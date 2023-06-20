import {
	FundingRatePayment,
	Trade,
	Prisma,
	PrismaClient,
	MarginTokenInfo,
} from "@prisma/client";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { MarginTokenData } from "../db/margin_token_info";
import StaticInfo from "../contracts/static_info";
import { correctQueryArgs, errorResp } from "../utils/response";
import {
	toJson,
	dec18ToFloat,
	decNToFloat,
	ABK64x64ToFloat,
	extractErrorMsg,
	isValidAddress,
} from "utils";

import { getAddress } from "ethers";
import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv } from "../utils/abi";
import dotenv from "dotenv";
import cors from "cors";
import { PriceInfo } from "../db/price_info";

// Make sure the decimal values are always return as normal numeric strings
// instead of scientific notation
Prisma.Decimal.prototype.toJSON = function () {
	return this.toFixed();
};

export interface DBHandlers {
	fundingRatePayment: FundingRatePayments;
	tradeHistory: TradingHistory;
	priceInfo: PriceInfo;
}
export interface RestAPIOptions {
	port: number;
	db: DBHandlers;
	staticInfo: StaticInfo;
	prisma: PrismaClient;
}

// Profit and loss express REST API
export class PNLRestAPI {
	private app: express.Application;

	private db: DBHandlers;

	private md?: MarketData;

	private CORS_ON: boolean;

	/**
	 * Initialize ResAPI parameters, routes, middelware, etc
	 * @param opts
	 * @param l
	 */
	constructor(private opts: RestAPIOptions, public l: Logger) {
		dotenv.config();
		this.CORS_ON = !(
			process.env.CORS_ON == undefined || process.env.CORS_ON == "FALSE"
		);
		this.db = opts.db;
		this.app = express();

		this.registerMiddleware();
		this.registerRoutes(this.app);
	}

	/**
	 * Initialize PNLRestAPI
	 */
	public async init() {
		// Init marked data
		let config = getSDKFromEnv();
		config.nodeURL = process.env.HTTP_RPC_URL;
		const md = new MarketData(config);
		await md.createProxyInstance();
		this.md = md;
	}

	private registerMiddleware() {
		if (this.CORS_ON) {
			this.app.use(cors());
		}
	}

	/**
	 * Register routes of pnl API
	 */
	private registerRoutes(app: express.Application) {
		app.get("/funding-rate-payments", this.fundingRatePayments.bind(this));
		app.get("/trades-history", this.historicalTrades.bind(this));
		app.get("/apy", this.apyCalculation.bind(this));
		app.get("/earnings", this.earnings.bind(this));
		app.get("/open-withdrawals", this.withdrawals.bind(this));
	}

	/**
	 * Starts the express app
	 */
	public async start() {
		await this.init();

		this.app.listen(this.opts.port, () => {
			this.l.info("starting pnl rest api server", { port: this.opts.port });
		});
	}

