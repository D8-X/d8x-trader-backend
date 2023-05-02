import { FundingRatePayment, Prisma, PrismaClient } from "@prisma/client";
import express, { Express, Request, Response, response } from "express";
import { Logger } from "winston";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { toJson } from "../utils/response";
import { getAddress } from "ethers";

// Make sure the decimal values are always return as normal numeric strings
// instead of scientific notation
Prisma.Decimal.prototype.toJSON = function () {
	return this.toFixed();
};

export interface DBHandlers {
	fundingRatePayment: FundingRatePayments;
	tradeHistory: TradingHistory;
}
export interface RestAPIOptions {
	port: number;
	db: DBHandlers;
	prisma: PrismaClient;
}

// Profit and loss express REST API
export class PNLRestAPI {
	private app: express.Application;

	private db: DBHandlers;
	/**
	 * Initialize ResAPI parameters, routes, middelware, etc
	 * @param opts
	 * @param l
	 */
	constructor(private opts: RestAPIOptions, public l: Logger) {
		this.db = opts.db;
		this.app = express();
		this.registerMiddleware();
		this.registerRoutes(this.app);
	}

	private registerMiddleware() {}

	/**
	 * Register routes of pnl API
	 */
	private registerRoutes(app: express.Application) {
		app.get(
			"/funding-rate-payments/:user_wallet",
			this.fundingRatePayments.bind(this)
		);
		app.get("/trades-history/:user_wallet", this.historicalTrades.bind(this));
	}

	/**
	 * Starts the express app
	 */
	public start() {
		this.app.listen(this.opts.port, () => {
			this.l.info("starting pnl rest api server", { port: this.opts.port });
		});
	}

	/**
	 * funding rate
	 * @param req
	 * @param resp
	 */
	private async fundingRatePayments(
		req: Request<{ user_wallet: string }>,
		resp: Response
	) {
		// Parse wallet address and see if it is correct
		try {
			getAddress(req.params.user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send("invalid wallet address");
			return;
		}

		const data = await this.opts.prisma.fundingRatePayment.findMany({
			orderBy: {
				payment_timestamp: "desc",
			},
			where: {
				wallet_address: {
					equals: req.params.user_wallet.toLowerCase(),
				},
			},
		});

		// return response
		resp.contentType("json");
		resp.send(toJson(data));
	}

	/**
	 * trades
	 * @param req
	 * @param resp
	 */
	private async historicalTrades(
		req: Request<{ user_wallet: string }>,
		resp: Response
	) {
		// Parse wallet address and see if it is correct
		try {
			getAddress(req.params.user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send("invalid wallet address");
			return;
		}

		const data = await this.opts.prisma.trade.findMany({
			orderBy: {
				trade_timestamp: "desc",
			},
			where: {
				wallet_address: {
					equals: req.params.user_wallet.toLowerCase(),
				},
			},
		});

		// return response
		resp.contentType("json");
		resp.send(toJson(data));
	}
}
