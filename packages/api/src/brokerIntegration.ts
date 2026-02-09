import { SmartContractOrder, Order } from "@d8-x/d8x-node-sdk";
import { NodeSDKConfig } from "@d8-x/d8x-node-sdk";
/**
 * Broker inherit from this class, perform
 * fee, address, and key management
 */
export default abstract class BrokerIntegration {
	abstract getBrokerAddress(): Promise<string>;
	abstract getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number>;
	abstract signOrder(SCOrder: SmartContractOrder): Promise<{
		sig: string;
		digest: string;
		orderId: string;
		brokerFee: number;
		brokerAddr: string;
	}>;
	abstract initialize(config: NodeSDKConfig): Promise<string>; // returns the broker address
}
