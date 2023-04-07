import { JsonRpcProvider, Log, Provider, ethers } from "ethers";
import { Logger } from "winston";
import perpProxyABI from "../abi/PerpetualManagerProxy.json";
export interface EventListenerOptions {
	rpcNodeUrl: string;
	logger: Logger;

	// smart contract addresses which will be used to listen to incoming events
	contractAddresses: {
		perpetualManagerProxy: string;
	};

	// Private key hex
	privateKey?: string;
}

export class EventListener {
	public provider: Provider;

	private l: Logger;

	private opts: EventListenerOptions;

	constructor(opts: EventListenerOptions) {
		this.provider = new JsonRpcProvider(opts.rpcNodeUrl);
		this.l = opts.logger;
		this.opts = opts;
	}

	/**
	 * listen starts all event listeners
	 */
	public listen() {
		this.l.info("starting smart contract event listeners");

		// perpertual proxy manager - main contract
		const pmp = new ethers.Contract(
			this.opts.contractAddresses.perpetualManagerProxy,
			perpProxyABI,
			this.provider
		);

		// Trade event
		pmp.on("Trade", (event) => {
			this.l.info("trade event received");
			console.log(event);
		});

		pmp.on("Liquidate", (event) => {
			this.l.info("Liquidate event received");
			console.log(event);
		});

		pmp.on("UpdateMarginAccount", (event) => {
			this.l.info("UpdateMarginAccount event received");
			console.log(event);
		});
	}
}
