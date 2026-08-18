const MAX_ENTRIES = 500_000;
const cache = new Map<number, number>();

let hits = 0;
let misses = 0;

export function getBlockTsCacheStats() {
	return { hits, misses, size: cache.size, saved: hits };
}

export function getCachedBlockTs(blockNumber: number): number | undefined {
	const v = cache.get(blockNumber);
	if (v === undefined) {
		misses++;
	} else {
		hits++;
	}
	return v;
}

export function setCachedBlockTs(blockNumber: number, timestamp: number): void {
	if (cache.has(blockNumber)) {
		return;
	}
	if (cache.size >= MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) {
			cache.delete(oldest);
		}
	}
	cache.set(blockNumber, timestamp);
}

if (process.env.BLOCK_TS_CACHE_STATS === "true") {
	setInterval(() => {
		console.log(`[blockTsCacheStats] ${JSON.stringify(getBlockTsCacheStats())}`);
	}, 30_000).unref();
}
