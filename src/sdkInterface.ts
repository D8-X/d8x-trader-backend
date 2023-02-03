import { MarketData, PerpetualDataHandler } from "@d8x/perpetuals-sdk";

export default class SDKInterface {
  private mktData: MarketData | undefined = undefined;

  public async initialize() {
    const sdkConfig = PerpetualDataHandler.readSDKConfig("testnet");
    this.mktData = new MarketData(sdkConfig);
    await this.mktData.createProxyInstance();
    console.log("SDK API initialized");
  }

  public async exchangeInfo(): Promise<string> {
    let info = await this.mktData!.exchangeInfo();
    return JSON.stringify(info);
  }
}
