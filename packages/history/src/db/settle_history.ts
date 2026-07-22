import { PrismaClient, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import { SettleEvent } from "../contracts/types.js";
import { Logger } from "winston";
import { formatErrorMessage } from "../utils/errors.js";
import { metrics } from "../svc/metrics.js";

export interface SettleBatchItem {
	e: SettleEvent;
	txHash: string;
	blockTimestamp: number;
}

const CREATE_MANY_BATCH = 1000;

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
		const data = this._buildSettleData(
			e,
			txHash,
			isCollectedByEvent,
			tradeBlockTimestamp,
		);
		await this.prisma.settle.upsert({
			where: {
				trader_addr_perpetual_id_tx_hash: {
					trader_addr: data.trader_addr,
					perpetual_id: data.perpetual_id,
					tx_hash: data.tx_hash,
				},
			},
			update: {
				is_collected_by_event: isCollectedByEvent,
				cash_cc: data.cash_cc,
				quantity_cc: data.quantity_cc,
				timestamp: data.timestamp,
				updated_at: new Date(),
			},
			create: data,
		});
	}

	private _buildSettleData(
		e: SettleEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		tradeBlockTimestamp: number,
	): Prisma.SettleCreateManyInput {
		// report amount received minus cash on the trader margin account
		const q = e.amount - e.cash;
		return {
			trader_addr: e.trader.toLowerCase(),
			perpetual_id: Number(e.perpetualId),
			chain_id: parseInt(this.chainId.toString()),
			cash_cc: e.cash.toString(),
			quantity_cc: q.toString(),
			tx_hash: txHash.toLowerCase(),
			timestamp: new Date(tradeBlockTimestamp * 1000),
			is_collected_by_event: isCollectedByEvent,
		};
	}

	public async insertSettleHistoryRecordsBatch(
		items: SettleBatchItem[],
		isCollectedByEvent: boolean,
	): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const byKey = new Map<string, Prisma.SettleCreateManyInput>();
		for (const it of items) {
			const data = this._buildSettleData(
				it.e,
				it.txHash,
				isCollectedByEvent,
				it.blockTimestamp,
			);
			byKey.set(`${data.trader_addr}:${data.perpetual_id}:${data.tx_hash}`, data);
		}
		const rows = [...byKey.values()];
		for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
			const chunk = rows.slice(i, i + CREATE_MANY_BATCH);
			let inserted = false;
			try {
				await this.prisma.settle.createMany({
					data: chunk,
					skipDuplicates: true,
				});
				inserted = true;
			} catch (e) {
				this.l.error("batch inserting settles", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("db:settle_createMany", e);
			}
			if (!isCollectedByEvent && inserted) {
				try {
					await this.prisma.settle.updateMany({
						where: {
							is_collected_by_event: true,
							OR: chunk.map((r) => ({
								trader_addr: r.trader_addr,
								perpetual_id: r.perpetual_id,
								tx_hash: r.tx_hash,
							})),
						},
						data: { is_collected_by_event: false },
					});
				} catch (e) {
					this.l.error("batch updating settle is_collected_by_event", {
						error: formatErrorMessage(e),
					});
					metrics.trackError("db:settle_updateMany", e);
				}
			}
		}
	}
}
