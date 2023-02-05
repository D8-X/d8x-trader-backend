import { PerpetualDataHandler } from "@d8x/perpetuals-sdk";
import { createClient } from "redis";
import { extractErrorMsg } from "./utils";
import { Order } from "@d8x/perpetuals-sdk";
import { TraderInterface } from "@d8x/perpetuals-sdk";
import BrokerIntegration from "./brokerIntegration";

export default class SDKInterface {
  private apiInterface: TraderInterface | undefined = undefined;
  private redisClient: ReturnType<typeof createClient>;
  private broker: BrokerIntegration;
  TIMEOUTSEC = 120;

  constructor(broker: BrokerIntegration) {
    this.redisClient = createClient();
    this.broker = broker;
  }

  public async initialize() {
    const sdkConfig = PerpetualDataHandler.readSDKConfig("testnet");
    this.apiInterface = new TraderInterface(sdkConfig);
    await this.apiInterface.createProxyInstance();
    await this.initRedis();
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

  public async openOrders(addr: string, symbol: string) {
    try {
      let res = await this.apiInterface?.openOrders(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async positionRisk(addr: string, symbol: string) {
    try {
      let res = await this.apiInterface?.positionRisk(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async getCurrentTraderVolume(traderAddr: string, symbol: string): Promise<string> {
    try {
      let vol = await this.apiInterface!.getCurrentTraderVolume(symbol, traderAddr);
      return JSON.stringify(vol);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async getOrderIds(traderAddr: string, symbol: string): Promise<string> {
    try {
      let orderBookContract = this.apiInterface!.getOrderBookContract(symbol);
      let ids = await TraderInterface.orderIdsOfTrader(traderAddr, orderBookContract);
      return JSON.stringify(ids);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async queryFee(traderAddr: string, poolSymbol: string): Promise<string> {
    try {
      let brokerAddr = this.broker.getBrokerAddress(traderAddr);
      let fee = await this.apiInterface?.queryExchangeFee(poolSymbol, traderAddr, brokerAddr);
      if (fee == undefined) {
        throw new Error("could not retreive fee");
      }
      fee = Math.round(fee * 1e5 + (await this.broker.getBrokerFeeTBps(traderAddr)));
      return JSON.stringify(fee);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async orderDigest(order: Order, traderAddr: string): Promise<string> {
    try {
      if (this.apiInterface == undefined) {
        throw Error("SDKInterface not initialized");
      }
      //console.log("order=", order);
      order.brokerFeeTbps = this.broker.getBrokerFeeTBps(traderAddr, order);
      order.brokerAddr = this.broker.getBrokerAddress(traderAddr, order);
      let SCOrder = this.apiInterface.createSmartContractOrder(order, traderAddr);
      this.broker.signOrder(SCOrder);
      // now we can create the digest that is to be signed by the trader
      let digest = await this.apiInterface.orderDigest(SCOrder);
      // also return the order book address
      let obAddr = this.apiInterface.getOrderBookAddress(order.symbol);
      let id = await this.apiInterface.digestTool.createOrderId(digest);
      return JSON.stringify({ digest: digest, orderId: id, OrderBookAddr: obAddr, SCOrder: SCOrder });
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }
}
