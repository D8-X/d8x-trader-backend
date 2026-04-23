import * as winston from "winston";
import { EventListener } from "../contracts/listeners.js";
import * as dotenv from "dotenv";
import { chooseRandomRPC, executeWithTimeout, loadConfigRPC, sleep } from "utils";
import { HistoricalDataFilterer } from "../contracts/historicalDataFilterer.js";
import { isRateLimitError, formatErrorMessage } from "../utils/errors.js";
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
	SettleEvent,
	SettleEventV1,
} from "../contracts/types.js";
import { PrismaClient, estimated_earnings_event_type } from "@prisma/client";
import { TradingHistory } from "../db/trading_history.js";
import { FundingRatePayments } from "../db/funding_rate.js";
import { HistoryRestAPI } from "../api/server.js";
import { getPerpetualManagerProxyAddress, getDefaultRPC } from "../utils/abi.js";
import { EstimatedEarnings } from "../db/estimated_earnings.js";
import { PriceInfo } from "../db/price_info.js";
import StaticInfo from "../contracts/static_info.js";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals.js";
import { MarginTokenInfo } from "../db/margin_token_info.js";
import WebSocket from "ws";
import { SetOracles } from "../db/set_oracles.js";
import { sleepForSec } from "@d8-x/d8x-node-sdk";
import { SettleHistory } from "../db/settle_history.js";
import { TokenFlow } from "../db/token_flow.js";
import { metrics } from "./metrics.js";
import { detectAndFillGaps } from "./gaps.js";
import sturdyWebsocket from "sturdy-websocket";
const SturdyWebSocket = sturdyWebsocket.default;

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
	process.on("unhandledRejection", (reason) => {
		logger.warn("unhandled rejection", { error: reason });
		metrics.trackError("unhandledRejection", reason);
	});

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
			batchMaxCount: 1,
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
	const dbSettle = new SettleHistory(chainId, prisma, logger);
	const dbTokenFlow = new TokenFlow(chainId, prisma, logger);
	// get sharepool token info and margin token info
	const staticInfo = new StaticInfo();
	for (let attempt = 0; ; attempt++) {
		try {
			await executeWithTimeout(
				staticInfo.initialize(httpProvider, httpRpcUrl),
				30_000,
				"RPC call timeout",
			);
			break;
		} catch (err) {
			const wait = Math.min(Math.pow(2, attempt) * 2, 120);
			logger.warn(
				`staticInfo.initialize failed (attempt ${attempt + 1}), retrying in ${wait}s`,
				{ error: formatErrorMessage(err) },
			);
			await sleepForSec(wait);
		}
	}
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
		dbSettle,
		dbTokenFlow,
	);

	const blk = await getCloseDeploymentBlock(proxyContractAddr, httpProvider);

	metrics.status = "running";

	// Start the historical data filterers on service start...
	const hdOpts: hdFilterersOpt = {
		dbEstimatedEarnings,
		dbFundingRatePayments,
		dbLPWithdrawals,
		dbPriceInfo,
		dbTrades,
		dbSetOracles,
		dbSettle,
		dbTokenFlow,
		httpProvider,
		proxyContractAddr,
		staticInfo: staticInfo,
		eventListener: eventsListener,
	};

	let backfillRunning = false;
	const runBackfillGuarded = async (startSec: number, skipUpToDate = true) => {
		if (backfillRunning) {
			logger.info("backfill already running, skipping");
			return;
		}
		backfillRunning = true;
		try {
			await runHistoricalDataFilterers(hdOpts, startSec, skipUpToDate);
		} finally {
			backfillRunning = false;
		}
	};

	const thirtyDaysAgoSec = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
	runBackfillGuarded(thirtyDaysAgoSec, false)
		.catch((e) => {
			logger.warn("initial backfill failed", { error: e });
			metrics.trackError("backfill", e);
		})
		.then(() => {
			const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
			return detectAndFillGaps(
				prisma,
				(sec: number) => runHistoricalDataFilterers(hdOpts, sec, false),
				sevenDaysAgoSec,
				logger,
			);
		})
		.catch((e) => {
			logger.warn("initial gap detection failed", { error: e });
			metrics.trackError("gapDetection", e);
		});
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
				batchMaxCount: 1,
				polling: true,
			});

		// provider is down - switch
		if (eventsListener.listeningMode === ListeningMode.WS) {
			// WS is not working, switch to HTTP
			logger.info(`switching to HTTP provider`);
			eventsListener.listen(makeJsonProvider());
			try {
				await wsProvider.destroy();
			} catch (e) {
				logger.warn("error destroying ws provider", { error: e });
				metrics.trackError("wsProvider.destroy", e);
			}
		} else {
			try {
				await wsProvider.destroy();
			} catch (e) {
				logger.warn("error destroying ws provider", { error: e });
				metrics.trackError("wsProvider.destroy", e);
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
		await runBackfillGuarded(blk.timestamp);
	}, 14_400_000); // 4 * 60 * 60 * 1000 miliseconds

	setInterval(async () => {
		if (backfillRunning) {
			logger.info("backfill running, skipping gap detection");
			return;
		}
		try {
			await detectAndFillGaps(
				prisma,
				(sec: number) => runHistoricalDataFilterers(hdOpts, sec, false),
				blk.timestamp,
				logger,
			);
		} catch (e) {
			logger.warn("gap detection failed", { error: e });
			metrics.trackError("gapDetection", e);
		}
	}, 7_200_000); // 2h in ms

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
	api.start(httpRpcUrl, staticInfo.sdkState);
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
	dbSettle: SettleHistory;
	dbTokenFlow: TokenFlow;
	staticInfo: StaticInfo; //<---- TODO: remove, available via EventListener
	eventListener: EventListener;
}

