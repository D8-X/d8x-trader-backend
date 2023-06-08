import ethers from "ethers";
import BrokerIntegration from "./brokerIntegration";
import { Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

export default class BrokerNone extends BrokerIntegration {
  public getBrokerAddress(traderAddr: string, order?: Order): string {
    return ZERO_ADDRESS;
  }
  public getBrokerFeeTBps(traderAddr: string, order?: Order): number {
    return 0;
  }
  public async signOrder(SCOrder: SmartContractOrder): Promise<string> {
    return await "";
  }
  public async initialize(): Promise<void> {
    return Promise.resolve();
  }
}
