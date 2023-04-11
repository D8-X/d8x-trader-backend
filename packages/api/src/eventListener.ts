import {
  ABK64x64ToFloat,
  BUY_SIDE,
  calculateLiquidationPriceCollateralBase,
  calculateLiquidationPriceCollateralQuanto,
  calculateLiquidationPriceCollateralQuote,
  CLOSED_SIDE,
  COLLATERAL_CURRENCY_BASE,
  COLLATERAL_CURRENCY_QUOTE,
  ExchangeInfo,
  getNewPositionLeverage,
  MarginAccount,
  mul64x64,
  NodeSDKConfig,
  ONE_64x64,
  PerpetualState,
  PerpetualStaticInfo,
  SELL_SIDE,
  SmartContractOrder,
  TraderInterface,
} from "@d8x/perpetuals-sdk";
import { BigNumber } from "ethers";
import WebSocket from "ws";

import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import IndexPriceInterface from "./indexPriceInterface";
import SDKInterface from "./sdkInterface";
import { ExecutionFailed, LimitOrderCreated, PriceUpdate, Trade, UpdateMarginAccount, WSMsg } from "utils/src/wsTypes";

/**
 * Class that listens to blockchain events on
 * - limitorder books
 *      - onExecutionFailed (trader)
 *      - onPerpetualLimitOrderCreated (trader)
 * - perpetual manager proxy
 *      - onUpdateMarkPrice (broadcast)
 *      - onUpdateFundingRate (broadcast via MarkPrice)
 *      - onUpdateMarginAccount (trader)
 *      - onPerpetualLimitOrderCancelled (trader)
 *      - onTrade (broadcast)
 * Subscriptions:
 * - subscribe to perpetual with trader-address
 * - will get most events as indicated above
 */

//onUpdateMarkPrice
//onUpdateUpdateFundingRate
//Order: onExecutionFailed
//       onPerpetualLimitOrderCreated
// proxy:
//      onUpdateMarginAccount
//      onPerpetualLimitOrderCancelled
//      onTrade
export default class EventListener extends IndexPriceInterface {
  traderInterface: TraderInterface;

  fundingRate: Map<number, number>; // perpetualId -> funding rate
  openInterest: Map<number, number>; // perpetualId -> openInterest
  lastBlockChainEventTs: number; //here we log the event occurence time to guess whether the connection is alive

  // subscription for perpetualId and trader address. Multiple websocket-clients can subscribe
  // (hence array of websockets)
  subscriptions: Map<number, Map<string, WebSocket.WebSocket[]>>; // perpetualId -> traderAddr -> ws[]
  clients: Map<WebSocket.WebSocket, Array<{ perpetualId: number; symbol: string; traderAddr: string }>>;

  constructor(sdkConfig: NodeSDKConfig) {
    super();
    this.lastBlockChainEventTs = Date.now();
    this.fundingRate = new Map<number, number>();
    this.openInterest = new Map<number, number>();
    this.traderInterface = new TraderInterface(sdkConfig);
    this.subscriptions = new Map<number, Map<string, WebSocket.WebSocket[]>>();
    this.clients = new Map<WebSocket.WebSocket, Array<{ perpetualId: number; symbol: string; traderAddr: string }>>();
  }

  public async initialize(sdkInterface: SDKInterface) {
    await super.initialize(sdkInterface);
    await this.traderInterface.createProxyInstance();
    sdkInterface.registerObserver(this);
    this.addProxyEventHandlers();
    this.lastBlockChainEventTs = Date.now();
  }

  /**
   * Time elapsed since last event was received.
   * Can be used to check "alive" status
   * @returns milliseconds since last event
   */
  public timeMsSinceLastBlockchainEvent(): number {
    return Date.now() - this.lastBlockChainEventTs;
  }

  private symbolFromPerpetualId(perpetualId: number): string {
    let symbol = this.traderInterface.getSymbolFromPerpId(perpetualId);
    return symbol || "";
  }

