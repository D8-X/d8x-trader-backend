import BrokerIntegration from "./brokerIntegration";
import { BrokerTool, NodeSDKConfig, Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

export default class BrokerRegular extends BrokerIntegration {
  private brokerKey: string;
  private sdk;
  private brokerFeeTenthOfBasisPoints: number;

  constructor(key: string, brokerFeeTenthOfBasisPoints: number, config: NodeSDKConfig) {
    super();
    this.brokerKey = key;
    this.sdk = new BrokerTool(config, this.brokerKey);
    this.brokerFeeTenthOfBasisPoints = brokerFeeTenthOfBasisPoints;
  }

  public async initialize() {
    await this.sdk.createProxyInstance();
  }

  public getBrokerAddress(traderAddr: string, order?: Order): string {
    return this.sdk.getAddress();
  }

  public getBrokerFeeTBps(traderAddr: string, order?: Order): number {
    return this.brokerFeeTenthOfBasisPoints;
  }

  public async signOrder(SCOrder: SmartContractOrder): Promise<string> {
    return await this.sdk.signSCOrder(SCOrder);
  }
}
