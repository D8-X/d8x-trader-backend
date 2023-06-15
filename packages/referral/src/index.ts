import Redis from "ioredis";
import * as winston from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import ReferralCode from "./db/referral_code";
import ReferralAPI from "./api/referral_api";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const defaultLogger = () => {
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { service: "pnl-service" },
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: "pnl.log" })],
  });
};

export const logger = defaultLogger();

function loadSettings() {
  let file = require("../referralSettings.json") as ReferralSettings;
  return file;
}

function loadEnv() {
  dotenv.config();
}

async function getBrokerAddressViaRedis(l: winston.Logger): Promise<string> {
  // wait for broker initialization by packages/api/sdkInterface
  let redisClient: Redis = constructRedis("referral");
  let brokerAddr: string | null = null;
  let count = 0;
  while (brokerAddr == null && count < 5) {
    await sleep(20_000);
    // BrokerAddress key is set by sdkInterface.ts
    brokerAddr = await redisClient.get("BrokerAddress");
    if (brokerAddr == null) {
      l.info("Broker address not found yet.");
    } else {
      l.info("Broker address found:" + brokerAddr);
    }
    count++;
  }
  if (brokerAddr == "") {
    l.info("Broker address not found as REDIS key, closing referral system");
    return "";
  }
  return brokerAddr || "";
}

async function start() {
  loadEnv();

  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }

  let settings = loadSettings();

  let brokerAddr = await getBrokerAddressViaRedis(logger);
  if (brokerAddr == "" || brokerAddr == ZERO_ADDRESS) {
    logger.info("shutting down referrer system (no broker)");
    return;
  }

  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCodes = new ReferralCode(
    BigInt(chainId),
    prisma,
    brokerAddr,
    settings.minimalBrokerSharePercent,
    logger
  );

  // Set default referral
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    s.brokerPayoutAddr,
    s.referrerAddr,
    s.agencyAddr,
    s.traderReferrerAgencyPerc
  );
  // start REST API server
  let port: number;
  if (process.env.REFERRAL_API_PORT == undefined) {
    throw new Error("Set REFERRAL_API_PORT in .env (e.g. REFERRAL_API_PORT=8889)");
  } else {
    port = parseInt(process.env.REFERRAL_API_PORT);
  }
  let refCode = new ReferralAPI(port, logger);
  await refCode.initialize();
}
start();
