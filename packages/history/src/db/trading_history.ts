import { formatErrorMessage } from "../utils/errors.js";
import { PrismaClient, trade_side, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import { TradeEvent } from "../contracts/types.js";
import { Logger } from "winston";
import { LiquidateEvent } from "../contracts/types.js";
import { ONE_64x64 } from "utils";
import { createHash } from "crypto";
import { metrics } from "../svc/metrics.js";

type TradeHistoryEvent = TradeEvent | LiquidateEvent;

export interface TradeBatchItem {
	e: TradeHistoryEvent;
	txHash: string;
	blockTimestamp: number;
	blockNumber: number;
}

const CREATE_MANY_BATCH = 1000;

//
export class TradingHistory {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger,
	) {}

	/**
	 * Insert Trade or Liquidation event into trade_history. Only if event from
	 * given txHash is not already present in db.
	 * Addresses will be converted to lowercase
	 * @param e                     TradeHistoryEvent
	 * @param txHash                Tx hash that triggered the event
	 * @param isCollectedByEvent    True if data comes from live-listening, false if via http
	 * @param tradeBlockTimestamp   Block-timestamp from event
	 * @param tradeBlockNumber      Block-number from event
	 * @returns void
	 */
	public async insertTradeHistoryRecord(
		e: TradeHistoryEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		tradeBlockTimestamp: number,
		tradeBlockNumber: number,
	) {
		const isLiquidation = (e as TradeEvent).order == undefined;
		try {
			const data = this._buildTradeData(
				e,
				txHash,
				isCollectedByEvent,
				tradeBlockTimestamp,
				tradeBlockNumber,
			);
			await this.prisma.trade.upsert({
				where: {
					order_digest_hash: data.order_digest_hash,
				},
				update: {
					is_collected_by_event: isCollectedByEvent,
					trade_timestamp: data.trade_timestamp,
					updated_at: new Date(),
				},
				create: data,
			});
		} catch (e) {
			this.l.error(`inserting new ${isLiquidation ? "liquidation" : "trade"}`, {
				error: formatErrorMessage(e),
			});
			metrics.trackError("db:trade_upsert", e);
		}
	}

	private _buildTradeData(
		e: TradeHistoryEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		tradeBlockTimestamp: number,
		tradeBlockNumber: number,
	): Prisma.TradeCreateInput {
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();
		const isLiquidation = (e as TradeEvent).order == undefined;
		if (!isLiquidation) {
			const te = e as TradeEvent;
			const quantityCC = (te.fB2C * te.order.fAmount) / ONE_64x64;
			return {
				chain_id: parseInt(this.chainId.toString()),
				order_digest_hash: te.orderDigest.toString(),
				fee: te.fFeeCC.toString(),
				broker_fee_tbps: Number(te.order.brokerFeeTbps),
				broker_addr: te.order.brokerAddr.toLowerCase(),
				perpetual_id: Number(te.perpetualId),
				price: te.price.toString(),
				quantity: te.order.fAmount.toString(),
				quantity_cc: quantityCC.toString(),
				realized_profit: te.fPnlCC.toString(),
				new_pos_bc: te.newPositionSizeBC.toString(),
				side: (parseInt(te.order.fAmount.toString()) > 0
					? "buy"
					: "sell") as trade_side,
				order_flags: te.order.flags,
				tx_hash,
				trader_addr: trader,
				trade_timestamp: new Date(tradeBlockTimestamp * 1000),
				is_collected_by_event: isCollectedByEvent,
				leverage: Number(te.order.leverageTDR),
			};
		}
		const le = e as LiquidateEvent;
		return {
			chain_id: parseInt(this.chainId.toString()),
			order_digest_hash: this._createLiquidationId(le, tradeBlockNumber),
			fee: le.fFeeCC.toString(),
			broker_fee_tbps: 0,
			perpetual_id: Number(le.perpetualId),
			price: le.liquidationPrice.toString(),
			quantity: le.amountLiquidatedBC.toString(),
			realized_profit: le.fPnlCC.toString(),
			new_pos_bc: le.newPositionSizeBC.toString(),
			side: (parseInt(le.amountLiquidatedBC.toString()) > 0
				? "liquidate_buy"
				: "liquidate_sell") as trade_side,
			trade_timestamp: new Date(tradeBlockTimestamp * 1000),
			tx_hash,
			trader_addr: trader,
			is_collected_by_event: isCollectedByEvent,
			leverage: null,
		};
	}

	/**
	 * Bulk-insert Trade/Liquidate records from the backfill path. Existing rows
	 * (by order_digest_hash) are left untouched via skipDuplicates.
	 */
	public async insertTradeHistoryRecordsBatch(
		items: TradeBatchItem[],
		isCollectedByEvent: boolean,
	): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const byKey = new Map<string, Prisma.TradeCreateManyInput>();
		for (const it of items) {
			try {
				const data = this._buildTradeData(
					it.e,
					it.txHash,
					isCollectedByEvent,
					it.blockTimestamp,
					it.blockNumber,
				) as Prisma.TradeCreateManyInput;
				byKey.set(data.order_digest_hash, data);
			} catch (e) {
				this.l.error("building trade batch row", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("db:trade_batch_build", e);
			}
		}
		const rows = [...byKey.values()];
		for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
			try {
				await this.prisma.trade.createMany({
					data: rows.slice(i, i + CREATE_MANY_BATCH),
					skipDuplicates: true,
				});
			} catch (e) {
				this.l.error("batch inserting trades", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("db:trade_createMany", e);
			}
		}
	}

	private _createLiquidationId(event: LiquidateEvent, blockNumber: number): string {
		const H = createHash("sha256");
		const compositeIdString =
			event.trader +
			event.perpetualId.toString() +
			blockNumber.toString() +
			event.newPositionSizeBC.toString().slice(-2);
		H.update(compositeIdString);
		return H.digest("hex");
	}

	/**
	 * Retrieve the latest timestamp of most latest trade event record or
	 * current date on default
	 * @returns
	 */
	public async getLatestTradeTimestamp(): Promise<Date | undefined> {
		const tradeDate = await this.prisma.trade.findFirst({
			select: {
				trade_timestamp: true,
			},
			where: {
				OR: [{ side: { equals: "buy" } }, { side: { equals: "sell" } }],
				AND: { is_collected_by_event: false },
			},
			orderBy: {
				trade_timestamp: "desc",
			},
		});

		if (tradeDate?.trade_timestamp) {
			return new Date(tradeDate.trade_timestamp.getTime() - 3_600_000);
		}
		return undefined;
	}

	/**
	 * Retrieve the latest timestamp of most latest trade event record or
	 * current date on default
	 * @returns
	 */
	public async getLatestLiquidateTimestamp(): Promise<Date | undefined> {
		const tradeDate = await this.prisma.trade.findFirst({
			select: {
				trade_timestamp: true,
			},
			where: {
				OR: [
					{ side: { equals: "liquidate_buy" } },
					{ side: { equals: "liquidate_sell" } },
				],
				AND: { is_collected_by_event: false },
			},
			orderBy: {
				trade_timestamp: "desc",
			},
		});

		if (tradeDate?.trade_timestamp) {
			return new Date(tradeDate.trade_timestamp.getTime() - 3_600_000);
		}
		return undefined;
	}
}
