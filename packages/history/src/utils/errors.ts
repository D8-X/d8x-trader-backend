export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function isRateLimitError(error: unknown): boolean {
	const msg = formatErrorMessage(error);
	if (msg.includes("rate limit") || msg.includes("-32016") || msg.includes("429")) {
		return true;
	}
	const err = error as Record<string, any>;
	if (err?.error?.code === -32016 || err?.error?.message?.includes("rate limit")) {
		return true;
	}
	if (err?.code === "UNKNOWN_ERROR" && err?.error?.code === -32016) {
		return true;
	}
	return false;
}
