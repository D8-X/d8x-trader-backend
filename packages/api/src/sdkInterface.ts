import {
  BUY_SIDE,
  ExchangeInfo,
  NodeSDKConfig,
  Order,
  PerpetualState,
  PoolState,
  SELL_SIDE,
  TraderInterface,
  MarginAccount,
  floatToABK64x64,
  SmartContractOrder,
  D8X_SDK_VERSION,
  ZERO_ADDRESS,
} from "@d8x/perpetuals-sdk";
import dotenv from "dotenv";
import Redis from "ioredis";
import BrokerIntegration from "./brokerIntegration";
import Observable from "./observable";
import { extractErrorMsg, constructRedis } from "utils";

export default class SDKInterface extends Observable {
  private apiInterface: TraderInterface | undefined = undefined;
  private redisClient: Redis;
  private broker: BrokerIntegration;
  TIMEOUTSEC = 5 * 60; // timeout for exchange info
  private MUTEX_TS_EXCHANGE_INFO = 0; // mutex for exchange info query

  constructor(broker: BrokerIntegration) {
    super();
    dotenv.config();
    this.redisClient = constructRedis("SDK Interface");
    this.broker = broker;
  }

  public async initialize(sdkConfig: NodeSDKConfig) {
    this.apiInterface = new TraderInterface(sdkConfig);
    await this.apiInterface.createProxyInstance();
    await this.broker.initialize(sdkConfig);
    const brokerAddress = await this.broker.getBrokerAddress();
    console.log(`Main API initialized broker address=`, brokerAddress);
    console.log(`SDK v${D8X_SDK_VERSION} API initialized`);
  }

  private async cacheExchangeInfo() {
    let tsQuery = Date.now();
    await this.redisClient.hset("exchangeInfo", ["ts:query", tsQuery]);
    let xchInfo = await this.apiInterface!.exchangeInfo();
    let info = JSON.stringify(xchInfo);
    await this.redisClient.hset("exchangeInfo", [
      "ts:response",
      Date.now(),
      "content",
      info,
    ]);
    this.notifyObservers("exchangeInfo");
    return info;
  }

  public async exchangeInfo(): Promise<string> {
    let obj = await this.redisClient.hgetall("exchangeInfo");
    let info: string = "";
    // console.log("obj=", obj);
    if (!Object.prototype.hasOwnProperty.call(obj, "ts:query")) {
      console.log("first time query");
      info = await this.cacheExchangeInfo();
    } else if (!Object.prototype.hasOwnProperty.call(obj, "content")) {
      console.log("re-query exchange info (latest: invalid)");
      info = await this.cacheExchangeInfo();
    } else {
      let timeElapsedS = (Date.now() - parseInt(obj["ts:query"])) / 1000;
      // prevent multiple clients calling at the same time via "MUTEX"
      let delay = Date.now() - this.MUTEX_TS_EXCHANGE_INFO;
      if (delay > 60_000 && timeElapsedS > this.TIMEOUTSEC) {
        this.MUTEX_TS_EXCHANGE_INFO = Date.now();
        // reload data through API
        // no await
        console.log("re-query exchange info (latest: expired)");
        this.cacheExchangeInfo();
      }
      info = obj["content"];
    }

    return info;
  }

  /**
   * Get the loyality score of the trader
   * @param traderAddr address of the trader
   * @returns loyality score
   */
  public async traderLoyalty(traderAddr: string): Promise<string> {
    let score = await this.apiInterface!.getTraderLoyalityScore(traderAddr);
    return score.toString();
  }

  public perpetualStaticInfo(symbol: string): string {
    let staticInfo = this.apiInterface!.getPerpetualStaticInfo(symbol);
    let info = JSON.stringify(staticInfo);
    return info;
  }

  /**
   * Get perpetual symbol from perpetual id
   * @param perpId id of perpetual
   * @returns symbol (BTC-USD-MATIC) or undefined - not JSON
   */
  public getSymbolFromPerpId(perpId: number): string | undefined {
    return this.apiInterface!.getSymbolFromPerpId(perpId);
  }

