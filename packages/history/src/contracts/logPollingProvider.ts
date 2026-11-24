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

export class LogPollingJsonRpcProvider extends JsonRpcProvider {
	private logSubs = new Set<SharedLogSubscriber>();
	private logPollTimer: NodeJS.Timeout | undefined;
	private logPollInflight = false;
	private nextLogBlock: number | undefined;

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
		try {
			const head = await this.getBlockNumber();
			if (this.nextLogBlock === undefined) {
				this.nextLogBlock = head + 1;
				return;
			}
			if (head < this.nextLogBlock) {
				return;
			}
			const fromBlock = this.nextLogBlock;
			const toBlock = Math.min(head, fromBlock + MAX_LOG_POLL_BLOCKS - 1);
			const subs = [...this.logSubs];
			const address = [...new Set(subs.flatMap((s) => s.addresses))];
			const logs = await this.getLogs({ address, fromBlock, toBlock });
			for (const log of logs) {
				for (const sub of subs) {
					if (sub.matches(log)) {
						void this.emit(sub.filter, log);
					}
				}
			}
			this.nextLogBlock = toBlock + 1;
		} catch (e) {
			this.logger.warn("HTTP log poll failed", {
				error: formatErrorMessage(e),
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
