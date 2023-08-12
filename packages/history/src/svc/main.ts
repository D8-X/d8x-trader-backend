import * as winston from "winston";
import { EventListener } from "../contracts/listeners";
import * as dotenv from "dotenv";
import { chooseRandomRPC, executeWithTimeout } from "utils";
import { HistoricalDataFilterer } from "../contracts/historicalDataFilterer";
import {
	BigNumberish,
	JsonRpcProvider,
	Network,
	WebSocketProvider,
	ethers,
} from "ethers";
import {
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	TradeEvent,
	LiquidateEvent,
	UpdateMarginAccountEvent,
} from "../contracts/types";
import { PrismaClient, estimated_earnings_event_type } from "@prisma/client";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { HistoryRestAPI } from "../api/server";
import { getPerpetualManagerProxyAddress, getDefaultRPC } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";
import StaticInfo from "../contracts/static_info";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals";
import { MarginTokenInfo } from "../db/margin_token_info";
import SturdyWebSocket from "sturdy-websocket";
import WebSocket from "ws";

const MAX_HISTORY_SINCE_TS = 1681387680;

const defaultLogger = () => {
	return winston.createLogger({
		level: "info",
		format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
		defaultMeta: { service: "history" },
		transports: [
			new winston.transports.Console(),
			new winston.transports.File({ filename: "history.log" }),
		],
	});
};

export const logger = defaultLogger();

export const loadEnv = (wantEnvs?: string[] | undefined) => {
	const config = dotenv.config({
		path: ".env",
	});
	let configNotFound = config.error || config.parsed === undefined;

	// Check if required env variables were provided
	const required = wantEnvs ?? [
		"DATABASE_DSN_HISTORY",
		"SDK_CONFIG_NAME",
		"CHAIN_ID",
		"API_PORT",
	];
	required.forEach((e) => {
		if (!(e in process.env)) {
			if (configNotFound) {
				logger.warn("could not parse .env file");
			}
			logger.error(`environment variable ${e} must be provided!`);
			process.exit(1);
		}
	});
};

// Entrypoint of history service
export const main = async () => {
	loadEnv();
	logger.info("starting history service");

	// Initialize db client
	const prisma = new PrismaClient();

	// Init blockchain provider
	const rpcConfig = require("../../../../config/live.rpc.json");
	let wsRpcUrl = chooseRandomRPC(true, rpcConfig);
	let httpRpcUrl = chooseRandomRPC(false, rpcConfig);
	let chainId = Number(<string>process.env.CHAIN_ID || -1);
	if (httpRpcUrl == "") {
		httpRpcUrl = getDefaultRPC();
		const msg = `no rpc provider specified, using default ${httpRpcUrl}`;
		logger.info(msg);
	}
	const network = Network.from(chainId);
	let wsProvider: ethers.WebSocketProvider = new WebSocketProvider(
		() =>
			new SturdyWebSocket(chooseRandomRPC(true, rpcConfig), {
				wsConstructor: WebSocket,
			}),
		network
	);
	let httpProvider: ethers.JsonRpcProvider = new JsonRpcProvider(httpRpcUrl, network, {
		staticNetwork: network,
		batchMaxCount: 25,
	});

	logger.info("initialized rpc provider", { wsRpcUrl, httpRpcUrl });

	// Init db handlers
	const dbTrades = new TradingHistory(chainId, prisma, logger);
	const dbFundingRatePayments = new FundingRatePayments(chainId, prisma, logger);
	const proxyContractAddr = getPerpetualManagerProxyAddress();
	const dbEstimatedEarnings = new EstimatedEarnings(chainId, prisma, logger);
	const dbPriceInfo = new PriceInfo(prisma, logger);
	const dbLPWithdrawals = new LiquidityWithdrawals(prisma, logger);
	const dbMarginTokenInfo = new MarginTokenInfo(prisma, logger);
	// get sharepool token info and margin token info
	const staticInfo = new StaticInfo();
	// the following call will throw an error on RPC timeout
	await executeWithTimeout(
		staticInfo.initialize(httpProvider, httpRpcUrl),
		10_000,
		"RPC call timeout"
	);
	// store margin token info and perpetual info to DB
	await staticInfo.checkAndWriteMarginTokenInfoToDB(dbMarginTokenInfo);

	const eventsListener = new EventListener(
		{
			logger: logger,
			contractAddresses: {
				perpetualManagerProxy: proxyContractAddr,
			},
			staticInfo: staticInfo,
		},
		// wsProvider,
		dbTrades,
		dbFundingRatePayments,
		dbEstimatedEarnings,
		dbPriceInfo,
		dbLPWithdrawals
	);

	// Start the historical data filterers on serivice start...
	const hdOpts: hdFilterersOpt = {
		dbEstimatedEarnings,
		dbFundingRatePayments,
		dbLPWithdrawals,
		dbPriceInfo,
		dbTrades,
		httpProvider,
		proxyContractAddr,
		staticInfo: staticInfo,
		eventListener: eventsListener,
	};
	runHistoricalDataFilterers(hdOpts);

	eventsListener.listen(wsProvider);
	// re-start listeners with new WS provider periodically
	// 2.5 hours - typically the connection should stay alive longer, so this ensures no gaps
	setInterval(async () => {
		eventsListener.listen(
			new WebSocketProvider(
				() =>
					new SturdyWebSocket(chooseRandomRPC(true, rpcConfig), {
						wsConstructor: WebSocket,
					}),
				network
			)
		);
	}, 9_000_000); // 2.5 * 60 * 60 * 1000 miliseconds

	// check heartbeat of RPC connection every 5 minutes - cheap (one eth_call)
	setInterval(async () => {
		eventsListener.checkHeartbeat(await httpProvider.getBlockNumber());
	}, 300_000);

	// Re fetch  periodically for redundancy. This will ensure that any lost events will eventually be stored in db
	// every 4 hours poll (5 hours would leave us just under 10_000 blocks, so the call typically covers as many blocks as possible for a fixed RPC cost)
	setInterval(async () => {
		logger.info("running historical data filterers for redundancy");
		// non-blocking, so no await
		runHistoricalDataFilterers(hdOpts);
	}, 14_400_000); // 4 * 60 * 60 * 1000 miliseconds

	// Start the history api
	const api = new HistoryRestAPI(
		{
			port: parseInt(process.env.API_PORT!),
			prisma,
			db: {
				fundingRatePayment: dbFundingRatePayments,
				tradeHistory: dbTrades,
				priceInfo: dbPriceInfo,
			},
			staticInfo: staticInfo,
		},
		logger
	);
	api.start(httpRpcUrl);
};

