import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { executeWithTimeout } from "utils";

export default class RPCManager {
	private healthy: Map<string, boolean> = new Map();
	private lastCheck: Map<string, number> = new Map();

	private CHECK_INTERVAL_MS = 1_000 * 60 * 60;

	constructor(private rpcURLs: string[]) {}

	public async getRPC(): Promise<string> {
		let numTries = 0;
		while (numTries < this.rpcURLs.length) {
			numTries++;
			const rpc = await this.cycleRPCs();
			if (this.healthy.get(rpc)) {
				return rpc;
			}
		}
		throw new Error("No healthy RPCs");
	}

	private async cycleRPCs() {
		const rpc = this.rpcURLs.pop();
		if (rpc === undefined) {
			throw new Error("No RPCs in queue");
		}
		if (
			this.healthy.get(rpc) === undefined ||
			(this.lastCheck.get(rpc) ?? 0) + this.CHECK_INTERVAL_MS < Date.now()
		) {
			const provider = new StaticJsonRpcProvider(rpc);
			try {
				await executeWithTimeout(provider.ready, 10_000);
				this.healthy.set(rpc, true);
			} catch (_e) {
				this.healthy.set(rpc, false);
			}
			this.lastCheck.set(rpc, Date.now());
		}
		this.rpcURLs = [rpc, ...this.rpcURLs];
		return rpc;
	}
}
