import { ethers } from "ethers";
import { ReferralSettings } from "../referralTypes";
import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import { isValidAddress } from "utils";
import DBReferralCode from "../db/db_referral_code";
const PERCENT_TOLERANCE = 0.0001;

/**
 * This class validates new referral codes to decide
 * whether they can be stored in the database
 */
export default class ReferralCodeValidator {
  constructor(private settings: ReferralSettings, private dbReferralCode: DBReferralCode) {}

  /**
   * Removes non-letters/numbers from string (except - and _)
   * and sets the string to uppercase
   * @param rawCode code received
   * @returns filtered code
   */
  public static washCode(rawCode: string): string {
    return rawCode.replace(/[^a-z0-9\_-]/gi, "").toUpperCase();
  }

  public async checkSelectCodePayload(pyld: APIReferralCodeSelectionPayload) {
    if (!isValidAddress(pyld.traderAddr)) {
      throw Error(`TraderAddr ${pyld.traderAddr} not valid`);
    }
    if (pyld.code == undefined || pyld.code == "") {
      throw Error("No code");
    }
    if (pyld.createdOn < Date.now() / 1000 - 86400 * 50 || pyld.createdOn > Date.now() + 60_000) {
      // timestamp can be seconds or milliseconds -> it serves as a nonce for
      // the signature
      throw Error("Invalid createdAt timestamp");
    }
    if (!(await this.dbReferralCode.codeExists(pyld.code))) {
      const msg = `Code ${ReferralCodeValidator.washCode(pyld.code)} unknown`;
      throw Error(msg);
    }
  }

  /**
   * Check payload:
   * - agency permissioned?
   * - checkPayloadLogic
   * - code already exists?
   * Throws errors
   * @param pyld payload
   */
  public async checkNewCodePayload(pyld: APIReferralCodePayload) {
    // throws:
    if (pyld.agencyRebatePerc != 0 && !this.isPermissionedAgency(pyld.agencyAddr)) {
      throw Error(`Agency address ${pyld.agencyAddr} not permissioned by broker`);
    }
    ReferralCodeValidator.checkNewCodePayloadLogic(pyld);
    if (pyld.code == undefined || pyld.code == "") {
      throw Error("No code");
    }
    if (await this.dbReferralCode.codeExists(pyld.code)) {
      const msg = `Code ${ReferralCodeValidator.washCode(pyld.code)} already exists`;
      throw Error(msg);
    }
  }

  public isPermissionedAgency(addr: string): boolean {
    // pre-condition: load settings transforms all permissionedAgencies-addresses to lowercase
    return this.settings.permissionedAgencies.includes(addr.toLowerCase());
  }

  public static checkNewCodePayloadLogic(pyld: APIReferralCodePayload) {
    if (Math.min(pyld.referrerRebatePerc, pyld.referrerRebatePerc, pyld.traderRebatePerc) < 0) {
      throw Error("Percentages must be positive");
    }
    const sum = pyld.referrerRebatePerc + pyld.agencyRebatePerc + pyld.traderRebatePerc;
    if (Math.abs(100 - sum) > PERCENT_TOLERANCE) {
      throw Error(`Rebate percentages add up to ${sum} but should be 100`);
    }
    if (pyld.agencyAddr == "" && pyld.agencyRebatePerc != 0) {
      throw Error("No agency address set but agency rebate");
    }
    if (pyld.agencyAddr != "" && !isValidAddress(pyld.agencyAddr)) {
      throw Error("Invalid agency address");
    }
    if (!isValidAddress(pyld.referrerAddr)) {
      throw Error("Invalid referrer address");
    }
    if (pyld.createdOn < Date.now() / 1000 - 86400 * 50 || pyld.createdOn > Date.now() + 60_000) {
      // timestamp can be seconds or milliseconds -> it serves as a nonce for
      // the signature
      throw Error("Invalid createdAt timestamp");
    }
  }
}
