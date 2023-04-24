import * as winston from "winston";
import { EventListener } from "./contracts/listeners";
import * as dotenv from "dotenv";
import { HistoricalDataFilterer } from "./contracts/historical";
import { BigNumberish, JsonRpcProvider, WebSocketProvider, ethers } from "ethers";
import { TradeEvent, UpdateMarginAccountEvent } from "./contracts/types";
import { PrismaClient } from "@prisma/client";
import { TradingHistory } from "./db/trading_history";
import { FundingRatePayments } from "./db/funding_rate";
import { PNLRestAPI } from "./api/server";

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

const loadEnv = () => {
	const config = dotenv.config({
		path: ".env",
	});
	if (config.error || config.parsed === undefined) {
		logger.error("could not parse .env file");
	}

	// Check if required env variables were provided
	const required = [
		"HTTP_RPC_URL",
		"WS_RPC_URL",
		"DATABASE_URL",
		"SC_ADDRESS_PERPETUAL_MANAGER_PROXY",
	];
	required.forEach((e) => {
		if (!(e in process.env)) {
			logger.error(`environment variable ${e} must be provided!`);
			process.exit(1);
		}
	});
};

// Entrypoint of PnL service
const main = async () => {
	loadEnv();
	logger.info("starting pnl service");

	// Initialize db client
	const prisma = new PrismaClient();

	// Init blockchain provider
	let wsRpcUrl = process.env.WS_RPC_URL as string;
	let httpRpcUrl = process.env.HTTP_RPC_URL as string;

	console.log(wsRpcUrl, httpRpcUrl);
	let wsProvider: ethers.Provider = new WebSocketProvider(wsRpcUrl);
	let httpProvider: ethers.Provider = new JsonRpcProvider(httpRpcUrl);

	logger.info("initialized rpc provider", { wsRpcUrl, httpRpcUrl });

	// Init db handlers
	const { chainId } = await httpProvider.getNetwork();
	const dbTrades = new TradingHistory(chainId, prisma, logger);
	const dbFundingRatePayments = new FundingRatePayments(chainId, prisma, logger);

	const eventsListener = new EventListener(
		{
			logger,
			contractAddresses: {
				perpetualManagerProxy: process.env
					.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string,
			},
		},
		wsProvider,
		dbTrades,
		dbFundingRatePayments
	);
	eventsListener.listen();

	const hd = new HistoricalDataFilterer(
		httpProvider,
		process.env.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string,
		logger
	);

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

main();
