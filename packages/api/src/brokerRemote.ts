import { toJson } from "utils";
import BrokerIntegration from "./brokerIntegration";
import axios from "axios";
import {
	BrokerTool,
	NodeSDKConfig,
	Order,
	SmartContractOrder,
	ZERO_ADDRESS,
} from "@d8x/perpetuals-sdk";

/**
 * This is a remote broker that relays signature requests to a REST API.
 * This type of broker does not need to manage a private key and the broker
 * fee is set in the remote location
 */
export default class BrokerRemote extends BrokerIntegration {
	private endpointGetBrokerAddress = "/broker-address";
	private endpointGetBrokerFee = "/broker-fee";
	private endpointSignOrder = "/sign-order";
	private brokerAddr: string = "";
	private brokerFee: number | undefined;

	constructor(
		private apiURL: string,
		private myId: string,
		private chainId: number,
	) {
		super();
		// remove trailing slash
		this.apiURL = this.apiURL.replace(/\/+$/, "");
	}

	public async initialize(config: NodeSDKConfig): Promise<string> {
		return await this.getBrokerAddress();
	}

	public async getBrokerAddress(): Promise<string> {
		if (this.brokerAddr == "") {
			const arg = "?id=" + this.myId;
			const endpoint = this.apiURL + this.endpointGetBrokerAddress + arg;
			try {
				const response = await fetch(endpoint);
				const data = await response.json();
				this.brokerAddr = data.brokerAddr;
			} catch (error) {
				console.log("brokerRemote: failed to fetch broker address");
			}
		}
		return this.brokerAddr;
	}

	public async getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number> {
		const arg = "?addr=" + traderAddr + "&chain=" + this.chainId;
		const endpoint = this.apiURL + this.endpointGetBrokerFee + arg;
		try {
			const response = await fetch(endpoint);
			const data = await response.json();
			this.brokerFee = Number(data.BrokerFeeTbps);
		} catch (error) {
			console.log("brokerRemote: failed to fetch broker address");
		}

		return this.brokerFee!;
	}

	public async signOrder(SCOrder: SmartContractOrder): Promise<{
		sig: string;
		digest: string;
		orderId: string;
		brokerFee: number;
		brokerAddr: "";
	}> {
		const reqData = {
			order: {
				flags: Number(SCOrder.flags.toString()),
				iPerpetualId: SCOrder.iPerpetualId,
				traderAddr: SCOrder.traderAddr,
				brokerAddr: SCOrder.brokerAddr,
				fAmount: SCOrder.fAmount.toString(),
				fLimitPrice: SCOrder.fLimitPrice.toString(),
				fTriggerPrice: SCOrder.fTriggerPrice.toString(),
				leverageTDR: SCOrder.leverageTDR,
				iDeadline: SCOrder.iDeadline,
				executionTimestamp: SCOrder.executionTimestamp,
			},
			chainId: this.chainId,
		};
		// send post request to endpoint with r as data
		const query = this.apiURL + this.endpointSignOrder;
		try {
			const response = await axios.post(query, reqData);
			const responseData = response.data;
			return {
				sig: responseData.brokerSignature,
				digest: responseData.orderDigest,
				orderId: responseData.orderId,
				brokerFee: responseData.orderFields.brokerFeeTbps,
				brokerAddr: responseData.orderFields.brokerAddr,
			};
		} catch (error) {
			let errorMessage;
			if (axios.isAxiosError(error)) {
				errorMessage =
					error.response?.data?.error ||
					error.message ||
					"Axios error occurred";
			} else if (error instanceof Error) {
				errorMessage = "Unknown error";
			}
			console.log(`${query} failed: ${errorMessage}`);
			return { sig: "", digest: "", orderId: "", brokerFee: 0, brokerAddr: "" };
		}
	}
}
