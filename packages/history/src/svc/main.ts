import * as winston from "winston";
import { EventListener } from "../contracts/listeners";
import * as dotenv from "dotenv";
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
import { PNLRestAPI } from "../api/server";
import { getPerpetualManagerProxyAddress, getDefaultRPC } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";
import StaticInfo from "../contracts/static_info";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals";
import { MarginTokenInfo } from "../db/margin_token_info";

const defaultLogger = () => {
	return winston.createLogger({
		level: "info",
		format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
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
	let configNotFound = config.error || config.parsed === undefined;

	// Check if required env variables were provided
	const required = wantEnvs ?? [
		"HTTP_RPC_URL",
		"WS_RPC_URL",
		"DATABASE_URL",
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

// Entrypoint of PnL service
export const main = async () => {
	loadEnv();
	logger.info("starting pnl service");

	// Initialize db client
	const prisma = new PrismaClient();

	// Init blockchain provider
	let wsRpcUrl = process.env.WS_RPC_URL as string;
	let httpRpcUrl = process.env.HTTP_RPC_URL as string;
	let chainId = Number(<string>process.env.CHAIN_ID || -1);
	if (httpRpcUrl == "") {
		httpRpcUrl = getDefaultRPC();
		const msg = `no rpc provider specified, using default ${httpRpcUrl}`;
		logger.info(msg);
	}
	const network = Network.from(chainId);
	let wsProvider: ethers.WebSocketProvider = new WebSocketProvider(wsRpcUrl, network);
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
	await staticInfo.initialize(httpProvider);
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
		useTimestamp: undefined,
		staticInfo: staticInfo,
		eventListener: eventsListener,
	};
	runHistoricalDataFilterers(hdOpts);

	eventsListener.listen(new WebSocketProvider(wsRpcUrl));
	// re-start listeners with new WS provider periodically
	// 2.5 hours - typically the connection should stay alive longer, so this ensures no gaps
	setInterval(async () => {
		eventsListener.listen(new WebSocketProvider(wsRpcUrl));
	}, 9_000_000); // 2.5 * 60 * 60 * 1000 miliseconds

	// check heartbeat of RPC connection every 5 minutes - cheap (one eth_call)
	setInterval(async () => {
		eventsListener.checkHeartbeat(await httpProvider.getBlockNumber());
	}, 300_000);

	// Re fetch  periodically for redundancy. This will ensure that any lost events will eventually be stored in db
	// every 4 hours poll 5 hours, just under 10_000 blocks, so this call covers as many blocks as possible for a fixed RPC cost
	setInterval(async () => {
		const secondsInPast = 18_000; // 5 * 60 * 60 seconds
		const timestampStart = Date.now() - secondsInPast * 1000;
		hdOpts.useTimestamp = new Date(timestampStart);
		logger.info("running historical data filterers for redundancy", {
			from: hdOpts.useTimestamp,
		});
		// non-blocking, so no await
		runHistoricalDataFilterers(hdOpts);
	}, 14_400_000); // 4 * 60 * 60 * 1000 miliseconds

	// Start the pnl api
	const api = new PNLRestAPI(
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
	api.start();
};

export interface hdFilterersOpt {
	// If useTimestamp is provided, it will be used instead of latest timestamp
	// from historical data db records
	useTimestamp: Date | undefined;
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
		useTimestamp,
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
	const hd = new HistoricalDataFilterer(httpProvider, proxyContractAddr, logger);

	// Share token contracts
	const shareTokenAddresses = await staticInfo.retrieveShareTokenContracts();

	let promises: Array<Promise<void>> = [];
	const IS_COLLECTED_BY_EVENT = false;
	promises.push(
		hd.filterLiquidityWithdrawalInitiations(
			null,
			useTimestamp ?? (await dbLPWithdrawals.getLatestTimestamp()),
			async (eventData, txHash, blockNumber, blockTimeStamp, params) => {
				await eventListener.onLiquidityWithdrawalInitiated(
					eventData,
					txHash,
					blockTimeStamp
				);
			}
		)
	);

	// Filter all trades on startup
	promises.push(
		hd.filterTrades(
			null as any as string,
			useTimestamp ?? (await dbTrades.getLatestTradeTimestamp()),
			async (
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
			}
		)
	);

	promises.push(
		hd.filterLiquidations(
			null as any as string,
			useTimestamp ?? (await dbTrades.getLatestLiquidateTimestamp()),
			async (
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
			}
		)
	);

	promises.push(
		hd.filterUpdateMarginAccount(
			null as any as string,
			useTimestamp ?? (await dbFundingRatePayments.getLatestTimestamp()),
			async (
				eventData: UpdateMarginAccountEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onUpdateMarginAccount(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			}
		)
	);

	promises.push(
		hd.filterLiquidityAdded(
			null,
			useTimestamp ??
				(await dbEstimatedEarnings.getLatestTimestamp(
					estimated_earnings_event_type.liquidity_added
				)),
			async (
				eventData: LiquidityAddedEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onLiquidityAdded(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			}
		)
	);

	promises.push(
		hd.filterLiquidityRemoved(
			null,
			useTimestamp ??
				(await dbEstimatedEarnings.getLatestTimestamp(
					estimated_earnings_event_type.liquidity_removed
				)),
			async (
				eventData: LiquidityRemovedEvent,
				txHash: string,
				blockNum: BigNumberish,
				blockTimestamp: number
			) => {
				await eventListener.onLiquidityRemoved(
					eventData,
					txHash,
					IS_COLLECTED_BY_EVENT,
					blockTimestamp
				);
			}
		)
	);

	// Share tokens p2p transfers
	const p2pTimestamps = useTimestamp
		? new Array(shareTokenAddresses.length).fill(useTimestamp)
		: await dbEstimatedEarnings.getLatestTimestampsP2PTransfer(
				shareTokenAddresses.length
		  );

	promises.push(
		hd.filterP2Ptransfers(
			shareTokenAddresses,
			p2pTimestamps,
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
