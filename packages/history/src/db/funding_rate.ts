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
			return;
		}
		const trader = e.trader.toLowerCase();
		const tx_hash = txHash.toLowerCase();

		const exists = await this.prisma.fundingRatePayment.findFirst({
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
			let fundingRatePayment: FundingRatePayment;
			try {
				const data: Prisma.FundingRatePaymentCreateInput = {
					payment_amount: e.fFundingPaymentCC.toString(),
					trader_addr: trader,
					perpetual_id: Number(e.perpetualId),
					tx_hash: tx_hash,
					payment_timestamp: new Date(blockTimestamp * 1000),
					is_collected_by_event: isCollectedByEvent,
				};

				fundingRatePayment = await this.prisma.fundingRatePayment.create({
					data,
				});
			} catch (e) {
				this.l.error("inserting new funding rate payment", { error: e });
				return;
			}
			this.l.info("inserted new funding rate payment", {
				trader_addr: fundingRatePayment.trader_addr,
			});
		} else if (!isCollectedByEvent) {
			// update
			let fundingRatePayment: FundingRatePayment;
			try {
				fundingRatePayment = await this.prisma.fundingRatePayment.update({
					where: {
						trader_addr_tx_hash: { trader_addr: trader, tx_hash: txHash },
					},
					data: {
						is_collected_by_event: false,
					},
				});
			} catch (e) {
				this.l.error("updating funding rate payment", { error: e });
				return;
			}
			this.l.info("updated funding rate payment", {
				trader_addr: fundingRatePayment.trader_addr,
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
