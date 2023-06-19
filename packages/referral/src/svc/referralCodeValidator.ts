import { ethers } from "ethers";
import { ReferralSettings, ReferralCodePayload } from "../referralTypes";
import DBReferralCode from "../db/db_referral_code";
const PERCENT_TOLERANCE = 0.0001;

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

  /**
   * Check payload:
   * - agency permissioned?
   * - checkPayloadLogic
   * - code already exists?
   * Throws errors
   * @param pyld payload
   */
  public async checkPayload(pyld: ReferralCodePayload) {
    if (pyld.agencyRebatePerc != 0 && !this.settings.permissionedAgencies.includes(pyld.agencyAddr)) {
      throw Error(`Agency address ${pyld.agencyAddr} not permissioned by broker`);
    }
    // throws:
    ReferralCodeValidator.checkPayloadLogic(pyld);
    if (pyld.code == undefined || pyld.code == "") {
      throw Error("No code");
    }
    if (await this.dbReferralCode.codeExists(pyld.code)) {
      const msg = `Code ${ReferralCodeValidator.washCode(pyld.code)} already exists`;
      throw Error(msg);
    }
  }

  public static checkPayloadLogic(pyld: ReferralCodePayload) {
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
    if (pyld.agencyAddr != "" && !ReferralCodeValidator.isValidAddress(pyld.agencyAddr)) {
      throw Error("Invalid agency address");
    }
    if (!ReferralCodeValidator.isValidAddress(pyld.referrerAddr)) {
      throw Error("Invalid referrer address");
    }
    if (pyld.createdOn < Date.now() / 1000 - 60 || pyld.createdOn > Date.now() + 60_000) {
      // timestamp can be seconds or milliseconds -> it serves as a nonce for
      // the signature
      throw Error("Invalid createdAt timestamp");
    }
  }

  private static isValidAddress(addr: string): boolean {
    return addr != "" && addr != ethers.constants.AddressZero && addr.length == 42 && addr.substring(0, 2) == "0x";
  }
}
