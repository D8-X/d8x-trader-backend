import { MarketData, PerpetualDataHandler } from "@d8x/perpetuals-sdk";
import { createClient } from "redis";
import { extractErrorMsg } from "./utils";
import { Order } from "@d8x/perpetuals-sdk";

export default class SDKInterface {
  private mktData: MarketData | undefined = undefined;
  private redisClient: ReturnType<typeof createClient>;
  TIMEOUTSEC = 120;

  constructor() {
    this.redisClient = createClient();
  }

  public async initialize() {
    const sdkConfig = PerpetualDataHandler.readSDKConfig("testnet");
    this.mktData = new MarketData(sdkConfig);
    await this.mktData.createProxyInstance();
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
    let xchInfo = await this.mktData!.exchangeInfo();
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

  public async openOrders(addr: string, symbol: string) {
    try {
      let res = await this.mktData?.openOrders(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async positionRisk(addr: string, symbol: string) {
    try {
      let res = await this.mktData?.positionRisk(addr, symbol);
      return JSON.stringify(res);
    } catch (error) {
      return JSON.stringify({ error: extractErrorMsg(error) });
    }
  }

  public async orderDigest(order: Order) {
    return "todo";
  }
}
