import {
	PrismaClient,
	Trade,
	trade_side,
	token_decimals_type,
	Prisma,
} from "@prisma/client";
import { BigNumberish, Numeric, Result, dataLength } from "ethers";
import { TradeEvent } from "../contracts/types";
import { Logger } from "winston";
import { UpdateMarginAccountEvent } from "../contracts/types";
import { LiquidateEvent } from "../contracts/types";
import { roundToNearestMinutesWithOptions } from "date-fns/fp";

export class TokenDecimals {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	public async insert(
		poolId: number,
		tokenAddress: string,
		decimals: number,
		isShareToken: boolean = true
	) {
		const token_address = tokenAddress.toLowerCase();

		const type: token_decimals_type = isShareToken
			? token_decimals_type.share_token
			: token_decimals_type.margin_token;

		const res = await this.prisma.tokenDecimals.findFirst({
			where: {
				token_address: {
					equals: token_address,
				},
				pool_id: {
					equals: poolId,
				},
				token_type: {
					equals: type,
				},
			},
		});

		if (res === null) {
			await this.prisma.tokenDecimals.create({
				data: {
					token_address,
					pool_id: poolId,
					decimals,
					token_type: type,
				},
			});
			this.l.info("inserted new token decimals record", {
				tokenAddress,
				poolId,
				type,
			});
		}
	}

	public async retrieveTokenDecimals(poolId: number, type: token_decimals_type) {
		const res = await this.prisma.tokenDecimals.findFirst({
			where: {
				pool_id: {
					equals: poolId,
				},
				token_type: {
					equals: type,
				},
			},
		});

		if (res !== null) {
			return res.decimals;
		}

		// Default to 18
		return 18;
	}

	public async retrievePoolShareTokenDecimals(poolId: number) {
		return this.retrieveTokenDecimals(poolId, token_decimals_type.share_token);
	}

	public async retrievePoolMarginTokenDecimals(poolId: number) {
		return this.retrieveTokenDecimals(poolId, token_decimals_type.margin_token);
	}
}
