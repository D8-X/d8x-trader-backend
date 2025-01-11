import * as winston from "winston";
import { EventListener } from "../contracts/listeners";
import * as dotenv from "dotenv";
import { chooseRandomRPC, executeWithTimeout, loadConfigRPC, sleep } from "utils";
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
	ListeningMode,
	SetOraclesEvent,
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
import { SetOracles } from "../db/set_oracles";
import { IPerpetualManager, sleepForSec } from "@d8x/perpetuals-sdk";

const MAX_HISTORY_SINCE_TS = 1713096480;

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
	const configNotFound = config.error || config.parsed === undefined;

	// Check if required env variables were provided
	const required = wantEnvs ?? [
		"DATABASE_DSN_HISTORY",
		"SDK_CONFIG_NAME",
		"CHAIN_ID",
		"HISTORY_API_PORT_HTTP",
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
	const rpcConfig = loadConfigRPC();
	const wsRpcUrl = chooseRandomRPC(true, rpcConfig);
	let httpRpcUrl = chooseRandomRPC(false, rpcConfig);
	const chainId = Number(<string>process.env.CHAIN_ID || -1);
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
		network,
	);
	const httpProvider: ethers.JsonRpcProvider = new JsonRpcProvider(
		httpRpcUrl,
		network,
		{
			staticNetwork: network,
			batchMaxCount: 25,
			polling: true,
		},
	);

	logger.info("initialized rpc provider", { wsRpcUrl, httpRpcUrl });

	// Init db handlers
	const dbTrades = new TradingHistory(chainId, prisma, logger);
	const dbFundingRatePayments = new FundingRatePayments(chainId, prisma, logger);
	const proxyContractAddr = getPerpetualManagerProxyAddress();
	const dbEstimatedEarnings = new EstimatedEarnings(chainId, prisma, logger);
	const dbPriceInfo = new PriceInfo(prisma, logger);
	const dbLPWithdrawals = new LiquidityWithdrawals(prisma, logger);
	const dbMarginTokenInfo = new MarginTokenInfo(prisma, logger);
	const dbSetOracles = new SetOracles(chainId, prisma, logger);
	// get sharepool token info and margin token info
	const staticInfo = new StaticInfo();
	// the following call will throw an error on RPC timeout
	await executeWithTimeout(
		staticInfo.initialize(httpProvider, httpRpcUrl),
		10_000,
		"RPC call timeout",
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
		dbLPWithdrawals,
		dbSetOracles,
	);

	// Start the historical data filterers on service start...
	const hdOpts: hdFilterersOpt = {
		dbEstimatedEarnings,
		dbFundingRatePayments,
		dbLPWithdrawals,
		dbPriceInfo,
		dbTrades,
		dbSetOracles,
		httpProvider,
		proxyContractAddr,
		staticInfo: staticInfo,
		eventListener: eventsListener,
	};
	runHistoricalDataFilterers(hdOpts);
	eventsListener.listen(wsProvider);

	// Websocket provider leaks memory, therefore as in main api, we will
	// exit the service for a restart after maxWsResetCounter is reached
	let wsResetCounter = 0;
	const maxWsResetCounter = 100 + Math.floor(Math.random() * 100);
	let resetRpcRunning = false;
	const resetRpcFunc = async () => {
		if (eventsListener.checkHeartbeat(30)) {
			return;
		}
		if (resetRpcRunning) {
			logger.info("resetRpcFunc is already running, not running again...");
			return;
		}
		resetRpcRunning = true;

		const makeJsonProvider = () =>
			new JsonRpcProvider(chooseRandomRPC(false, rpcConfig), network, {
				staticNetwork: network,
				batchMaxCount: 25,
				polling: true,
			});

		// provider is down - switch
		if (eventsListener.listeningMode === ListeningMode.WS) {
			// WS is not working, switch to HTTP
			logger.info(`switching to HTTP provider`);
			eventsListener.listen(makeJsonProvider());
		} else {
			if (wsProvider) {
				await wsProvider.destroy();
			}

			// currently on HTTP - check if can switch back to WS
			const wsUrl = chooseRandomRPC(true, rpcConfig);
			logger.info("creating new WebsocketProvider", { wsUrl });

			wsProvider = new WebSocketProvider(
				() =>
					new SturdyWebSocket(wsUrl, {
						wsConstructor: WebSocket,
					}),
				network,
			);
			wsResetCounter++;

			// Wait for block event to happen on ws provider (~8sec), othwerwise
			// switch back to HTTP
			const wsAlive = await new Promise((resolve, reject) => {
				wsProvider.once("block", () => {
					resolve(true);
				});
				setTimeout(() => {
					resolve(false);
				}, 30_000);
			});
			// WS works, switch providers
			if (wsAlive) {
				logger.info(`switching to WS provider`);
				eventsListener.listen(wsProvider!);
			} else {
				// WS didn't work, stay on HTTP
				logger.info(`switching HTTP providers`);
				eventsListener.listen(makeJsonProvider());
			}
		}

		resetRpcRunning = false;
		// Once reset limit is reached - restart
		if (wsResetCounter >= maxWsResetCounter) {
			logger.warn(
				"wsResetCounter reached maxWsResetCounter, restarting history service",
				{ maxWsResetCounter, wsResetCounter },
			);
			process.exit(0);
		} else {
			logger.info("resetRpcFunc finished", { wsResetCounter, maxWsResetCounter });
		}
	};

	// check heartbeat of RPC connection
	setInterval(async () => {
		try {
			await resetRpcFunc();
		} catch (e) {
			resetRpcRunning = false;
		}
	}, 60_000);

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
			port: parseInt(process.env.HISTORY_API_PORT_HTTP!),
			prisma,
			db: {
				fundingRatePayment: dbFundingRatePayments,
				tradeHistory: dbTrades,
				priceInfo: dbPriceInfo,
			},
			staticInfo: staticInfo,
		},
		logger,
	);
	api.start(httpRpcUrl);
};

