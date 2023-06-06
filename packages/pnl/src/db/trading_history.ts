import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish, Numeric, Result } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types";
import { LiquidateEvent } from "../contracts/types";

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
				wallet_address: {
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
					data = {
						chain_id: parseInt(this.chainId.toString()),
						order_digest_hash: e.orderDigest.toString(),
						fee: e.fFeeCC.toString(),
						broker_fee_tbps: e.order.brokerFeeTbps,
						perpetual_id: e.perpetualId,
						price: e.price.toString(),
						quantity: e.order.fAmount.toString(),
						realized_profit: e.fPnlCC.toString(),
						side: (parseInt(e.order.fAmount.toString()) > 0
							? "buy"
							: "sell") as trade_side,
						// Order flags are only present
						order_flags: e.order.flags,
						tx_hash,
						wallet_address: trader,
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
						wallet_address: trader,
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
	 * current date on deefault
	 * @returns
	 */
	public async getLatestTimestamp(): Promise<Date | undefined> {
		const tradeDate = await this.prisma.trade.findFirst({
			select: {
				trade_timestamp: true,
			},
			orderBy: {
				trade_timestamp: "desc",
			},
		});

		return tradeDate?.trade_timestamp;
	}
}
