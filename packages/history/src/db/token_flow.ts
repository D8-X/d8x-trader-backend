import { PrismaClient, Trade, trade_side, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import {
	TokenFlowEvent,
	TokensDepositedEvent,
	TokensWithdrawnEvent,
} from "../contracts/types.js";
import { Logger } from "winston";

export class TokenFlow {
	constructor(
		public chainId: BigNumberish,
		public prisma: PrismaClient,
		public l: Logger,
	) {}

	public async getLatestTimestamp(): Promise<Date | undefined> {
		const res = await this.prisma.tokenFlow.findFirst({
			select: {
				timestamp: true,
			},
			orderBy: {
				timestamp: "desc",
			},
			where: {
				is_collected_by_event: false,
			},
		});
		if (res?.timestamp) {
			return new Date(res.timestamp.getTime() - 3_600_000);
		}
		return undefined;
	}

	public async insertTokenWithdrawRecord(
		e: TokensWithdrawnEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		evtBlockTimestamp: number,
	) {
		const ev: TokenFlowEvent = {
			perpetualId: e.perpetualId,
			amountCC: -e.amountCC,
			trader: e.trader,
		};
		await this.insertTokenFlowRecord(
			ev,
			txHash,
			isCollectedByEvent,
			evtBlockTimestamp,
		);
	}

	public async insertTokenDepositRecord(
		e: TokensDepositedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		evtBlockTimestamp: number,
	) {
		const ev: TokenFlowEvent = {
			perpetualId: e.perpetualId,
			amountCC: e.amountCC,
			trader: e.trader,
		};
		await this.insertTokenFlowRecord(
			ev,
			txHash,
			isCollectedByEvent,
			evtBlockTimestamp,
		);
	}

	private async insertTokenFlowRecord(
		e: TokenFlowEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		evtBlockTimestamp: number,
	) {
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();
		await this.prisma.tokenFlow.upsert({
			where: {
				trader_addr_perpetual_id_tx_hash: {
					trader_addr: trader,
					perpetual_id: Number(e.perpetualId),
					tx_hash,
				},
			},
			update: {
				is_collected_by_event: isCollectedByEvent,
			},
			create: {
				trader_addr: trader,
				perpetual_id: Number(e.perpetualId),
				chain_id: parseInt(this.chainId.toString()),
				amount_cc: e.amountCC.toString(),
				tx_hash,
				timestamp: new Date(evtBlockTimestamp * 1000),
				is_collected_by_event: isCollectedByEvent,
			},
		});
	}
}
