import ethers from "ethers";
import BrokerIntegration from "./brokerIntegration";
import { Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

export default class NoBroker extends BrokerIntegration {
  public getBrokerAddress(order: Order, traderAddr: string): string {
    return ZERO_ADDRESS;
  }
  public getBrokerFeeTBps(order: Order, traderAddr: string): number {
    return 0;
  }
  public signOrder(SCOrder: SmartContractOrder): string {
    return "";
  }
}
