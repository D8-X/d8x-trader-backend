import * as winston from "winston";
import { EventListener } from "./contracts/listeners";
import * as dotenv from "dotenv";
import { HistoricalDataFilterer } from "./contracts/historical";
import { JsonRpcProvider } from "ethers";
import { TradeEvent, UpdateMarginAccountEvent } from "./contracts/types";

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
const main = () => {
	loadEnv();

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

	const hd = new HistoricalDataFilterer(
		new JsonRpcProvider(process.env.RPC_URL as string),
		process.env.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string
	);
	//  TODO use historical data filterer
};

main();
