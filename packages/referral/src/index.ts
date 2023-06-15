import Redis from "ioredis";
import { Logger } from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { ReferralCode } from "./db/referral_code";

function loadSettings() {
  let file = require("../referralSettings.json") as ReferralSettings;
  return file;
}

function loadEnv() {
  dotenv.config();
}

async function start() {
  loadEnv();

  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }

  let redisClient: Redis = constructRedis("referral");
  let l = new Logger();
  let settings = loadSettings();
  // wait for broker initialization by packages/api/sdkInterface
  let brokerAddr: string | null = null;
  let count = 0;
  while (brokerAddr == null || count > 4) {
    sleep(10_000);
    // BrokerAddress key is set by sdkInterface.ts
    brokerAddr = await redisClient.get("BrokerAddress");
    count++;
  }
  if (brokerAddr == "") {
    l.info("Broker address not found as REDIS key, closing referral system");
    return;
  }
  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCodes = new ReferralCode(chainId, prisma, brokerAddr, settings.minimalBrokerSharePercent, l);

  // Set default referral
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    s.brokerPayoutAddr,
    s.referrerAddr,
    s.agencyAddr,
    s.traderReferrerAgencyPerc
  );
}
start();
