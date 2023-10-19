import { JsonRpcProvider } from "@ethersproject/providers";
import { executeWithTimeout } from "utils";

export default class RPCManager {
  private healthy: Map<string, boolean> = new Map();
  private lastCheck: Map<string, number> = new Map();

  private CHECK_INTERVAL_MS = 1_000 * 60 * 60;
  private NETWORK_READY_MS = 10_000;

  /**
   * @param rpcURLs Array of RPC URLs
   */
  constructor(private rpcURLs: string[]) {}

  /**
   * Finds the next healthy RPC in the queue and returns it.
   * Health of each RPCs is checked at most once an hour
   * @returns A healthy RPC URL
   */
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

  /**
   * Adds an RPC to the list
   * @param rpc An RPC URL
   */
  public addRPC(rpc: string) {
    this.rpcURLs.push(rpc);
  }

  /**
   * Cycles through the list of RPC URLs and returns the next one,
   * updaing its health status if necessary
   * @returns The next RPC URL
   */
  private async cycleRPCs() {
    const rpc = this.rpcURLs.pop();
    if (rpc === undefined) {
      throw new Error("No RPCs in queue");
    }
    if (
      this.healthy.get(rpc) === undefined ||
      (this.lastCheck.get(rpc) ?? 0) + this.CHECK_INTERVAL_MS < Date.now()
    ) {
      const provider = new JsonRpcProvider(rpc);
      try {
        await executeWithTimeout(provider.ready, this.NETWORK_READY_MS);
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
