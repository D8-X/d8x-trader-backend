import { Logger } from "winston";
import {
	LiquidationsFilteredCb,
	LiquidityAddedEvent,
	LiquidityAddedFilteredCb,
	LiquidityRemovedEvent,
	LiquidityRemovedFilteredCb,
	LiquidityWithdrawalInitiated,
	LiquidityWithdrawalInitiatedFilteredCb,
	P2PTransferEvent,
	P2PTransferFilteredCb,
	TradeEvent,
	TradesFilteredCb,
	UpdateMarginAccountEvent,
	UpdateMarginAccountFilteredCb,
} from "./types";
import { Contract, Provider, ethers, Interface, BigNumberish } from "ethers";
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
	 * Get the nearest block number for given time
	 * @param time
	 */
	public async calculateBlockFromTime(time: Date | undefined): Promise<number> {
		if (time === undefined) {
			return 33600000;
		}

		const timestamp = time.getTime() / 1000;
		let max = await this.provider.getBlockNumber();
		let min = 33600000;
		if (max <= min) {
			return min;
		}
		let midpoint = Math.floor((max + min) / 2);

		// allow up to 5 blocks (in past) of error when finding the block
		// number. Threshold is in seconds (5 times ETH block time)
		const threshold = 15 * 5;

		let found = false;
		while (!found) {
			const blk = await this.provider.getBlock(midpoint);
			if (blk) {
				if (blk.timestamp > timestamp) {
					max = blk.number;
				} else {
					min = blk.number;
				}
				// Found our block
				if (
					blk.timestamp - threshold <= timestamp &&
					blk.timestamp + threshold >= timestamp
				) {
					return blk.number;
				}

				midpoint = Math.floor((max + min) / 2);
			} else {
				throw Error(`block ${midpoint} not found!`);
			}
		}

		return 0;
	}

	/**
	 * Retrieve trade events for given walletAddress from a provided since date.
	 *
	 * @param walletAddress
	 * @param since
	 * @param cb
	 */
	public async filterTrades(
		walletAddress: string | null,
		since: Date | undefined,
		cb: TradesFilteredCb
	) {
		this.l.info("started trades filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Trade(null, walletAddress);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
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
		since: Date | undefined,
		cb: TradesFilteredCb
	) {
		this.l.info("started liquidations filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Liquidate(null, walletAddress);

		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"Liquidate",
			this.PerpManagerProxy,
			(
				decodedEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedEvent as TradeEvent,
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
		since: Date | undefined,
		cb: UpdateMarginAccountFilteredCb
	) {
		this.l.info("started margin account updates filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.UpdateMarginAccount(
			null,
			walletAddress
		);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
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
		since: Date | undefined,
		cb: LiquidityAddedFilteredCb
	) {
		this.l.info("started liquidity added filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.LiquidityAdded(null, walletAddress);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
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
		since: Date | undefined,
		cb: LiquidityRemovedFilteredCb
	) {
		this.l.info("started liquidity removed filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.LiquidityRemoved(
			null,
			walletAddress
		);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
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
		since: Array<Date | undefined>,
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
				await this.calculateBlockFromTime(since[i]),
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
		since: Date | undefined,
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
			await this.calculateBlockFromTime(since),
			"LiquidityWithdrawalInitiated",
			this.PerpManagerProxy,
			(
				decodedTradeEvent: Record<string, any>,
				e: ethers.EventLog,
				blockTimestamp: number
			) => {
				cb(
					decodedTradeEvent as LiquidityWithdrawalInitiated,
					e.transactionHash,
					e.blockNumber,
					blockTimestamp
				);
			}
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
		filter: ethers.DeferredTopicFilter,
		fromBlock: BigNumberish,
		eventName: string,
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
					await new Promise((resolve) => setTimeout(resolve, 1_100));
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

		const eventFragment = c.interface.getEvent(eventName) as ethers.EventFragment;

		const iface = new Interface([eventFragment]);

		// Check if we can get events one by one (via generator or smth)

		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			let log = iface
				.decodeEventLog(eventFragment, event.data, event.topics)
				.toObject();
			const b = await event.getBlock();

			cb(log, event, b.timestamp);

			// limit: 25 requests per second
			numRequests++;
			if (numRequests >= 25) {
				numRequests = 0;
				await new Promise((resolve) => setTimeout(resolve, 1_100));
			}
		}
	}
}
