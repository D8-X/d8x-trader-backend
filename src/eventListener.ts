import { ethers } from "ethers";
import { BigNumber } from "ethers";
import WebSocket from "ws";
import {
  TraderInterface,
  PerpetualDataHandler,
  SmartContractOrder,
  ABK64x64ToFloat,
  mul64x64,
  ONE_64x64,
} from "@d8x/perpetuals-sdk";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";

/**
 * Class that listens to blockchain events on
 * - limitorder books
 *      x onExecutionFailed (trader)
 *      x onPerpetualLimitOrderCreated (trader)
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
export default class EventListener {
  traderInterface: TraderInterface;
  fundingRate: Map<number, number>; // perpetualId -> funding rate
  openInterest: Map<number, number>; // perpetualId -> openInterest

  // subscription for perpetualId and trader address. Multiple websocket-clients can subscribe
  // (hence array of websockets)
  subscriptions: Map<number, Map<string, WebSocket.WebSocket[]>>; // perpetualId -> traderAddr -> ws[]
  clients: Map<WebSocket.WebSocket, Array<{ perpetualId: number; symbol: string; traderAddr: string }>>;

  constructor(network: string = "testnet") {
    this.fundingRate = new Map<number, number>();
    this.openInterest = new Map<number, number>();
    const sdkConfig = PerpetualDataHandler.readSDKConfig(network);
    this.traderInterface = new TraderInterface(sdkConfig);
    this.subscriptions = new Map<number, Map<string, WebSocket.WebSocket[]>>();
    this.clients = new Map<WebSocket.WebSocket, Array<{ perpetualId: number; symbol: string; traderAddr: string }>>();
  }

  public async initialize() {
    await this.traderInterface.createProxyInstance();
    this.addProxyEventHandlers();
  }

  public subscribe(ws: WebSocket.WebSocket, perpetualsSymbol: string, traderAddr: string) {
    console.log("subscribe");
    let id = this.traderInterface.getPerpIdFromSymbol(perpetualsSymbol);
    if (this.clients.get(ws) == undefined) {
      this.clients.set(ws, new Array<{ perpetualId: number; symbol: string; traderAddr: string }>());
    }
    this.clients.get(ws)?.push({ perpetualId: id, symbol: perpetualsSymbol, traderAddr: traderAddr });
    console.log(`new client: ws:${ws} ${traderAddr}`);
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
  }

  public unsubscribe(ws: WebSocket.WebSocket) {
    console.log(`unsubscribe client: ws:${ws}`);
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
      const idx = subscribers!.indexOf(ws, 0);
      if (idx > -1) {
        subscribers!.splice(idx, 1);
      }
      if (subscribers?.length == 0) {
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
   * Send websocket message
   * @param perpetualId perpetual id
   * @param message JSON-message to be sent
   * @param traderAddr optional: only send to this trader. Otherwise broadcast
   */
  private sendToSubscribers(perpetualId: number, message: string, traderAddr?: string) {
    // traderAddr -> ws
    let subscribers: Map<string, WebSocket.WebSocket[]> | undefined = this.subscriptions.get(perpetualId);
    if (subscribers == undefined) {
      console.log(`no subscribers for perpetual ${perpetualId}`);
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
    proxyContract.on(
      "Trade",
      (
        perpetualId: number,
        trader: string,
        positionId: string,
        order: SmartContractOrder,
        orderDigest: string,
        newPositionSizeBC: BigNumber,
        price: BigNumber
      ) => {
        this.onTrade(perpetualId, trader, positionId, order, orderDigest, newPositionSizeBC, price);
      }
    );
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
    this.openInterest.set(perpetualId, ABK64x64ToFloat(fOpenInterestBC));
    // send data to subscriber
    let obj: UpdateMarginAccount = {
      perpetualId: perpetualId,
      traderAddr: trader,
      positionId: positionId,
      positionBC: ABK64x64ToFloat(fPositionBC),
      cashCC: ABK64x64ToFloat(fCashCC),
      lockedInValueQC: ABK64x64ToFloat(fLockedInValueQC),
      fundingPaymentCC: ABK64x64ToFloat(fFundingPaymentCC),
    };
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
    let [newMidPrice, newMarkPrice, newIndexPrice] = EventListener.ConvertUpdateMarkPrice(
      fMidPricePremium,
      fMarkPricePremium,
      fSpotIndexPrice
    );
    let fundingRate = this.fundingRate.get(perpetualId);
    if (fundingRate == undefined) {
      fundingRate = 0;
    }
    let oi = this.openInterest.get(perpetualId);
    if (oi == undefined) {
      oi = 0;
    }
    let obj: PriceUpdate = {
      perpetualId: perpetualId,
      midPrice: newMidPrice,
      markPrice: newMarkPrice,
      indexPrice: newIndexPrice,
      fundingRate: fundingRate,
      openInterest: oi,
    };
    let wsMsg: WSMsg = { name: "PriceUpdate", obj: obj };
    let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onUpdateMarkPrice", "", wsMsg);
    // send to all subscribers
    this.sendToSubscribers(perpetualId, jsonMsg);
  }

  /**
   *
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
    price: BigNumber
  ) {
    // return transformed trade info
    let data: Trade = {
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
    console.log("onPerpetualLimitOrderCreated");
    // send to subscriber who sent the order
    let obj: LimitOrderCreated = {
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
  public onPerpetualLimitOrderCancelled(orderId: string) {
    console.log("onPerpetualLimitOrderCancelled");
    //let wsMsg: WSMsg = { name: "PerpetualLimitOrderCancelled", obj: { orderId: orderId } };
    //let jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onPerpetualLimitOrderCreated", "", wsMsg);
    // currently broadcasted:
    // this.sendToSubscribers(perpetualId, JSON.stringify(wsMsg));
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
    console.log("onExecutionFailed:", reason);
    let obj: ExecutionFailed = {
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
