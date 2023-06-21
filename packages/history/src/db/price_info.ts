import { PrismaClient } from "@prisma/client";
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
		try {
			let dt = new Date(timestampSec * 1000);
			const res = await this.prisma.price.upsert({
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
}