  /**
   *
   * @param ws websocket client
   * @param perpetualsSymbol symbol of the form BTC-USD-MATIC
   * @param traderAddr address of the trader
   * @returns true if newly subscribed
   */
  public subscribe(ws: WebSocket.WebSocket, perpetualsSymbol: string, traderAddr: string): boolean {
    console.log("subscribe");
    let id = this.traderInterface.getPerpIdFromSymbol(perpetualsSymbol);
    if (this.clients.get(ws) == undefined) {
      this.clients.set(ws, new Array<{ perpetualId: number; symbol: string; traderAddr: string }>());
    }
    let perpArray: Array<{ perpetualId: number; symbol: string; traderAddr: string }> = this.clients.get(ws) || [];
    // check that not already subscribed
    for (let k = 0; k < perpArray?.length; k++) {
      if (perpArray[k].perpetualId == id && perpArray[k].traderAddr == traderAddr) {
        // already subscribed
        console.log(`client tried to subscribe again for perpetual ${id} and trader ${traderAddr}`);
        return false;
      }
    }
    this.clients.get(ws)?.push({ perpetualId: id, symbol: perpetualsSymbol, traderAddr: traderAddr });
    console.log(`${new Date(Date.now())}: #ws=${this.clients.size}, new client ${traderAddr}`);
    let perpSubscribers = this.subscriptions.get(id);
    if (perpSubscribers == undefined) {
      this.subscriptions.set(id, new Map<string, WebSocket.WebSocket[]>());
      this.addOrderBookEventHandlers(perpetualsSymbol);
      perpSubscribers = this.subscriptions.get(id);
    }
    let traderSubscribers = perpSubscribers!.get(traderAddr);
    if (traderSubscribers == undefined) {
      perpSubscribers!.set(traderAddr, new Array<WebSocket>());
      traderSubscribers = perpSubscribers!.get(traderAddr);
    }
    traderSubscribers!.push(ws);
    console.log(`subscribed to perp ${perpetualsSymbol} with id ${id}`);
    return true;
  }

  public unsubscribe(ws: WebSocket.WebSocket) {
    console.log(`${new Date(Date.now())}: #ws=${this.clients.size}, client unsubscribed`);
    //subscriptions: Map<number, Map<string, WebSocket.WebSocket[]>>;
    let clientSubscriptions = this.clients.get(ws);
    if (clientSubscriptions == undefined) {
      console.log("unknown client unsubscribed");
      return;
    }
    for (let k = 0; k < clientSubscriptions?.length; k++) {
      let id = clientSubscriptions[k].perpetualId;
      let traderMap = this.subscriptions.get(id);
      if (traderMap == undefined) {
        continue;
      }
      let subscribers = traderMap.get(clientSubscriptions[k].traderAddr);
      if (subscribers != undefined) {
        const idx = subscribers!.indexOf(ws, 0);
        if (idx > -1) {
          subscribers!.splice(idx, 1);
        }
      }
      if (subscribers == undefined || subscribers?.length == 0) {
        traderMap.delete(clientSubscriptions[k].traderAddr);
      }
      if (this.subscriptions.get(id)?.keys.length == 0) {
        console.log(`no more subscribers for perpetualId ${id}`);
        // unsubscribe events
        this.removeOrderBookEventHandlers(clientSubscriptions[k].symbol);
      }
    }
    this.clients.delete(ws);
  }

  /**
   * Handles updates from sdk interface
   * @param msg from observable
   */
  protected async _update(msg: String) {
    // we receive a message from the observable sdk
    // on update exchange info; we update price info and inform subscribers
    console.log("received update from sdkInterface");
    let info: ExchangeInfo = await this.traderInterface.exchangeInfo();
    // update fundingRate: Map<number, number>; // perpetualId -> funding rate
    //        openInterest: Map<number, number>; // perpetualId -> openInterest
    let pools = info.pools;
    for (let k = 0; k < pools.length; k++) {
      let pool = pools[k];
      for (let j = 0; j < pool.perpetuals.length; j++) {
        let perp: PerpetualState = pool.perpetuals[j];
        this.fundingRate.set(perp.id, perp.currentFundingRateBps / 1e4);
        this.openInterest.set(perp.id, perp.openInterestBC);
        this.updateMarkPrice(perp.id, perp.midPrice, perp.markPrice, perp.indexPrice);
      }
    }
  }

