import BrokerIntegration from "./brokerIntegration";
import { BrokerTool, NodeSDKConfig, Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

export default class BrokerRegular extends BrokerIntegration {
  private brokerKey: string;
  private sdk: BrokerTool | undefined = undefined;
  private brokerFeeTenthOfBasisPoints: number;

  constructor(key: string, brokerFeeTenthOfBasisPoints: number) {
    super();
    this.brokerKey = key;

    this.brokerFeeTenthOfBasisPoints = brokerFeeTenthOfBasisPoints;
  }

  public async initialize(config: NodeSDKConfig): Promise<string> {
    this.sdk = new BrokerTool(config, this.brokerKey);
    await this.sdk.createProxyInstance();
    return this.sdk.getAddress();
  }

  public async getBrokerAddress(): Promise<string> {
    if (this.sdk == undefined) {
      throw Error("BrokerRegular: initialize required");
    }
    return this.sdk.getAddress();
  }

  public async getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number> {
    return this.brokerFeeTenthOfBasisPoints;
  }

  public async signOrder(SCOrder: SmartContractOrder): Promise<string> {
    if (this.sdk == undefined) {
      throw Error("BrokerRegular: initialize required");
    }
    return await this.sdk.signSCOrder(SCOrder);
  }
}