  public async updateExchangeInfoNumbersOfPerpetual(
    symbol: string,
    values: number[],
    propertyNames: string[]
  ) {
    let obj = await this.redisClient.hgetall("exchangeInfo");
    let info = <ExchangeInfo>JSON.parse(obj["content"]);
    let [k, j] = SDKInterface.findPoolAndPerpIdx(symbol, info);
    let perpState: PerpetualState = info.pools[k].perpetuals[j];
    for (let m = 0; m < values.length; m++) {
      switch (propertyNames[m]) {
        case "indexPrice":
          perpState.indexPrice = values[m];
          break;
        case "markPrice":
          perpState.markPrice = values[m];
          break;
        case "currentFundingRateBps":
          if (values[m] != 0) {
            perpState.currentFundingRateBps = values[m];
          }
          break;
        case "midPrice":
          perpState.midPrice = values[m];
          break;
        case "openInterestBC":
          if (values[m] != 0) {
            perpState.openInterestBC = values[m];
          }
          break;
        default:
          throw new Error(`unknown property name ${propertyNames[m]}`);
      }
    }
    // store back to redis: we don't update the timestamp "ts:query", so that
    // all information will still be pulled at some time
    let infoStr = JSON.stringify(info);
    await this.redisClient.hset("exchangeInfo", [
      "ts:response",
      Date.now(),
      "content",
      infoStr,
    ]);
    // we do not notify the observers since this function is called as a result of eventListener changes and
    // eventListeners are observers
  }

  public static findPoolIdx(poolSymbol: string, pools: PoolState[]): number {
    let k = 0;
    while (k < pools.length) {
      if (pools[k].poolSymbol == poolSymbol) {
        // pool found
        return k;
      }
      k++;
    }
    return -1;
  }

  public static findPerpetualInPool(
    base: string,
    quote: string,
    perpetuals: PerpetualState[]
  ): number {
    let k = 0;
    while (k < perpetuals.length) {
      if (
        perpetuals[k].baseCurrency == base &&
        perpetuals[k].quoteCurrency == quote
      ) {
        // perpetual found
        return k;
      }
      k++;
    }
    return -1;
  }

  public static findPoolAndPerpIdx(
    symbol: string,
    info: ExchangeInfo
  ): [number, number] {
    let pools = <PoolState[]>info.pools;
    let symbols = symbol.split("-");
    let k = SDKInterface.findPoolIdx(symbols[2], pools);
    if (k == -1) {
      throw new Error(`No pool found with symbol ${symbols[2]}`);
    }
    let j = SDKInterface.findPerpetualInPool(
      symbols[0],
      symbols[1],
      pools[k].perpetuals
    );
    if (j == -1) {
      throw new Error(`No perpetual found with symbol ${symbol}`);
    }
    return [k, j];
  }

  /**
   * Get the PerpetualState from exchange info
   * @param symbol perpetual symbol (e.g., BTC-USD-MATIC)
   */
  public async extractPerpetualStateFromExchangeInfo(
    symbol: string
  ): Promise<PerpetualState> {
    let info = JSON.parse(await this.exchangeInfo());
    let [k, j] = SDKInterface.findPoolAndPerpIdx(symbol, info);
    let perpState: PerpetualState = info.pools[k].perpetuals[j];
    return perpState;
  }

