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
} from "@d8x/perpetuals-sdk";
import dotenv from "dotenv";
import { createClient } from "redis";
import BrokerIntegration from "./brokerIntegration";
import Observable from "./observable";
import { extractErrorMsg } from "./utils";

export default class SDKInterface extends Observable {
  private apiInterface: TraderInterface | undefined = undefined;
  private redisClient: ReturnType<typeof createClient>;
  private broker: BrokerIntegration;
  TIMEOUTSEC = 60; // timeout for exchange info

  constructor(broker: BrokerIntegration) {
    super();
    dotenv.config();
    let redisUrl: string | undefined = process.env.REDIS_URL;
    if (redisUrl == undefined || redisUrl == "") {
      this.redisClient = createClient();
    } else {
      this.redisClient = createClient({ url: redisUrl });
    }

    this.broker = broker;
  }

  public async initialize(sdkConfig: NodeSDKConfig) {
    await this.initRedis();
    this.apiInterface = new TraderInterface(sdkConfig);
    await this.apiInterface.createProxyInstance();
    console.log("SDK API initialized");
  }

  private async initRedis() {
    await this.redisClient.connect();
    this.redisClient.on("error", (err) => console.log("Redis Client Error", err));
  }

  private async cacheExchangeInfo() {
    let tsQuery = Date.now();
    await this.redisClient.hSet("exchangeInfo", ["ts:query", tsQuery]);
    let xchInfo = await this.apiInterface!.exchangeInfo();
    let info = JSON.stringify(xchInfo);
    await this.redisClient.hSet("exchangeInfo", ["ts:response", Date.now(), "content", info]);
    this.notifyObservers("exchangeInfo");
    return info;
  }

  public async exchangeInfo(): Promise<string> {
    let obj = await this.redisClient.hGetAll("exchangeInfo");
    let info: string = "";
    //console.log("obj=", obj);
    if (!Object.prototype.hasOwnProperty.call(obj, "ts:query")) {
      console.log("first time query");
      info = await this.cacheExchangeInfo();
    } else {
      let timeElapsedS = (Date.now() - parseInt(obj["ts:query"])) / 1000;
      if (timeElapsedS > this.TIMEOUTSEC) {
        // reload data through API
        // no await
        console.log("re-query exchange info");
        this.cacheExchangeInfo();
      }
      info = obj["content"];
    }
    return info;
  }

  public perpetualStaticInfo(symbol: string): string {
    let staticInfo = this.apiInterface!.getPerpetualStaticInfo(symbol);
    let info = JSON.stringify(staticInfo);
    return info;
  }

