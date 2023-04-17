import { Logger } from "winston";
import {
	TradeEvent,
	TradesFilteredCb,
	UpdateMarginAccountEvent,
	UpdateMarginAccountFilteredCb,
} from "./types";
import { Contract, Provider, ethers, Interface, BigNumberish } from "ethers";
import pmpAbi from "../abi/PerpetualManagerProxy.json";
/**
 * HistoricalDataFilterer retrieves historical data for trades, liquidations and
 * other events from perpetual manager proxy contract
 */
export class HistoricalDataFilterer {
	// Perpetual manager proxy contract binding
	public PerpManagerProxy: Contract;

	constructor(public provider: Provider, public perpetualManagerProxyAddress: string) {
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
	public async calculateBlockFromTime(time: Date): Promise<number> {
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
	public async filterTrades(walletAddress: string, since: Date, cb: TradesFilteredCb) {
		const filter = this.PerpManagerProxy.filters.Trade(null, walletAddress);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"Trade",
			(decodedTradeEvent: Record<string, any>, e: ethers.EventLog) => {
				decodedTradeEvent.order = decodedTradeEvent.order.toObject();
				cb(decodedTradeEvent as TradeEvent, e.transactionHash, e.blockNumber);
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
		since: Date,
		cb: TradesFilteredCb
	) {
		const filter = this.PerpManagerProxy.filters.Liquidate(null, walletAddress);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"Liquidate",
			(decodedEvent: Record<string, any>, e: ethers.EventLog) => {
				cb(decodedEvent as TradeEvent, e.transactionHash, e.blockNumber);
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
		since: Date,
		cb: UpdateMarginAccountFilteredCb
	) {
		const filter = this.PerpManagerProxy.filters.UpdateMarginAccount(
			null,
			walletAddress
		);
		this.genericFilterer(
			filter,
			await this.calculateBlockFromTime(since),
			"UpdateMarginAccount",
			(decodedEvent: Record<string, any>, e: ethers.EventLog) => {
				cb(
					decodedEvent as UpdateMarginAccountEvent,
					e.transactionHash,
					e.blockNumber
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
		cb: (decodedEvent: Record<string, any>, event: ethers.EventLog) => void
	) {
		const events = (await this.PerpManagerProxy.queryFilter(
			filter,
			fromBlock
		)) as ethers.EventLog[];

		const eventFragment = this.PerpManagerProxy.interface.getEvent(
			eventName
		) as ethers.EventFragment;

		const iface = new Interface([eventFragment]);
		events.forEach((event) => {
			let log = iface
				.decodeEventLog(eventFragment, event.data, event.topics)
				.toObject();
			cb(log, event);
		});
	}
}
