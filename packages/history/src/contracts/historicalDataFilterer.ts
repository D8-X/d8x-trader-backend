import { Logger } from "winston";
import { calculateBlockFromTime, executeWithTimeout } from "utils";
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
} from "./types";
import {
	Contract,
	Provider,
	ethers,
	BigNumberish,
	TopicFilter,
	ContractEventName,
	EventFragment,
} from "ethers";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi";

global.Error.stackTraceLimit = Infinity;

function formatErrorMessage(error: unknown) {
	if (error instanceof Error) return error.message;
	return String(error);
}

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
	) {
		// events in scope
		const eventNames = [
			"Trade",
			"Liquidate",
			"UpdateMarginAccount",
			"LiquidityAdded",
			"LiquidityRemoved",
			"LiquidityWithdrawalInitiated",
			"SetOracles",
		];
		const cbKeys = Object.keys(callbacks);
		for (const eventName of cbKeys) {
			if (!eventNames.some((x) => x == eventName)) {
				throw new Error(`Unknown event ${eventName}`);
			}
		}
		for (const eventName of eventNames) {
			if (!cbKeys.some((x) => x == eventName)) {
				throw new Error(`Missing event ${eventName}`);
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
		const cb = async (
			decodedEvent: Record<string, any>,
			e: ethers.EventLog,
			blockTimestamp: number,
		) => {
			const eventName = this.PerpManagerProxy.interface.getEventName(e.topics[0]);
			// TODO: can't do this because of the casting below ... not necessarily better, but would be shorter code
			// callbacks[eventName](
			// 	decodedEvent as TradeEvent, // <--
			// 	e.transactionHash,
			// 	e.blockNumber,z
			// 	blockTimestamp
			// );
			switch (eventName) {
				case "Trade":
					callbacks["Trade"](
						decodedEvent as TradeEvent,
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
		// limit: 10_000 blocks in one eth_getLogs call
		let deltaBlocks = 9_999;
		const endBlock: number = currentBlock;
		const eventNames = topicHashes.map((topic0) => c.interface.getEventName(topic0));

		this.l.info("querying historical logs", {
			events: eventNames,
			fromBlock: fromBlock,
			numBlocks: endBlock - Number(fromBlock),
		});

		await new Promise((resolve) => setTimeout(resolve, 1_100));
		let numRequests = 0;
		let events: ethers.EventLog[] = [];
		let lastWaitSeconds = 2;
		const maxWaitSeconds = 32;
		const blockTimestamp = new Map<Number, number>();

		for (let i = Number(fromBlock); i < endBlock; ) {
			const _startBlock = i;
			const _endBlock = Math.min(endBlock, i + deltaBlocks - 1);
			const percProgress = Math.round(i/endBlock*100);
			if (percProgress % 5==0) {
				this.l.info(`historical blocks ${_startBlock}-${_endBlock}, ${percProgress} progress`)
			}
			try {
				// fetch from blockchain
				const _events = (await c.queryFilter(
					filter,
					_startBlock,
					_endBlock,
				)) as ethers.EventLog[];
				events = [...events, ..._events];
				// limit: 25 requests per second
				numRequests++;
				if (numRequests >= 25) {
					numRequests = 0;
					lastWaitSeconds = 2;
					await new Promise((resolve) => setTimeout(resolve, 10_000));
				}
				i += deltaBlocks;
				// save to db
				await this.saveEvents(
					topicHashes,
					_events,
					c,
					blockTimestamp,
					numRequests,
					cb,
				);
			} catch (error) {
				const errMsg = formatErrorMessage(error);
				this.l.warn("Caught error in genericFilterer:" + errMsg);
				if (errMsg.includes("413")) {
					// 413 Payload Too Large
					deltaBlocks = Math.max(100, Math.round(deltaBlocks * 0.75));
					this.l.info("reduced deltaBlocks to " + String(deltaBlocks));
					return;
				}
				// probably too many requests to node
				this.l.info("seconds", { maxWaitSeconds, lastWaitSeconds });
				if (maxWaitSeconds > lastWaitSeconds) {
					this.l.warn(
						"attempted to make too many requests to node, performing a wait",
						{ wait_seconds: lastWaitSeconds },
					);
					// rate limited: wait before re-trying
					await new Promise((resolve) =>
						setTimeout(resolve, lastWaitSeconds * 1000),
					);
					numRequests = 0;
					lastWaitSeconds *= 2;
				} else {
					this.l.warn("throwing error in genericFilterer");
					throw new Error(error as string | undefined);
				}
			}
		}
		this.l.info("finished querying historical logs", {
			events: eventNames,
			eventsFound: events.length,
		});
	}

	private async saveEvents(
		topicHashes: string[],
		events: ethers.EventLog[],
		c: Contract,
		blockTimestamp: Map<Number, number>,
		numRequests: number,
		cb: (
			decodedEvent: Record<string, any>,
			event: ethers.EventLog,
			blockTimestamp: number,
		) => void,
	) {
		if (events.length < 1) {
			return;
		}

		const eventFragments = topicHashes.map(
			(topic0) => c.interface.getEvent(topic0) as EventFragment,
		);
		// let blockTimestamp = new Map<Number, number>();
		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			for (let j = 0; j < topicHashes.length; j++) {
				if (topicHashes[j] == event.topics[0]) {
					// found event
					const log = c.interface.decodeEventLog(
						eventFragments[j],
						event.data,
						event.topics,
					);
					// one call per block with event
					if (blockTimestamp.get(event.blockNumber) == undefined) {
						blockTimestamp.set(
							event.blockNumber,
							(await event.getBlock()).timestamp,
						);
					}
					const ts = blockTimestamp.get(event.blockNumber)!;
					// do work
					cb(log, event, ts);

					// TODO: how to get rid of this?
					// limit: 25 requests per second
					numRequests++;
					if (numRequests >= 25) {
						numRequests = 0;
						await new Promise((resolve) => setTimeout(resolve, 1_100));
					}
					break;
				}
			}
		}
	}
}
