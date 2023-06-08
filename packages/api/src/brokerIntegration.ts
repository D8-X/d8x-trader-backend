import { SmartContractOrder, Order } from "@d8x/perpetuals-sdk";

/**
 * Broker inherit from this class, perform
 * fee, address, and key management
 */
export default abstract class BrokerIntegration {
  abstract getBrokerAddress(traderAddr: string, order?: Order): string;
  abstract getBrokerFeeTBps(traderAddr: string, order?: Order): number;
  abstract signOrder(SCOrder: SmartContractOrder): Promise<string>;
  abstract initialize(): Promise<void>;
}
