import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import { SettleEvent } from "../contracts/types.js";
import { Logger } from "winston";

export class SettleHistory {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger,
	) {}

	public async getLatestTimestamp(): Promise<Date | undefined> {
		const res = await this.prisma.settle.findFirst({
			select: {
				timestamp: true,
			},
			orderBy: {
				timestamp: "desc",
			},
			where: {
				is_collected_by_event: false,
			},
		});
		if (res?.timestamp) {
			return new Date(res.timestamp.getTime() - 3_600_000);
		}
		return undefined;
	}

	public async insertSettleHistoryRecord(
		e: SettleEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		tradeBlockTimestamp: number,
	) {
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();
		// report amount received minus cash on the trader margin account
		const q = e.amount - e.cash;
		await this.prisma.settle.upsert({
			where: {
				trader_addr_perpetual_id_tx_hash: {
					trader_addr: trader,
					perpetual_id: Number(e.perpetualId),
					tx_hash,
				},
			},
			update: {
				is_collected_by_event: isCollectedByEvent,
				cash_cc: e.cash.toString(),
				quantity_cc: q.toString(),
				timestamp: new Date(tradeBlockTimestamp * 1000),
				updated_at: new Date(),
			},
			create: {
				trader_addr: trader,
				perpetual_id: Number(e.perpetualId),
				chain_id: parseInt(this.chainId.toString()),
				cash_cc: e.cash.toString(),
				quantity_cc: q.toString(),
				tx_hash,
				timestamp: new Date(tradeBlockTimestamp * 1000),
				is_collected_by_event: isCollectedByEvent,
			},
		});
	}
}
