const startTime = Date.now();

export const metrics = {
	connection: "unknown" as string,
	lastBlock: 0,
	rateLimitsHit: 0,
	errors: [] as { ts: string; msg: string }[],
	backfill: {
		running: false,
		progress: 0,
		eventsFound: 0,
	},
	gapDetection: {
		gapsDetected: 0,
		gapsFilled: 0,
		lastRun: null as string | null,
	},
	eventsProcessed: {} as Record<string, number>,
	lastEventAt: null as string | null,

	trackEvent(eventName: string) {
		this.eventsProcessed[eventName] = (this.eventsProcessed[eventName] ?? 0) + 1;
		this.lastEventAt = new Date().toISOString();
	},

	toJSON() {
		return {
			uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
			connection: this.connection,
			last_block: this.lastBlock,
			rate_limits_hit: this.rateLimitsHit,
			recent_errors: this.errors.slice(-10),
			backfill: this.backfill,
			gap_detection: this.gapDetection,
			events_processed: this.eventsProcessed,
			last_event_at: this.lastEventAt,
		};
	},
};
