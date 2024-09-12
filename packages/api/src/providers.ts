import {
	FetchRequest,
	JsonRpcProvider,
	Networkish,
	WebSocketLike,
	WebSocketProvider,
} from "ethers";

export const ProvidersEthCallsStartTime = new Date();

/**
 * List of eth_ * method calls and their counts for all TrackedJsonRpcProvider
 */
export const JsonRpcEthCalls = new Map<string, number>();

/**
 * List of eth_ * method calls and their counts for all TrackedWebsocketsProvider
 */
export const WssEthCalls = new Map<string, number>();

export let NumJsonRpcProviders = 0;
export let NumWssProviders = 0;

export class TrackedWebsocketsProvider extends WebSocketProvider {
	constructor(url: string | WebSocketLike, network?: Networkish) {
		super(url, network);
		NumWssProviders++;
	}

	send(method: string, params: any[] | Record<string, any>): Promise<any> {
		if (!WssEthCalls.has(method)) {
			WssEthCalls.set(method, 0);
		}
		WssEthCalls.set(method, WssEthCalls.get(method)! + 1);

		return super.send(method, params);
	}
}

export class TrackedJsonRpcProvider extends JsonRpcProvider {
	constructor(url?: string | FetchRequest | string, network?: Networkish) {
		super(url, network);
		NumJsonRpcProviders++;
	}

	send(method: string, params: Array<any>): Promise<any> {
		if (!JsonRpcEthCalls.has(method)) {
			JsonRpcEthCalls.set(method, 0);
		}
		JsonRpcEthCalls.set(method, JsonRpcEthCalls.get(method)! + 1);

		return super.send(method, params);
	}
}
