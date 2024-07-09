import { Networkish } from "@ethersproject/providers";
import { WebSocketLike } from "@ethersproject/providers/lib/websocket-provider";
import { providers } from "ethers";
import { ConnectionInfo } from "ethers/lib/utils";

export const ProvidersEthCallsStartTime = new Date();

/**
 * List of eth_ * method calls and their counts for all TrackedJsonRpcProvider
 */
export const JsonRpcEthCalls = new Map<string, number>();

/**
 * List of eth_ * method calls and their counts for all TrackedWebsocketsProvider
 */
export const WssEthCalls = new Map<string, number>();

export class TrackedWebsocketsProvider extends providers.WebSocketProvider {
	constructor(url: string | WebSocketLike, network?: Networkish) {
		super(url, network);
	}

	send(method: string, params?: Array<any>): Promise<any> {
		if (!WssEthCalls.has(method)) {
			WssEthCalls.set(method, 0);
		}
		WssEthCalls.set(method, WssEthCalls.get(method)! + 1);

		return super.send(method, params);
	}
}

export class TrackedJsonRpcProvider extends providers.StaticJsonRpcProvider {
	constructor(url?: ConnectionInfo | string, network?: Networkish) {
		super(url, network);
	}

	send(method: string, params: Array<any>): Promise<any> {
		if (!JsonRpcEthCalls.has(method)) {
			JsonRpcEthCalls.set(method, 0);
		}
		JsonRpcEthCalls.set(method, JsonRpcEthCalls.get(method)! + 1);

		return super.send(method, params);
	}
}