	private extractTimestamps(fromStr: string, toStr: string): [number, number] {
		let t_from = parseInt(fromStr);
		let t_to = parseInt(toStr);
		const reDigit = /^\d+$/;
		if (
			isNaN(t_from) ||
			isNaN(t_to) ||
			fromStr.match(reDigit) === null ||
			toStr.match(reDigit) === null
		) {
			throw Error(
				"invalid fromTimestamp or toTimestamp, please provide correct unix timestamps"
			);
		}

		if (t_from < 1681402080) {
			throw Error("timestamp to old");
		}
		if (t_from >= t_to) {
			throw Error("from must be smaller than to");
		}
		if (t_to > 4837075680) {
			throw Error("timestamp must be in seconds");
		}
		return [t_from, t_to];
	}
	/**
	 * Retrieve open withdrawal information
	 *
	 * @param req
	 * @param resp
	 * @returns
	 */
	private async withdrawals(
		req: Request<any, any, any, { lpAddr: string; poolSymbol: string }>,
		resp: Response
	) {
		const usage = "required query parameters: lpAddr, poolSymbol";
		if (!correctQueryArgs(req.query, ["lpAddr", "poolSymbol"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}

		const user_wallet = req.query.lpAddr.toLowerCase();
		const poolIdNum = this.md?.getPoolIdFromSymbol(req.query.poolSymbol)!;

		if (poolIdNum === undefined || isNaN(poolIdNum)) {
			resp.send(errorResp("please provide a correct poolSymbol", usage));
			return;
		}

		const withdrawals = await this.opts.prisma.liquidityWithdrawal.findMany({
			where: {
				AND: [
					{
						pool_id: {
							equals: poolIdNum,
						},
						liq_provider_addr: {
							equals: user_wallet,
						},
					},
				],
			},
			select: {
				amount: true,
				is_removal: true,
				timestamp: true,
			},
			orderBy: {
				timestamp: "desc",
			},
			// Take the last one - if is_removal=true, that means we have no
			// active withdrawals and last withdrawal was completed.
			take: 1,
		});

		let withdrawalsData: {
			share_amount: string | number;
			time_elapsed_sec: number;
		}[] = [];

		// Here we'll check if our last withdrawal for given pool and user
		// consists of liquidity withdrawal initiation and liquidity removal
		if (withdrawals.length === 1) {
			const w = withdrawals[0];
			if (!w.is_removal) {
				withdrawalsData.push({
					share_amount: dec18ToFloat(BigInt(w.amount.toFixed())),
					time_elapsed_sec: Math.floor(
						new Date().getTime() / 1000 - w.timestamp.getTime() / 1000
					),
				});
			}
		}

		resp.send(
			toJson({
				withdrawals: withdrawalsData.map((w) => ({
					shareAmount: w.share_amount,
					timeElapsedSec: w.time_elapsed_sec,
				})),
			})
		);
	}

	private async earnings(
		req: Request<any, any, any, { lpAddr: string; poolSymbol: string }>,
		resp: Response
	) {
		const usage = "required query parameters: lpAddr, poolSymbol";
		try {
			if (!correctQueryArgs(req.query, ["lpAddr", "poolSymbol"])) {
				throw Error("please provide correct query parameters");
			}

			const user_wallet = req.query.lpAddr.toLowerCase();
			if (!isValidAddress(user_wallet)) {
				resp.status(400);
				throw Error("invalid address");
			}
			let poolIdNum: number;
			poolIdNum = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;

			interface EstEarningTokenSum {
				tkn: string;
			}
			const sumTokenAmount = await this.opts.prisma.$queryRaw<EstEarningTokenSum[]>`
                select CAST(COALESCE(sum(token_amount),0) AS VARCHAR) as tkn from estimated_earnings_tokens 
                where LOWER(liq_provider_addr) = ${user_wallet} AND pool_id = ${poolIdNum}`;

			const decimalConvention =
				this.opts.staticInfo.getMarginTokenDecimals(poolIdNum);

			let earningsTokensSum = decNToFloat(
				BigInt(sumTokenAmount[0].tkn),
				decimalConvention
			);
			const participationValue = await this.md?.getParticipationValue(
				user_wallet,
				poolIdNum
			);
			// Value is shareTokenBalance * latest price from contract
			earningsTokensSum += participationValue?.value ?? 0;

			resp.contentType("json");
			resp.send(
				toJson({
					earnings: earningsTokensSum,
				})
			);
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}

	/**
	 * funding rate
	 * @param req
	 * @param resp
	 */
	private async fundingRatePayments(
		req: Request<any, any, any, { traderAddr: string }>,
		resp: Response
	) {
		const usage = "required query parameters: traderAddr";
		if (!correctQueryArgs(req.query, ["traderAddr"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}

		const user_wallet = req.query.traderAddr.toLowerCase();
		// Parse wallet address and see if it is correct
		try {
			getAddress(user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send(errorResp("invalid wallet address", usage));
			return;
		}

		const data: FundingRatePayment[] =
			await this.opts.prisma.fundingRatePayment.findMany({
				orderBy: {
					payment_timestamp: "desc",
				},
				where: {
					trader_addr: {
						equals: user_wallet,
					},
				},
			});

		// return response
		resp.contentType("json");
		resp.send(
			toJson(
				data.map((f: FundingRatePayment) => ({
					perpetualId: Number(f.perpetual_id),
					amount: ABK64x64ToFloat(BigInt(f.payment_amount.toString())),
					timestamp: f.payment_timestamp,
					transactionHash: f.tx_hash,
				}))
			)
		);
	}

	/**
	 * trades
	 * @param req
	 * @param resp
	 */
	private async historicalTrades(
		req: Request<any, any, any, { traderAddr: string }>,
		resp: Response
	) {
		const usage = "required query parameters: traderAddr";
		if (!correctQueryArgs(req.query, ["traderAddr"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}
		const user_wallet = req.query.traderAddr.toLowerCase();

		// Parse wallet address and see if it is correct
		try {
			getAddress(user_wallet);
		} catch (e) {
			resp.status(400);
			resp.send(errorResp("invalid wallet address", usage));
			return;
		}

		const data: Trade[] = await this.opts.prisma.trade.findMany({
			orderBy: {
				trade_timestamp: "desc",
			},
			where: {
				trader_addr: {
					equals: user_wallet,
				},
			},
		});

		// return response
		resp.contentType("json");
		resp.send(
			toJson(
				data.map((t: Trade) => ({
					chainId: Number(t.chain_id),
					perpetualId: Number(t.perpetual_id),

					orderId: t.order_digest_hash,
					orderFlags: t.order_flags,
					side: t.side.toUpperCase(),
					price: ABK64x64ToFloat(BigInt(t.price.toFixed())),
					quantity: ABK64x64ToFloat(BigInt(t.quantity.toFixed())),
					fee: ABK64x64ToFloat(BigInt(t.fee.toFixed())),
					realizedPnl: ABK64x64ToFloat(BigInt(t.realized_profit.toFixed())),

					transactionHash: t.tx_hash,
					timestamp: t.trade_timestamp,
				}))
			)
		);
	}

	/**
	 * In memory cache for last price fetch time for poolSymbol
	 */
	public lastPriceFetchCacheTimestampSec = new Map<number, number>();

	/**
	 * Fetch the latest price of asked poolSymbol if previous fetch was over an
	 * hour ago.
	 * @param poolSymbol
	 */
	private async fetchAndStoreLatestPriceForPool(poolId: number) {
		let lastTsSec = this.lastPriceFetchCacheTimestampSec.get(poolId);
		if (lastTsSec != undefined) {
			const secondsSinceUpdate = Date.now() / 1000 - lastTsSec;
			if (secondsSinceUpdate < 3600) {
				this.l.info("no price update required", secondsSinceUpdate);
				return;
			}
		}
		// Perform the price fetching
		const price = await this.md!.getShareTokenPrice(poolId);
		const timestampSec = Math.round(Date.now() / 1000);
		if (!isNaN(price)) {
			this.lastPriceFetchCacheTimestampSec.set(poolId, timestampSec);
			this.l.info("fetched price info", { poolId, price, timestampSec });
			// Push the price info to db
			await this.db.priceInfo.insert(price, poolId, timestampSec);
		}
	}

	private async apyCalculation(
		req: Request<
			any,
			any,
			any,
			{
				poolSymbol: string;
				// Date/timestamp from which we check the APY
				fromTimestamp: string;
				// Either NOW or later date than from_timestamp
				toTimestamp: string;
			}
		>,
		resp: Response
	) {
		const usage =
			"required query parameters: poolSymbol, fromTimestamp (seconds), toTimestamp (seconds) ";
		try {
			if (
				!correctQueryArgs(req.query, [
					"poolSymbol",
					"fromTimestamp",
					"toTimestamp",
				])
			) {
				throw Error("please provide correct query parameters");
			}

			let pool_id: number;
			try {
				pool_id = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;
			} catch (error) {
				throw Error(`no pool found for symbol ${req.query.poolSymbol}`);
			}

			const { fromTimestamp, toTimestamp } = req.query;

			// Check if provided timestamps in seconds are ok
			let [t_from, t_to] = this.extractTimestamps(fromTimestamp, toTimestamp);

			// Retrieve the dates
			let from: Date, to: Date;
			from = new Date(t_from * 1000);
			to = new Date(t_to * 1000);
			const poolId = BigInt(pool_id!);

			// Immitate the price fetched cron job. Periodically (atm every 1 hour)
			// fetch latest price info for requested pool
			this.fetchAndStoreLatestPriceForPool(pool_id);

			interface p_info {
				pool_token_price: number;
				pool_id: number;
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
			if (toPriceInfo.length != 1 || fromPriceInfo.length != 1) {
				throw Error("not enough prices found");
			}
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
				throw Error(
					"not enough price data for the given time range to calculate APY"
				);
			}

			// APY = (priceCurrent/priceOld-1)/(TimestampSec.now()-TimestampSec.priceOld) * #secondsInYear
			const apy = ((price_ratio - 1) / t_diff) * secondsInYear;

			const response = {
				startTimestamp: start_timestamp,
				endTimestamp: end_timestamp,
				startPrice: toPriceInfo[0].pool_token_price,
				endPrice: fromPriceInfo[0].pool_token_price,
				apy,
			};
			resp.send(toJson(response));
		} catch (err: any) {
			resp.status(400).send(errorResp(extractErrorMsg(err), usage));
		}
	}
}
