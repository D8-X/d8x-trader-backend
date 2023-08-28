import Redis from "ioredis";
import { ethers } from "ethers";
import * as winston from "winston";
import { ReferralSettings, ReferralCodeData } from "./referralTypes";
import {
  constructRedis,
  sleep,
  isValidAddress,
  cronParserCheckExpression,
  chooseRandomRPC,
  loadConfigRPC,
  loadConfigReferralSettings,
} from "utils";
import dotenv from "dotenv";
import { APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import DBSettings from "./db/db_settings";
import DBReferralCode from "./db/db_referral_code";
import DBTokenHoldings from "./db/db_token_holdings";
import DBReferralCut from "./db/db_referral_cut";
import DBBrokerFeeAccumulator from "./db/db_brokerFeeAccumulator";
import DBPayments from "./db/db_payments";
import ReferralAPI from "./api/referral_api";

import TokenAccountant from "./svc/tokenAccountant";
import ReferralPaymentManager from "./svc/referralPaymentManager";
import ReferralCodeValidator from "./svc/referralCodeValidator";
import PayExecutorLocal from "./svc/payExecutorLocal";

import { createKyselyDBInstance } from "./db/database";
import { Database } from "./db/db_types";
import { Kysely } from "kysely";
import AbstractPayExecutor from "./svc/abstractPayExecutor";
import PayExecutorRemote from "./svc/payExecutorRemote";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const defaultLogger = () => {
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { service: "referral-service" },
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: "referral.log" })],
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
  let file = loadConfigReferralSettings() as ReferralSettings;
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

async function setDefaultReferralCode(dbReferralCodes: DBReferralCode, settings: ReferralSettings) {
  let s = settings.defaultReferralCode;
  await dbReferralCodes.writeDefaultReferralCodeToDB(
    settings.brokerPayoutAddr,
    s.referrerAddr,
    s.agencyAddr,
    s.traderReferrerAgencyPerc
  );
}

async function setDBSettings(
  settings: ReferralSettings,
  dbHandler: Kysely<Database>,
  logger: winston.Logger
): Promise<boolean> {
  const dbSettings = new DBSettings(settings, dbHandler, logger);
  return await dbSettings.writeSettings();
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
async function setReferralCutSettings(dbReferralCuts: DBReferralCut, settings: ReferralSettings) {
  await dbReferralCuts.writeReferralCutsToDB(true, [[settings.agencyCutPercent, 0]], 0, "");
  await dbReferralCuts.writeReferralCutsToDB(
    false,
    settings.referrerCutPercentForTokenXHolding,
    settings.tokenX.decimals,
    settings.tokenX.address
  );
}

/**
 * Tries to update margin token info from history-api. If not available sleeps and
 * retries for 10 times
 * @param dbBrokerFeeAccumulator object of type DBBrokerFeeAccumulator
 */
async function waitAndUpdateMarginTokenInfoFromAPI(dbBrokerFeeAccumulator: DBBrokerFeeAccumulator) {
  let isSuccess = false;
  let count = 0;
  while (!isSuccess) {
    try {
      await dbBrokerFeeAccumulator.updateMarginTokenInfoFromAPI(false);
      isSuccess = true;
    } catch (err) {
      console.log("Waiting for history API...");
      if (count == 10) {
        throw err;
      }
      await sleep(15_000);
    }
    count++;
  }
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
  } else {
    logger.info("Starting referral system");
  }
  let key = "";
  if (process.env.BROKER_KEY != undefined && process.env.BROKER_KEY != "") {
    key = process.env.BROKER_KEY;
  }
  if (key == "") {
    logger.info("No BROKER_KEY defined. Required for referral system. Existing.");
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
  let historyAPIEndpoint = process.env.HISTORY_API_ENDPOINT;
  if (historyAPIEndpoint == undefined) {
    logger.error("Set HISTORY_API_ENDPOINT");
    return;
  }
  historyAPIEndpoint = historyAPIEndpoint.replaceAll(`"`, "");
  const rpcConfig = loadConfigRPC();
  let rpcUrl = chooseRandomRPC(false, rpcConfig);
  if (rpcUrl == "") {
    logger.error("Set HTTP RPC in config/live.rpc.json");
    return;
  }

  // Initialize db client
  const dbHandler = await createKyselyDBInstance();
  const setOk = await setDBSettings(settings, dbHandler, logger);
  if (!setOk) {
    logger.error("setDBSettings failed");
    return;
  }

  let payExecutor: AbstractPayExecutor;
  let remoteBrokerAddr = process.env.REMOTE_BROKER_HTTP;
  if (remoteBrokerAddr != undefined && process.env.REMOTE_BROKER_HTTP != "") {
    logger.info("Creating remote payment executor");
    const myId = "1";
    payExecutor = new PayExecutorRemote(
      key,
      settings.multiPayContractAddr,
      rpcUrl,
      chainId,
      logger,
      remoteBrokerAddr,
      myId
    );
  } else {
    logger.info("Creating local payment executor");
    payExecutor = new PayExecutorLocal(key, settings.multiPayContractAddr, rpcUrl, logger);
  }
  const brokerAddr = await payExecutor.getBrokerAddress();

  const dbTokenHoldings = new DBTokenHoldings(dbHandler, logger);

  const dbReferralCode = new DBReferralCode(dbHandler, brokerAddr, settings, logger);
  await setDefaultReferralCode(dbReferralCode, settings);

  let ta = new TokenAccountant(dbTokenHoldings, settings.tokenX.address, logger);
  await ta.initProvider(rpcUrl);

  const dbReferralCuts = new DBReferralCut(dbHandler, logger);
  await setReferralCutSettings(dbReferralCuts, settings);

  const referralCodeValidator = new ReferralCodeValidator(settings, dbReferralCode);

  const dbBrokerFeeAccumulator = new DBBrokerFeeAccumulator(dbHandler, historyAPIEndpoint, brokerAddr, logger);
  await waitAndUpdateMarginTokenInfoFromAPI(dbBrokerFeeAccumulator);

  // populate broker-fee table
  await dbBrokerFeeAccumulator.updateBrokerFeesFromAPIAllPools(
    Math.round(Date.now() / 1000 - settings.paymentMaxLookBackDays * 86400)
  );
  const dbPayment = new DBPayments(dbBrokerFeeAccumulator, dbHandler, settings.paymentMaxLookBackDays, logger);

  // fetch token balances for referral rebates
  await ta.fetchBalancesFromChain();
  // start REST API server
  let api = new ReferralAPI(port, dbReferralCode, dbPayment, referralCodeValidator, ta, brokerAddr, logger);
  await api.initialize();

  // start payment manager
  logger.info("Starting Referral system");
  let paymentManager = new ReferralPaymentManager(brokerAddr, dbPayment, settings, rpcUrl, payExecutor, logger);
  // starting (async)
  paymentManager.run();
}
start();
