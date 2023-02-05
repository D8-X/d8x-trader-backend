import { SmartContractOrder, Order } from "@d8x/perpetuals-sdk";

/**
 * Broker inherit from this class, perform
 * fee, address, and key management
 */
export default abstract class BrokerIntegration {
  abstract getBrokerAddress(order: Order, traderAddr: string): string;
  abstract getBrokerFeeTBps(order: Order, traderAddr: string): number;
  abstract signOrder(SCOrder: SmartContractOrder): string;
}
