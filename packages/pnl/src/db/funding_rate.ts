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
export class FundingRate {
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

		const exists = await this.prisma.fundingRatePayment.findFirst({
			where: {
				tx_hash: {
					equals: txHash,
				},
			},
		});

		this.l.info(`Payment amount: ${e.fFundingPaymentCC}`);
		if (exists === null) {
			let fungingRatePayment: FundingRatePayment;
			try {
				let data: Prisma.FundingRatePaymentCreateInput = {
					payment_amount: e.fFundingPaymentCC.toString(),
					wallet_address: e.trader,
					perpetual_id: e.perpetualId,
					tx_hash: txHash,
					payment_timestamp: new Date(blockTimestamp * 1000),
				};

				fungingRatePayment = await this.prisma.fundingRatePayment.create({
					data,
				});
			} catch (e) {
				this.l.error("inserting new funding rate payment", { error: e });
				return;
			}
			this.l.info("inserted new funding rate payment", {
				trade_id: fungingRatePayment.id,
			});
		}
	}
}
