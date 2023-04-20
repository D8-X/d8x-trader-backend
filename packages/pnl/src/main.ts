import * as winston from "winston";
import { EventListener } from "./contracts/listeners";
import * as dotenv from "dotenv";
import { HistoricalDataFilterer } from "./contracts/historical";
import { BigNumberish, JsonRpcProvider } from "ethers";
import { TradeEvent, UpdateMarginAccountEvent } from "./contracts/types";
import { PrismaClient } from "@prisma/client";
import { TradingHistory } from "./db/trading_history";
import { FundingRate } from "./db/funding_rate";

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
	const required = ["RPC_URL", "DATABASE_URL", "SC_ADDRESS_PERPETUAL_MANAGER_PROXY"];
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

	// Initialize db client
	const prisma = new PrismaClient();

	logger.info("starting pnl service");

	const eventsListener = new EventListener({
		rpcNodeUrl: process.env.RPC_URL as string,
		logger,
		contractAddresses: {
			perpetualManagerProxy: process.env
				.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string,
		},
	});
	eventsListener.listen();

	const provider = new JsonRpcProvider(process.env.RPC_URL as string);

	const hd = new HistoricalDataFilterer(
		provider,
		process.env.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string
	);

	// Init db handlers
	const { chainId } = await provider.getNetwork();
	const dbTrades = new TradingHistory(chainId, prisma, logger);
	const dbFundingRatePayments = new FundingRate(chainId, prisma, logger);

	hd.filterTrades(
		"0x6FE871703EB23771c4016eB62140367944e8EdFc" as any as string,
		new Date("2023-01-01"),
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
		"0x6FE871703EB23771c4016eB62140367944e8EdFc" as any as string,
		new Date("2023-01-01"),
		(
			e: UpdateMarginAccountEvent,
			txHash: string,
			blockNum: BigNumberish,
			blockTimestamp: number
		) => {
			dbFundingRatePayments.insertFundingRatePayment(e, txHash, blockTimestamp);
		}
	);
};

main();
