import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";

export class PriceInfo {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	/**
	 * Insert new price info
	 *
	 * @param pool_token_price
	 * @param pool_id
	 * @param timestamp if undefined, current date will be used
	 */
	public async insert(pool_token_price: number, pool_id: number, timestamp?: Date) {
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
