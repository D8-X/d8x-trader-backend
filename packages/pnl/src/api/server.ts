import { FundingRatePayment, Prisma, PrismaClient } from "@prisma/client";
import express, { Express, Request, Response, response } from "express";
import { Logger } from "winston";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { correctQueryArgs, errorResp, toJson } from "../utils/response";
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
		app.get("/funding-rate-payments", this.fundingRatePayments.bind(this));
		app.get("/trades-history", this.historicalTrades.bind(this));
		app.get("/apy", this.apyCalculation.bind(this));
		app.get("/earnings", this.earnings.bind(this));
	}

	/**
	 * Starts the express app
	 */
	public start() {
		this.app.listen(this.opts.port, () => {
			this.l.info("starting pnl rest api server", { port: this.opts.port });
		});
	}

	private async earnings(
		req: Request<any, any, any, { user_wallet: string; pool_id: string }>,
		resp: Response
	) {
		const usage = "required query parameters: user_wallet, pool_id";
		if (!correctQueryArgs(req.query, ["user_wallet", "pool_id"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}
		const { user_wallet, pool_id } = req.query;

		const poolIdNum = parseInt(pool_id);
		if (isNaN(poolIdNum)) {
			resp.send(errorResp("please provide a correct numeric pool_id value", usage));
			return;
		}

		const result = await this.opts.prisma.estimatedEarningTokens.aggregate({
			_sum: {
				token_amount: true,
			},
			where: {
				AND: [
					{
						wallet_address: {
							equals: user_wallet,
						},
					},
					{
						pool_id: {
							equals: poolIdNum,
						},
					},
				],
			},
		});

		let earningsTokensSum = result._sum.token_amount ?? 0;

		resp.contentType("json");
		resp.send(
			toJson({
				pool_id,
				user: user_wallet,
				earnings: earningsTokensSum,
			})
		);
	}

	/**
	 * funding rate
	 * @param req
	 * @param resp
	 */
	private async fundingRatePayments(
		req: Request<any, any, any, { user_wallet: string }>,
		resp: Response
	) {
		const usage = "required query parameters: user_wallet";
		if (!correctQueryArgs(req.query, ["user_wallet"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}

		const user_wallet = req.query.user_wallet;
		// Parse wallet address and see if it is correct
		try {
			getAddress(user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send(errorResp("invalid wallet address", usage));
			return;
		}

		const data = await this.opts.prisma.fundingRatePayment.findMany({
			orderBy: {
				payment_timestamp: "desc",
			},
			where: {
				wallet_address: {
					equals: user_wallet.toLowerCase(),
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
		req: Request<any, any, any, { user_wallet: string }>,
		resp: Response
	) {
		const usage = "required query parameters: user_wallet";
		if (!correctQueryArgs(req.query, ["user_wallet"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}

		const user_wallet = req.query.user_wallet;

		// Parse wallet address and see if it is correct
		try {
			getAddress(user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send(errorResp("invalid wallet address", usage));
			return;
		}

		const data = await this.opts.prisma.trade.findMany({
			orderBy: {
				trade_timestamp: "desc",
			},
			where: {
				wallet_address: {
					equals: user_wallet.toLowerCase(),
				},
			},
		});

		// return response
		resp.contentType("json");
		resp.send(toJson(data));
	}

	private async apyCalculation(
		req: Request<
			any,
			any,
			any,
			{
				pool_id: string;
				// Date/timestamp from which we check the APY
				from_timestamp: string;
				// Either NOW or later date than from_timestamp
				to_timestamp: string;
			}
		>,
		resp: Response
	) {
		const usage = "required query parameters: pool_id, from_timestamp, to_timestamp ";
		if (!correctQueryArgs(req.query, ["pool_id", "from_timestamp", "to_timestamp"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}
		const { pool_id, from_timestamp, to_timestamp } = req.query;

		// Check if provided timestamps are numbers
		let t_from = parseInt(from_timestamp),
			t_to = parseInt(to_timestamp);
		const reDigit = /^\d+$/;
		if (
			isNaN(t_from) ||
			isNaN(t_to) ||
			from_timestamp.match(reDigit) === null ||
			to_timestamp.match(reDigit) === null
		) {
			resp.send(
				errorResp(
					"invalid from_timestamp or to_timestamp, please provide correct unix timestamp",
					usage
				)
			);
			return;
		}

		// Retrieve the dates
		let from: Date, to: Date;
		from = new Date(t_from * 1000);
		to = new Date(t_to * 1000);

		console.log(from, to);

		if (isNaN(from.getTime()) || isNaN(to.getTime())) {
			this.l.error("apy calculation: invalid dates provided", {
				params: req.params,
			});

			resp.send(errorResp("please provide valid timestamps", usage));
			return;
		}

		if (from > to) {
			resp.send(errorResp("from date can not be later than to", usage));
			return;
		}

		const poolId = BigInt(pool_id);

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
				resp.send(errorResp("not enough data to calculate APY", usage));
				return;
			}
			// APY = (priceCurrent/priceOld-1)/(TimestampSec.now()-TimestampSec.priceOld) * #secondsInYear
			const apy = ((price_ratio - 1) / t_diff) * secondsInYear;

			const response = {
				start_timestamp,
				end_timestamp,
				start_price: toPriceInfo[0].pool_token_price,
				end_price: fromPriceInfo[0].pool_token_price,
				pool_id: pool_id,
				apy,
			};
			resp.send(toJson(response));
			return;
		}

		resp.send(errorResp("not enough data to calculate APY", usage));
		return;
	}
}
