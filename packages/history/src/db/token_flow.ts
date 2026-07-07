import { PrismaClient, Prisma } from "@prisma/client";
import { BigNumberish } from "ethers";
import {
	TokenFlowEvent,
	TokensDepositedEvent,
	TokensWithdrawnEvent,
} from "../contracts/types.js";
import { Logger } from "winston";
import { formatErrorMessage } from "../utils/errors.js";
import { metrics } from "../svc/metrics.js";

export interface TokenFlowBatchItem {
	perpetualId: BigNumberish;
	trader: string;
	amountCC: bigint;
	txHash: string;
	blockTimestamp: number;
	isDeposit: boolean;
}

const CREATE_MANY_BATCH = 1000;

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
			false,
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
			true,
		);
	}

	private async insertTokenFlowRecord(
		e: TokenFlowEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		evtBlockTimestamp: number,
		isDeposit: boolean,
	) {
		const tx_hash = txHash.toLowerCase();
		const trader = e.trader.toLowerCase();
		await this.prisma.tokenFlow.upsert({
			where: {
				trader_addr_perpetual_id_tx_hash_deposit: {
					trader_addr: trader,
					perpetual_id: Number(e.perpetualId),
					tx_hash,
					deposit: isDeposit,
				},
			},
			update: {
				is_collected_by_event: isCollectedByEvent,
				timestamp: new Date(evtBlockTimestamp * 1000),
				updated_at: new Date(),
			},
			create: {
				trader_addr: trader,
				perpetual_id: Number(e.perpetualId),
				chain_id: parseInt(this.chainId.toString()),
				amount_cc: e.amountCC.toString(),
				deposit: isDeposit,
				tx_hash,
				timestamp: new Date(evtBlockTimestamp * 1000),
				is_collected_by_event: isCollectedByEvent,
			},
		});
	}

	public async insertTokenFlowRecordsBatch(
		items: TokenFlowBatchItem[],
		isCollectedByEvent: boolean,
	): Promise<void> {
		if (items.length === 0) {
			return;
		}
		const byKey = new Map<string, Prisma.TokenFlowCreateManyInput>();
		for (const it of items) {
			const trader = it.trader.toLowerCase();
			const tx_hash = it.txHash.toLowerCase();
			const perpetual_id = Number(it.perpetualId);
			const amount = it.isDeposit ? it.amountCC : -it.amountCC;
			byKey.set(`${trader}:${perpetual_id}:${tx_hash}:${it.isDeposit}`, {
				trader_addr: trader,
				perpetual_id,
				chain_id: parseInt(this.chainId.toString()),
				amount_cc: amount.toString(),
				deposit: it.isDeposit,
				tx_hash,
				timestamp: new Date(it.blockTimestamp * 1000),
				is_collected_by_event: isCollectedByEvent,
			});
		}
		const rows = [...byKey.values()];
		for (let i = 0; i < rows.length; i += CREATE_MANY_BATCH) {
			try {
				await this.prisma.tokenFlow.createMany({
					data: rows.slice(i, i + CREATE_MANY_BATCH),
					skipDuplicates: true,
				});
			} catch (e) {
				this.l.error("batch inserting token flows", {
					error: formatErrorMessage(e),
				});
				metrics.trackError("token_flow_createMany", e);
			}
		}
	}
}