  /**
   * Send websocket message
   * @param perpetualId perpetual id
   * @param message JSON-message to be sent
   * @param traderAddr optional: only send to this trader. Otherwise broadcast
   */
  private sendToSubscribers(perpetualId: number, message: string, traderAddr?: string) {
    // traderAddr -> ws
    let subscribers: Map<string, WebSocket.WebSocket[]> | undefined = this.subscriptions.get(perpetualId);
    if (subscribers == undefined) {
      // console.log(`no subscribers for perpetual ${perpetualId}`);
      return;
    }
    if (traderAddr != undefined) {
      let traderWs: WebSocket[] | undefined = subscribers.get(traderAddr);
      if (traderWs == undefined) {
        console.log(`no subscriber to trader ${traderAddr} in perpetual ${perpetualId}`);
        return;
      }
      // send to all subscribers of this perpetualId and traderAddress
      for (let k = 0; k < traderWs.length; k++) {
        traderWs[k].send(message);
      }
    } else {
      // broadcast
      for (const [trader, wsArr] of subscribers) {
        for (let k = 0; k < wsArr.length; k++) {
          wsArr[k].send(message);
        }
      }
    }
  }

  /**
   * onUpdateMarkPrice
   * onUpdateFundingRate
   * onUpdateMarginAccount
   * onPerpetualLimitOrderCancelled
   * onTrade
   */
  private addProxyEventHandlers() {
    let proxyContract = this.traderInterface.getReadOnlyProxyInstance();
    proxyContract.on("UpdateMarkPrice", (perpetualId, fMidPricePremium, fMarkPricePremium, fSpotIndexPrice) => {
      this.onUpdateMarkPrice(perpetualId, fMidPricePremium, fMarkPricePremium, fSpotIndexPrice);
    });
    proxyContract.on("UpdateFundingRate", (perpetualId: number, fFundingRate: BigNumber) => {
      this.onUpdateFundingRate(perpetualId, fFundingRate);
    });
    proxyContract.on(
      "UpdateMarginAccount",
      (
        perpetualId: number,
        trader: string,
        positionId: string,
        fPositionBC: BigNumber,
        fCashCC: BigNumber,
        fLockedInValueQC: BigNumber,
        fFundingPaymentCC: BigNumber,
        fOpenInterestBC: BigNumber
      ) => {
        this.onUpdateMarginAccount(
          perpetualId,
          trader,
          positionId,
          fPositionBC,
          fCashCC,
          fLockedInValueQC,
          fFundingPaymentCC,
          fOpenInterestBC
        );
      }
    );
    proxyContract.on("TokensDeposited", (perpetualId: number, trader: string, amount: BigNumber) => {
      this.onUpdateMarginCollateral(perpetualId, trader, amount);
    });
    proxyContract.on("TokensWithdrawn", (perpetualId: number, trader: string, amount: BigNumber) => {
      this.onUpdateMarginCollateral(perpetualId, trader, amount.mul(-1));
    });

    proxyContract.on(
      "Trade",
      (
        perpetualId: number,
        trader: string,
        positionId: string,
        order: SmartContractOrder,
        orderDigest: string,
        newPositionSizeBC: BigNumber,
        price: BigNumber,
        fFeeCC: BigNumber,
        fPnlCC: BigNumber
      ) => {
        /**
     *  event Trade(
        uint24 indexed perpetualId,
        address indexed trader,
        bytes16 indexed positionId,
        IPerpetualOrder.Order order,
        bytes32 orderDigest,
        int128 newPositionSizeBC,
        int128 price,
        int128 fFeeCC,
        int128 fPnlCC
    );
     */
        this.onTrade(perpetualId, trader, positionId, order, orderDigest, newPositionSizeBC, price, fFeeCC, fPnlCC);
      }
    );

    proxyContract.on("PerpetualLimitOrderCancelled", (perpetualId: number, digest: string) => {
      this.onPerpetualLimitOrderCancelled(perpetualId, digest);
    });
  }

