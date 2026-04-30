import * as winston from "winston";

const { format } = winston;

const prettyFormat = format.combine(
	format.colorize({ level: true }),
	format.timestamp({ format: "HH:mm:ss.SSS" }),
	format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
		const metaKeys = Object.keys(meta);
		const metaStr = metaKeys.length
			? " " +
				metaKeys
					.map((k) => {
						const v = (meta as Record<string, unknown>)[k];
						return `\x1b[90m${k}=\x1b[0m${
							typeof v === "string" ? v : JSON.stringify(v)
						}`;
					})
					.join(" ")
			: "";
		const svc = service ? `\x1b[36m[${service}]\x1b[0m ` : "";
		const stackStr = stack ? `\n${stack}` : "";
		return `\x1b[90m${timestamp}\x1b[0m ${svc}${level} ${message}${metaStr}${stackStr}`;
	}),
);

const jsonFormat = format.combine(format.timestamp(), format.json());

const resolveFormat = () => {
	const mode = (process.env.LOG_FORMAT ?? "").toLowerCase();
	if (mode === "pretty") return prettyFormat;
	if (mode === "json") return jsonFormat;
	return process.stdout.isTTY ? prettyFormat : jsonFormat;
};

export const logger: winston.Logger = winston.createLogger({
	level: process.env.LOG_LEVEL ?? "info",
	format: resolveFormat(),
	defaultMeta: { service: "api" },
	transports: [new winston.transports.Console()],
});
