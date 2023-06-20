import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish, Numeric, Result } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { LiquidateEvent } from "../contracts/types";
import { ONE_64x64, ABK64x64ToFloat } from "utils";

type TradeHistoryEvent = TradeEvent | LiquidateEvent;

//
export class TradingHistory {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger
	) {}

	/**
	 * Insert Trade or Liquidation event into trade_history. Only if event from
	 * given txHash is not already present in db.
	 *
	 * @param e
	 * @param txHash
	 * @returns
	 */
	public async insertTradeHistoryRecord(
		e: TradeHistoryEvent,
		txHash: string,
		tradeBlockTimestamp: number
	) {
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();

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
			try {
				let data: Prisma.TradeCreateInput;

				if ((e as TradeEvent).order !== undefined) {
					e = e as TradeEvent;
					//a*2^64 * b*2^64 /2^64 = a*b*2^64 => requires >ES2017
					let quantityCC = (e.fB2C * e.order.fAmount) / ONE_64x64;
					data = {
						chain_id: parseInt(this.chainId.toString()),
						order_digest_hash: e.orderDigest.toString(),
						fee: e.fFeeCC.toString(),
						broker_fee_tbps: Number(e.order.brokerFeeTbps),
						broker_addr: e.order.brokerAddr,
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
					};
				} else {
					e = e as LiquidateEvent;
					data = {
						chain_id: parseInt(this.chainId.toString()),
						order_digest_hash: "",
						fee: e.fFeeCC.toString(),
						broker_fee_tbps: 0,
						perpetual_id: e.perpetualId,
						price: e.liquidationPrice.toString(),
						quantity: e.amountLiquidatedBC.toString(),
						realized_profit: e.fPnlCC.toString(),
						side: (parseInt(e.amountLiquidatedBC.toString()) > 0
							? "liquidate_buy"
							: "liquidate_sell") as trade_side,
						trade_timestamp: new Date(tradeBlockTimestamp * 1000),
						tx_hash,
						trader_addr: trader,
					};
				}
				newTrade = await this.prisma.trade.create({
					data,
				});
			} catch (e) {
				this.l.error("inserting new trade", { error: e });
				return;
			}
			this.l.info("inserted new trade", { trade_id: newTrade.id });
		}
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
			},
			orderBy: {
				trade_timestamp: "desc",
			},
		});

		return tradeDate?.trade_timestamp;
	}
}
