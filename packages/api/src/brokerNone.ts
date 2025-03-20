import ethers from "ethers";
import BrokerIntegration from "./brokerIntegration";
import {
	Order,
	SmartContractOrder,
	ZERO_ADDRESS,
	NodeSDKConfig,
} from "@d8x/perpetuals-sdk";

export default class BrokerNone extends BrokerIntegration {
	public async getBrokerAddress(): Promise<string> {
		return ZERO_ADDRESS;
	}
	public async getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number> {
		return 0;
	}

	public async signOrder(SCOrder: SmartContractOrder): Promise<{
		sig: string;
		digest: string;
		orderId: string;
		brokerFee: number;
		brokerAddr: string;
	}> {
		return { sig: "", digest: "", orderId: "", brokerFee: 0, brokerAddr: "" };
	}

	public async initialize(config: NodeSDKConfig): Promise<string> {
		return Promise.resolve("");
	}
}
