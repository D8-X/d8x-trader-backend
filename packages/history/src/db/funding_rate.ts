import { formatErrorMessage } from "../utils/errors.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types.js";

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
		const trader = e.trader.toLowerCase();
		const tx_hash = txHash.toLowerCase();

		const data: Prisma.FundingRatePaymentCreateInput = {
			payment_amount: e.fFundingPaymentCC.toString(),
			trader_addr: trader,
			perpetual_id: Number(e.perpetualId),
			tx_hash: tx_hash,
			payment_timestamp: new Date(blockTimestamp * 1000),
			is_collected_by_event: isCollectedByEvent,
		};

		try {
			await this.prisma.fundingRatePayment.upsert({
				where: {
					trader_addr_tx_hash: { trader_addr: trader, tx_hash: tx_hash },
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
