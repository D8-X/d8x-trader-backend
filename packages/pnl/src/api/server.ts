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

		app.get(
			"/apy/:pool_id/:from_timestamp/:to_timestamp",
			this.apyCalculation.bind(this)
		);
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

	private async apyCalculation(
		req: Request<{
			pool_id: string;
			// Date/timestamp from which we check the APY
			from_timestamp: string;
			// Either NOW or later date than from_timestamp
			to_timestamp: string;
		}>,
		resp: Response
	) {
		// Check if provided timestamps are numbers
		let t_from = parseInt(req.params.from_timestamp),
			t_to = parseInt(req.params.to_timestamp);
		const reDigit = /^\d+$/;
		if (
			isNaN(t_from) ||
			isNaN(t_to) ||
			req.params.from_timestamp.match(reDigit) === null ||
			req.params.to_timestamp.match(reDigit) === null
		) {
			resp.send(
				"invalid from_timestamp or to_timestamp, please provide correct unix timestamp"
			);
			return;
		}

		// Retrieve the dates
		let from: Date, to: Date;
		from = new Date(t_from * 1000);
		to = new Date(t_to * 1000);

		if (isNaN(from.getTime()) || isNaN(to.getTime())) {
			this.l.error("apy calculation: invalid dates provided", {
				params: req.params,
			});

			resp.send("please provide valid timestamps");
			return;
		}

		if (from > to) {
			resp.send("from date can not be later than to");
			return;
		}

		const poolId = BigInt(req.params.pool_id);

		interface p_info {
			pool_token_price: number;
			pool_id: bigint;
			timestamp: Date;
		}

		const fromPriceInfo = await this.opts.prisma.$queryRaw<p_info[]>`
		    select * from price_info
		    where pool_id = ${poolId}
		    order by abs(extract(epoch from ("timestamp" -  ${from}::timestamp )))
		    limit 1
		`;
		const toPriceInfo = await this.opts.prisma.$queryRaw<p_info[]>`
		    select * from price_info
		    where pool_id = ${poolId}
		    order by abs(extract(epoch from ("timestamp" - ${to}::timestamp )))
		    limit 1
		`;

		// Price info was found
		if (toPriceInfo.length === 1 && fromPriceInfo.length === 1) {
			const start_timestamp = fromPriceInfo[0].timestamp.getTime() / 1000;
			const end_timestamp = toPriceInfo[0].timestamp.getTime() / 1000;

			// Now - Old timestamp
			const t_diff = end_timestamp - start_timestamp;

			const year = new Date().getUTCFullYear();
			const secondsInYear =
				((year % 4 === 0 && year % 100 > 0) || year % 400 == 0 ? 366 : 365) *
				24 *
				3600;

			const price_ratio =
				toPriceInfo[0].pool_token_price / fromPriceInfo[0].pool_token_price;

			// division by 0
			if (t_diff === 0) {
				resp.send("not enough data to calculate APY");
				return;
			}
			// APY = (priceCurrent/priceOld-1)/(TimestampSec.now()-TimestampSec.priceOld) * #secondsInYear
			const apy = ((price_ratio - 1) / t_diff) * secondsInYear;

			const response = {
				start_timestamp,
				end_timestamp,
				start_price: toPriceInfo[0].pool_token_price,
				end_price: fromPriceInfo[0].pool_token_price,
				pool_id: req.params.pool_id,
				apy,
			};
			resp.send(toJson(response));
			return;
		}

		resp.send("could not retrieve price info");
		return;
	}
}