export interface hdFilterersOpt {
	httpProvider: ethers.Provider;
	proxyContractAddr: string;
	dbTrades: TradingHistory;
	dbFundingRatePayments: FundingRatePayments;
	dbEstimatedEarnings: EstimatedEarnings;
	dbPriceInfo: PriceInfo;
	dbLPWithdrawals: LiquidityWithdrawals;
	staticInfo: StaticInfo; //<---- TODO: remove, available via EventListener
	eventListener: EventListener;
}

export async function runHistoricalDataFilterers(opts: hdFilterersOpt) {
	const {
		httpProvider,
		proxyContractAddr,
		dbTrades,
		dbFundingRatePayments,
		dbEstimatedEarnings,
		dbPriceInfo,
		dbLPWithdrawals,
		staticInfo,
		eventListener,
	} = opts;
	const defaultDate = new Date(MAX_HISTORY_SINCE_TS * 1000);
	const hd = new HistoricalDataFilterer(httpProvider, proxyContractAddr, logger);

	// Share token contracts
	const shareTokenAddresses = await staticInfo.retrieveShareTokenContracts();

	let promises: Array<Promise<void>> = [];
	const IS_COLLECTED_BY_EVENT = false;

	let ts = [
		(await dbLPWithdrawals.getLatestTimestampInitiation()) ?? defaultDate,
		(await dbTrades.getLatestTradeTimestamp()) ?? defaultDate,
		(await dbTrades.getLatestLiquidateTimestamp()) ?? defaultDate,
		(await dbFundingRatePayments.getLatestTimestamp()) ?? defaultDate,
	].reduce(function (a, b) {
		return a > b ? a : b;
	});

	promises.push(
		hd.filterProxyEvents(ts, {
			Trade: async (
				eventData: TradeEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onTradeEvent(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
					Number(blockNum.toString())
				);
			},
			Liquidate: async (
				eventData: LiquidateEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onLiquidate(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
					Number(blockNum.toString())
				);
			},
			UpdateMarginAccount: async (
				eventData: UpdateMarginAccountEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onUpdateMarginAccount(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			},
			LiquidityAdded: async (
				eventData: LiquidityAddedEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onLiquidityAdded(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			},
			LiquidityRemoved: async (
				eventData: LiquidityRemovedEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onLiquidityRemoved(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			},
			LiquidityWithdrawalInitiated: async (
				eventData,
				txHash,
				_blockNumber,
				blockTimeStamp,
				_params
			) => {
				await eventListener.onLiquidityWithdrawalInitiated(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimeStamp
				);
			},
			// TODO: add the rest
		})
	);
	// Share tokens p2p transfers
	let p2pTimestamps = await dbEstimatedEarnings.getLatestTimestampsP2PTransfer(
		shareTokenAddresses.length
	);
	let p2pTs: Date[] = [];
	for (let k = 0; k < shareTokenAddresses.length; k++) {
		if (p2pTimestamps[k] == undefined) {
			p2pTs.push(defaultDate);
		} else {
			p2pTs.push(p2pTimestamps[k]!);
		}
	}
	promises.push(
		hd.filterP2Ptransfers(
			shareTokenAddresses,
			p2pTs,
			(eventData, txHash, blockNumber, blockTimeStamp, params) => {
				dbEstimatedEarnings.insertShareTokenP2PTransfer(
					eventData,
					params?.poolId as unknown as number,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimeStamp
				);
			}
		)
	);
	await Promise.all(promises);
}
