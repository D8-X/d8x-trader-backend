import {
	PrismaClient,
	Trade,
	trade_side,
	Prisma,
	FundingRatePayment,
} from "@prisma/client";
import { BigNumberish, Numeric, Result } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types";
import { LiquidateEvent } from "../contracts/types";

//
export class FundingRatePayments {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger
	) {}

	/**
	 * Insert funding rate payment event into trade_history. If event data is
	 * already present in the database - this will be a no-op.
	 *
	 * @param e
	 * @param txHash
	 * @returns
	 */
	public async insertFundingRatePayment(
		e: UpdateMarginAccountEvent,
		txHash: string,
		blockTimestamp: number
	) {
		// Only insert those UpdateMarginAccount events which have payment
		// amount not 0
		if (e.fFundingPaymentCC.toString() === "0") {
			return;
		}
		const trader = e.trader.toLowerCase();
		const tx_hash = txHash.toLowerCase();

		const exists = await this.prisma.fundingRatePayment.findFirst({
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
			let fundingRatePayment: FundingRatePayment;
			try {
				let data: Prisma.FundingRatePaymentCreateInput = {
					payment_amount: e.fFundingPaymentCC.toString(),
					wallet_address: trader,
					perpetual_id: Number(e.perpetualId),
					tx_hash: tx_hash,
					payment_timestamp: new Date(blockTimestamp * 1000),
				};

				fundingRatePayment = await this.prisma.fundingRatePayment.create({
					data,
				});
			} catch (e) {
				this.l.error("inserting new funding rate payment", { error: e });
				return;
			}
			this.l.info("inserted new funding rate payment", {
				trade_id: fundingRatePayment.id,
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
			orderBy: {
				payment_timestamp: "desc",
			},
		});

		return fp?.payment_timestamp;
	}
}
