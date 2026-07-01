import { formatErrorMessage } from "../utils/errors.js";

const startTime = Date.now();

function formatUptime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const days = Math.floor(s / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(" ");
}

export const metrics = {
	status: "initializing" as string,
	connection: "unknown" as string,
	lastBlock: 0,
	rateLimitsHit: 0,
	lastRateLimitAt: null as string | null,
	errors: [] as { ts: string; source: string; msg: string }[],
	backfill: {
		running: false,
		progress: 0,
		eventsFound: 0,
	},
	gapDetection: {
		gapsDetected: 0,
		gapsFilled: 0,
		gapsSkipped: 0,
		lastRun: null as string | null,
	},
	eventsProcessed: {} as Record<string, number>,
	lastEventAt: null as string | null,

	trackEvent(eventName: string) {
		this.eventsProcessed[eventName] = (this.eventsProcessed[eventName] ?? 0) + 1;
		this.lastEventAt = new Date().toISOString();
	},

	trackError(source: string, error: unknown) {
		const msg = formatErrorMessage(error);
		this.errors.push({
			ts: new Date().toISOString(),
			source,
			msg: msg.slice(0, 300),
		});
		if (this.errors.length > 20) {
			this.errors = this.errors.slice(-20);
		}
	},

	toJSON() {
		const uptimeMs = Date.now() - startTime;
		return {
			status: this.status,
			uptime: formatUptime(uptimeMs),
			uptime_seconds: Math.floor(uptimeMs / 1000),
			connection: this.connection,
			last_block: this.lastBlock,
			rate_limits_hit: this.rateLimitsHit,
			last_rate_limit_at: this.lastRateLimitAt,
			backfill: this.backfill,
			gap_detection: this.gapDetection,
			events_processed: this.eventsProcessed,
			last_event_at: this.lastEventAt,
			recent_errors: this.errors,
		};
	},
};
