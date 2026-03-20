import * as winston from "winston";
import { EventListener } from "../contracts/listeners.js";
import * as dotenv from "dotenv";
import { chooseRandomRPC, executeWithTimeout, loadConfigRPC, sleep } from "utils";
import { HistoricalDataFilterer } from "../contracts/historicalDataFilterer.js";
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
// workaround for CJS package
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("sturdy-websocket");
const SturdyWebSocket = mod.default ?? mod.SturdyWebSocket ?? mod;

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
	const dbSettle = new SettleHistory(chainId, prisma, logger);
	const dbTokenFlow = new TokenFlow(chainId, prisma, logger);
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
		dbSettle,
		dbTokenFlow,
	);

	const blk = await getCloseDeploymentBlock(proxyContractAddr, httpProvider);

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
	runHistoricalDataFilterers(hdOpts, blk.timestamp);
	detectAndFillGaps(prisma, hdOpts, blk.timestamp).catch((e) => {
		logger.warn("initial gap detection failed", { error: e });
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
				batchMaxCount: 25,
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
			}
		} else {
			try {
				await wsProvider.destroy();
			} catch (e) {
				logger.warn("error destroying ws provider", { error: e });
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
		runHistoricalDataFilterers(hdOpts, blk.timestamp);
	}, 14_400_000); // 4 * 60 * 60 * 1000 miliseconds

	setInterval(async () => {
		try {
			await detectAndFillGaps(prisma, hdOpts, blk.timestamp);
		} catch (e) {
			logger.warn("gap detection failed", { error: e });
		}
	}, 86_400_000); // this 24h in ms

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
	let errCount = 0;
	while (lastAvailBlock - lastNABlock > 10_000) {
		try {
			code = await provider.getCode(contractAddress, blockNumber);
		} catch (err) {
			console.log("getCloseDeploymentBlock error: waiting");
			if (errCount > 10) {
				throw new Error("too many errors in trying to getCloseDeploymentBlock");
			}
			await sleepForSec(10);
			errCount += 1;
			continue;
		}
		if (code === "0x") {
			// not deployed yet
			lastNABlock = blockNumber;
		} else {
			// deployed
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
						Number(blockNum.toString()),
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
						Number(blockNum.toString()),
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
						Number(blockNum.toString()),
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
						Number(blockNum.toString()),
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
					staticInfo,
				);
			},
		),
	);
	await Promise.all(promises);
	// align timestamps in perpetual_long_id (because we have asynchronous events)
	await dbSetOracles.alignTimestamps();
}

interface GapConfig {
	table: string;
	timestampCol: string;
	thresholdSeconds: number;
}

const GAP_CONFIGS: GapConfig[] = [
	{
		table: "trades_history",
		timestampCol: "trade_timestamp",
		thresholdSeconds: 12 * 3600,
	},
	{ table: "token_flow", timestampCol: "timestamp", thresholdSeconds: 12 * 3600 },
	{
		table: "funding_rate_payments",
		timestampCol: "payment_timestamp",
		thresholdSeconds: 12 * 3600,
	},
	{ table: "settle_history", timestampCol: "timestamp", thresholdSeconds: 24 * 3600 },
	{
		table: "estimated_earnings_tokens",
		timestampCol: "created_at",
		thresholdSeconds: 24 * 3600,
	},
];

async function detectGaps(
	prisma: PrismaClient,
	config: GapConfig,
): Promise<{ gap_start: Date; gap_end: Date }[]> {
	const gaps = await prisma.$queryRawUnsafe<{ gap_start: Date; gap_end: Date }[]>(
		`WITH ordered AS (
			SELECT ${config.timestampCol} as ts,
				LEAD(${config.timestampCol}) OVER (ORDER BY ${config.timestampCol}) as next_ts
			FROM ${config.table}
			WHERE is_collected_by_event = false
		)
		SELECT ts as gap_start, next_ts as gap_end
		FROM ordered
		WHERE next_ts IS NOT NULL
			AND EXTRACT(EPOCH FROM (next_ts - ts)) > $1
		LIMIT 10`,
		config.thresholdSeconds,
	);
	return gaps;
}

async function detectAndFillGaps(
	prisma: PrismaClient,
	opts: hdFilterersOpt,
	startTimestampSec: number,
) {
	let latestGapStart: Date | undefined;

	for (const config of GAP_CONFIGS) {
		try {
			const gaps = await detectGaps(prisma, config);
			if (gaps.length > 0) {
				const lastGap = gaps[gaps.length - 1];
				logger.info(`detected ${gaps.length} gap(s) in ${config.table}`, {
					first_gap: `${gaps[0].gap_start.toISOString()} - ${gaps[0].gap_end.toISOString()}`,
					last_gap: `${lastGap.gap_start.toISOString()} - ${lastGap.gap_end.toISOString()}`,
				});
				if (!latestGapStart || lastGap.gap_start > latestGapStart) {
					latestGapStart = lastGap.gap_start;
				}
			}
		} catch (e) {
			logger.warn(`gap detection failed for ${config.table}`, { error: e });
		}
	}

	if (latestGapStart) {
		const gapStartSec = Math.max(
			Math.floor(latestGapStart.getTime() / 1000),
			startTimestampSec,
		);
		logger.info("triggering backfill from latest gap", {
			gap_start: latestGapStart.toISOString(),
		});
		await runHistoricalDataFilterers(opts, gapStartSec, false);
	}
}
