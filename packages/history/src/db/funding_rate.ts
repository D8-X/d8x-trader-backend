import { formatErrorMessage } from "../utils/errors.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types.js";
import { metrics } from "../svc/metrics.js";

export interface FundingBatchItem {
	e: UpdateMarginAccountEvent;
	txHash: string;
	blockTimestamp: number;
}

const CREATE_MANY_BATCH = 1000;

//
export class FundingRatePayments {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger,
	) {}

	/**
	 * Insert funding rate payment event into trade_history. If event data is
	 * already present in the database, collected by event is set to false.
	 *
	 * @param e event
	 * @param txHash transaction hash from the event
	 * @param isCollectedByEvent true if the data comes from an event, rather than http polling
	 * @param blockTimestamp timestamp in seconds
	 * @returns void
	 */
	public async insertFundingRatePayment(
		e: UpdateMarginAccountEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number,
	): Promise<void> {
		// Only insert those UpdateMarginAccount events which have payment
		// amount not 0
		if (e.fFundingPaymentCC.toString() === "0") {
			this.l.debug("skipping zero funding payment", { tx_hash: txHash });
			return;
		}
		const data = this._buildFundingData(
			e,
			txHash,
			isCollectedByEvent,
			blockTimestamp,
		);

		try {
			await this.prisma.fundingRatePayment.upsert({
				where: {
					trader_addr_tx_hash: {
						trader_addr: data.trader_addr,
						tx_hash: data.tx_hash,
					},
				},
				create: data,
				update: isCollectedByEvent ? {} : { is_collected_by_event: false },
			});
		} catch (e) {
			this.l.error("inserting funding rate payment", {
				error: formatErrorMessage(e),
			});
		}
	}

	private _buildFundingData(
		e: UpdateMarginAccountEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number,
	): Prisma.FundingRatePaymentCreateInput {
		return {
			payment_amount: e.fFundingPaymentCC.toString(),
			trader_addr: e.trader.toLowerCase(),
			perpetual_id: Number(e.perpetualId),
			tx_hash: txHash.toLowerCase(),
			payment_timestamp: new Date(blockTimestamp * 1000),
			is_collected_by_event: isCollectedByEvent,
		};
	}

	public async insertFundingRatePaymentsBatch(
		items: FundingBatchItem[],
		isCollectedByEvent: boolean,
	): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const byKey = new Map<string, Prisma.FundingRatePaymentCreateManyInput>();
		for (const it of items) {
			if (it.e.fFundingPaymentCC.toString() === "0") {
				continue;
			}
			const data = this._buildFundingData(
				it.e,
				it.txHash,
				isCollectedByEvent,
				it.blockTimestamp,
			) as Prisma.FundingRatePaymentCreateManyInput;
			byKey.set(`${data.trader_addr}:${data.tx_hash}`, data);
		}
		const rows = [...byKey.values()];
		for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
			const chunk = rows.slice(i, i + CREATE_MANY_BATCH);
			try {
				await this.prisma.fundingRatePayment.createMany({
					data: chunk,
					skipDuplicates: true,
				});
			} catch (e) {
				this.l.error("batch inserting funding payments", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("db:funding_createMany", e);
			}
			if (!isCollectedByEvent) {
				try {
					await this.prisma.fundingRatePayment.updateMany({
						where: {
							is_collected_by_event: true,
							OR: chunk.map((r) => ({
								trader_addr: r.trader_addr,
								tx_hash: r.tx_hash,
							})),
						},
						data: { is_collected_by_event: false },
					});
				} catch (e) {
					this.l.error("batch updating funding is_collected_by_event", {
						error: formatErrorMessage(e),
					});
					metrics.trackError("db:funding_updateMany", e);
				}
			}
		}
	}

	/**
	 * Retrieve the latest timestamp of most latest trade event record or
	 * current date on deefault
	 * @returns
	 */
	public async getLatestTimestamp(): Promise<Date | undefined> {
		const fp = await this.prisma.fundingRatePayment.findFirst({
			select: {
				payment_timestamp: true,
			},
			where: {
				is_collected_by_event: false,
			},
			orderBy: {
				payment_timestamp: "desc",
			},
		});

		return fp?.payment_timestamp;
	}
}
