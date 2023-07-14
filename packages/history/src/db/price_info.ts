import { PrismaClient } from "@prisma/client";
import { timeStamp } from "console";
import { Logger } from "winston";

export class PriceInfo {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	/**
	 * Insert new price info
	 *
	 * @param pool_token_price
	 * @param pool_id
	 * @param timestampSec
	 */
	public async insert(pool_token_price: number, pool_id: number, timestampSec: number) {
		// create or update
		if (!(await this.passOutlierCheck(pool_token_price, pool_id, timestampSec))) {
			const msg = `pool token price outlier detected, price ${pool_token_price}`;
			this.l.info(msg);
			return;
		}
		try {
			let dt = new Date(timestampSec * 1000);
			await this.prisma.price.upsert({
				where: {
					pool_id_timestamp: { pool_id: pool_id, timestamp: dt },
				},
				update: {
					pool_token_price: pool_token_price,
				},
				create: {
					pool_id: pool_id,
					timestamp: dt,
					pool_token_price: pool_token_price,
				},
			});
			this.l.info("upsert price info", {
				pool_id,
				pool_token_price,
				timestampSec,
			});
		} catch (error) {
			this.l.error("PriceInfo update/insert failed", error);
		}
	}

	/**
	 * Pass
	 * @param new_price new price to be inserted chronologically
	 * @param pool_id pool id for the price
	 * @param timestampSec timestamp in seconds for the price observation
	 * @returns true if likely no outlier, false otherwise
	 */
	private async passOutlierCheck(
		new_price: number,
		pool_id: number,
		timestampSec: number
	): Promise<boolean> {
		let dt = new Date(timestampSec * 1000);
		let priceTs = await this.prisma.price.findFirst({
			where: {
				pool_id: pool_id,
				timestamp: { lt: dt },
			},
			orderBy: {
				timestamp: "desc",
			},
			select: {
				pool_token_price: true,
				timestamp: true,
			},
		});
		if (priceTs == null) {
			// no price so far
			return true;
		}
		const dTsec = timestampSec - priceTs?.timestamp.getTime() / 1000;
		const dHour = dTsec / 3600;
		const retRaw = Math.abs(new_price / priceTs.pool_token_price - 1);
		const retHourly = retRaw / dHour;
		// less than 100% abs hourly return?
		return retHourly < 1;
	}
}
