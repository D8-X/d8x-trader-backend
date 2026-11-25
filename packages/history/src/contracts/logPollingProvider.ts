import {
	EventFilter,
	JsonRpcApiProviderOptions,
	JsonRpcProvider,
	Log,
	Networkish,
	Subscriber,
	Subscription,
} from "ethers";
import { Logger } from "winston";
import { formatErrorMessage } from "../utils/errors.js";

const LOG_POLL_INTERVAL_MS = 5_000;
const MAX_LOG_POLL_BLOCKS = 1_000;
const LOG_POLL_LAG_BLOCKS = 10;
const LOG_POLL_OVERLAP_BLOCKS = 30;

export class LogPollingJsonRpcProvider extends JsonRpcProvider {
	private logSubs = new Set<SharedLogSubscriber>();
	private logPollTimer: NodeJS.Timeout | undefined;
	private logPollInflight = false;
	private startLogBlock: number | undefined;
	private nextLogBlock: number | undefined;
	private logPollRange = MAX_LOG_POLL_BLOCKS;
	private seenLogs = new Map<string, number>();

	constructor(
		url: string,
		network: Networkish,
		options: JsonRpcApiProviderOptions,
		private logger: Logger,
	) {
		super(url, network, options);
	}

	override _getSubscriber(sub: Subscription): Subscriber {
		if (sub.type === "event") {
			const addresses = toAddressList(sub.filter);
			if (addresses) {
				return new SharedLogSubscriber(this, sub.filter, addresses);
			}
		}
		return super._getSubscriber(sub);
	}

	override destroy(): void {
		this.stopLogPolling();
		super.destroy();
	}

	addLogSubscriber(sub: SharedLogSubscriber) {
		this.logSubs.add(sub);
		if (!this.logPollTimer) {
			this.logPollTimer = setInterval(
				() => void this.pollLogs(),
				LOG_POLL_INTERVAL_MS,
			);
			void this.pollLogs();
		}
	}

	removeLogSubscriber(sub: SharedLogSubscriber) {
		this.logSubs.delete(sub);
		if (this.logSubs.size === 0) {
			this.stopLogPolling();
			this.startLogBlock = undefined;
			this.nextLogBlock = undefined;
			this.seenLogs.clear();
		}
	}

	private stopLogPolling() {
		if (this.logPollTimer) {
			clearInterval(this.logPollTimer);
			this.logPollTimer = undefined;
		}
	}

	private async pollLogs() {
		if (this.logPollInflight || this.logSubs.size === 0) {
			return;
		}
		this.logPollInflight = true;
		let fromBlock: number | undefined;
		let toBlock: number | undefined;
		try {
			const head = await this.getBlockNumber();
			if (this.nextLogBlock === undefined || this.startLogBlock === undefined) {
				this.startLogBlock = head + 1;
				this.nextLogBlock = head + 1;
				return;
			}
			fromBlock = Math.max(
				this.startLogBlock,
				this.nextLogBlock -
					Math.min(LOG_POLL_OVERLAP_BLOCKS, Math.floor(this.logPollRange / 2)),
			);
			toBlock = Math.min(
				head - LOG_POLL_LAG_BLOCKS,
				fromBlock + this.logPollRange - 1,
			);
			if (toBlock < this.nextLogBlock) {
				return;
			}
			const subs = [...this.logSubs];
			const address = [...new Set(subs.flatMap((s) => s.addresses))];
			const logs = await this.getLogs({ address, fromBlock, toBlock });
			if (this.logSubs.size === 0) {
				return;
			}
			for (const log of logs) {
				const key = `${log.blockHash}:${log.index}`;
				if (this.seenLogs.has(key)) {
					continue;
				}
				this.seenLogs.set(key, log.blockNumber);
				for (const sub of subs) {
					if (sub.matches(log)) {
						void this.emit(sub.filter, log);
					}
				}
			}
			this.nextLogBlock = toBlock + 1;
			for (const [key, block] of this.seenLogs) {
				if (block < this.nextLogBlock - LOG_POLL_OVERLAP_BLOCKS) {
					this.seenLogs.delete(key);
				}
			}
			this.logPollRange = Math.min(MAX_LOG_POLL_BLOCKS, this.logPollRange * 2);
		} catch (e) {
			this.logPollRange = Math.max(1, Math.floor(this.logPollRange / 2));
			this.logger.warn("HTTP log poll failed", {
				error: formatErrorMessage(e),
				request: fromBlock === undefined ? "eth_blockNumber" : "eth_getLogs",
				from_block: fromBlock,
				to_block: toBlock,
				next_range_blocks: this.logPollRange,
			});
		} finally {
			this.logPollInflight = false;
		}
	}
}

function toAddressList(filter: EventFilter): string[] | undefined {
	if (filter.address == null) {
		return undefined;
	}
	const list = Array.isArray(filter.address) ? filter.address : [filter.address];
	if (list.length === 0 || !list.every((a) => typeof a === "string")) {
		return undefined;
	}
	return (list as string[]).map((a) => a.toLowerCase());
}

class SharedLogSubscriber implements Subscriber {
	constructor(
		private provider: LogPollingJsonRpcProvider,
		readonly filter: EventFilter,
		readonly addresses: string[],
	) {}

	matches(log: Log): boolean {
		if (!this.addresses.includes(log.address.toLowerCase())) {
			return false;
		}
		const topics = this.filter.topics ?? [];
		return topics.every((expected, i) => {
			if (expected == null) {
				return true;
			}
			const actual = log.topics[i]?.toLowerCase();
			if (Array.isArray(expected)) {
				return expected.some((t) => t.toLowerCase() === actual);
			}
			return expected.toLowerCase() === actual;
		});
	}

	start() {
		this.provider.addLogSubscriber(this);
	}

	stop() {
		this.provider.removeLogSubscriber(this);
	}

	pause() {
		this.stop();
	}

	resume() {
		this.start();
	}
}
