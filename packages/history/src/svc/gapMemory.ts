import type { RedisClientType } from "redis";
import type { Logger } from "winston";

const GAP_TRIED_KEY = "history:gap:tried";
const RETENTION_SEC = 30 * 24 * 3600;

/**
 * Remembers which gap windows we have already attempted to backfill.
 * A connected Redis client is required
 */
export class GapMemory {
	private client: RedisClientType;
	private logger: Logger;

	constructor(client: RedisClientType, logger: Logger) {
		this.client = client;
		this.logger = logger;
	}

	static key(gapStartSec: number, gapEndSec: number): string {
		return `${gapStartSec}:${gapEndSec}`;
	}

	/** Whether this exact gap window has already been attempted. */
	async hasTried(gapStartSec: number, gapEndSec: number): Promise<boolean> {
		const score = await this.client.zScore(
			GAP_TRIED_KEY,
			GapMemory.key(gapStartSec, gapEndSec),
		);
		return score !== null;
	}

	/** Record that this gap window was attempted. */
	async markTried(
		gapStartSec: number,
		gapEndSec: number,
		nowSec: number,
	): Promise<void> {
		await this.client.zAdd(GAP_TRIED_KEY, {
			score: nowSec,
			value: GapMemory.key(gapStartSec, gapEndSec),
		});
	}

	/** Drop attempts older than the retention window. */
	async cleanup(nowSec: number): Promise<void> {
		const removed = await this.client.zRemRangeByScore(
			GAP_TRIED_KEY,
			"-inf",
			nowSec - RETENTION_SEC,
		);
		if (removed > 0) {
			this.logger.info(`pruned ${removed} stale gap-attempt record(s)`);
		}
	}
}
