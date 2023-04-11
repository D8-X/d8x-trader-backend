import { Logger } from "winston";
import { TradesFilteredCb } from "./types";
import { Contract, Provider, ethers, Interface } from "ethers";
import pmpAbi from "../abi/PerpetualManagerProxy.json";
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
		public logger: Logger
	) {
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
	public calculateBlockFromTime(time: Date): number {
		// TODO
		return 0;
	}

	public cerateFilter(event: ethers.EventFragment, fromBlock: number): ethers.Filter {
		return {
			address: this.perpetualManagerProxyAddress,
			fromBlock: fromBlock,
			topics: [event.topicHash],
		};
	}

	// TODO
	public async filterTrades(walletAddress: string, since: Date, cb: TradesFilteredCb) {
		const events = (await this.PerpManagerProxy.queryFilter(
			"Trade",
			this.calculateBlockFromTime(since)
		)) as ethers.EventLog[];

		const evnt = this.PerpManagerProxy.interface.getEvent(
			"Trade"
		) as ethers.EventFragment;

		this.PerpManagerProxy.filters.Trade;
		const iface = new Interface([evnt]);
		events.forEach((event) => {
			// console.log(event.data);
			const log = iface.decodeEventLog(evnt, event.data, event.topics);
			console.log("----------------------------");
			console.log("----------------------------");
			console.log("----------------------------");
			console.log(event.args);
		});
	}
}