export interface hdFilterersOpt {
	httpProvider: ethers.Provider;
	proxyContractAddr: string;
	dbTrades: TradingHistory;
	dbSetOracles: SetOracles;
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
		dbSetOracles,
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

	const promises: Array<Promise<void>> = [];
	const IS_COLLECTED_BY_EVENT = false;

	const tsArr = [
		(await dbLPWithdrawals.getLatestTimestampInitiation()) ?? defaultDate,
		(await dbTrades.getLatestTradeTimestamp()) ?? defaultDate,
		(await dbTrades.getLatestLiquidateTimestamp()) ?? defaultDate,
		(await dbFundingRatePayments.getLatestTimestamp()) ?? defaultDate,
		(await dbEstimatedEarnings.getLatestTimestamp("liquidity_added")) ?? defaultDate,
		(await dbSetOracles.getLatestTimestamp()) ?? defaultDate,
	];
	// Use the smallest timestamp for the start of the filter
	let ts = tsArr.reduce(function (a, b) {
		return a < b ? a : b;
	});
	console.log(` starting filterer at ts = ${ts}`)
	promises.push(
		hd.filterProxyEvents(ts, {
			Trade: async (
				eventData: TradeEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onTradeEvent(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
					Number(blockNum.toString()),
				);
			},

			SetOracles: async(
				eventData: SetOraclesEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onSetOracleEvent(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
					Number(blockNum.toString()),
				)
			},

			Liquidate: async (
				eventData: LiquidateEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onLiquidate(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
					Number(blockNum.toString()),
				);
			},
			UpdateMarginAccount: async (
				eventData: UpdateMarginAccountEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onUpdateMarginAccount(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
				);
			},
			LiquidityAdded: async (
				eventData: LiquidityAddedEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onLiquidityAdded(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
				);
			},
			LiquidityRemoved: async (
				eventData: LiquidityRemovedEvent,
				txHash: string,
				_blockNum: BigNumberish,
				blockTimestamp: number,
			) => {
				await eventListener.onLiquidityRemoved(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp,
				);
			},
			LiquidityWithdrawalInitiated: async (
				eventData,
				txHash,
				_blockNumber,
				blockTimeStamp,
				_params,
			) => {
				await eventListener.onLiquidityWithdrawalInitiated(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimeStamp,
				);
			},
			
		}),
	);
	// Share tokens p2p transfers
	const p2pTimestamps = await dbEstimatedEarnings.getLatestTimestampsP2PTransfer(
		shareTokenAddresses.length,
	);
	const p2pTs: Date[] = [];
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
					blockTimeStamp,
				);
			},
		),
	);
	await Promise.all(promises);
	// align timestamps in perpetual_long_id (because we have asynchronous events)
	await dbSetOracles.alignTimestamps()
}
