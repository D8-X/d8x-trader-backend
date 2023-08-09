import { SmartContractOrder, Order } from "@d8x/perpetuals-sdk";
import { NodeSDKConfig } from "@d8x/perpetuals-sdk";
/**
 * Broker inherit from this class, perform
 * fee, address, and key management
 */
export default abstract class BrokerIntegration {
  abstract getBrokerAddress(): Promise<string>;
  abstract getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number>;
  abstract signOrder(SCOrder: SmartContractOrder): Promise<string>;
  abstract initialize(config: NodeSDKConfig): Promise<string>; // returns the broker address
}
