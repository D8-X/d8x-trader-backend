export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

interface RpcErrorShape {
	code?: string;
	error?: {
		code?: number;
		message?: string;
	};
}

export function isNoHistoricalStateError(error: unknown): boolean {
	const msg = formatErrorMessage(error);
	return msg.includes("historical state") && msg.includes("is not available");
}

export function isRateLimitError(error: unknown): boolean {
	const msg = formatErrorMessage(error);
	if (
		msg.includes("rate limit") ||
		msg.includes("request limit") ||
		msg.includes("-32016") ||
		msg.includes("-32007") ||
		msg.includes("429")
	) {
		return true;
	}
	const err = (error ?? {}) as RpcErrorShape;
	const code = err.error?.code;
	if (code === -32016 || code === -32007) {
		return true;
	}
	const innerMsg = err.error?.message;
	if (innerMsg?.includes("rate limit") || innerMsg?.includes("request limit")) {
		return true;
	}
	if (err.code === "UNKNOWN_ERROR" && (code === -32016 || code === -32007)) {
		return true;
	}
	return false;
}
