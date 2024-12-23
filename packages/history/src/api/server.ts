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
import { getSDKConfigFromEnv } from "../utils/abi";
import dotenv from "dotenv";
import cors from "cors";
import { PriceInfo } from "../db/price_info";
import { tokenToString } from "typescript";
export const DECIMAL40_FORMAT_STRING = "FM9999999999999999999999999999999999999";

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
export class HistoryRestAPI {
	private app: express.Application;

	private db: DBHandlers;

	private md?: MarketData;

	private CORS_ON: boolean;

	/**
	 * Initialize ResAPI parameters, routes, middelware, etc
	 * @param opts
	 * @param l
	 */
	constructor(
		private opts: RestAPIOptions,
		public l: Logger,
	) {
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
	 * Initialize HistoryRestAPI
	 *
	 * @param httpRpcUrl
	 */
	public async init(httpRpcUrl: string) {
		// Init marked data
		const config = getSDKConfigFromEnv();
		config.nodeURL = httpRpcUrl;
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
	 * Register routes of history API
	 */
	private registerRoutes(app: express.Application) {
		app.get("/funding-rate-payments", this.fundingRatePayments.bind(this));
		app.get("/apy", this.apyCalculation.bind(this));
		app.get("/earnings", this.earnings.bind(this));
		app.get("/open-withdrawals", this.withdrawals.bind(this));
		app.get("/margin-token-info", this.marginTokenInfo.bind(this));
		app.get("/trading-volume", this.tradingVolume.bind(this));
		app.get("/has-trades", this.hasTrades.bind(this));
		app.get("/trades-history", this.historicalTrades.bind(this));
	}

	/**
	 * Starts the express app
	 */
	public async start(httpRPCUrl: string) {
		await this.init(httpRPCUrl);

		this.app.listen(this.opts.port, () => {
			this.l.info("starting history rest api server", { port: this.opts.port });
		});
	}

	private extractSecondTimestamps(t_from: number, t_to: number): [number, number] {
		if (t_from >= t_to) {
			throw Error("from must be smaller than to");
		}
		if (t_from < 1681402080) {
			//timestamp to old
			t_from = 1681402080;
		}
		if (t_to > Date.now()) {
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
		resp: Response,
	) {
		const usage = "required query parameters: lpAddr, poolSymbol";
		try {
			if (!correctQueryArgs(req.query, ["lpAddr", "poolSymbol"])) {
				resp.status(400);
				throw Error("please provide correct query parameters");
			}

			const user_wallet = req.query.lpAddr.toLowerCase();
			if (!isValidAddress(user_wallet)) {
				resp.status(400);
				throw Error("invalid address");
			}
			const poolIdNum = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;

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

			const withdrawalsData: {
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
							new Date().getTime() / 1000 - w.timestamp.getTime() / 1000,
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
				}),
			);
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}

	/**
	 * See "Estimated Earnings" in
	 * https://www.notion.so/Trader-Backend-Historical-Data-6a13d2a4aba74c7da1726c31640386f9
	 *
	 * @param req request
	 * @param resp response
	 */
	private async earnings(
		req: Request<any, any, any, { lpAddr: string; poolSymbol: string }>,
		resp: Response,
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
			const poolIdNum = this.md!.getPoolIdFromSymbol(req.query.poolSymbol)!;

			interface EstEarningTokenSum {
				tkn: string;
			}
			const sumTokenAmount = await this.opts.prisma.$queryRaw<EstEarningTokenSum[]>`
                select TO_CHAR(COALESCE(sum(token_amount),0), ${DECIMAL40_FORMAT_STRING}) as tkn from estimated_earnings_tokens 
                where LOWER(liq_provider_addr) = ${user_wallet} AND pool_id = ${poolIdNum}`;

			const decimalConvention =
				this.opts.staticInfo.getMarginTokenDecimals(poolIdNum);

			let earningsTokensSum = decNToFloat(
				BigInt(sumTokenAmount[0].tkn),
				decimalConvention,
			);
			const participationValue = await this.md?.getParticipationValue(
				user_wallet,
				poolIdNum,
			);
			// Value is shareTokenBalance * latest price from contract
			if (earningsTokensSum != 0) {
				earningsTokensSum += participationValue?.value ?? 0;
			} else {
				earningsTokensSum = 0;
			}

			resp.contentType("json");
			resp.send(
				toJson({
					earnings: earningsTokensSum,
				}),
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
		resp: Response,
	) {
		const usage = "required query parameters: traderAddr";
		try {
			if (!correctQueryArgs(req.query, ["traderAddr"])) {
				resp.status(400);
				throw Error("please provide correct query parameters");
			}

			const user_wallet = req.query.traderAddr.toLowerCase();
			// Parse wallet address and see if it is correct
			try {
				getAddress(user_wallet);
			} catch (e) {
				resp.status(400);
				throw Error("invalid wallet address");
			}

			const d = await this.opts.prisma.$queryRaw<FundingRatePayment[]>`
                select 
                    perpetual_id, 
                    TO_CHAR(payment_amount, ${DECIMAL40_FORMAT_STRING}) AS payment_amount, 
                    payment_timestamp, 
                    tx_hash
                from funding_rate_payments
                where trader_addr=${user_wallet};`;
			// return response
			resp.contentType("json");
			resp.send(
				toJson(
					d.map((f: FundingRatePayment) => ({
						perpetualId: Number(f.perpetual_id),
						amount: ABK64x64ToFloat(BigInt(f.payment_amount.toString())),
						timestamp: f.payment_timestamp,
						transactionHash: f.tx_hash,
					})),
				),
			);
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}

	/**
	 * hasTrades endpoint for Bera-clients
	 * @param req
	 * @param resp
	 */
	private async hasTrades(
		req: Request<any, any, any, { walletAddress: string; chainId: number }>,
		resp: Response,
	) {
		const usage = "required query parameters: walletAddress, optional: chainId";
		try {
			if (!correctQueryArgs(req.query, ["walletAddress"])) {
				throw Error("please provide walletAddress");
			}
			const user_wallet = req.query.walletAddress.toLowerCase();
			let chainId = 80084;
			if (req.query["chainId"] != undefined) {
				chainId = req.query["chainId"];
			}
			// Parse wallet address and see if it is correct
			try {
				getAddress(user_wallet);
			} catch (e) {
				resp.status(400);
				throw Error("invalid wallet address");
			}
			const data: any = await this.opts.prisma.trade.findFirst({
				where: {
					trader_addr: {
						equals: user_wallet,
					},
					chain_id: {
						equals: chainId,
					},
				},
			});
			console.log(`hasTrades data = ${data}`);
			console.log(`hasTrades data.length = ${data.length}`);
			const hasTrades = data.length > 0;
			// return response
			resp.contentType("json");
			resp.send(toJson({ status: hasTrades }));
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}
	/**
	 * trades
	 * @param req
	 * @param resp
	 */
	private async historicalTrades(
		req: Request<any, any, any, { traderAddr: string }>,
		resp: Response,
	) {
		const usage = "required query parameters: traderAddr";
		try {
			if (!correctQueryArgs(req.query, ["traderAddr"])) {
				throw Error("please provide correct query parameters");
			}
			const user_wallet = req.query.traderAddr.toLowerCase();

			// Parse wallet address and see if it is correct
			try {
				getAddress(user_wallet);
			} catch (e) {
				resp.status(400);
				throw Error("invalid wallet address");
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
					})),
				),
			);
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
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
		const lastTsSec = this.lastPriceFetchCacheTimestampSec.get(poolId);
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

	private async apyCalculation(req: Request, resp: Response) {
		const usage =
			"required query parameters: poolSymbol, optional: fromTimestamp (seconds), toTimestamp (seconds) ";
		try {
			const t1 = typeof req.query.fromTimestamp;
			const t2 = typeof req.query.toTimestamp;
			if (typeof req.query.poolSymbol != "string") {
				resp.status(400);
				throw Error("please provide correct query parameters");
			}
			const symbol = req.query.poolSymbol;
			let pool_id: number;
			try {
				pool_id = this.md!.getPoolIdFromSymbol(symbol);
			} catch (error) {
				resp.status(400);
				throw Error(`no pool found for symbol ${symbol}`);
			}
			const toTimestamp: number =
				req.query.toTimestamp != undefined
					? Number(req.query.toTimestamp)
					: Math.round(Date.now() / 1000);
			const fromTimestamp: number =
				req.query.fromTimestamp != undefined
					? Number(req.query.fromTimestamp)
					: toTimestamp - 86_400 * 7;
			if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
				resp.status(400);
				throw Error("please provide timestamps");
			}
			// Check if provided timestamps in seconds are ok
			const [t_from, t_to] = this.extractSecondTimestamps(
				fromTimestamp,
				toTimestamp,
			);

			// Retrieve the dates
			const from = new Date(t_from * 1000);
			const to = new Date(t_to * 1000);
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
			const firstTimestamp = await this.opts.prisma.$queryRaw<p_info[]>`
                select timestamp from price_info
                where pool_id = ${poolId}
                order by timestamp
                limit 1
            `;
			// Price info was found
			if (toPriceInfo.length != 1 || fromPriceInfo.length != 1) {
				resp.status(503);
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

			const St = toPriceInfo[0].pool_token_price;
			const S0 = fromPriceInfo[0].pool_token_price;
			const rawReturn = (St - S0) / S0;

			// division by 0
			if (t_diff === 0) {
				resp.status(503);
				throw Error(
					"not enough price data for the given time range to calculate APY",
				);
			}
			const apy = (rawReturn * secondsInYear) / t_diff;

			const allTimeAPY =
				((St - 1) * secondsInYear) /
				(end_timestamp - firstTimestamp[0].timestamp.getTime() / 1000);
			const response = {
				startTimestamp: start_timestamp,
				endTimestamp: end_timestamp,
				startPrice: fromPriceInfo[0].pool_token_price,
				endPrice: toPriceInfo[0].pool_token_price,
				apy: apy,
				rawReturn: rawReturn,
				allTimeAPY: allTimeAPY,
			};
			resp.send(toJson(response));
		} catch (err: any) {
			if (resp.statusCode != 200) {
				resp.statusCode = 400;
			}
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}

	private async marginTokenInfo(req: Request, resp: Response) {
		try {
			interface MgnTknResponse {
				pool_id: number;
				token_addr: string;
				token_name: string;
				token_decimals: number;
			}
			const queryResponse = await this.opts.prisma.$queryRaw<MgnTknResponse[]>`
                SELECT pool_id, token_addr, token_name, token_decimals
                from margin_token_info;
            `;
			const response = queryResponse.map((x) => {
				return {
					poolId: x.pool_id,
					tokenAddr: x.token_addr,
					tokenName: x.token_name,
					tokenDecimals: x.token_decimals,
				};
			});
			resp.send(toJson(response));
		} catch (err: any) {
			resp.send(errorResp(extractErrorMsg(err), ""));
		}
	}

	/**
	 * Aggregates trading volume for a given trader for provided
	 * timestamps
	 * @param req REST request data
	 * @param resp response obj
	 */
	private async tradingVolume(req: Request, resp: Response) {
		const usage =
			"query parameters: traderAddr, fromTimestamp (seconds), toTimestamp (seconds)";
		try {
			if (
				Number(req.query.fromTimestamp) == undefined ||
				Number(req.query.toTimestamp) == undefined
			) {
				resp.statusCode = 400;
				throw Error("invalid timestamp");
			}
			const [t_from, t_to] = this.extractSecondTimestamps(
				Number(req.query.fromTimestamp),
				Number(req.query.toTimestamp),
			);
			const reqTraderAddr = req.query.traderAddr?.toString().toLowerCase();
			if (reqTraderAddr == undefined || !isValidAddress(reqTraderAddr)) {
				resp.status(400);
				throw Error("invalid address");
			}
			const fromDate = new Date(t_from * 1000);
			const toDate = new Date(t_to * 1000);
			interface SqlResponse {
				pool_id: number;
				quantity_cc_abdk: string;
			}
			const queryResponse = await this.opts.prisma.$queryRaw<SqlResponse[]>`
                SELECT 
                    FLOOR(perpetual_id/100000) as pool_id,
                    TO_CHAR(SUM(ABS(th.quantity_cc)), ${DECIMAL40_FORMAT_STRING}) as quantity_cc_abdk
                FROM trades_history th
                WHERE LOWER(th.trader_addr) = ${reqTraderAddr}
                    AND th.trade_timestamp >= ${fromDate}::timestamp
                    AND th.trade_timestamp < ${toDate}::timestamp
                GROUP BY pool_id;`;
			const response = queryResponse.map((x) => {
				return { poolId: x.pool_id, quantityCcAbdk: x.quantity_cc_abdk };
			});
			resp.send(toJson(response));
		} catch (err: any) {
			if (resp.statusCode == 200) {
				resp.statusCode = 400;
			}
			resp.send(errorResp(extractErrorMsg(err), usage));
		}
	}
}