//getCloseDeploymentBlock finds a block that is a few blocks before the proxy contract
//was deployed.
async function getCloseDeploymentBlock(
	contractAddress: string,
	provider: ethers.Provider,
): Promise<{ blockNumber: number; timestamp: number }> {
	let blockNumber = await provider.getBlockNumber();
	const delta = 1000;
	blockNumber = blockNumber - delta;
	let lastAvailBlock = blockNumber;
	let lastNABlock = 0;
	let code: string;
	let consecutiveErrors = 0;
	while (lastAvailBlock - lastNABlock > 10_000) {
		try {
			code = await provider.getCode(contractAddress, blockNumber);
			consecutiveErrors = 0;
		} catch (err) {
			consecutiveErrors++;
			const wait = isRateLimitError(err)
				? Math.min(Math.pow(2, consecutiveErrors) * 2, 120)
				: Math.min(consecutiveErrors * 10, 120);
			if (isRateLimitError(err)) {
				metrics.rateLimitsHit++;
				metrics.lastRateLimitAt = new Date().toISOString();
			}
			logger.warn(
				`getCloseDeploymentBlock: ${isRateLimitError(err) ? "rate limited" : "error"}, waiting ${wait}s (attempt ${consecutiveErrors})`,
				{ error: formatErrorMessage(err) },
			);
			await sleepForSec(wait);
			continue;
		}
		if (code === "0x") {
			lastNABlock = blockNumber;
		} else {
			lastAvailBlock = blockNumber;
		}
		blockNumber = lastNABlock + Math.floor((lastAvailBlock - lastNABlock) / 2);
	}
	const block = await provider.getBlock(lastNABlock);

	return {
		blockNumber: lastNABlock,
		timestamp: block!.timestamp,
	};
}

