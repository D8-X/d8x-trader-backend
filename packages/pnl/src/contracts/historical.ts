import { Logger } from "winston";
import { TradesFilteredCb } from "./types";
import { Contract, Provider, ethers } from "ethers";
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
		this.PerpManagerProxy = new ethers.Contract(
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
		return 100;
	}

	// TODO
	public async filterTrades(walletAddress: string, since: Date, cb: TradesFilteredCb) {
		const events = await this.PerpManagerProxy.queryFilter(
			"Trade",
			this.calculateBlockFromTime(since)
		);
		events.forEach((event) => {
			console.log(event);
		});
	}
}
