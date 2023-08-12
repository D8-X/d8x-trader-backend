import ethers from "ethers";
import BrokerIntegration from "./brokerIntegration";
import { Order, SmartContractOrder, ZERO_ADDRESS, NodeSDKConfig } from "@d8x/perpetuals-sdk";

export default class BrokerNone extends BrokerIntegration {
  public async getBrokerAddress(): Promise<string> {
    return ZERO_ADDRESS;
  }
  public async getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number> {
    return 0;
  }

  public async signOrder(SCOrder: SmartContractOrder): Promise<string> {
    return await "";
  }

  public async initialize(config: NodeSDKConfig): Promise<string> {
    return Promise.resolve("");
  }
}
