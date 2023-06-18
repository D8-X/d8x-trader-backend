import { FundingRatePayment, Trade, Prisma, PrismaClient } from "@prisma/client";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { correctQueryArgs, errorResp, toJson } from "../utils/response";
import { getAddress } from "ethers";
import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv } from "../utils/abi";
import { dec18ToFloat, ABK64x64ToFloat } from "../utils/bigint";
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
						user_wallet: {
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
		// consists of liqduidity withdrawal initiation and liquidity removal
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
		if (!correctQueryArgs(req.query, ["lpAddr", "poolSymbol"])) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}

		const user_wallet = req.query.lpAddr.toLowerCase();
		let poolIdNum: number;
		try {
			poolIdNum = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;
		} catch (error) {
			resp.send(
				errorResp(`no pool found for symbol ${req.query.poolSymbol} `, usage)
			);
			return;
		}

		if (poolIdNum === undefined || isNaN(poolIdNum)) {
			resp.send(errorResp("please provide a correct poolSymbol", usage));
			return;
		}

        interface EstEarningTokenSum { tkn: string};
        const sumTokenAmount = await this.opts.prisma.$queryRaw<EstEarningTokenSum[]>`
            select CAST(sum(token_amount) AS VARCHAR) as tkn from estimated_earnings_tokens 
            where LOWER(wallet_address) = ${user_wallet} AND pool_id = ${poolIdNum}`;

		let earningsTokensSum = dec18ToFloat(
			BigInt(sumTokenAmount[0].tkn)
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
					wallet_address: {
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
				wallet_address: {
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
	public lastPriceFetchCache = new Map<number, Date>();

	/**
	 * Fetch the latest price of asked poolSymbol if previous fetch was over an
	 * hour ago.
	 * @param poolSymbol
	 */
	private async fetchAndStoreLatestPriceForPool(poolId: number) {
		if (this.lastPriceFetchCache.has(poolId)) {
			const moreThan1HAgo =
				(new Date().getTime() / 1000 -
					this.lastPriceFetchCache.get(poolId)!.getTime() / 1000) /
					3600 >=
				1;

			if (!moreThan1HAgo) {
				return;
			}
		}

		// Perform the price fetching
		const price = await this.md!.getShareTokenPrice(poolId);

		if (!isNaN(price)) {
			this.lastPriceFetchCache.set(poolId, new Date());
			this.l.info("fetched price info", { poolId, price });

			// Push the price info to db
			await this.db.priceInfo.insert(price, poolId);
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
			"required query parameters: poolSymbol, fromTimestamp, toTimestamp ";
		if (
			!correctQueryArgs(req.query, ["poolSymbol", "fromTimestamp", "toTimestamp"])
		) {
			resp.send(errorResp("please provide correct query parameters", usage));
			return;
		}
		let pool_id: number;
		try {
			pool_id = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;
		} catch (error) {
			resp.send(
				errorResp(`no pool found for symbol ${req.query.poolSymbol} `, usage)
			);
			return;
		}
		const { fromTimestamp, toTimestamp } = req.query;

		// Check if provided timestamps are numbers
		let t_from = parseInt(fromTimestamp),
			t_to = parseInt(toTimestamp);
		const reDigit = /^\d+$/;
		if (
			isNaN(t_from) ||
			isNaN(t_to) ||
			fromTimestamp.match(reDigit) === null ||
			toTimestamp.match(reDigit) === null ||
            t_from<1681387920 || t_to<1681387920 || // ts (seconds) before this date are not realistic
            t_to>Date.now()+86_400*1000 || // ts (milliseconds) after this date are not realistic
            t_from>t_to
		) {
			resp.send(
				errorResp(
					"invalid fromTimestamp or toTimestamp, please provide correct unix timestamps (s or ms)",
					usage
				)
			);
			return;
		}

		// Retrieve the dates
		let from: Date, to: Date;
        function toMilli(timeStmp: number) : number {
            // if the timestamp is larger than the date-now+buffer in seconds,
            // then the timestamp must be in millisecond units
            const tsNearFutureInSeconds = Date.now()/1000+5*86400;
            return timeStmp > tsNearFutureInSeconds ? timeStmp : timeStmp*1000;
        }
        from = new Date(toMilli(t_from));
		to = new Date(toMilli(t_to));

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

		const poolId = BigInt(pool_id!);

		// Immitate the price fetched cron job. Periodically (atm every 1 hour)
		// fetch latest price info for requested pool
		this.fetchAndStoreLatestPriceForPool(pool_id);

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
				startTimestamp: start_timestamp,
				endTimestamp: end_timestamp,
				startPrice: toPriceInfo[0].pool_token_price,
				endPrice: fromPriceInfo[0].pool_token_price,
				apy,
			};
			resp.send(toJson(response));
			return;
		}

		resp.send(errorResp("not enough data to calculate APY", usage));
		return;
	}
}
