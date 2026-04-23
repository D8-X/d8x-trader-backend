import * as winston from "winston";

const createDefaultLogger = (): winston.Logger =>
	winston.createLogger({
		level: "info",
		format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
		defaultMeta: { service: "api" },
		transports: [new winston.transports.Console()],
	});

export const logger: winston.Logger = createDefaultLogger();
