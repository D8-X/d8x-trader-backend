import { Logger } from "winston";
import { calculateBlockFromTime, executeWithTimeout } from "utils";
import { formatErrorMessage, isRateLimitError } from "../utils/errors.js";
import {
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	LiquidityWithdrawalInitiatedEvent,
	P2PTransferEvent,
	P2PTransferFilteredCb,
	TradeEvent,
	LiquidateEvent,
	UpdateMarginAccountEvent,
	EventCallback,
	SetOraclesEvent,
	SettleEvent,
	SettleEventV1,
	TokensDepositedEvent,
	TokensWithdrawnEvent,
} from "./types.js";
import {
	Contract,
	Provider,
	ethers,
	BigNumberish,
	TopicFilter,
	ContractEventName,
	EventFragment,
} from "ethers";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi.js";
import { metrics } from "../svc/metrics.js";

global.Error.stackTraceLimit = Infinity;

/**
 * HistoricalDataFilterer retrieves historical data for trades, liquidations and
 * other events from perpetual manager proxy contract
 */
export class HistoricalDataFilterer {
	// Perpetual manager proxy contract binding
	public PerpManagerProxy: Contract;
	constructor(
		public provider: Provider,
		public perpetualManagerProxyAddress: string,
		public l: Logger,
	) {
		const pmpAbi = getPerpetualManagerABI();
		// Init the contract binding
		this.PerpManagerProxy = new Contract(
			perpetualManagerProxyAddress,
			pmpAbi,
			provider,
		);
	}

	/**
	 *
	 * Retrieve P2PTransfers from all given shareTokenContracts
	 * @param shareTokenContracts - share token contract addresses
	 * @param since - array of since dates for each ith sharetTokenContracts address
	 * @param cb
	 */
	public async filterP2Ptransfers(
		shareTokenContracts: string[],
		since: Array<Date>,
		cb: P2PTransferFilteredCb,
	) {
		const shareTokenAbi = await getShareTokenContractABI();
		for (let i = 0; i < shareTokenContracts.length; i++) {
			const currentAddress = shareTokenContracts[i];
			this.l.info("starting p2p transfer filtering", {
				share_token_contract: currentAddress,
			});
			// Pools start at 1
			const poolId = i + 1;
			const c = new Contract(currentAddress, shareTokenAbi, this.provider);
			const filter = c.filters.P2PTransfer();
			const sinceBlocks: [number, number] = await executeWithTimeout(
				calculateBlockFromTime(this.provider, since[i]),
				10_000,
				"RPC call timeout",
			);
			this.genericFilterer(
				filter,
				sinceBlocks[0],
				[filter.fragment.topicHash],
				c,
				(
					decodedTradeEvent: Record<string, any>,
					e: ethers.EventLog,
					blockTimestamp: number,
				) => {
					cb(
						decodedTradeEvent as P2PTransferEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
						{ poolId },
					);
				},
				sinceBlocks[1],
			);
		}
	}

