import {
	PrismaClient,
	EstimatedEarningTokens,
	estimated_earnings_event_type,
} from "@prisma/client";
import { BigNumberish, ethers, Numeric, Result } from "ethers";
import * as eth from "ethers";
import { Logger } from "winston";
import {
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	P2PTransferEvent,
} from "../contracts/types";
import { dec18ToFloat, decNToFloat } from "utils";

export class EstimatedEarnings {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger
	) {}

	/**
	 * Insert new estimated earning
	 * @param wallet address that performed the action
	 * @param amount amount of collateral tokens, or in case of p2p transfer share tokens
	 * @param pool_id pool id where action happens
	 * @param txHash hash of the transaction
	 * @param type estimated_earnings_event_type
	 * @param isCollectedByEvent true if this data is collected via event (ws) and not http
	 * @param blockTimestamp
	 * @returns void
	 */
	public async insert(
		wallet: string,
		amount: bigint,
		pool_id: number,
		txHash: string,
		type: estimated_earnings_event_type,
		isCollectedByEvent: boolean,
		blockTimestamp?: number
	): Promise<void> {
		const exists = await this.prisma.estimatedEarningTokens.findFirst({
			where: {
				AND: {
					tx_hash: {
						equals: txHash,
					},
					event_type: {
						equals: type,
					},
				},
			},
		});

		if (exists === null) {
			let earning: EstimatedEarningTokens;
			try {
				earning = await this.prisma.estimatedEarningTokens.create({
					data: {
						pool_id: Number(pool_id),
						token_amount: amount.toString(),
						tx_hash: txHash,
						liq_provider_addr: wallet,
						created_at: blockTimestamp
							? new Date(blockTimestamp * 1000)
							: undefined,
						event_type: type,
						is_collected_by_event: isCollectedByEvent,
					},
				});
			} catch (e) {
				this.l.error("inserting new estimated earning record", { error: e });
				return;
			}
			this.l.info("inserted new estimated earning record", {
				blockTimestamp,
				pool_id,
				type,
			});
		} else if (!isCollectedByEvent) {
			// update record
			let earning: EstimatedEarningTokens;
			try {
				earning = await this.prisma.estimatedEarningTokens.update({
					where: {
						pool_id_tx_hash: { pool_id: pool_id, tx_hash: txHash },
					},
					data: {
						is_collected_by_event: false,
					},
				});
			} catch (e) {
				this.l.error("inserting new estimated earning record", { error: e });
				return;
			}
			this.l.info("updated estimated earning record", { type });
		}
	}

	public async insertLiquidityAdded(
		eventData: LiquidityAddedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number
	) {
		const poolIdNum = Number(eventData.poolId.toString());
		return this.insert(
			eventData.user,
			// Liquidity Added goes with - sign
			eventData.tokenAmount * BigInt(-1),
			poolIdNum,
			txHash,
			estimated_earnings_event_type.liquidity_added,
			isCollectedByEvent,
			blockTimestamp
		);
	}

	public async insertLiquidityRemoved(
		eventData: LiquidityRemovedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number
	) {
		const poolIdNum = Number(eventData.poolId.toString());
		return this.insert(
			eventData.user,
			// Liquidity Removed  goes with + sign so we leave it as it is
			eventData.tokenAmount,
			poolIdNum,
			txHash,
			estimated_earnings_event_type.liquidity_removed,
			isCollectedByEvent,
			blockTimestamp
		);
	}

	/**
	 * Insert a peer-to-peer transfer of the token
	 * @param eventData P2PTransferEvent
	 * @param poolId id of pool for which the token is an LP token
	 * @param txHash transaction hash of the transfer transaction
	 * @param blockTimestamp timestamp when event emited
	 */
	public async insertShareTokenP2PTransfer(
		eventData: P2PTransferEvent,
		poolId: number,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number
	) {
		const shareTokenAmount = dec18ToFloat(eventData.amountD18);
		const price = dec18ToFloat(eventData.priceD18);

		const estimatedEarningsTokensAmnt = shareTokenAmount * price;

		// From wallet_from amount sign is plus
		await this.insert(
			eventData.from,
			BigInt(Math.floor(estimatedEarningsTokensAmnt)),
			poolId,
			txHash,
			estimated_earnings_event_type.share_token_p2p_transfer,
			isCollectedByEvent,
			blockTimestamp
		);

		// receiver amount sign is - (minus)
		this.insert(
			eventData.to,
			BigInt(Math.floor(estimatedEarningsTokensAmnt)) * BigInt(-1),
			poolId,
			txHash,
			estimated_earnings_event_type.share_token_p2p_transfer,
			isCollectedByEvent,
			blockTimestamp
		);
	}

	/**
	 * Retrieve the latest timestamp of most latest record via http or undefined
	 * @returns date or undefined
	 */
	public async getLatestTimestamp(
		eventType: estimated_earnings_event_type
	): Promise<Date | undefined> {
		const res = await this.prisma.estimatedEarningTokens.findFirst({
			select: {
				created_at: true,
			},
			orderBy: {
				created_at: "desc",
			},
			where: {
				event_type: eventType,
				is_collected_by_event: false,
			},
		});

		return res?.created_at;
	}

	/**
	 * Retrieve the latest timestamps for each pool id for p2ptransfer events.
	 * Returned result is up to 255 elements array, where each index
	 * @param nShareTokens total number of share tokens / pools currently available - this determines the size of return array
	 * @returns
	 */
	public async getLatestTimestampsP2PTransfer(
		nShareTokens: number
	): Promise<Array<Date | undefined>> {
		const res = await this.prisma.$queryRaw<{ pool_id: bigint; created_at: Date }[]>`
        select pool_id, max(created_at) as created_at from estimated_earnings_tokens 
        group by pool_id 
        order by pool_Id
        `;

		const poolDates: Array<Date | undefined> = new Array(nShareTokens).fill(
			undefined,
			0,
			nShareTokens
		);

		// Set the last date for each pool (pool id is the index of return array)
		res.forEach((r) => {
			// Pool ids start from 1
			poolDates[parseInt(r.pool_id.toString()) - 1] = new Date(r.created_at);
		});

		return poolDates;
	}
}
