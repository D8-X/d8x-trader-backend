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

interface DbErrorShape {
	code?: unknown;
	meta?: { code?: unknown };
}

export function isTransientError(error: unknown): boolean {
	const msg = formatErrorMessage(error).toLowerCase();

	const err = (error ?? {}) as DbErrorShape;
	const codes = [err.code, err.meta?.code]
		.filter((c): c is string => typeof c === "string")
		.map((c) => c.toUpperCase());
	if (
		codes.some((c) =>
			[
				"P2024",
				"P2034",
				"P1001",
				"P1002",
				"P1008",
				"P1017",
				"40P01",
				"40001",
			].includes(c),
		)
	) {
		return true;
	}

	return (
		msg.includes("connection pool") ||
		msg.includes("timed out fetching a new connection") ||
		msg.includes("deadlock") ||
		msg.includes("could not serialize") ||
		msg.includes("can't reach database server") ||
		msg.includes("server has closed the connection") ||
		msg.includes("connection closed") ||
		msg.includes("econnreset") ||
		msg.includes("econnrefused") ||
		msg.includes("etimedout") ||
		msg.includes("socket hang up") ||
		msg.includes("request timeout") ||
		msg.includes("code=timeout") ||
		msg.includes("beyond current head") ||
		msg.includes("-32602") ||
		isRateLimitError(error)
	);
}
