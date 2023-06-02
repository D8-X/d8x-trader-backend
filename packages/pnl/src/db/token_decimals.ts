import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish, Numeric, Result, dataLength } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types";
import { LiquidateEvent } from "../contracts/types";

export class TokenDecimals {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	public async insert(poolId: number, tokenAddress: string, decimals: number) {
		const token_address = tokenAddress.toLowerCase();
		const res = await this.prisma.tokenDecimals.findFirst({
			where: {
				token_address: {
					equals: token_address,
				},
				pool_id: {
					equals: poolId,
				},
			},
		});

		if (res === null) {
			await this.prisma.tokenDecimals.create({
				data: {
					token_address,
					pool_id: poolId,
					decimals,
				},
			});
			this.l.info("inserted new token decimals record", { tokenAddress, poolId });
		}
	}

	public async retrievePoolShareTokenDecimals(poolId: number) {
		const res = await this.prisma.tokenDecimals.findFirst({
			where: {
				pool_id: {
					equals: poolId,
				},
			},
		});

		if (res !== null) {
			return res.decimals;
		}

		// Default to 18
		return 18;
	}
}
