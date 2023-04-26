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
import { dec18ToFloat } from "../utils/bigint";

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
		perpetualId: bigint,
		txHash: string,
		type: estimated_earnings_event_type,
		blockTimestamp?: number
	) {
		const exists = await this.prisma.estimatedEarningTokens.findFirst({
			where: {
				tx_hash: {
					equals: txHash,
				},
			},
		});

		if (exists === null) {
			let fungingRatePayment: EstimatedEarningTokens;
			try {
				fungingRatePayment = await this.prisma.estimatedEarningTokens.create({
					data: {
						perpetual_id: perpetualId,
						token_amount: amount.toString(),
						tx_hash: txHash,
						wallet_address: wallet,
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
				trade_id: fungingRatePayment.id,
			});
		}
	}

	public async insertLiquidityAdded(
		wallet: string,
		amount: bigint,
		perpetualId: bigint,
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
		perpetualId: bigint,
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

	public async insertShareTokenP2PTransfer(
		wallet_from: string,
		wallet_to: string,
		amountD18: bigint,
		priceD18: bigint,
		perpetualId: bigint,
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
			perpetualId,
			txHash,
			estimated_earnings_event_type.share_token_p2p_transfer,
			blockTimestamp
		);

		// For wallet_from amount sign is - (minus)
		return this.insert(
			wallet_to,
			BigInt(Math.floor(estimatedEarningsTokensAmnt)) * BigInt(-1),
			perpetualId,
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
}
