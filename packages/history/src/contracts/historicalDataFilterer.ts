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
	 * Retrieve trade events for given traderAddress from a provided since date.
	 *
	 * @param traderAddress
	 * @param since
	 * @param cb
	 */
	public async filterTrades(
		traderAddress: string | null,
		since: Date,
		cb: TradesFilteredCb
	) {
		this.l.info("started trades filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Trade(null, traderAddress);
		this.genericFilterer(
			filter,
			(await calculateBlockFromTime(this.provider, since))[0],
			"Trade",
			this.PerpManagerProxy,
			(
				decodedTradeEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				decodedTradeEvent.order = decodedTradeEvent.order.toObject();
				cb(
					decodedTradeEvent as TradeEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
		);
	}

	/**
	 * Retrieve Liquidate events for given walletAddress from a provided since date.
	 *
	 * @param walletAddress
	 * @param since
	 * @param cb
	 */
	public async filterLiquidations(
		walletAddress: string | null,
		since: Date,
		cb: LiquidationsFilteredCb
	) {
		this.l.info("started liquidations filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Liquidate(null, walletAddress);

		this.genericFilterer(
			filter,
			(await calculateBlockFromTime(this.provider, since))[0],
			"Liquidate",
			this.PerpManagerProxy,
			(
				decodedEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedEvent as LiquidateEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
		);
	}

	/**
	 * Retrieve UpdateMarginAccount events for given walletAddress from a provided since date.
	 *
	 * @param walletAddress - trader field
	 * @param since
	 * @param cb
	 */
	public async filterUpdateMarginAccount(
		walletAddress: string | null,
		since: Date,
		cb: UpdateMarginAccountFilteredCb
	) {
		this.l.info("started margin account updates filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.UpdateMarginAccount(
			null,
			walletAddress
		);
		this.genericFilterer(
			filter,
			(await calculateBlockFromTime(this.provider, since))[0],
			"UpdateMarginAccount",
			this.PerpManagerProxy,
			(
				decodedEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedEvent as UpdateMarginAccountEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
		);
	}
	/**
	 * Retrieve LiquidityAdded events for given walletAddress from a provided since date.
	 *
	 * @param walletAddress - trader field
	 * @param since
	 * @param cb
	 */
	public async filterLiquidityAdded(
		walletAddress: string | null,
		since: Date,
		cb: LiquidityAddedFilteredCb
	) {
		this.l.info("started liquidity added filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.LiquidityAdded(null, walletAddress);
		this.genericFilterer(
			filter,
			(await calculateBlockFromTime(this.provider, since))[0],
			"LiquidityAdded",

			this.PerpManagerProxy,
			(
				decodedEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedEvent as LiquidityAddedEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
		);
	}

	/**
	 * Retrieve UpdateMarginAccount events for given walletAddress from a provided since date.
	 *
	 * @param walletAddress - trader field
	 * @param since
	 * @param cb
	 */
	public async filterLiquidityRemoved(
		walletAddress: string | null,
		since: Date,
		cb: LiquidityRemovedFilteredCb
	) {
		this.l.info("started liquidity removed filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.LiquidityRemoved(
			null,
			walletAddress
		);
		this.genericFilterer(
			filter,
			(await calculateBlockFromTime(this.provider, since))[0],
			"LiquidityRemoved",

			this.PerpManagerProxy,
			(
				decodedEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedEvent as LiquidityRemovedEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
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
				"P2PTransfer",
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
	public async filterLiquidityWithdrawalInitiations(
		walletAddress: string | null,
		since: Date,
		cb: LiquidityWithdrawalInitiatedFilteredCb
	) {
		this.l.info("started liquidity withdrawal initiated filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.LiquidityWithdrawalInitiated(
			null,
			walletAddress
		);

		// We want to process lpwi events in a synchronous way
		await this.genericFilterer(
			filter,
			(
				await calculateBlockFromTime(this.provider, since)
			)[0],
			"LiquidityWithdrawalInitiated",
			this.PerpManagerProxy,
			(
				decodedTradeEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedTradeEvent as LiquidityWithdrawalInitiatedEvent,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
		);
	}

	public async filterProxyEvents(fromBlock: BigNumberish) {
		//

		const filter = [
			await this.PerpManagerProxy.filters.Trade().getTopicFilter(),
			await this.PerpManagerProxy.filters.Liquidate().getTopicFilter(),
			await this.PerpManagerProxy.filters.UpdateMarginAccount().getTopicFilter(),
			await this.PerpManagerProxy.filters.LiquidityAdded().getTopicFilter(),
			await this.PerpManagerProxy.filters.LiquidityRemoved().getTopicFilter(),
			await this.PerpManagerProxy.filters
				.LiquidityWithdrawalInitiated()
				.getTopicFilter(),
		];

		const cb = async (
			decodedEvent: Record<string, any>,
			e: ethers.EventLog,
			blockTimestamp: number
		) => {
			switch (key) {
				case value:
					break;

				default:
					break;
			}
			cb(
				decodedEvent as LiquidityRemovedEvent,
				e.transactionHash,
				e.blockNumber,
				blockTimestamp
			);
		};
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
		eventSignatures: string[],
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

		const eventFragment = c.interface.getEvent(eventSignatures); // as ethers.EventFragment;

		const iface = new Interface(c.interface.events);

		// Check if we can get events one by one (via generator or smth)

		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			for (let j = 0; j < eventSignatures.length; j++) {
				if (eventSignatures[j] == event.topics[0]) {
					let log = c.interface.decodeEventLog(
						event.topics[0],
						event.data,
						event.topics
					);
					// this log has the event name
					// TODO
					// switch (log.) {
					//     case value:

					//         break;

					//     default:
					//         break;
					// }
				}
			}

			// obsolete:
			// let log = iface
			// 	.decodeEventLog(eventFragment, event.data, event.topics)
			// 	.toObject();

			// TODO: get rid of
			const b = await event.getBlock();

			// obsolete
			cb(log, event, b.timestamp);

			// TODO: not like this but speeds
			// limit: 25 requests per second
			numRequests++;
			if (numRequests >= 25) {
				numRequests = 0;
				await new Promise((resolve) => setTimeout(resolve, 1_100));
			}
		}
	}
}
