import * as winston from "winston";

// TODO set this up for actual production use
const defaultLogger = () => {
  return winston.createLogger({
    level: "info",
    format: winston.format.json(),
    defaultMeta: { service: "pnl-service" },
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: "pnl.log" }),
    ],
  });
};

// Entrypoint of PnL service
const main = () => {
  const logger = defaultLogger();
  logger.info("starting pnl service");
};

main();
