import Redis from "ioredis";
import { ethers } from "ethers";
import * as winston from "winston";
import { ReferralSettings } from "./referralTypes";
import { constructRedis, sleep, isValidAddress, cronParserCheckExpression } from "utils";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import ReferralAPI from "./api/referral_api";
import DBReferralCode from "./db/db_referral_code";
import ReferralCut from "./db/db_referral_cut";
import DBTokenHoldings from "./db/db_token_holdings";
import TokenAccountant from "./svc/tokenAccountant";
import ReferralPaymentManager from "./svc/referralPaymentManager";
import DBPayments from "./db/db_payments";
import ReferralCodeValidator from "./svc/referralCodeValidator";
import PayExecutorLocal from "./svc/payExecutorLocal";
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
 * Check paymentScheduleMinHourDayofmonthWeekday, e.g., "0-14-7-*"
 * @param sched schedule-string from settings file
 * @returns true if it passes validity checks
 */
function isValidPaymentScheduleSyntax(sched: string): boolean {
  return cronParserCheckExpression(sched);
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
  let file = require("../../../config/referralSettings.json") as ReferralSettings;
  // some rudimentary checks
  if (file.permissionedAgencies.length > 0) {
    file.permissionedAgencies.map((a) => {
      if (!isValidAddress(a)) {
        logger.warn(`Invalid address in permissionedAgencies: ${a}`);
      }
    });
  }
  file.permissionedAgencies = file.permissionedAgencies.map((x) => x.toLocaleLowerCase());
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
  if (!isValidPaymentScheduleSyntax(file.paymentScheduleMinHourDayofmonthWeekday)) {
    throw Error(`referralSettings: invalid payment schedule ${file.paymentScheduleMinHourDayofmonthWeekday}`);
  }
  checkReferralCutPercent(file.referrerCutPercentForTokenXHolding);
  checkSettingMinBrokerFeeCCForRebatePerPool(file.minBrokerFeeCCForRebatePerPool);
  return file;
}

/**
 * Currently not used
 * @param l logger
 * @returns broker address
 */
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

function getBrokerAddressFromKey(key: string): string {
  const wallet = new ethers.Wallet(key);
  // Get the wallet address
  return wallet.address;
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

/**
 * Store referral cut settings in database, meaning:
 *  - how much percent of the broker fee earnings are re-distributed?
 *  - reads referralSettings.json and translates this into db
 *    - agencyCutPercent (first entry in db)
 *    - referrerCutPercentForTokenXHolding
 * Example:
 *  is_agency_cut | cut_perc |  holding_amount_dec_n   |  token_addr
 * ---------------+----------+-------------------------+----------------------
 *  t             |    80.00 |                       0 |
 *  f             |     0.20 |                       0 | 0x2d10075E54356E1...
 *  f             |     1.50 |   100000000000000000000 | 0x2d10075E54356E1...
 *  f             |     2.50 |  1000000000000000000000 | 0x2d10075E54356E1...
 *  f             |     3.50 | 10000000000000000000000 | 0x2d10075E54356E1...
 * @param dbReferralCuts db handle
 * @param settings  settings file with information for this table
 */
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
  dotenv.config();

  let settings;
  try {
    settings = loadSettings();
  } catch (error) {
    logger.error("Problems in referralSettings:" + error);
    return;
  }
  if (!settings.referralSystemEnabled) {
    logger.info("NO REFERRALS: Referral system disabled (settings)");
    return;
  }
  let key = "";
  if (process.env.BROKER_KEY != undefined && process.env.BROKER_KEY != "") {
    key = process.env.BROKER_KEY;
  }

  let brokerAddr = getBrokerAddressFromKey(key);
  if (brokerAddr == "" || brokerAddr == ZERO_ADDRESS) {
    logger.info("shutting down referrer system (no broker)");
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

  // Initialize db client
  const prisma = new PrismaClient();
  const dbReferralCode = new DBReferralCode(BigInt(chainId), prisma, brokerAddr, settings, logger);
  const dbReferralCuts = new ReferralCut(BigInt(chainId), prisma, logger);
  const dbTokenHoldings = new DBTokenHoldings(BigInt(chainId), prisma, logger);
  const referralCodeValidator = new ReferralCodeValidator(settings, dbReferralCode);
  const dbPayment = new DBPayments(BigInt(chainId), prisma, logger);

  await setDefaultReferralCode(dbReferralCode, settings);
  await setReferralCutSettings(dbReferralCuts, settings);
  let ta = new TokenAccountant(dbTokenHoldings, settings.tokenX.address, logger);
  ta.initProvider(rpcUrl);
  await ta.fetchBalancesFromChain();
  // start REST API server
  let api = new ReferralAPI(port, dbReferralCode, dbPayment, referralCodeValidator, ta, brokerAddr, logger);
  await api.initialize();
  // start payment manager
  logger.info("Starting Referral system");
  let payExecutor = new PayExecutorLocal(key, settings.multiPayContractAddr, rpcUrl, logger);
  let paymentManager = new ReferralPaymentManager(brokerAddr, dbPayment, settings, rpcUrl, payExecutor, logger);
  // starting (async)
  paymentManager.run();
}
start();
