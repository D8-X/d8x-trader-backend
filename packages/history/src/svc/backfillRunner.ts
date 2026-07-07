import type { BigNumberish, ethers } from "ethers";
import type { Logger } from "winston";

import { EventListener } from "../contracts/listeners.js";
import { HistoricalDataFilterer } from "../contracts/historicalDataFilterer.js";
import StaticInfo from "../contracts/static_info.js";
import type {
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	TradeEvent,
	LiquidateEvent,
	UpdateMarginAccountEvent,
	SetOraclesEvent,
	SettleEvent,
	SettleEventV1,
} from "../contracts/types.js";
import { EstimatedEarnings } from "../db/estimated_earnings.js";
import { FundingRatePayments, type FundingBatchItem } from "../db/funding_rate.js";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals.js";
import { PriceInfo } from "../db/price_info.js";
import { SetOracles } from "../db/set_oracles.js";
import { SettleHistory, type SettleBatchItem } from "../db/settle_history.js";
import { TokenFlow, type TokenFlowBatchItem } from "../db/token_flow.js";
import { TradingHistory, type TradeBatchItem } from "../db/trading_history.js";

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
	logger: Logger;
}

export async function runHistoricalDataFilterers(
	opts: hdFilterersOpt,
	startTimestampSec: number,
	skipUpToDate = true,
	endTimestampSec?: number,
) {
	const {
		httpProvider,
		proxyContractAddr,
		dbTrades,
		dbSetOracles,
		dbFundingRatePayments,
		dbEstimatedEarnings,
		dbPriceInfo: _dbPriceInfo,
		dbLPWithdrawals,
		dbSettle,
		dbTokenFlow,
		staticInfo,
		eventListener,
		logger,
	} = opts;

	const defaultDate = new Date(startTimestampSec * 1000);
	const untilDate =
		endTimestampSec !== undefined ? new Date(endTimestampSec * 1000) : undefined;
	const hd = new HistoricalDataFilterer(httpProvider, proxyContractAddr, logger);

	// Share token contracts
	const shareTokenAddresses = staticInfo.retrieveShareTokenContracts();

	const promises: Array<Promise<void>> = [];
	const IS_COLLECTED_BY_EVENT = false;

	const tradeBatch: TradeBatchItem[] = [];
	const fundingBatch: FundingBatchItem[] = [];
	const settleBatch: SettleBatchItem[] = [];
	const tokenFlowBatch: TokenFlowBatchItem[] = [];

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

	const lookbackDays = Number(process.env.BACKFILL_MAX_LOOKBACK_DAYS ?? 30);
	const floorMs = Date.now() - lookbackDays * 24 * 3600 * 1000;

	let ts: Date;
	if (skipUpToDate) {
		const redundancyLookbackHours = Number(
			process.env.BACKFILL_REDUNDANCY_LOOKBACK_HOURS ?? 8,
		);
		const startMs = Math.max(
			floorMs,
			Date.now() - redundancyLookbackHours * 3600 * 1000,
		);
		ts = new Date(startMs);
		logger.info(
			`redundancy backfill scanning last ${redundancyLookbackHours}h from ${ts.toISOString()}`,
		);
	} else {
		const allTimestamps = [...eventTimestamps.values()];
		allTimestamps.push(defaultDate);
		ts = allTimestamps.reduce((a, b) => (a < b ? a : b));
		if (ts.getTime() < floorMs) {
			const floored = new Date(floorMs);
			logger.info(
				`flooring backfill start from ${ts.toISOString()} to ${floored.toISOString()} (${lookbackDays}d lookback)`,
			);
			ts = floored;
		}
	}

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
					tradeBatch.push({
						e: eventData,
						txHash,
						blockTimestamp,
						blockNumber: Number(blockNum.toString()),
					});
				},

				Settle: async (
					eventData: SettleEventV1,
					txHash: string,
					blockNum: BigNumberish,
					blockTimeStamp: number,
				) => {
					settleBatch.push({
						e: {
							perpetualId: eventData.perpetualId,
							trader: eventData.trader,
							amount: eventData.amount,
							cash: 0n,
						},
						txHash,
						blockTimestamp: blockTimeStamp,
					});
				},

				SettleV2: async (
					eventData: SettleEvent,
					txHash: string,
					blockNum: BigNumberish,
					blockTimeStamp: number,
				) => {
					settleBatch.push({
						e: eventData,
						txHash,
						blockTimestamp: blockTimeStamp,
					});
				},

				TokensDeposited: async (
					eventData: Record<string, any>,
					txHash: string,
					blockNum: BigNumberish,
					blockTimestamp: number,
				) => {
					tokenFlowBatch.push({
						perpetualId: eventData.perpetualId,
						trader: eventData.trader,
						amountCC: eventData.amount,
						txHash,
						blockTimestamp,
						isDeposit: true,
					});
				},

				TokensWithdrawn: async (
					eventData: Record<string, any>,
					txHash: string,
					blockNum: BigNumberish,
					blockTimestamp: number,
				) => {
					tokenFlowBatch.push({
						perpetualId: eventData.perpetualId,
						trader: eventData.trader,
						amountCC: eventData.amount,
						txHash,
						blockTimestamp,
						isDeposit: false,
					});
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
					tradeBatch.push({
						e: eventData,
						txHash,
						blockTimestamp,
						blockNumber: Number(blockNum.toString()),
					});
				},
				UpdateMarginAccount: async (
					eventData: UpdateMarginAccountEvent,
					txHash: string,
					_blockNum: BigNumberish,
					blockTimestamp: number,
				) => {
					fundingBatch.push({
						e: eventData,
						txHash,
						blockTimestamp,
					});
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
			untilDate,
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

	logger.info("flushing backfill batches", {
		trades: tradeBatch.length,
		funding: fundingBatch.length,
		settle: settleBatch.length,
		tokenFlow: tokenFlowBatch.length,
	});
	await dbTrades.insertTradeHistoryRecordsBatch(tradeBatch, IS_COLLECTED_BY_EVENT);
	await dbFundingRatePayments.insertFundingRatePaymentsBatch(
		fundingBatch,
		IS_COLLECTED_BY_EVENT,
	);
	await dbSettle.insertSettleHistoryRecordsBatch(settleBatch, IS_COLLECTED_BY_EVENT);
	await dbTokenFlow.insertTokenFlowRecordsBatch(tokenFlowBatch, IS_COLLECTED_BY_EVENT);

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
		untilDate,
	);
	// align timestamps in perpetual_long_id (because we have asynchronous events)
	await dbSetOracles.alignTimestamps();
}
