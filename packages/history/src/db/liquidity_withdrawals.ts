import { LiquidityWithdrawal, PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import {
	LiquidityRemovedEvent,
	LiquidityWithdrawalInitiatedEvent,
} from "../contracts/types";
import { LiquidityProviderTool } from "@d8x/perpetuals-sdk";
import { lastDayOfWeek } from "date-fns";

export class LiquidityWithdrawals {
	constructor(public prisma: PrismaClient, public l: Logger) {}

	/**
	 * Create new lp withdrawal initation record from lp withdrawal event data
	 * @param e
	 * @param isLiquidityRemovalEvent false if this is withdrawal initiated
	 * @param txHash
	 * @param blockTimestamp
	 * @returns
	 */
	public async insert(
		e: LiquidityWithdrawalInitiatedEvent | LiquidityRemovedEvent,
		isLiquidityRemovedEvent: boolean,
		txHash: string,
		isCollectedByEvent: boolean,
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
				liq_provider_addr: {
					equals: user_wallet,
				},
				is_removal: {
					equals: isLiquidityRemovedEvent,
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
						liq_provider_addr: user_wallet,
						timestamp: new Date(blockTimestamp * 1000),
						is_removal: isLiquidityRemovedEvent,
						tx_hash: tx_hash,
						is_collected_by_event: isCollectedByEvent,
					},
				});
			} catch (e) {
				this.l.error("inserting new liquidity withdrawal record", {
					error: e,
				});
				return;
			}
			this.l.info("inserted new liquidity withdrawal record", {
				liq_provider_addr: lpw.liq_provider_addr,
				pool_id: lpw.pool_id,
				is_removal: isLiquidityRemovedEvent,
			});
		} else if (!isCollectedByEvent) {
			// update
			let lpw: LiquidityWithdrawal;
			try {
				lpw = await this.prisma.liquidityWithdrawal.update({
					where: {
						liq_provider_addr_tx_hash: {
							liq_provider_addr: e.user,
							tx_hash: tx_hash,
						},
					},
					data: {
						is_collected_by_event: false,
					},
				});
			} catch (e) {
				this.l.error("updating liquidity withdrawal record", {
					error: e,
				});
				return;
			}
			this.l.info("updated liquidity withdrawal record", {
				liq_provider_addr: lpw.liq_provider_addr,
				pool_id: lpw.pool_id,
				is_removal: isLiquidityRemovedEvent,
			});
		}
	}

	public async getLatestTimestampInitiation(): Promise<Date | undefined> {
		return this.getLatestTimestamp(false);
	}

	public async getLatestTimestampRemoval(): Promise<Date | undefined> {
		return this.getLatestTimestamp(true);
	}

	/**
	 * Retrieve latest timestamp of existing LiquidityWithdrawalInitiated or removal event
	 */
	public async getLatestTimestamp(isRemoval: boolean): Promise<Date | undefined> {
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
					equals: isRemoval,
				},
				is_collected_by_event: {
					equals: false,
				},
			},
		});

		return res?.timestamp;
	}
}
