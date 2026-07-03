import { PrismaClient } from "@prisma/client";
import type { Logger } from "winston";
import { metrics } from "./metrics.js";
import { GapMemory } from "./gapMemory.js";

export interface GapRow {
	gap_start: Date;
	gap_end: Date;
}

type AllowedTable =
	| "trades_history"
	| "token_flow"
	| "funding_rate_payments"
	| "settle_history"
	| "estimated_earnings_tokens";

type AllowedTimestampCol =
	| "trade_timestamp"
	| "timestamp"
	| "payment_timestamp"
	| "created_at";

export interface GapConfig {
	table: AllowedTable;
	timestampCol: AllowedTimestampCol;
	thresholdSeconds: number;
}

export type BackfillRunner = (
	startTimestampSec: number,
	endTimestampSec?: number,
) => Promise<void>;

export const GAP_CONFIGS: GapConfig[] = [
	{
		table: "trades_history",
		timestampCol: "trade_timestamp",
		thresholdSeconds: 4 * 3600,
	},
	{ table: "token_flow", timestampCol: "timestamp", thresholdSeconds: 4 * 3600 },
	{
		table: "funding_rate_payments",
		timestampCol: "payment_timestamp",
		thresholdSeconds: 4 * 3600,
	},
	{ table: "settle_history", timestampCol: "timestamp", thresholdSeconds: 6 * 3600 },
	{
		table: "estimated_earnings_tokens",
		timestampCol: "created_at",
		thresholdSeconds: 12 * 3600,
	},
];

export async function detectGaps(
	prisma: PrismaClient,
	config: GapConfig,
): Promise<GapRow[]> {
	const gaps = await prisma.$queryRawUnsafe<GapRow[]>(
		`WITH ordered AS (
			SELECT ${config.timestampCol} as ts,
				LEAD(${config.timestampCol}) OVER (ORDER BY ${config.timestampCol}) as next_ts
			FROM ${config.table}
			WHERE is_collected_by_event = false
				AND ${config.timestampCol} > NOW() - interval '30 days'
		)
		SELECT ts as gap_start, next_ts as gap_end
		FROM ordered
		WHERE next_ts IS NOT NULL
			AND EXTRACT(EPOCH FROM (next_ts - ts)) > $1
		ORDER BY ts ASC`,
		config.thresholdSeconds,
	);
	return gaps;
}

export async function detectAndFillGaps(
	prisma: PrismaClient,
	runBackfill: BackfillRunner,
	startTimestampSec: number,
	logger: Logger,
	gapMemory: GapMemory,
): Promise<void> {
	const nowSec = Math.floor(Date.now() / 1000);
	await gapMemory.cleanup(nowSec);

	const gapWindows = new Map<number, number>();

	for (const config of GAP_CONFIGS) {
		try {
			const gaps = await detectGaps(prisma, config);
			if (gaps.length > 0) {
				logger.info(`detected ${gaps.length} gap(s) in ${config.table}`, {
					earliest: `${gaps[0].gap_start.toISOString()} - ${gaps[0].gap_end.toISOString()}`,
					latest: `${gaps[gaps.length - 1].gap_start.toISOString()} - ${gaps[gaps.length - 1].gap_end.toISOString()}`,
				});
				for (const gap of gaps) {
					const startSec = Math.floor(gap.gap_start.getTime() / 1000);
					const endSec = Math.ceil(gap.gap_end.getTime() / 1000);
					const prev = gapWindows.get(startSec);
					gapWindows.set(
						startSec,
						prev === undefined ? endSec : Math.max(prev, endSec),
					);
				}
			}
		} catch (e) {
			logger.warn(`gap detection failed for ${config.table}`, {
				error: e instanceof Error ? e.message : String(e),
			});
			metrics.trackError(`gapDetection:${config.table}`, e);
		}
	}

	if (gapWindows.size === 0) return;

	metrics.gapDetection.lastRun = new Date().toISOString();
	metrics.gapDetection.gapsDetected = gapWindows.size;
	const sorted = [...gapWindows.keys()].sort((a, b) => b - a);
	logger.info(`filling ${sorted.length} unique gap(s), most recent first`);

	for (const gapStartSec of sorted) {
		const sec = Math.max(gapStartSec, startTimestampSec);
		const endSec = gapWindows.get(gapStartSec)!;
		if (await gapMemory.hasTried(gapStartSec, endSec)) {
			logger.info("skipping gap already attempted", {
				gap_start: new Date(gapStartSec * 1000).toISOString(),
				gap_end: new Date(endSec * 1000).toISOString(),
			});
			metrics.gapDetection.gapsSkipped++;
			continue;
		}
		logger.info("triggering backfill for gap", {
			gap_start: new Date(sec * 1000).toISOString(),
			gap_end: new Date(endSec * 1000).toISOString(),
		});
		// we record the attempt before running so a gap that crashes or persists is not rescanned every cycle
		await gapMemory.markTried(gapStartSec, endSec, nowSec);
		await runBackfill(sec, endSec);
		metrics.gapDetection.gapsFilled++;
	}
}
