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

	// /**
	//  *
	//  *
	//  * @param e
	//  * @param txHash
	//  * @param blockTimestamp
	//  */
	// public async insertWithdrawalCompleted(
	// 	e: LiquidityRemovedEvent,
	// 	txHash: string,
	// 	blockTimestamp: number
	// ) {
	// 	this.prisma.fundingRatePayment;

	// 	// Find nearest timestamp for given wallet and pool id and update it

	// 	// select * from liquidity_withdrawal
	// 	// where pool_id = 5 and initiated_at < '2023-05-11 10:30:00'
	// 	// order by initiated_at desc
	// 	// limit 1

	// 	const tx_hash = txHash.toString();

	// 	const poolId = parseInt(e.poolId.toString());

	// 	// Find the first nearest record
	// 	const lpw = await this.prisma.liquidityWithdrawal.findFirst({
	// 		orderBy: {
	// 			initiated_at: "desc",
	// 		},
	// 		where: {
	// 			AND: [
	// 				{
	// 					initiated_at: {
	// 						lte: new Date(blockTimestamp * 1000),
	// 					},
	// 				},
	// 				{
	// 					pool_id: {
	// 						equals: poolId,
	// 					},
	// 				},
	// 			],
	// 		},
	// 	});

	// 	if (lpw === null) {
	// 		this.l.warn("could not find liquidity withdrawal record", {
	// 			poolId,
	// 			liquidity_removed_tx_hash: txHash,
	// 		});
	// 		return;
	// 	}

	// 	// Make sure the amounts match
	// 	if (BigInt(lpw.amount.toString()) !== e.shareAmount) {
	// 		this.l.error(
	// 			"amounts of liquidity removal and record in database do not match",
	// 			{
	// 				liquidity_withdrawal_record_id: lpw.id,
	// 				removal_tx_hash: txHash,
	// 				amount_in_db: lpw.amount.toString(),
	// 				amount_received: e.shareAmount,
	// 			}
	// 		);
	// 		return;
	// 	}

	// 	// Update the record
	// 	lpw.finished_at = new Date(blockTimestamp * 1000);
	// 	lpw.finalization_tx_hash = tx_hash;

	// 	// Update
	// 	await this.prisma.liquidityWithdrawal.update({
	// 		where: {
	// 			id: lpw.id,
	// 		},
	// 		data: lpw,
	// 	});
	// 	this.l.info("liquidity withdrawal record was set to finalized");
	// }

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
