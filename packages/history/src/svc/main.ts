import { EventListener } from "../contracts/listeners.js";
import * as dotenv from "dotenv";
import {
	chooseRandomRPC,
	constructRedis,
	executeWithTimeout,
	loadConfigRPC,
} from "utils";
import { logger } from "./logger.js";
import {
	isRateLimitError,
	isNoHistoricalStateError,
	formatErrorMessage,
} from "../utils/errors.js";
import { JsonRpcProvider, Network, WebSocketProvider, ethers } from "ethers";
import { ListeningMode } from "../contracts/types.js";
import { PrismaClient } from "@prisma/client";
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
import { GapMemory } from "./gapMemory.js";
import { hdFilterersOpt, runHistoricalDataFilterers } from "./backfillRunner.js";
import sturdyWebsocket from "sturdy-websocket";
const SturdyWebSocket = sturdyWebsocket.default;

export { logger };

const STATIC_INFO_INIT_TIMEOUT_MS = 30_000;
const STATIC_INFO_MAX_BACKOFF_SEC = 120;
const WS_PROVIDER_DESTROY_TIMEOUT_MS = 10_000;
const WS_ALIVE_PROBE_MS = 30_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 60_000;
const HEARTBEAT_STALE_THRESHOLD_SEC = 30;
const REDUNDANCY_BACKFILL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const GAP_DETECTION_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2h

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
		"REDIS_URL",
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
				STATIC_INFO_INIT_TIMEOUT_MS,
				"RPC call timeout",
			);
			break;
		} catch (err) {
			const wait = Math.min(Math.pow(2, attempt) * 2, STATIC_INFO_MAX_BACKOFF_SEC);
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
		logger,
	};

	const redisClient = constructRedis("history-gaps");
	try {
		await redisClient.connect();
	} catch (e) {
		logger.error("gap memory: could not connect to redis", {
			error: formatErrorMessage(e),
		});
		process.exit(1);
	}
	const gapMemory = new GapMemory(redisClient, logger);
	logger.info("gap memory: connected to redis");

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
			logger.warn("initial backfill failed", { error: formatErrorMessage(e) });
			metrics.trackError("backfill", e);
		})
		.then(() => {
			const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
			return detectAndFillGaps(
				prisma,
				(sec: number, endSec?: number) =>
					runHistoricalDataFilterers(hdOpts, sec, false, endSec),
				sevenDaysAgoSec,
				logger,
				gapMemory,
			);
		})
		.catch((e) => {
			logger.warn("initial gap detection failed", { error: formatErrorMessage(e) });
			metrics.trackError("gapDetection", e);
		});
	eventsListener.listen(wsProvider);

	// Websocket provider leaks memory, therefore as in main api, we will
	// exit the service for a restart after maxWsResetCounter is reached
	let wsResetCounter = 0;
	const maxWsResetCounter = 100 + Math.floor(Math.random() * 100);
	let resetRpcRunning = false;
	const resetRpcFunc = async () => {
		if (eventsListener.checkHeartbeat(HEARTBEAT_STALE_THRESHOLD_SEC)) {
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
				await executeWithTimeout(
					wsProvider.destroy(),
					WS_PROVIDER_DESTROY_TIMEOUT_MS,
					"wsProvider.destroy timeout",
				);
			} catch (e) {
				logger.warn("error destroying ws provider", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("wsProvider.destroy", e);
			}
		} else {
			try {
				await executeWithTimeout(
					wsProvider.destroy(),
					WS_PROVIDER_DESTROY_TIMEOUT_MS,
					"wsProvider.destroy timeout",
				);
			} catch (e) {
				logger.warn("error destroying ws provider", {
					error: formatErrorMessage(e),
				});
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

			const wsAlive = await new Promise((resolve) => {
				wsProvider.once("block", () => {
					resolve(true);
				});
				setTimeout(() => {
					resolve(false);
				}, WS_ALIVE_PROBE_MS);
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
		} catch (_e) {
			resetRpcRunning = false;
		}
	}, HEARTBEAT_CHECK_INTERVAL_MS);

	setInterval(async () => {
		logger.info("running historical data filterers for redundancy");
		await runBackfillGuarded(blk.timestamp);
	}, REDUNDANCY_BACKFILL_INTERVAL_MS);

	setInterval(async () => {
		if (backfillRunning) {
			logger.info("backfill running, skipping gap detection");
			return;
		}
		try {
			await detectAndFillGaps(
				prisma,
				(sec: number, endSec?: number) =>
					runHistoricalDataFilterers(hdOpts, sec, false, endSec),
				blk.timestamp,
				logger,
				gapMemory,
			);
		} catch (e) {
			logger.warn("gap detection failed", { error: formatErrorMessage(e) });
			metrics.trackError("gapDetection", e);
		}
	}, GAP_DETECTION_INTERVAL_MS);

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

async function getCodeAt(
	contractAddress: string,
	blockNumber: number,
	provider: ethers.Provider,
): Promise<string> {
	let consecutiveErrors = 0;
	for (;;) {
		try {
			return await provider.getCode(contractAddress, blockNumber);
		} catch (err) {
			if (isNoHistoricalStateError(err)) {
				throw new Error(
					`RPC node is not an archive node (no historical state at block ${blockNumber}). Use an archive-capable RPC endpoint.`,
				);
			}
			consecutiveErrors++;
			if (consecutiveErrors > 10) {
				throw new Error(
					`getCodeAt: giving up after ${consecutiveErrors} errors at block ${blockNumber}: ${formatErrorMessage(err)}`,
				);
			}
			const wait = isRateLimitError(err)
				? Math.min(Math.pow(2, consecutiveErrors) * 2, 120)
				: Math.min(consecutiveErrors * 10, 120);
			if (isRateLimitError(err)) {
				metrics.rateLimitsHit++;
				metrics.lastRateLimitAt = new Date().toISOString();
			}
			logger.warn(
				`getCodeAt: ${isRateLimitError(err) ? "rate limited" : "error"}, waiting ${wait}s`,
				{
					blockNumber,
					attempt: consecutiveErrors,
					error: formatErrorMessage(err),
				},
			);
			await sleepForSec(wait);
		}
	}
}

// Walk backwards from the current block in exponentially growing steps until
// getCode returns "0x" (contract not yet deployed), then binary-search the
// exact boundary. Throws immediately if the node lacks archive state.
async function getCloseDeploymentBlock(
	contractAddress: string,
	provider: ethers.Provider,
): Promise<{ blockNumber: number; timestamp: number }> {
	const currentBlock = await provider.getBlockNumber();

	let upper = currentBlock - 1000;
	let step = 10_000;
	let lower = upper - step;

	// Walk back until we find a block where the contract doesn't exist yet.
	while (lower > 0) {
		const code = await getCodeAt(contractAddress, lower, provider);
		if (code === "0x") break;
		upper = lower;
		step = Math.min(step * 2, 2_000_000);
		lower = Math.max(0, upper - step);
	}

	// Binary search the deployment boundary between lower ("0x") and upper (bytecode).
	while (upper - lower > 1) {
		const mid = lower + Math.floor((upper - lower) / 2);
		const code = await getCodeAt(contractAddress, mid, provider);
		if (code === "0x") {
			lower = mid;
		} else {
			upper = mid;
		}
	}

	const block = await provider.getBlock(lower);
	return { blockNumber: lower, timestamp: block!.timestamp };
}
