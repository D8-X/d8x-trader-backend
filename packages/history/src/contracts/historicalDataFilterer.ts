import { Logger } from "winston";
import { calculateBlockFromTime } from "utils";
import {
	LiquidationsFilteredCb,
	LiquidityAddedEvent,
	LiquidityAddedFilteredCb,
	LiquidityRemovedEvent,
	LiquidityRemovedFilteredCb,
	LiquidityWithdrawalInitiatedEvent,
	LiquidityWithdrawalInitiatedFilteredCb,
	P2PTransferEvent,
	P2PTransferFilteredCb,
	TradeEvent,
	LiquidateEvent,
	TradesFilteredCb,
	UpdateMarginAccountEvent,
	UpdateMarginAccountFilteredCb,
	EventCallback,
} from "./types";
import {
	Contract,
	Provider,
	ethers,
	Interface,
	BigNumberish,
	TopicFilter,
	ContractEventName,
	EventFragment,
} from "ethers";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi";

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
		public l: Logger
	) {
		let pmpAbi = getPerpetualManagerABI();
		// Init the contract binding
		this.PerpManagerProxy = new Contract(
			perpetualManagerProxyAddress,
			pmpAbi,
			provider
		);
	}

	/**
	 *
	 * Retrieve P2PTransfers from all given sharetTokenContracts
	 * @param shareTokenContracts - share token contract addresses
	 * @param since - array of since dates for each ith sharetTokenContracts address
	 * @param cb
	 */
	public async filterP2Ptransfers(
		shareTokenContracts: string[],
		since: Array<Date>,
		cb: P2PTransferFilteredCb
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
			this.genericFilterer(
				filter,
				(await calculateBlockFromTime(this.provider, since[i]))[0],
				[filter.fragment.topicHash],
				c,
				(
					decodedTradeEvent: Record<string, any>,
					e: ethers.EventLog,
					blockTimestamp: number
				) => {
					cb(
						decodedTradeEvent as P2PTransferEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp,
						{ poolId }
					);
				}
			);
		}
	}

	/**
	 *
	 * @param fromBlock Block number to start recording from
	 * @param callbacks Event name => EventCallback to invoke for each such event
	 */
	public async filterProxyEvents(
		since: Date,
		callbacks: Record<string, EventCallback<any>>
	) {
		// events in scope
		const eventNames = [
			"Trade",
			"Liquidate",
			"UpdateMarginAccount",
			"LiquidityAdded",
			"LiquidityRemoved",
			"LiquidityWithdrawalInitiated",
		];

		// topic filters
		let topicFilters: TopicFilter | undefined = undefined;
		for (const eventName of eventNames) {
			if (topicFilters == undefined) {
				topicFilters = await this.PerpManagerProxy.filters[
					eventName
				]().getTopicFilter();
			} else {
				const newFilter = await this.PerpManagerProxy.filters[
					eventName
				]().getTopicFilter();
				topicFilters = topicFilters.concat(newFilter) as TopicFilter;
			}
		}
		// topic signature hashes
		const topicHashes = eventNames.map(
			(eventName) => this.PerpManagerProxy.filters[eventName]().fragment.topicHash
		);

		// callbacks
		const cb = async (
			decodedEvent: Record<string, any>,
			e: ethers.EventLog,
			blockTimestamp: number
		) => {
			const eventName = this.PerpManagerProxy.interface.getEventName(e.topics[0]);
			// TODO: can't do this because of the casting... not necessarily better, but shorter code
			// callbacks[eventName](
			// 	decodedEvent as TradeEvent,
			// 	e.transactionHash,
			// 	e.blockNumber,
			// 	blockTimestamp
			// );
			switch (eventName) {
				case "Trade":
					callbacks["Trade"](
						decodedEvent as TradeEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				case "Liquidate":
					callbacks["Liquidate"](
						decodedEvent as LiquidateEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				case "UpdateMarginAccount":
					callbacks["UpdateMarginAccount"](
						decodedEvent as UpdateMarginAccountEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				case "LiquidityAdded":
					callbacks["LiquidityAdded"](
						decodedEvent as LiquidityAddedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				case "LiquidityWithdrawalInitiated":
					callbacks["LiquidityWithdrawalInitiated"](
						decodedEvent as LiquidityWithdrawalInitiatedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				case "LiquidityRemoved":
					callbacks["LiquidityRemoved"](
						decodedEvent as LiquidityRemovedEvent,
						e.transactionHash,
						e.blockNumber,
						blockTimestamp
					);
					break;
				default:
					break;
			}
		};

		await this.genericFilterer(
			topicFilters!,
			await calculateBlockFromTime(this.provider, since)[0],
			topicHashes,
			this.PerpManagerProxy,
			cb
		);
	}

	/**
	 * Filter event logs based on provided parameters.
	 *
	 * @param filter
	 * @param fromBlock
	 * @param eventName
	 * @param cb
	 */
	private async genericFilterer(
		filter: ContractEventName,
		fromBlock: BigNumberish,
		topicHashes: string[],
		c: Contract,
		cb: (
			decodedEvent: Record<string, any>,
			event: ethers.EventLog,
			blockTimestamp: number
		) => void
	) {
		// limit: 10_000 blocks in one eth_getLogs call
		const deltaBlocks = 9_999;
		const endBlock = await this.provider.getBlockNumber();

		this.l.info("querying historical logs", {
			fromBlock: fromBlock,
			numBlocks: endBlock - Number(fromBlock),
		});

		await new Promise((resolve) => setTimeout(resolve, 1_100));
		let numRequests = 0;
		let events: ethers.EventLog[] = [];
		let lastWaitSeconds = 2;
		let maxWaitSeconds = 32;

		for (let i = Number(fromBlock); i < endBlock; ) {
			const _startBlock = i;
			const _endBlock = Math.min(endBlock, i + deltaBlocks - 1);
			try {
				const _events = (await c.queryFilter(
					filter,
					_startBlock,
					_endBlock
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
			} catch (error) {
				this.l.info("seconds", { maxWaitSeconds, lastWaitSeconds });
				if (maxWaitSeconds > lastWaitSeconds) {
					this.l.warn(
						"attempted to make too many requests to node, performing a wait",
						{ wait_seconds: lastWaitSeconds }
					);
					// rate limited: wait before re-trying
					await new Promise((resolve) =>
						setTimeout(resolve, lastWaitSeconds * 1000)
					);
					numRequests = 0;
					lastWaitSeconds *= 2;
				} else {
					throw new Error(error as string | undefined);
				}
			}
		}

		const eventNames = topicHashes.map((topic0) => c.interface.getEventName(topic0));
		const eventFragments = topicHashes.map(
			(topic0) => c.interface.getEvent(topic0) as EventFragment
		);
		let blockTimestamp = new Map<Number, number>();
		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			for (let j = 0; j < topicHashes.length; j++) {
				if (topicHashes[j] == event.topics[0]) {
					// found event
					let eventName = eventNames[j];
					let log = c.interface.decodeEventLog(
						eventFragments[j],
						event.data,
						event.topics
					);
					// one call per block with event
					if (blockTimestamp.get(event.blockNumber) == undefined) {
						blockTimestamp.set(
							event.blockNumber,
							(await event.getBlock()).timestamp
						);
					}
					let ts = blockTimestamp.get(event.blockNumber)!;
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
