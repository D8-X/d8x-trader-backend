import Redis from "ioredis";
import * as winston from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep, isValidAddress } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import ReferralAPI from "./api/referral_api";
import DBReferralCode from "./db/db_referral_code";
import ReferralCut from "./db/db_referral_cut";
import TokenHoldings from "./db/db_token_holdings";
import TokenAccountant from "./svc/tokenAccountant";

import DBPayments from "./db/db_payments";
import ReferralCodeValidator from "./svc/referralCodeValidator";
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

/**
 * Check paymentScheduleMinHourDayofweekDayofmonthMonthWeekday, e.g., "0-14-7-*"
 * @param sched schedule-string from settings file
 * @returns true if it passes validity checks
 */
function isValidPaymentScheduleSyntax(sched: string): boolean {
  if (!/^([0-9]{1,2})-([0-9]{1,2})-([0-9]{1,2}|\*)-([0-9]{1,2}|\*)-([0-9]{1,2}|\*)$/.test(sched)) {
    return false;
  }
  let [_min, _hour, _dayOfWeek, _dayOfMonth, _weekDay] = sched.split("-");
  const isInValid =
    (_min != "*" && (Number(_min) > 59 || Number(_min) < 0)) ||
    (_hour != "*" && (Number(_hour) > 23 || Number(_hour) < 0)) ||
    (_dayOfWeek != "*" && (Number(_dayOfWeek) > 7 || Number(_dayOfWeek) < 1)) ||
    (_dayOfMonth != "*" && (Number(_dayOfMonth) > 31 || Number(_dayOfMonth) < 1)) ||
    (_weekDay != "*" && (Number(_weekDay) < 0 || Number(_weekDay) > 7));
  return !isInValid;
}

function checkReferralCutPercent(cut: Array<[number, number]>) {
  for (let k = 0; k < cut.length; k++) {
    const isPercent = cut[k][0] < 100 && cut[k][0] >= 0;
    const posTokenHoldings = cut[k][1] >= 0;
    if (!isPercent) {
      throw Error(`referrerCutPercentForTokenXHolding: incorrect percentage ${cut[k][0]}`);
    }
    if (!posTokenHoldings) {
      throw Error(`referrerCutPercentForTokenXHolding: token holdings negative ${cut[k][1]}`);
    }
  }
}

/**
 * Check whether settings for minBrokerFeeCCForRebatePerPool seem ok
 * @param rebate rebate array from settings
 */
function checkSettingMinBrokerFeeCCForRebatePerPool(rebate: Array<[number, number]>) {
  for (let k = 0; k < rebate.length; k++) {
    const isPool = rebate[k][1] > 0 && rebate[k][1] < 120 && rebate[k][1] - Math.round(rebate[k][1]) == 0;
    if (!isPool) {
      throw Error(`minBrokerFeeCCForRebatePerPool: invalid pool number ${rebate[k][1]}`);
    }
  }
}

function loadSettings() {
  let file = require("../referralSettings.json") as ReferralSettings;
  // some rudimentary checks
  if (file.permissionedAgencies.length > 0) {
    file.permissionedAgencies.map((a) => {
      if (!isValidAddress(a)) {
        logger.warn(`Invalid address in permissionedAgencies: ${a}`);
      }
    });
  }
  if (file.tokenX.address != "" && !isValidAddress(file.tokenX.address)) {
    throw Error(`referralSettings: Invalid tokenX address: ${file.tokenX.address}`);
  }
  if (file.brokerPayoutAddr != "" && !isValidAddress(file.brokerPayoutAddr)) {
    throw Error(`referralSettings: Invalid brokerPayoutAddr address: ${file.brokerPayoutAddr}`);
  }
  if (file.defaultReferralCode.referrerAddr != "" && !isValidAddress(file.defaultReferralCode.referrerAddr)) {
    throw Error(`referralSettings: Invalid referrerAddr address: ${file.defaultReferralCode.referrerAddr}`);
  }
  if (file.defaultReferralCode.agencyAddr != "" && !isValidAddress(file.defaultReferralCode.agencyAddr)) {
    throw Error(`referralSettings: Invalid agencyAddr address: ${file.defaultReferralCode.agencyAddr}`);
  }
  const percArray = file.defaultReferralCode.traderReferrerAgencyPerc;
  let sumP = percArray[0] + percArray[1] + percArray[2];
  if (sumP > 100) {
    throw Error(`referralSettings: traderReferrerAgencyPerc should sum to 100 but sum to ${sumP}`);
  }
  if (!isValidPaymentScheduleSyntax(file.paymentScheduleMinHourDayofweekDayofmonthMonthWeekday)) {
    throw Error(
      `referralSettings: invalid payment schedule ${file.paymentScheduleMinHourDayofweekDayofmonthMonthWeekday}`
    );
  }
  checkReferralCutPercent(file.referrerCutPercentForTokenXHolding);
  checkSettingMinBrokerFeeCCForRebatePerPool(file.minBrokerFeeCCForRebatePerPool);
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

async function setDefaultReferralCode(dbReferralCodes: DBReferralCode, settings: ReferralSettings) {
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    settings.brokerPayoutAddr,
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

  let settings;
  try {
    settings = loadSettings();
  } catch (error) {
    logger.error("Problems in referralSettings:" + error);
    return;
  }

  if (!settings.referralSystemEnabled) {
    logger.info("Referral system is turned off. Use referralSettings.json to enable.");
    return;
  }

  let port: number;
  if (process.env.REFERRAL_API_PORT == undefined) {
    logger.error("Set REFERRAL_API_PORT in .env (e.g. REFERRAL_API_PORT=8889)");
    return;
  } else {
    port = parseInt(process.env.REFERRAL_API_PORT);
  }

  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    logger.error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
    return;
  }

  let rpcUrl: string = process.env.HTTP_RPC_URL || "";
  if (rpcUrl == "") {
    logger.error("Set HTTP_RPC_URL in .env");
    return;
  }

  let brokerAddr = await getBrokerAddressViaRedis(logger);
  if (brokerAddr == "" || brokerAddr == ZERO_ADDRESS) {
    logger.info("shutting down referrer system (no broker)");
    return;
  }

  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCode = new DBReferralCode(BigInt(chainId), prisma, brokerAddr, settings, logger);
  const dbReferralCuts = new ReferralCut(BigInt(chainId), prisma, logger);
  const dbFeeAggregator = new DBPayments(BigInt(chainId), prisma, logger);
  const dbTokenHoldings = new TokenHoldings(BigInt(chainId), prisma, logger);
  const referralCodeValidator = new ReferralCodeValidator(settings, dbReferralCode);
  await setDefaultReferralCode(dbReferralCode, settings);
  await setReferralCutSettings(dbReferralCuts, settings);
  let ta = new TokenAccountant(dbTokenHoldings, settings.tokenX.address, logger);
  ta.initProvider(rpcUrl);
  await ta.fetchBalancesFromChain();
  // start REST API server
  let api = new ReferralAPI(port, dbFeeAggregator, dbReferralCode, referralCodeValidator, brokerAddr, logger);
  await api.initialize();
}
start();
