import Redis from "ioredis";
import * as winston from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import ReferralAPI from "./api/referral_api";
import ReferralCode from "./db/referral_code";
import ReferralCut from "./db/referral_cut";
import TokenHoldings from "./db/token_holdings";
import TokenAccountant from "./svc/tokenAccountant";

import FeeAggregator from "./db/fee_aggregator";
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

async function setDefaultReferralCode(dbReferralCodes: ReferralCode, settings: ReferralSettings) {
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    s.brokerPayoutAddr,
    s.referrerAddr,
    s.agencyAddr,
    s.traderReferrerAgencyPerc
  );
}

async function setReferralCutSettings(dbReferralCuts: ReferralCut, settings: ReferralSettings) {
  await dbReferralCuts.writeReferralCutsToDB(true, [[settings.agencyCutPercent, 0]], 0, "");
  await dbReferralCuts.writeReferralCutsToDB(
    false,
    settings.referrerCutPercentForTokenXHolding,
    settings.tokenX.decimals,
    settings.tokenX.address
  );
}

async function start() {
  loadEnv();
  let port: number;
  if (process.env.REFERRAL_API_PORT == undefined) {
    throw new Error("Set REFERRAL_API_PORT in .env (e.g. REFERRAL_API_PORT=8889)");
  } else {
    port = parseInt(process.env.REFERRAL_API_PORT);
  }

  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }

  let rpcUrl: string = process.env.HTTP_RPC_URL || "";
  if (rpcUrl == "") {
    throw new Error("Set HTTP_RPC_URL in .env");
  }

  let settings = loadSettings();

  let brokerAddr = await getBrokerAddressViaRedis(logger);
  if (brokerAddr == "" || brokerAddr == ZERO_ADDRESS) {
    logger.info("shutting down referrer system (no broker)");
    return;
  }

  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCodes = new ReferralCode(BigInt(chainId), prisma, brokerAddr, logger);
  const dbReferralCuts = new ReferralCut(BigInt(chainId), prisma, logger);
  const dbFeeAggregator = new FeeAggregator(BigInt(chainId), prisma, logger);
  const dbTokenHoldings = new TokenHoldings(BigInt(chainId), prisma, logger);

  await setDefaultReferralCode(dbReferralCodes, settings);
  await setReferralCutSettings(dbReferralCuts, settings);
  let ta = new TokenAccountant(dbTokenHoldings, settings.tokenX.address);
  ta.initProvider(rpcUrl);
  await ta.fetchFromChain();

  // start REST API server
  let api = new ReferralAPI(port, dbFeeAggregator, brokerAddr, logger);
  await api.initialize();
}
start();
