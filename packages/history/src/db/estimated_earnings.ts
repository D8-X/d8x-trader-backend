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
import { dec18ToFloat, decNToFloat } from "utils";

eth.toBigInt;

export class EstimatedEarnings {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger
	) {}

	/**
	 * Insert new estimated earning
	 *
	 * @param wallet
	 * @param amount
	 * @param txHash
	 * @param blockTimestamp
	 * @returns
	 */
	public async insert(
		wallet: string,
		amount: bigint,
		pool_id: number,
		txHash: string,
		type: estimated_earnings_event_type,
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
					},
				});
			} catch (e) {
				this.l.error("inserting new estimated earning record", { error: e });
				return;
			}
			this.l.info("inserted new estimated earning record", {
				trade_id: earning.id,
				type,
			});
		}
	}

	public async insertLiquidityAdded(
		wallet: string,
		amount: bigint,
		perpetualId: number,
		txHash: string,
		blockTimestamp: number
	) {
		return this.insert(
			wallet,
			// Liquidity Added  goes with - sign
			amount * BigInt(-1),
			perpetualId,
			txHash,
			estimated_earnings_event_type.liquidity_added,
			blockTimestamp
		);
	}

	public async insertLiquidityRemoved(
		wallet: string,
		amount: bigint,
		perpetualId: number,
		txHash: string,
		blockTimestamp: number
	) {
		return this.insert(
			wallet,
			// Liquidity Removed  goes with + sign so we leave it as it is
			amount,
			perpetualId,
			txHash,
			estimated_earnings_event_type.liquidity_removed,
			blockTimestamp
		);
	}

	/**
	 * Insert a peer-to-peer transfer of the token
	 * @param wallet_from transfer from this address
	 * @param wallet_to transfer to this address
	 * @param amountD18 amount of the token transferred in decimal 18 convention
	 * @param priceD18 price of the share pool token at the time of transfer
	 * @param poolId id of poool
	 * @param txHash transaction hash of the transfer transaction
	 * @param blockTimestamp timestamp when event emited
	 */
	public async insertShareTokenP2PTransfer(
		wallet_from: string,
		wallet_to: string,
		amountD18: bigint,
		priceD18: bigint,
		poolId: number,
		txHash: string,
		blockTimestamp: number
	) {
		const amount = dec18ToFloat(amountD18);
		const price = dec18ToFloat(priceD18);

		const estimatedEarningsTokensAmnt = amount * price;

		// For wallet_from amount sign is plus
		await this.insert(
			wallet_from,
			BigInt(Math.floor(estimatedEarningsTokensAmnt)),
			poolId,
			txHash,
			estimated_earnings_event_type.share_token_p2p_transfer,
			blockTimestamp
		);

		// For wallet_from amount sign is - (minus)
		this.insert(
			wallet_to,
			BigInt(Math.floor(estimatedEarningsTokensAmnt)) * BigInt(-1),
			poolId,
			txHash,
			estimated_earnings_event_type.share_token_p2p_transfer,
			blockTimestamp
		);
	}

	/**
	 * Retrieve the latest timestamp of most latest event record or
	 * current date on deefault
	 * @returns
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
