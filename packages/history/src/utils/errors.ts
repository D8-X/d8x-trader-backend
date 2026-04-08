export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function isRateLimitError(error: unknown): boolean {
	const msg = formatErrorMessage(error);
	if (
		msg.includes("rate limit") ||
		msg.includes("request limit") ||
		msg.includes("-32016") ||
		msg.includes("-32007") ||
		msg.includes("429") ||
		msg.includes("could not coalesce error")
	) {
		return true;
	}
	const err = error as Record<string, any>;
	const code = err?.error?.code;
	if (code === -32016 || code === -32007) {
		return true;
	}
	if (
		err?.error?.message?.includes("rate limit") ||
		err?.error?.message?.includes("request limit")
	) {
		return true;
	}
	if (err?.code === "UNKNOWN_ERROR" && (code === -32016 || code === -32007)) {
		return true;
	}
	return false;
}