  /**
   * Event handler registration for order book
   * @param symbol order book symbol
   */
  private addOrderBookEventHandlers(symbol: string) {
    let contract = this.traderInterface.getOrderBookContract(symbol);
    contract.on(
      "PerpetualLimitOrderCreated",
      (
        perpetualId: number,
        trader: string,
        referrerAddr: string,
        brokerAddr: string,
        Order: SmartContractOrder,
        digest: string
      ) => {
        this.onPerpetualLimitOrderCreated(perpetualId, trader, referrerAddr, brokerAddr, Order, digest);
      }
    );
    contract.on("ExecutionFailed", (perpetualId: number, trader: string, digest: string, reason: string) => {
      this.onExecutionFailed(perpetualId, trader, digest, reason);
    });
  }

  /**
   * Unlisten/Remove event handlers for an order-book
   * @param symbol symbol for order-book
   */
  private removeOrderBookEventHandlers(symbolOrId: string) {
    let contract = this.traderInterface.getOrderBookContract(symbolOrId);
    // contract.removeAllListeners("PerpetualLimitOrderCancelled");
    contract.removeAllListeners("PerpetualLimitOrderCreated");
    contract.removeAllListeners("ExecutionFailed");
  }

  /**
   * emit UpdateFundingRate(_perpetual.id, fFundingRate)
   * We store the funding rate locally and send it with other events to the price subscriber
   * @param perpetualId
   * @param fFundingRate
   */
  private onUpdateFundingRate(perpetualId: number, fFundingRate: BigNumber) {
    this.lastBlockChainEventTs = Date.now();
    let rate = ABK64x64ToFloat(fFundingRate);
    this.fundingRate.set(perpetualId, rate);
  }

