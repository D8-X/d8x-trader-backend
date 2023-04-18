import { PrismaClient, Trade, trade_side, trade_type } from "@prisma/client";
import { BigNumberish, Numeric, Result } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";

//
export class TradingHistory {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger
	) {}

	public async insertNewTradeEvent(e: TradeEvent, txHash: string) {
		const exists = await this.prisma.trade.findFirst({
			where: {
				tx_hash: {
					equals: txHash,
				},
			},
		});
		if (exists === null) {
			let newTrade: Trade;
			try {
				newTrade = await this.prisma.trade.create({
					data: {
						chain_id: parseInt(this.chainId.toString()),
						order_digest_hash: e.orderDigest.toString(),
						feee: e.fFeeCC.toString(),
						perpetual_id: e.perpetualId,
						price: e.price.toString(),
						quantity: e.order.fAmount.toString(),
						realized_profit: e.fPnlCC.toString(),
						side: (parseInt(e.order.fAmount.toString()) > 0
							? "buy"
							: "sell") as trade_side,
						tx_hash: txHash,
						type: this.determineOrderType(e),
						wallet_address: e.trader,
					},
				});
			} catch (e) {
				this.l.error("inserting new trade", { error: e });
				return;
			}
			this.l.info("inserted new trade", { trade_id: newTrade.id });
		}
	}

	private determineOrderType(e: TradeEvent): trade_type {
		return "limit";
	}
}
