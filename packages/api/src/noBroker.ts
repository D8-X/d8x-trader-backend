import ethers from "ethers";
import BrokerIntegration from "./brokerIntegration";
import { Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

export default class NoBroker extends BrokerIntegration {
  public getBrokerAddress(traderAddr: string, order?: Order): string {
    return ZERO_ADDRESS;
  }
  public getBrokerFeeTBps(traderAddr: string, order?: Order): number {
    return 0;
  }
  public signOrder(SCOrder: SmartContractOrder): string {
    return "";
  }
}