  /**
   * This function is async
   * We store open interest locally and send it with other events to the price subscriber
   * @param perpetualId id of the perpetual
   * @param trader trader address
   * @param positionId position id
   * @param fPositionBC position size in base currency
   * @param fCashCC margin collateral in margin account
   * @param fLockedInValueQC pos*average opening price
   * @param fFundingPaymentCC funding payment made
   * @param fOpenInterestBC open interest
   */
  public async onUpdateMarginAccount(
    perpetualId: number,
    trader: string,
    positionId: string,
    fPositionBC: BigNumber,
    fCashCC: BigNumber,
    fLockedInValueQC: BigNumber,
    fFundingPaymentCC: BigNumber,
    fOpenInterestBC: BigNumber
  ): Promise<void> {
    this.lastBlockChainEventTs = Date.now();
    this.openInterest.set(perpetualId, ABK64x64ToFloat(fOpenInterestBC));

    let symbol = this.symbolFromPerpetualId(perpetualId);
    let state = await this.sdkInterface!.extractPerpetualStateFromExchangeInfo(symbol);
    let info = <PerpetualStaticInfo>JSON.parse(this.sdkInterface!.perpetualStaticInfo(symbol));
    // margin account
    let posBC = ABK64x64ToFloat(fPositionBC);
    let lockedInQC = ABK64x64ToFloat(fLockedInValueQC);
    let cashCC = ABK64x64ToFloat(fCashCC);
    let lvg = getNewPositionLeverage(
      0,
      cashCC,
      posBC,
      lockedInQC,
      state.indexPrice,
      state.collToQuoteIndexPrice,
      state.markPrice
    );
    let S2Liq, S3Liq;
    if (info.collateralCurrencyType == COLLATERAL_CURRENCY_BASE) {
      S2Liq = calculateLiquidationPriceCollateralBase(lockedInQC, posBC, cashCC, info.maintenanceMarginRate);
      S3Liq = S2Liq;
    } else if (info.collateralCurrencyType == COLLATERAL_CURRENCY_QUOTE) {
      S2Liq = calculateLiquidationPriceCollateralQuote(lockedInQC, posBC, cashCC, info.maintenanceMarginRate);
      S3Liq = state.collToQuoteIndexPrice;
    } else {
      S2Liq = calculateLiquidationPriceCollateralQuanto(
        lockedInQC,
        posBC,
        cashCC,
        info.maintenanceMarginRate,
        state.collToQuoteIndexPrice,
        state.markPrice
      );
      S3Liq = S2Liq;
    }

    let obj: UpdateMarginAccount = {
      // positionRisk
      symbol: symbol,
      positionNotionalBaseCCY: Math.abs(posBC),
      side: posBC > 0 ? BUY_SIDE : posBC < 0 ? SELL_SIDE : CLOSED_SIDE,
      entryPrice: posBC == 0 ? 0 : Math.abs(lockedInQC / posBC),
      leverage: lvg,
      markPrice: state.markPrice,
      unrealizedPnlQuoteCCY: posBC * state.markPrice - lockedInQC,
      unrealizedFundingCollateralCCY: 0,
      collateralCC: cashCC,
      liquidationPrice: [S2Liq, S3Liq],
      liquidationLvg: posBC == 0 ? 0 : 1 / info.maintenanceMarginRate,
      collToQuoteConversion: state.collToQuoteIndexPrice,
      // extra info
      perpetualId: perpetualId,
      traderAddr: trader,
      positionId: positionId,
      fundingPaymentCC: ABK64x64ToFloat(fFundingPaymentCC),
    };
    // send data to subscriber
    let wsMsg: WSMsg = { name: "UpdateMarginAccount", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onUpdateMarginAccount", "", wsMsg);
    // send to subscribers of trader/perpetual
    this.sendToSubscribers(perpetualId, jsonMsg, trader);
  }

  private async onUpdateMarginCollateral(perpetualId: number, trader: string, amount: BigNumber) {
    this.lastBlockChainEventTs = Date.now();
    let symbol = this.sdkInterface!.getSymbolFromPerpId(perpetualId)!;
    let pos = <MarginAccount>JSON.parse(await this.sdkInterface!.positionRisk(trader, symbol));
    if (pos.positionNotionalBaseCCY == 0 && amount.lt(0)) {
      // position is zero after a withdrawal: this will be caught as a margin account update, ignore
      return;
    }
    // either an opening trade, or trader just deposited to an existing position
    let obj: UpdateMarginAccount = {
      // positionRisk
      symbol: symbol,
      positionNotionalBaseCCY: pos.positionNotionalBaseCCY,
      side: pos.side,
      entryPrice: pos.entryPrice,
      leverage: pos.leverage,
      markPrice: pos.markPrice,
      unrealizedPnlQuoteCCY: pos.unrealizedPnlQuoteCCY,
      unrealizedFundingCollateralCCY: pos.unrealizedFundingCollateralCCY,
      collateralCC: pos.collateralCC,
      liquidationPrice: pos.liquidationPrice,
      liquidationLvg: pos.liquidationLvg,
      collToQuoteConversion: pos.collToQuoteConversion,
      // extra info
      perpetualId: perpetualId,
      traderAddr: trader,
      positionId: "", // not used in the front-end
      fundingPaymentCC: 0,
    };
    // send data to subscriber
    let wsMsg: WSMsg = { name: "UpdateMarginAccount", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onUpdateMarginAccount", "", wsMsg);
    // send to subscribers of trader/perpetual
    this.sendToSubscribers(perpetualId, jsonMsg, trader);
  }

  /**
   * Handle the event UpdateMarkPrice and update relevant
   * data
   * @param perpetualId perpetual Id
   * @param fMarkPricePremium premium rate in ABDK format
   * @param fSpotIndexPrice spot index price in ABDK format
   */
  public onUpdateMarkPrice(
    perpetualId: number,
    fMidPricePremium: BigNumber,
    fMarkPricePremium: BigNumber,
    fSpotIndexPrice: BigNumber
  ): void {
    this.lastBlockChainEventTs = Date.now();
    let [newMidPrice, newMarkPrice, newIndexPrice] = EventListener.ConvertUpdateMarkPrice(
      fMidPricePremium,
      fMarkPricePremium,
      fSpotIndexPrice
    );
    console.log("eventListener: onUpdateMarkPrice");
    // update internal storage that is streamed to websocket
    // and adjust mid/idx price based on newest index
    [newMidPrice, newMarkPrice, newIndexPrice] = this.updatePricesOnMarkPriceEvent(
      perpetualId,
      newMidPrice,
      newMarkPrice,
      newIndexPrice
    );
    // notify websocket listeners (using prices based on most recent websocket price)
    this.updateMarkPrice(perpetualId, newMidPrice, newMarkPrice, newIndexPrice);

    // update data in sdkInterface's exchangeInfo
    let fundingRate = this.fundingRate.get(perpetualId) || 0;
    let oi = this.openInterest.get(perpetualId) || 0;
    let symbol = this.symbolFromPerpetualId(perpetualId);

    if (this.sdkInterface != undefined && symbol != undefined) {
      this.sdkInterface.updateExchangeInfoNumbersOfPerpetual(
        symbol,
        [newMidPrice, newMarkPrice, newIndexPrice, oi, fundingRate * 1e4],
        ["midPrice", "markPrice", "indexPrice", "openInterestBC", "currentFundingRateBps"]
      );
    } else {
      const errStr = `onUpdateMarkPrice: no perpetual found for id ${perpetualId} ${symbol} or no sdkInterface available`;
      throw new Error(errStr);
    }
  }

  /**
   * Internal function to update prices.
   * Called either by blockchain event handler (onUpdateMarkPrice),
   * or on update of the observable sdkInterface (after exchangeInfo update),
   * or from parent class on websocket update.
   * Informs websocket subsribers
   * @param perpetualId id of the perpetual for which prices are being updated
   * @param newMidPrice mid price in decimals
   * @param newMarkPrice mark price
   * @param newIndexPrice index price
   */
  protected updateMarkPrice(perpetualId: number, newMidPrice: number, newMarkPrice: number, newIndexPrice: number) {
    let fundingRate = this.fundingRate.get(perpetualId) || 0;
    let oi = this.openInterest.get(perpetualId) || 0;
    let symbol = this.symbolFromPerpetualId(perpetualId);
    let obj: PriceUpdate = {
      symbol: symbol,
      perpetualId: perpetualId,
      midPrice: newMidPrice,
      markPrice: newMarkPrice,
      indexPrice: newIndexPrice,
      fundingRate: fundingRate * 1e4, // in bps so it matches exchangeInfo
      openInterest: oi,
    };
    let wsMsg: WSMsg = { name: "PriceUpdate", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onUpdateMarkPrice", "", wsMsg);
    // send to all subscribers
    this.sendToSubscribers(perpetualId, jsonMsg);
  }

  /**
   * @param perpetualId perpetual id
   * @param trader trader address
   * @param positionId position id
   * @param order order struct
   * @param orderDigest order id
   * @param newPositionSizeBC new pos size in base currency ABDK
   * @param price price in ABDK format
   */
  private onTrade(
    perpetualId: number,
    trader: string,
    positionId: string,
    order: SmartContractOrder,
    orderDigest: string,
    newPositionSizeBC: BigNumber,
    price: BigNumber,
    fFeeCC: BigNumber,
    fPnlCC: BigNumber
  ) {
    this.lastBlockChainEventTs = Date.now();
    let symbol = this.symbolFromPerpetualId(perpetualId);
    // return transformed trade info
    let data: Trade = {
      symbol: symbol,
      perpetualId: perpetualId,
      traderAddr: trader,
      positionId: positionId,
      orderId: orderDigest,
      newPositionSizeBC: ABK64x64ToFloat(newPositionSizeBC),
      executionPrice: ABK64x64ToFloat(price),
    };
    let wsMsg: WSMsg = { name: "Trade", obj: data };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onTrade", "", wsMsg);
    // broadcast
    this.sendToSubscribers(perpetualId, jsonMsg);
  }

  /**
   * event PerpetualLimitOrderCreated(
   *    uint24 indexed perpetualId,
   *    address indexed trader,
   *    address referrerAddr,
   *    address brokerAddr,
   *    Order order,
   *    bytes32 digest
   *)
   * @param perpetualId id of the perpetual
   * @param trader address of the trader
   * @param referrerAddr address of the referrer
   * @param brokerAddr address of the broker
   * @param Order order struct
   * @param digest order id
   */
  private onPerpetualLimitOrderCreated(
    perpetualId: number,
    trader: string,
    referrerAddr: string,
    brokerAddr: string,
    Order: SmartContractOrder,
    digest: string
  ): void {
    this.lastBlockChainEventTs = Date.now();
    console.log("onPerpetualLimitOrderCreated");
    // send to subscriber who sent the order
    let symbol = this.symbolFromPerpetualId(perpetualId);
    let obj: LimitOrderCreated = {
      symbol: symbol,
      perpetualId: perpetualId,
      traderAddr: trader,
      brokerAddr: brokerAddr,
      orderId: digest,
    };
    let wsMsg: WSMsg = { name: "PerpetualLimitOrderCreated", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onPerpetualLimitOrderCreated", "", wsMsg);
    // only send to trader that subscribed
    this.sendToSubscribers(perpetualId, jsonMsg, trader);
  }

  /**
   * Event emitted by perpetual proxy: event PerpetualLimitOrderCancelled(bytes32 indexed orderHash);
   * event PerpetualLimitOrderCancelled(bytes32 indexed orderHash);
   * @param orderId string order id/digest
   */
  public onPerpetualLimitOrderCancelled(perpetualId: number, orderId: string) {
    this.lastBlockChainEventTs = Date.now();
    console.log("onPerpetualLimitOrderCancelled");
    let wsMsg: WSMsg = { name: "PerpetualLimitOrderCancelled", obj: { orderId: orderId } };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onPerpetualLimitOrderCancelled", "", wsMsg);
    // currently broadcasted:
    this.sendToSubscribers(perpetualId, jsonMsg);
  }

  /**
   * event ExecutionFailed(
   *    uint24 indexed perpetualId,
   *    address indexed trader,
   *    bytes32 digest,
   *    string reason
   * );
   * @param perpetualId id of the perpetual
   * @param trader address of the trader
   * @param digest digest of the order/cancel order
   * @param reason reason why the execution failed
   */
  private onExecutionFailed(perpetualId: number, trader: string, digest: string, reason: string) {
    this.lastBlockChainEventTs = Date.now();
    console.log("onExecutionFailed:", reason);
    let symbol = this.symbolFromPerpetualId(perpetualId);
    let obj: ExecutionFailed = {
      symbol: symbol,
      perpetualId: perpetualId,
      traderAddr: trader,
      orderId: digest,
      reason: reason,
    };
    let wsMsg: WSMsg = { name: "ExecutionFailed", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onExecutionFailed", "", wsMsg);
    // send to subscribers
    this.sendToSubscribers(perpetualId, jsonMsg, trader);
  }

  /**
   * UpdateMarkPrice(
   *  uint24 indexed perpetualId,
   *  int128 fMarkPricePremium,
   *  int128 fSpotIndexPrice
   * )
   * @param fMarkPricePremium premium rate in ABDK format
   * @param fSpotIndexPrice spot index price in ABDK format
   * @returns mark price and spot index in float
   */
  private static ConvertUpdateMarkPrice(
    fMidPricePremium: BigNumber,
    fMarkPricePremium: BigNumber,
    fSpotIndexPrice: BigNumber
  ): [number, number, number] {
    let fMarkPrice = mul64x64(fSpotIndexPrice, ONE_64x64.add(fMarkPricePremium));
    let fMidPrice = mul64x64(fSpotIndexPrice, ONE_64x64.add(fMidPricePremium));
    let midPrice = ABK64x64ToFloat(fMidPrice);
    let markPrice = ABK64x64ToFloat(fMarkPrice);
    let indexPrice = ABK64x64ToFloat(fSpotIndexPrice);
    return [midPrice, markPrice, indexPrice];
  }
}
