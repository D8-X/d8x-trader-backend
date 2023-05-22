import { LiquidityWithdrawal, PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { LiquidityRemovedEvent, LiquidityWithdrawalInitiated } from "../contracts/types";
import { LiquidityProviderTool } from "@d8x/perpetuals-sdk";
import { lastDayOfWeek } from "date-fns";

export class LiquidityWithdrawals {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	// Cretae new lp withdrawal initation record from lp withdrawal event data
	public async insert(
		e: LiquidityWithdrawalInitiated | LiquidityRemovedEvent,
		isRemovedEvent: boolean,
		txHash: string,
		blockTimestamp: number
	) {
		const user_wallet = e.user.toLowerCase();
		const tx_hash = txHash.toLowerCase();

		// Make sure given record does not exis yet
		const exists = await this.prisma.liquidityWithdrawal.findFirst({
			where: {
				tx_hash: {
					equals: tx_hash,
				},
				user_wallet: {
					equals: user_wallet,
				},
				is_removal: {
					equals: isRemovedEvent,
				},
			},
		});

		if (exists === null) {
			let lpw: LiquidityWithdrawal;
			try {
				lpw = await this.prisma.liquidityWithdrawal.create({
					data: {
						amount: e.shareAmount.toString(),
						pool_id: parseInt(e.poolId.toString()),
						user_wallet,
						timestamp: new Date(blockTimestamp * 1000),
						is_removal: isRemovedEvent,
						tx_hash,
					},
				});
			} catch (e) {
				this.l.error("inserting new liquidity withdrawal record", {
					error: e,
				});
				return;
			}
			this.l.info("inserted new liquidity withdrawal record", {
				wallet: lpw.user_wallet,
				pool_id: lpw.pool_id,
				is_removal: isRemovedEvent,
			});
		}
	}

	/**
	 * Retrieve latest timestamp of existing LiquidittyWithdrawalInitiated event
	 */
	public async getLatestTimestamp(): Promise<Date | undefined> {
		const res = await this.prisma.liquidityWithdrawal.findFirst({
			select: {
				timestamp: true,
			},
			orderBy: {
				timestamp: "desc",
			},
			where: {
				// Only retrieve the ts of liquidity withdrawal initiated events
				is_removal: {
					equals: false,
				},
			},
		});

		return res?.timestamp;
	}
}
