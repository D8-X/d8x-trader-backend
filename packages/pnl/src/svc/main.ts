import * as winston from "winston";
import { EventListener } from "../contracts/listeners";
import * as dotenv from "dotenv";
import { HistoricalDataFilterer } from "../contracts/historical";
import { BigNumberish, JsonRpcProvider, WebSocketProvider, ethers } from "ethers";
import {
	LiquidityAddedEvent,
	TradeEvent,
	UpdateMarginAccountEvent,
} from "../contracts/types";
import { PrismaClient, estimated_earnings_event_type } from "@prisma/client";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { PNLRestAPI } from "../api/server";
import { getPerpetualManagerProxyAddress, getDefaultRPC } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";

// TODO set this up for actual production use
const defaultLogger = () => {
	return winston.createLogger({
		level: "info",
		format: winston.format.json(),
		defaultMeta: { service: "pnl-service" },
		transports: [
			new winston.transports.Console(),
			new winston.transports.File({ filename: "pnl.log" }),
		],
	});
};

export const logger = defaultLogger();

export const loadEnv = (wantEnvs?: string[] | undefined) => {
	const config = dotenv.config({
		path: ".env",
	});
	if (config.error || config.parsed === undefined) {
		logger.error("could not parse .env file");
	}

	// Check if required env variables were provided
	const required = wantEnvs ?? [
		"HTTP_RPC_URL",
		"WS_RPC_URL",
		"DATABASE_URL",
		"SDK_CONFIG_NAME",
	];
	required.forEach((e) => {
		if (!(e in process.env)) {
			logger.error(`environment variable ${e} must be provided!`);
			process.exit(1);
		}
	});
};

// Entrypoint of PnL service
export const main = async () => {
	loadEnv();
	logger.info("starting pnl service");

	// Initialize db client
	const prisma = new PrismaClient();

	// Init blockchain provider
	let wsRpcUrl = process.env.WS_RPC_URL as string;
	let httpRpcUrl = process.env.HTTP_RPC_URL as string;
	if (httpRpcUrl == "") {
		httpRpcUrl = getDefaultRPC();
		const msg = `no rpc provider specified, using default ${httpRpcUrl}`;
		logger.info(msg);
	}
	let wsProvider: ethers.Provider = new WebSocketProvider(wsRpcUrl);
	let httpProvider: ethers.Provider = new JsonRpcProvider(httpRpcUrl);

	logger.info("initialized rpc provider", { wsRpcUrl, httpRpcUrl });

	// Init db handlers
	const { chainId } = await httpProvider.getNetwork();
	const dbTrades = new TradingHistory(chainId, prisma, logger);
	const dbFundingRatePayments = new FundingRatePayments(chainId, prisma, logger);
	const proxyContractAddr = getPerpetualManagerProxyAddress();
	const dbEstimatedEarnings = new EstimatedEarnings(chainId, prisma, logger);
	const dbPriceInfo = new PriceInfo(prisma, logger);

	const eventsListener = new EventListener(
		{
			logger,
			contractAddresses: {
				perpetualManagerProxy: proxyContractAddr,
			},
		},
		wsProvider,
		dbTrades,
		dbFundingRatePayments,
		dbEstimatedEarnings,
		dbPriceInfo
	);
	eventsListener.listen();

	const hd = new HistoricalDataFilterer(httpProvider, proxyContractAddr, logger);

	// Filter all trades on startup
	hd.filterTrades(
		null as any as string,
		await dbTrades.getLatestTimestamp(),
		(
			e: TradeEvent,
			txHash: string,
			blockNum: BigNumberish,
			blockTimestamp: number
		) => {
			dbTrades.insertTradeHistoryRecord(e, txHash, blockTimestamp);
		}
	);

	hd.filterUpdateMarginAccount(
		null as any as string,
		await dbFundingRatePayments.getLatestTimestamp(),
		(
			e: UpdateMarginAccountEvent,
			txHash: string,
			blockNum: BigNumberish,
			blockTimestamp: number
		) => {
			dbFundingRatePayments.insertFundingRatePayment(e, txHash, blockTimestamp);
		}
	);
	hd.filterLiquidityAdded(
		null,
		await dbEstimatedEarnings.getLatestTimestamp(
			estimated_earnings_event_type.liquidity_added
		),
		(
			e: LiquidityAddedEvent,
			txHash: string,
			blockNum: BigNumberish,
			blockTimestamp: number
		) => {
			dbEstimatedEarnings.insertLiquidityAdded(
				e.user,
				e.tokenAmount,
				e.poolId,
				txHash,
				blockTimestamp
			);
		}
	);
	hd.filterLiquidityRemoved(
		null,
		await dbEstimatedEarnings.getLatestTimestamp(
			estimated_earnings_event_type.liquidity_removed
		),
		(
			e: LiquidityAddedEvent,
			txHash: string,
			blockNum: BigNumberish,
			blockTimestamp: number
		) => {
			dbEstimatedEarnings.insertLiquidityRemoved(
				e.user,
				e.tokenAmount,
				e.poolId,
				txHash,
				blockTimestamp
			);
		}
	);

	// Start the pnl api
	const api = new PNLRestAPI(
		{
			port: 8888,
			prisma,
			db: {
				fundingRatePayment: dbFundingRatePayments,
				tradeHistory: dbTrades,
			},
		},
		logger
	);
	api.start();
};
