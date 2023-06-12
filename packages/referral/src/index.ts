import Redis from "ioredis";
import { Logger } from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { ReferralCodes } from "./db/referral_codes";

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
  while (brokerAddr == null) {
    sleep(10_000);
    brokerAddr = await redisClient.get("BrokerAddress");
  }
  if (brokerAddr == "") {
    l.info("Broker address not defined in referralSettings.json, closing referral system");
    return;
  }
  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCodes = new ReferralCodes(chainId, prisma, brokerAddr, settings.minimalBrokerSharePercent, l);
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    s.brokerPayoutAddr,
    s.referrerAddr,
    s.agencyAddr,
    s.traderReferrerAgencyPerc
  );
}
start();
