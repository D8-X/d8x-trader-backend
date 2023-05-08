import {
	PrismaClient,
	Trade,
	trade_side,
	Prisma,
	FundingRatePayment,
	EstimatedEarningTokens,
	estimated_earnings_event_type,
} from "@prisma/client";
import { BigNumberish, ethers, Numeric, Result } from "ethers";
import * as eth from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types";
import { LiquidateEvent } from "../contracts/types";
import { dec18ToFloat } from "../utils/bigint";

export class PriceInfo {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	/**
	 * Insert new price info
	 *
	 * @param pool_token_price
	 * @param pool_id
	 * @param timestamp if undefined, current date will be used
	 */
	public async insert(pool_token_price: number, pool_id: bigint, timestamp?: Date) {
		const res = await this.prisma.price.create({
			data: {
				pool_id: pool_id,
				pool_token_price,
				timestamp,
			},
		});
		this.l.info("inserted new price info", {
			pool_id,
			pool_token_price,
			record_id: res.id,
		});
	}
}
