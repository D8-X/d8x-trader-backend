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
import { FundingRatePayments } from "../db/funding_rate.js";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals.js";
import { PriceInfo } from "../db/price_info.js";
import { SetOracles } from "../db/set_oracles.js";
import { SettleHistory } from "../db/settle_history.js";
import { TokenFlow } from "../db/token_flow.js";
import { TradingHistory } from "../db/trading_history.js";

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