  public async getPerpetualPriceOfType(
    symbol: string,
    priceType: string
  ): Promise<string> {
    try {
      let res;
      switch (priceType) {
        case "mid": {
          res = await this.apiInterface?.getPerpetualMidPrice(symbol);
          break;
        }
        case "mark": {
          res = await this.apiInterface?.getMarkPrice(symbol);
          break;
        }
        case "oracle": {
          let components = symbol.split("-");
          res = await this.apiInterface?.getOraclePrice(
            components[0],
            components[1]
          );
          break;
        }
        default: {
          throw new Error("price type unknown");
        }
      }
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  private checkAPIInitialized() {
    if (this.apiInterface == undefined) {
      throw Error("SDKInterface not initialized");
    }
  }

  /**
   * Send open orders for a given trader in either one perpetual or
   * all perpetuals of the pool
   * @param addr trader address
   * @param symbol either a pool symbol ("MATIC") or a perpetual ("BTC-USD-MATIC")
   * @returns JSON array with open orders { orders: Order[]; orderIds: string[] }
   */
  public async openOrders(addr: string, symbol?: string) {
    try {
      this.checkAPIInitialized();
      let res = await this.apiInterface?.openOrders(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  /**
   * Send position risk for a given trader in either one perpetual or
   * all perpetuals of the pool
   * @param addr address of the trader
   * @param symbol either a pool symbol ("MATIC") or a perpetual ("BTC-USD-MATIC")
   * @returns JSON array with MarginAccount
   */
  public async positionRisk(addr: string, symbol?: string) {
    this.checkAPIInitialized();
    let resArray = await this.apiInterface!.positionRisk(addr, symbol);
    return JSON.stringify(resArray);
  }

  public async maxOrderSizeForTrader(
    addr: string,
    symbol: string
  ): Promise<string> {
    this.checkAPIInitialized();
    const sizes = await this.apiInterface!.maxOrderSizeForTrader(addr, symbol);
    return JSON.stringify({ buy: sizes.buy, sell: sizes.sell });
  }

  public async getCurrentTraderVolume(
    traderAddr: string,
    symbol: string
  ): Promise<string> {
    this.checkAPIInitialized();
    let vol = await this.apiInterface!.getCurrentTraderVolume(
      symbol,
      traderAddr
    );
    return JSON.stringify(vol);
  }

  public async getOrderIds(
    traderAddr: string,
    symbol: string
  ): Promise<string> {
    this.checkAPIInitialized();
    let orderBookContract = this.apiInterface!.getOrderBookContract(symbol);
    let ids = await TraderInterface.orderIdsOfTrader(
      traderAddr,
      orderBookContract
    );
    return JSON.stringify(ids);
  }

  public async queryFee(
    traderAddr: string,
    poolSymbol: string
  ): Promise<string> {
    this.checkAPIInitialized();
    let brokerAddr = await this.broker.getBrokerAddress();
    let fee = await this.apiInterface?.queryExchangeFee(
      poolSymbol,
      traderAddr,
      brokerAddr
    );
    if (fee == undefined) {
      throw new Error("could not retreive fee");
    }
    fee = Math.round(
      fee * 1e5 + (await this.broker.getBrokerFeeTBps(traderAddr))
    );
    return JSON.stringify(fee);
  }

  public async orderDigest(
    orders: Order[],
    traderAddr: string
  ): Promise<string> {
    this.checkAPIInitialized();
    //console.log("order=", orders);
    if (!orders.every((order: Order) => order.symbol == orders[0].symbol)) {
      throw Error("orders must have the same symbol");
    }
    let SCOrders = await Promise.all(
      orders!.map(async (order: Order) => {
        order.brokerFeeTbps = await this.broker.getBrokerFeeTBps(
          traderAddr,
          order
        );
        order.brokerAddr = await this.broker.getBrokerAddress();
        let SCOrder = this.apiInterface?.createSmartContractOrder(
          order,
          traderAddr
        );
        SCOrder!.brokerSignature = await this.broker.signOrder(SCOrder!);
        return SCOrder!;
      })
    );
    // now we can create the digest that is to be signed by the trader
    let digests = await Promise.all(
      SCOrders.map((SCOrder: SmartContractOrder) => {
        return this.apiInterface?.orderDigest(SCOrder);
      })
    );
    let ids = await Promise.all(
      digests.map((digest) => {
        return this.apiInterface!.digestTool.createOrderId(digest!);
      })
    );
    // also return the order book address and postOrder ABI
    let obAddr = this.apiInterface!.getOrderBookAddress(orders[0].symbol);
    let postOrderABI = [
      this.apiInterface!.getOrderBookABI(orders[0].symbol, "postOrder"),
      this.apiInterface!.getOrderBookABI(orders[0].symbol, "postOrders"),
    ];
    return JSON.stringify({
      digests: digests,
      orderIds: ids,
      OrderBookAddr: obAddr,
      abi: postOrderABI,
      SCOrders: SCOrders,
    });
  }

  public async positionRiskOnTrade(
    order: Order,
    traderAddr: string
  ): Promise<string> {
    this.checkAPIInitialized();
    let positionRisk: MarginAccount[] | undefined =
      await this.apiInterface!.positionRisk(traderAddr, order.symbol);
    let res = await this.apiInterface!.positionRiskOnTrade(
      traderAddr,
      order,
      positionRisk[0]
    );
    return JSON.stringify({
      newPositionRisk: res.newPositionRisk,
      orderCost: res.orderCost,
    });
  }

  public async positionRiskOnCollateralAction(
    traderAddr: string,
    deltaCollateral: number,
    positionRisk: MarginAccount
  ): Promise<string> {
    this.checkAPIInitialized();
    let res: MarginAccount =
      await this.apiInterface!.positionRiskOnCollateralAction(
        deltaCollateral,
        positionRisk
      );
    return JSON.stringify({
      newPositionRisk: res,
      availableMargin: await this.apiInterface!.getAvailableMargin(
        traderAddr,
        positionRisk.symbol
      ),
    });
  }

  public async addCollateral(symbol: string, amount: string): Promise<string> {
    this.checkAPIInitialized();
    // contract data
    let proxyAddr = this.apiInterface!.getProxyAddress();
    let proxyABI = this.apiInterface!.getProxyABI("deposit");
    // call data
    let perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
    // the amount as a Hex string, such that BigNumber.from(amountHex) == floatToABK64(amount)
    let amountHex = floatToABK64x64(Number(amount)).toHexString();
    let priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
    return JSON.stringify({
      perpId: perpId,
      proxyAddr: proxyAddr,
      abi: proxyABI,
      amountHex: amountHex,
      priceUpdate: {
        updateData: priceUpdate.priceFeedVaas,
        publishTimes: priceUpdate.timestamps,
        updateFee:
          this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
          priceUpdate.priceFeedVaas.length,
      },
    });
  }

  public async removeCollateral(
    symbol: string,
    amount: string
  ): Promise<string> {
    this.checkAPIInitialized();
    // contract data
    let proxyAddr = this.apiInterface!.getProxyAddress();
    let proxyABI = this.apiInterface!.getProxyABI("withdraw");
    // call data
    let perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
    // the amount as a Hex string, such that BigNumber.from(amountHex) == floatToABK64(amount)
    let amountHex = floatToABK64x64(Number(amount)).toHexString();
    let priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
    return JSON.stringify({
      perpId: perpId,
      proxyAddr: proxyAddr,
      abi: proxyABI,
      amountHex: amountHex,
      priceUpdate: {
        updateData: priceUpdate.priceFeedVaas,
        publishTimes: priceUpdate.timestamps,
        updateFee:
          this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
          priceUpdate.priceFeedVaas.length,
      },
    });
  }

  public async getAvailableMargin(symbol: string, traderAddr: string) {
    this.checkAPIInitialized();
    let amount = await this.apiInterface!.getAvailableMargin(
      traderAddr,
      symbol
    );
    return JSON.stringify({ amount: amount });
  }

  public async cancelOrder(symbol: string, orderId: string) {
    this.checkAPIInitialized();
    let cancelDigest = await this.apiInterface!.cancelOrderDigest(
      symbol,
      orderId
    );
    let cancelABI = this.apiInterface!.getOrderBookABI(symbol, "cancelOrder");
    let priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
    return JSON.stringify({
      OrderBookAddr: cancelDigest.OBContractAddr,
      abi: cancelABI,
      digest: cancelDigest.digest,
      priceUpdate: {
        updateData: priceUpdate.priceFeedVaas,
        publishTimes: priceUpdate.timestamps,
        updateFee:
          this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
          priceUpdate.priceFeedVaas.length,
      },
    });
  }
}
