import { Logger } from "winston";
import {
	TradeEvent,
	TradesFilteredCb,
	UpdateMarginAccountEvent,
	UpdateMarginAccountFilteredCb,
} from "./types";
import { Contract, Provider, ethers, Interface, BigNumberish } from "ethers";
import { getPerpetualManagerABI } from "../utils/abi";

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
			return 0;
		}

		const timestamp = time.getTime() / 1000;
		let max = await this.provider.getBlockNumber();
		let min = 0;
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
		walletAddress: string,
		since: Date | undefined,
		cb: TradesFilteredCb
	) {
		this.l.info("started trades filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Trade(null, walletAddress);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"Trade",
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
		walletAddress: string,
		since: Date | undefined,
		cb: TradesFilteredCb
	) {
		this.l.info("started liquidations filtering", { date: since });

		const filter = this.PerpManagerProxy.filters.Liquidate(null, walletAddress);

		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"Liquidate",
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
		walletAddress: string,
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
		cb: (
			decodedEvent: Record<string, any>,
			event: ethers.EventLog,
			blockTimestamp: number
		) => void
	) {
		const events = (await this.PerpManagerProxy.queryFilter(
			filter,
			fromBlock
		)) as ethers.EventLog[];

		const eventFragment = this.PerpManagerProxy.interface.getEvent(
			eventName
		) as ethers.EventFragment;

		const iface = new Interface([eventFragment]);

		// Check if we can get events one by one (via generator or smth)

		for (let i = 0; i < events.length; i++) {
			const event = events[i];
			let log = iface
				.decodeEventLog(eventFragment, event.data, event.topics)
				.toObject();
			const b = await event.getBlock();

			cb(log, event, b.timestamp);
		}
	}
}
