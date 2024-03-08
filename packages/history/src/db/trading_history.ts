import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish, Numeric, Result, keccak256 } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { LiquidateEvent } from "../contracts/types";
import { ONE_64x64, ABK64x64ToFloat } from "utils";
import { createHash } from "crypto";

type TradeHistoryEvent = TradeEvent | LiquidateEvent;

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
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();
		const isLiquidation = (e as TradeEvent).order == undefined;
		const exists = await this.prisma.trade.findFirst({
			where: {
				tx_hash: {
					equals: tx_hash,
				},
				trader_addr: {
					equals: trader,
				},
			},
		});
		if (exists === null) {
			let newTrade: Trade;
			let orderDigest: string;
			try {
				let data: Prisma.TradeCreateInput;

				if (!isLiquidation) {
					e = e as TradeEvent;
					//a*2^64 * b*2^64 /2^64 = a*b*2^64 => requires >ES2017
					const quantityCC = (e.fB2C * e.order.fAmount) / ONE_64x64;
					orderDigest = e.orderDigest.toString();
					data = {
						chain_id: parseInt(this.chainId.toString()),
						order_digest_hash: orderDigest,
						fee: e.fFeeCC.toString(),
						broker_fee_tbps: Number(e.order.brokerFeeTbps),
						broker_addr: e.order.brokerAddr.toLowerCase(),
						perpetual_id: Number(e.perpetualId),
						price: e.price.toString(),
						quantity: e.order.fAmount.toString(),
						quantity_cc: quantityCC.toString(),
						realized_profit: e.fPnlCC.toString(),
						side: (parseInt(e.order.fAmount.toString()) > 0
							? "buy"
							: "sell") as trade_side,
						// Order flags are only present
						order_flags: e.order.flags,
						tx_hash,
						trader_addr: trader,
						trade_timestamp: new Date(tradeBlockTimestamp * 1000),
						is_collected_by_event: isCollectedByEvent,
					};
				} else {
					e = e as LiquidateEvent;
					orderDigest = this._createLiquidationId(e, tradeBlockNumber);
					data = {
						chain_id: parseInt(this.chainId.toString()),
						// create id in case of liquidation event that is unique
						order_digest_hash: orderDigest,
						fee: e.fFeeCC.toString(),
						broker_fee_tbps: 0,
						perpetual_id: Number(e.perpetualId),
						price: e.liquidationPrice.toString(),
						quantity: e.amountLiquidatedBC.toString(),
						realized_profit: e.fPnlCC.toString(),
						side: (parseInt(e.amountLiquidatedBC.toString()) > 0
							? "liquidate_buy"
							: "liquidate_sell") as trade_side,
						trade_timestamp: new Date(tradeBlockTimestamp * 1000),
						tx_hash,
						trader_addr: trader,
						is_collected_by_event: isCollectedByEvent,
					};
				}
				this.l.info(`inserting new ${isLiquidation ? "liquidation" : "trade"}`, {
					order_digest: data.order_digest_hash,
				});
				newTrade = await this.prisma.trade.create({
					data,
				});
			} catch (e) {
				this.l.error(`inserting new ${isLiquidation ? "liquidation" : "trade"}`, {
					error: e,
				});
				return;
			}
		} else if (isCollectedByEvent) {
			// record exists, and was collected by event -> update
			const id = isLiquidation
				? this._createLiquidationId(e as LiquidateEvent, tradeBlockNumber)
				: (e as TradeEvent).orderDigest.toString();
			console.log(`tradingHistory: tradevent = ${e}`);
			console.log(`tradingHistory: id = ${id}`);
			await this.prisma.trade.update({
				where: {
					order_digest_hash: id,
				},
				data: {
					is_collected_by_event: false,
				},
			});
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

		return tradeDate?.trade_timestamp;
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

		return tradeDate?.trade_timestamp;
	}
}