	/**
	 *
	 * @param since Date to start recording from
	 * @param callbacks Event name => EventCallback to invoke for each such event
	 */
	public async filterProxyEvents(
		since: Date,
		callbacks: Record<string, EventCallback<any>>,
		eventTimestamps?: Map<string, Date>,
	) {
		const allEventNames = [
			"Trade",
			"Settle",
			"SettleV2",
			"TokensDeposited",
			"TokensWithdrawn",
			"Liquidate",
			"UpdateMarginAccount",
			"LiquidityAdded",
			"LiquidityRemoved",
			"LiquidityWithdrawalInitiated",
			"SetOracles",
		];
		const eventNames = allEventNames.filter((name) => {
			try {
				this.PerpManagerProxy.filters[name]();
				return true;
			} catch {
				this.l.info(`event ${name} not in ABI, skipping`);
				return false;
			}
		});
		const cbKeys = Object.keys(callbacks);
		for (const eventName of cbKeys) {
			if (!allEventNames.some((x) => x == eventName)) {
				throw new Error(`Unknown event ${eventName}`);
			}
		}

		// topic filters
		const topicFilterList: TopicFilter[] = [];
		for (const eventName of eventNames) {
			const newFilter =
				await this.PerpManagerProxy.filters[eventName]().getTopicFilter();
			topicFilterList.push(newFilter);
		}
		const topicFilters = [
			topicFilterList.reduce((prev, cur, _i) => prev.concat(cur)),
		] as TopicFilter;
		// topic signature hashes
		const topicHashes = eventNames.map(
			(eventName) => this.PerpManagerProxy.filters[eventName]().fragment.topicHash,
		);

		// callbacks
		const skipCounts = new Map<string, number>();
		const cb = async (
			decodedEvent: Record<string, any>,
			e: ethers.EventLog,
			blockTimestamp: number,
		) => {
			const eventName = this.PerpManagerProxy.interface.getEventName(e.topics[0]);

			if (eventTimestamps) {
				const watermark = eventTimestamps.get(eventName);
				if (watermark && new Date(blockTimestamp * 1000) < watermark) {
					skipCounts.set(eventName, (skipCounts.get(eventName) ?? 0) + 1);
					return;
				}
			}

			metrics.trackEvent(eventName);
			switch (eventName) {
				case "Trade":
					callbacks["Trade"](
						decodedEvent as TradeEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "Settle":
					callbacks["Settle"](
						decodedEvent as SettleEventV1,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "SettleV2":
					callbacks["SettleV2"](
						decodedEvent as SettleEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;

				case "TokensWithdrawn":
					callbacks["TokensWithdrawn"](
						decodedEvent as TokensWithdrawnEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "TokensDeposited":
					callbacks["TokensDeposited"](
						decodedEvent as TokensDepositedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "SetOracles":
					callbacks["SetOracles"](
						decodedEvent as SetOraclesEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "Liquidate":
					callbacks["Liquidate"](
						decodedEvent as LiquidateEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "UpdateMarginAccount":
					callbacks["UpdateMarginAccount"](
						decodedEvent as UpdateMarginAccountEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "LiquidityAdded":
					callbacks["LiquidityAdded"](
						decodedEvent as LiquidityAddedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "LiquidityWithdrawalInitiated":
					callbacks["LiquidityWithdrawalInitiated"](
						decodedEvent as LiquidityWithdrawalInitiatedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				case "LiquidityRemoved":
					callbacks["LiquidityRemoved"](
						decodedEvent as LiquidityRemovedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
					);
					break;
				default:
					break;
			}
		};
		const sinceBlocks: [number, number] = await executeWithTimeout(
			calculateBlockFromTime(this.provider, since),
			10_000,
			"RPC call timeout",
		);
		await this.genericFilterer(
			topicFilters!,
			sinceBlocks[0],
			topicHashes,
			this.PerpManagerProxy,
			cb,
			sinceBlocks[1],
		);

		if (skipCounts.size > 0) {
			const counts: Record<string, number> = {};
			for (const [k, v] of skipCounts) {
				counts[k] = v;
			}
			this.l.info("skipped already-up-to-date events", counts);
		}
	}

	/**
	 * Filter event logs based on provided parameters.
	 *
	 * @param filter
	 * @param fromBlock    first block to scan
	 * @param eventName    name of the event we filter
	 * @param cb
	 * @param currentBlock current block number
	 */
	private async genericFilterer(
		filter: ContractEventName,
		fromBlock: BigNumberish,
		topicHashes: string[],
		c: Contract,
		cb: (
			decodedEvent: Record<string, any>,
			event: ethers.EventLog,
			blockTimestamp: number,
		) => void,
		currentBlock: number,
	) {
		let deltaBlocks = 9_999;
		const endBlock: number = currentBlock;
		const eventNames = topicHashes.map((topic0) => c.interface.getEventName(topic0));

		this.l.info("querying historical logs", {
			events: eventNames,
			fromBlock: fromBlock,
			numBlocks: endBlock - Number(fromBlock),
		});

		let totalEventsFound = 0;
		let lastWaitSeconds = 2;
		const maxWaitSeconds = 32;
		const blockTimestamp = new Map<number, number>();
		let count = 0;
		for (let i = Number(fromBlock); i < endBlock; ) {
			const _startBlock = i;
			const _endBlock = Math.min(endBlock, i + deltaBlocks - 1);
			const percProgress = Math.round(
				((i - Number(fromBlock)) / (endBlock - Number(fromBlock))) * 100,
			);
			metrics.backfill.running = true;
			metrics.backfill.progress = percProgress;
			metrics.backfill.eventsFound = totalEventsFound;
			if (count % 100 == 0) {
				this.l.info(
					`historical blocks ${_startBlock}-${_endBlock}, ${percProgress}% progress`,
				);
			}
			count += 1;
			try {
				const _events = (await c.queryFilter(
					filter,
					_startBlock,
					_endBlock,
				)) as ethers.EventLog[];
				totalEventsFound += _events.length;
				i += deltaBlocks;
				lastWaitSeconds = 2;
				if (deltaBlocks < 9_999 * 0.75) {
					deltaBlocks = Math.min(9_999, Math.round(deltaBlocks * 1.25));
				}
				await this.saveEvents(topicHashes, _events, c, blockTimestamp, cb);
				// throttle just in case avoid RPC ban, for about ~10 rps
				await new Promise((resolve) => setTimeout(resolve, 250));
			} catch (error) {
				const errMsg = formatErrorMessage(error);
				this.l.warn("Caught error in genericFilterer:" + errMsg);
				metrics.trackError("genericFilterer", error);
				if (errMsg.includes("413")) {
					deltaBlocks = Math.max(100, Math.round(deltaBlocks * 0.75));
					this.l.info(
						"reduced deltaBlocks to " + String(deltaBlocks) + " ... retrying",
					);
					continue;
				}
				if (isRateLimitError(error)) {
					metrics.rateLimitsHit++;
					this.l.warn("rate limited by RPC, backing off", {
						wait_seconds: lastWaitSeconds,
					});
					await new Promise((resolve) =>
						setTimeout(resolve, lastWaitSeconds * 1000),
					);
					lastWaitSeconds = Math.min(lastWaitSeconds * 2, maxWaitSeconds);
					continue;
				}
				if (maxWaitSeconds > lastWaitSeconds) {
					this.l.warn("RPC error, retrying", {
						wait_seconds: lastWaitSeconds,
					});
					await new Promise((resolve) =>
						setTimeout(resolve, lastWaitSeconds * 1000),
					);
					lastWaitSeconds *= 2;
				} else {
					this.l.warn("throwing error in genericFilterer");
					throw new Error(error as string | undefined);
				}
			}
		}
		metrics.backfill.running = false;
		metrics.backfill.eventsFound = totalEventsFound;
		this.l.info("finished querying historical logs", {
			events: eventNames,
			eventsFound: totalEventsFound,
		});
	}

	private async saveEvents(
		topicHashes: string[],
		events: ethers.EventLog[],
		c: Contract,
		blockTimestamp: Map<number, number>,
		cb: (
			decodedEvent: Record<string, any>,
			event: ethers.EventLog,
			blockTimestamp: number,
		) => void,
	) {
		if (events.length < 1) {
			return;
		}

		if (events.length >= 100) {
			this.l.info(`saveEvents: processing ${events.length} events`);
		}

		const eventFragments = topicHashes.map(
			(topic0) => c.interface.getEvent(topic0) as EventFragment,
		);
		let getBlockCalls = 0;
		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			for (let j = 0; j < topicHashes.length; j++) {
				if (topicHashes[j] == event.topics[0]) {
					const log = c.interface.decodeEventLog(
						eventFragments[j],
						event.data,
						event.topics,
					);
					if (blockTimestamp.get(event.blockNumber) == undefined) {
						getBlockCalls++;
						let retries = 0;
						for (;;) {
							try {
								blockTimestamp.set(
									event.blockNumber,
									(await event.getBlock()).timestamp,
								);
								break;
							} catch (e) {
								if (isRateLimitError(e) && retries < 5) {
									metrics.rateLimitsHit++;
									metrics.trackError("getBlock", e);
									const wait = Math.pow(2, retries) * 1000;
									this.l.warn(
										`getBlock rate limited, retrying in ${wait}ms`,
									);
									await new Promise((r) => setTimeout(r, wait));
									retries++;
								} else {
									throw e;
								}
							}
						}
					}
					const ts = blockTimestamp.get(event.blockNumber)!;
					cb(log, event, ts);
					break;
				}
			}
		}
		if (getBlockCalls >= 100) {
			this.l.info(`saveEvents: made ${getBlockCalls} getBlock() RPC calls`);
		}
	}
}