export async function runHistoricalDataFilterers(
	opts: hdFilterersOpt,
	startTimestampSec: number,
	skipUpToDate = true,
) {
	const {
		httpProvider,
		proxyContractAddr,
		dbTrades,
		dbSetOracles,
		dbFundingRatePayments,
		dbEstimatedEarnings,
		dbPriceInfo,
		dbLPWithdrawals,
		dbSettle,
		dbTokenFlow,
		staticInfo,
		eventListener,
	} = opts;

	const defaultDate = new Date(startTimestampSec * 1000);
	const hd = new HistoricalDataFilterer(httpProvider, proxyContractAddr, logger);

	// Share token contracts
	const shareTokenAddresses = await staticInfo.retrieveShareTokenContracts();

	const promises: Array<Promise<void>> = [];
	const IS_COLLECTED_BY_EVENT = false;

	const eventTimestamps = new Map<string, Date>();

	const tradeTs = await dbTrades.getLatestTradeTimestamp();
	if (tradeTs) eventTimestamps.set("Trade", tradeTs);

	const liqTs = await dbTrades.getLatestLiquidateTimestamp();
	if (liqTs) eventTimestamps.set("Liquidate", liqTs);

	const settleTs = await dbSettle.getLatestTimestamp();
	if (settleTs) {
		eventTimestamps.set("Settle", settleTs);
		eventTimestamps.set("SettleV2", settleTs);
	}

	const tokenFlowTs = await dbTokenFlow.getLatestTimestamp();
	if (tokenFlowTs) {
		eventTimestamps.set("TokensDeposited", tokenFlowTs);
		eventTimestamps.set("TokensWithdrawn", tokenFlowTs);
	}

	const fundingTs = await dbFundingRatePayments.getLatestTimestamp();
	if (fundingTs) eventTimestamps.set("UpdateMarginAccount", fundingTs);

	const earningsTs = await dbEstimatedEarnings.getLatestTimestamp("liquidity_added");
	if (earningsTs) {
		eventTimestamps.set("LiquidityAdded", earningsTs);
		eventTimestamps.set("LiquidityRemoved", earningsTs);
	}

	const lpWithdrawalTs = await dbLPWithdrawals.getLatestTimestampInitiation();
	if (lpWithdrawalTs)
		eventTimestamps.set("LiquidityWithdrawalInitiated", lpWithdrawalTs);

	const oracleTs = await dbSetOracles.getLatestTimestamp();
	if (oracleTs) eventTimestamps.set("SetOracles", oracleTs);

	const allTimestamps = [...eventTimestamps.values()];
	allTimestamps.push(defaultDate);
	const ts = allTimestamps.reduce((a, b) => (a < b ? a : b));

	const tsInfo: Record<string, string> = {};
	for (const [k, v] of eventTimestamps) {
		tsInfo[k] = v.toISOString();
	}
	logger.info("per-event-type timestamps", tsInfo);
	logger.info(`starting filterer at ts = ${ts.toISOString()}`);

	promises.push(
		hd.filterProxyEvents(
			ts,
			{
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

				Settle: async (
					eventData: SettleEventV1,
					txHash: string,
					blockNum: BigNumberish,
					blockTimeStamp: number,
				) => {
					await eventListener.onSettleEvent(
						{
							perpetualId: eventData.perpetualId,
							trader: eventData.trader,
							amount: eventData.amount,
							cash: 0n,
						},
						txHash,
						IS_COLLECTED_BY_EVENT,
						blockTimeStamp,
					);
				},

				SettleV2: async (
					eventData: SettleEvent,
					txHash: string,
					blockNum: BigNumberish,
					blockTimeStamp: number,
				) => {
					await eventListener.onSettleEvent(
						eventData,
						txHash,
						IS_COLLECTED_BY_EVENT,
						blockTimeStamp,
					);
				},

				TokensDeposited: async (
					eventData: Record<string, any>,
					txHash: string,
					blockNum: BigNumberish,
					blockTimestamp: number,
				) => {
					await eventListener.onTokensDepositedEvent(
						{
							perpetualId: eventData.perpetualId,
							trader: eventData.trader,
							amountCC: eventData.amount,
						},
						txHash,
						IS_COLLECTED_BY_EVENT,
						blockTimestamp,
					);
				},

				TokensWithdrawn: async (
					eventData: Record<string, any>,
					txHash: string,
					blockNum: BigNumberish,
					blockTimestamp: number,
				) => {
					await eventListener.onTokensWithdrawnEvent(
						{
							perpetualId: eventData.perpetualId,
							trader: eventData.trader,
							amountCC: eventData.amount,
						},
						txHash,
						IS_COLLECTED_BY_EVENT,
						blockTimestamp,
					);
				},

				SetOracles: async (
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
					);
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
			},
			skipUpToDate ? eventTimestamps : undefined,
		),
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
	await Promise.all(promises);

	await hd.filterP2Ptransfers(
		shareTokenAddresses,
		p2pTs,
		(eventData, txHash, blockNumber, blockTimeStamp, params) => {
			dbEstimatedEarnings.insertShareTokenP2PTransfer(
				eventData,
				params?.poolId as unknown as number,
				txHash,
				IS_COLLECTED_BY_EVENT,
				blockTimeStamp,
				staticInfo,
			);
		},
	);
	// align timestamps in perpetual_long_id (because we have asynchronous events)
	await dbSetOracles.alignTimestamps();
}