  public async updateExchangeInfoNumbersOfPerpetual(symbol: string, values: number[], propertyNames: string[]) {
    let obj = await this.redisClient.hGetAll("exchangeInfo");
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
        case "maxPositionBC":
          perpState.maxPositionBC = values[m];
          break;
        default:
          throw new Error(`unknown property name ${propertyNames[m]}`);
      }
    }
    // store back to redis: we don't update the timestamp "ts:query", so that
    // all information will still be pulled at some time
    let infoStr = JSON.stringify(info);
    await this.redisClient.hSet("exchangeInfo", ["ts:response", Date.now(), "content", infoStr]);
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

  public static findPerpetualInPool(base: string, quote: string, perpetuals: PerpetualState[]): number {
    let k = 0;
    while (k < perpetuals.length) {
      if (perpetuals[k].baseCurrency == base && perpetuals[k].quoteCurrency == quote) {
        // perpetual found
        return k;
      }
      k++;
    }
    return -1;
  }

  public static findPoolAndPerpIdx(symbol: string, info: ExchangeInfo): [number, number] {
    let pools = <PoolState[]>info.pools;
    let symbols = symbol.split("-");
    let k = SDKInterface.findPoolIdx(symbols[2], pools);
    if (k == -1) {
      throw new Error(`No pool found with symbol ${symbols[2]}`);
    }
    let j = SDKInterface.findPerpetualInPool(symbols[0], symbols[1], pools[k].perpetuals);
    if (j == -1) {
      throw new Error(`No perpetual found with symbol ${symbol}`);
    }
    return [k, j];
  }

  /**
   * Get the PerpetualState from exchange info
   * @param symbol perpetual symbol (e.g., BTC-USD-MATIC)
   */
  public async extractPerpetualStateFromExchangeInfo(symbol: string): Promise<PerpetualState> {
    let info = JSON.parse(await this.exchangeInfo());
    let [k, j] = SDKInterface.findPoolAndPerpIdx(symbol, info);
    let perpState: PerpetualState = info.pools[k].perpetuals[j];
    return perpState;
  }

  public async getPerpetualPriceOfType(symbol: string, priceType: string): Promise<string> {
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
          res = await this.apiInterface?.getOraclePrice(components[0], components[1]);
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

  public async openOrders(addr: string, symbol: string) {
    try {
      this.checkAPIInitialized();
      let res = await this.apiInterface?.openOrders(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async positionRisk(addr: string, symbol: string) {
    this.checkAPIInitialized();
    let res = await this.apiInterface?.positionRisk(addr, symbol);
    return JSON.stringify(res);
  }

  public async maxOrderSizeForTrader(addr: string, symbol: string) {
    this.checkAPIInitialized();
    let perpetualState: PerpetualState = await this.extractPerpetualStateFromExchangeInfo(symbol);
    let positionRisk: MarginAccount | undefined = await this.apiInterface!.positionRisk(addr, symbol);
    let sizeBUY = this.apiInterface!.maxOrderSizeForTrader(BUY_SIDE, positionRisk, perpetualState);
    let sizeSELL = this.apiInterface!.maxOrderSizeForTrader(SELL_SIDE, positionRisk, perpetualState);
    return JSON.stringify({ buy: sizeBUY, sell: sizeSELL });
  }

  public async getCurrentTraderVolume(traderAddr: string, symbol: string): Promise<string> {
    this.checkAPIInitialized();
    let vol = await this.apiInterface!.getCurrentTraderVolume(symbol, traderAddr);
    return JSON.stringify(vol);
  }

  public async getOrderIds(traderAddr: string, symbol: string): Promise<string> {
    this.checkAPIInitialized();
    let orderBookContract = this.apiInterface!.getOrderBookContract(symbol);
    let ids = await TraderInterface.orderIdsOfTrader(traderAddr, orderBookContract);
    return JSON.stringify(ids);
  }

  public async queryFee(traderAddr: string, poolSymbol: string): Promise<string> {
    this.checkAPIInitialized();
    let brokerAddr = this.broker.getBrokerAddress(traderAddr);
    let fee = await this.apiInterface?.queryExchangeFee(poolSymbol, traderAddr, brokerAddr);
    if (fee == undefined) {
      throw new Error("could not retreive fee");
    }
    fee = Math.round(fee * 1e5 + (await this.broker.getBrokerFeeTBps(traderAddr)));
    return JSON.stringify(fee);
  }

  public async orderDigest(order: Order, traderAddr: string): Promise<string> {
    this.checkAPIInitialized();
    //console.log("order=", order);
    order.brokerFeeTbps = this.broker.getBrokerFeeTBps(traderAddr, order);
    order.brokerAddr = this.broker.getBrokerAddress(traderAddr, order);
    let SCOrder = this.apiInterface?.createSmartContractOrder(order, traderAddr);
    this.broker.signOrder(SCOrder!);
    // now we can create the digest that is to be signed by the trader
    let digest = await this.apiInterface?.orderDigest(SCOrder!);
    // also return the order book address and postOrder ABI
    let obAddr = this.apiInterface!.getOrderBookAddress(order.symbol);
    let postOrderABI = this.apiInterface!.getOrderBookABI(order.symbol, "postOrder");
    let id = await this.apiInterface!.digestTool.createOrderId(digest!);
    return JSON.stringify({
      digest: digest,
      orderId: id,
      OrderBookAddr: obAddr,
      abi: postOrderABI,
      SCOrder: SCOrder,
    });
  }

  public async positionRiskOnTrade(order: Order, traderAddr: string): Promise<string> {
    this.checkAPIInitialized();
    let perpetualState: PerpetualState = await this.extractPerpetualStateFromExchangeInfo(order.symbol);
    let positionRisk: MarginAccount | undefined = await this.apiInterface!.positionRisk(traderAddr, order.symbol);
    let res: MarginAccount | undefined = await this.apiInterface!.positionRiskOnTrade(
      traderAddr,
      order,
      perpetualState,
      positionRisk
    );
    return JSON.stringify({ newPositionRisk: res });
  }

  public addCollateral(symbol: string, amount: string): string {
    this.checkAPIInitialized();
    // contract data
    let proxyAddr = this.apiInterface!.getProxyAddress();
    let proxyABI = this.apiInterface!.getProxyABI("deposit");
    // call data
    let perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
    // the amount as a Hex string, such that BigNumber.from(amountHex) == floatToABK64(amount)
    let amountHex = floatToABK64x64(Number(amount)).toHexString();
    return JSON.stringify({ perpId: perpId, proxyAddr: proxyAddr, abi: proxyABI, amountHex: amountHex });
  }

  public removeCollateral(symbol: string, amount: string): string {
    this.checkAPIInitialized();
    // contract data
    let proxyAddr = this.apiInterface!.getProxyAddress();
    let proxyABI = this.apiInterface!.getProxyABI("withdraw");
    // call data
    let perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
    // the amount as a Hex string, such that BigNumber.from(amountHex) == floatToABK64(amount)
    let amountHex = floatToABK64x64(Number(amount)).toHexString();
    return JSON.stringify({ perpId: perpId, proxyAddr: proxyAddr, abi: proxyABI, amountHex: amountHex });
  }
}
