import {
  Database,
  ReferralCodeTable,
  ReferralCodeTbl,
  NewReferralCodeTbl,
  UpdateReferralCodeTbl,
  ReferralCodeUsageTbl,
  UpdateReferralCodeUsageTbl,
  NewReferralCodeUsageTbl,
} from "./db_types";
import { Kysely, sql, Insertable, Selectable, Updateable } from "kysely";
import { ReferralCodeData } from "../referralTypes";
import { Logger } from "winston";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import { ReferralSettings, APIReferralCodeRecord, APITraderCode } from "../referralTypes";
import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import { sleep, adjustNDigitPercentagesTo100 } from "utils";
import TokenAccountant from "../svc/tokenAccountant";

export default class DBReferralCode {
  private codeUsgMUTEX = new Map<string, boolean>(); //mutex per trader address
  constructor(
    private dbHandler: Kysely<Database>,
    private brokerAddr: string,
    private settings: ReferralSettings,
    private l: Logger
  ) {}

  public async codeExistsReferrerAndAgency(
    code: string
  ): Promise<{ exists: boolean; referrer: string; agency: string }> {
    let cleanCode = ReferralCodeValidator.washCode(code);
    interface Response {
      referrer_addr: string;
      agency_addr: string;
    }
    const exists = await sql<Response>`
        SELECT referrer_addr, agency_addr
        FROM referral_code
        where code=${cleanCode}`.execute(this.dbHandler);
    if (exists.rows.length > 0) {
      return { exists: true, referrer: exists.rows[0].referrer_addr, agency: exists.rows[0].agency_addr || "" };
    } else {
      return { exists: false, referrer: "", agency: "" };
    }
  }

  /**
   * No checks on percentages correctness or other consistencies
   * @param codeName name of the code to be inserted (will be 'washed')
   * @param rd  referral code metadata
   */
  public async insert(codeName: string, rd: ReferralCodeData): Promise<void> {
    const cleanCodeName = ReferralCodeValidator.washCode(codeName);
    let r = await this.codeExistsReferrerAndAgency(codeName);
    if (r.exists) {
      throw Error("cannot insert code, already exists" + cleanCodeName);
    }
    const input: NewReferralCodeTbl = {
      code: cleanCodeName,
      referrer_addr: rd.referrerAddr.toLowerCase(),
      agency_addr: rd.agencyAddr.toLowerCase(),
      broker_addr: this.brokerAddr.toLowerCase(),
      broker_payout_addr: rd.brokerPayoutAddr.toLowerCase(),
      trader_rebate_perc: rd.traderReferrerAgencyPerc[0],
      referrer_rebate_perc: rd.traderReferrerAgencyPerc[1],
      agency_rebate_perc: rd.traderReferrerAgencyPerc[2],
    };
    await this.dbHandler.insertInto("referral_code").values(input).executeTakeFirst();
    this.l.info("inserted new referral code info", {
      codeName,
      rd,
    });
  }

  /**
   * No checks on percentages correctness or other consistencies
   * @param codeName code name (will be 'washed')
   * @param rd ReferralCodeData with updated fields
   */
  public async update(codeName: string, rd: ReferralCodeData): Promise<void> {
    const cleanCodeName = ReferralCodeValidator.washCode(codeName);
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    let input: UpdateReferralCodeTbl = {
      referrer_addr: rd.referrerAddr.toLowerCase(),
      agency_addr: rd.agencyAddr.toLowerCase(),
      broker_addr: this.brokerAddr.toLowerCase(),
      broker_payout_addr: rd.brokerPayoutAddr.toLowerCase(),
      trader_rebate_perc: rd.traderReferrerAgencyPerc[0],
      referrer_rebate_perc: rd.traderReferrerAgencyPerc[1],
      agency_rebate_perc: rd.traderReferrerAgencyPerc[2],
    };
    await this.dbHandler.updateTable("referral_code").set(input).where("code", "=", cleanCodeName).executeTakeFirst();
    this.l.info("updated referral code info", {
      codeName,
      rd,
    });
  }

  public async insertNewCodeFromPayload(payload: APIReferralCodePayload) {
    let perc: number[] = adjustNDigitPercentagesTo100(
      [payload.traderRebatePerc, payload.referrerRebatePerc, payload.agencyRebatePerc],
      2
    );
    const dbData: ReferralCodeData = {
      brokerPayoutAddr: this.settings.brokerPayoutAddr,
      referrerAddr: payload.referrerAddr,
      agencyAddr: payload.agencyAddr,
      traderReferrerAgencyPerc: [perc[0], perc[1], perc[2]],
    };
    await this.insert(payload.code, dbData);
  }

  public async updateCodeFromPayload(payload: APIReferralCodePayload) {
    let perc: number[] = adjustNDigitPercentagesTo100(
      [payload.traderRebatePerc, payload.referrerRebatePerc, payload.agencyRebatePerc],
      2
    );
    const dbData: ReferralCodeData = {
      brokerPayoutAddr: this.settings.brokerPayoutAddr,
      referrerAddr: payload.referrerAddr,
      agencyAddr: payload.agencyAddr,
      traderReferrerAgencyPerc: [perc[0], perc[1], perc[2]],
    };
    await this.update(payload.code, dbData);
  }

  /**
   * Select a new code as a trader
   *
   * Uses a mutex per trader to avoid dirty read/writes when first updating the valid until
   * code and then inserting a new code
   * @param payload see APIReferralCodeSelectionPayload
   * @returns void
   */
  public async insertCodeSelectionFromPayload(payload: APIReferralCodeSelectionPayload) {
    const traderAddr = payload.traderAddr.toLowerCase();
    try {
      while (this.codeUsgMUTEX.has(traderAddr)) {
        await sleep(1000);
      }
      this.codeUsgMUTEX.set(traderAddr, true);
      // first reset valid until for code
      const latestCode = await sql<ReferralCodeUsageTbl>`
        SELECT trader_addr, code,
        valid_from, valid_to
        FROM referral_code_usage
        WHERE LOWER(trader_addr)=${traderAddr}
        ORDER BY valid_to DESC
        LIMIT 1`.execute(this.dbHandler);
      // if we found a code usage and it's not the same code we update the existing code's valid until
      if (latestCode.rows.length > 0) {
        if (latestCode.rows[0].code == payload.code) {
          // trader already has that code, so we leave
          this.l.info(`Tried to select same code ${payload.code} again`);
          return;
        }
        // update valid to of old code
        let noRowsUpdated = await sql<UpdateReferralCodeUsageTbl>`
            UPDATE referral_code_usage
            SET valid_to=${new Date(Date.now())}
            WHERE LOWER(trader_addr)=${traderAddr}
                AND code=${latestCode.rows[0].code}
                AND valid_to=${latestCode.rows[0].valid_to}
            `.execute(this.dbHandler);
        if (noRowsUpdated.numAffectedRows == 0n) {
          throw Error("no rows updated");
        }
      }
      // now insert new code
      let noRowsUpdated = await sql<NewReferralCodeUsageTbl>`
        INSERT INTO referral_code_usage (trader_addr, code)
        VALUES (${traderAddr}, ${payload.code})`.execute(this.dbHandler);
      if (noRowsUpdated.numAffectedRows == 0n) {
        throw Error("no rows updated");
      }
      this.l.info(`inserted new code selection for ${traderAddr} info`, {
        payload,
      });
    } catch (error) {
      this.l.warn("Error when inserting referralCodeUsage", error);
      throw Error("Could not select code in database");
    } finally {
      this.codeUsgMUTEX.delete(traderAddr);
    }
  }

  public async queryTraderCode(addr: string, tokenAccountant: TokenAccountant): Promise<APITraderCode> {
    const dateNow = new Date().toISOString();
    interface SQLRes {
      code: string;
      trader_rebate_perc: number;
      referrer_addr: string;
      agency_addr: string;
      valid_from: Date;
    }
    const res = await sql<SQLRes>`
        SELECT rcu.code as code, rc.trader_rebate_perc, rc.referrer_addr, rc.agency_addr, rcu.valid_from as valid_from
        FROM referral_code_usage rcu
        JOIN referral_code rc
        ON rc.code = rcu.code
        WHERE rcu.valid_to > ${dateNow}::timestamp
            AND rcu.valid_from < ${dateNow}::timestamp
            AND LOWER(rcu.trader_addr) = ${addr.toLowerCase()}`.execute(this.dbHandler);
    if (res.rows.length == 0) {
      return { code: "", traderRebatePercFinal: 0, activeSince: undefined };
    }
    res.rows[0].trader_rebate_perc = Number(res.rows[0].trader_rebate_perc);
    let traderRebatePerc;
    if (res.rows[0].agency_addr != "") {
      let agencyCut = await tokenAccountant.getCutPercentageForAgency();
      traderRebatePerc = (agencyCut * res.rows[0].trader_rebate_perc) / 100;
    } else {
      let referrerCut = await tokenAccountant.getCutPercentageForReferrer(res.rows[0].referrer_addr);
      traderRebatePerc = (referrerCut * res.rows[0].trader_rebate_perc) / 100;
    }
    return { code: res.rows[0].code, traderRebatePercFinal: traderRebatePerc, activeSince: res.rows[0].valid_from };
  }

  /**
   * Query the db entry for the given code to get
   * the ReferralCodeTbl metadata for this code
   * @param addr code (must be exact)
   * @returns metadata for given code
   */
  public async queryCode(code: string): Promise<APIReferralCodeRecord> {
    const res = await sql<ReferralCodeTbl>`
      SELECT
        code,
        referrer_addr,
        agency_addr,
        broker_addr,
        trader_rebate_perc,
        agency_rebate_perc,
        referrer_rebate_perc,
        created_on,
        expiry
      FROM referral_code
      WHERE code=${code}
      LIMIT 1`.execute(this.dbHandler);
    let codes: APIReferralCodeRecord[] = this._formatReferralCodes(res.rows);
    return codes[0];
  }

  /**
   * Query codes for a given agency address
   * @param addr address of the agency (will be lowercased)
   * @returns formated response array
   */
  public async queryAgencyCodes(addr: string): Promise<APIReferralCodeRecord[]> {
    const res = await sql<ReferralCodeTbl>`
      SELECT
        code,
        referrer_addr,
        agency_addr,
        broker_addr,
        trader_rebate_perc,
        agency_rebate_perc,
        referrer_rebate_perc,
        created_on,
        expiry
      FROM referral_code
      WHERE LOWER(agency_addr)=${addr.toLowerCase()}`.execute(this.dbHandler);
    let codes: APIReferralCodeRecord[] = this._formatReferralCodes(res.rows);
    return codes;
  }

  /**
   * Query codes for a given referrer address
   * @param addr address of the referrer (will be lowercased)
   * @returns formated response array
   */
  public async queryReferrerCodes(addr: string): Promise<APIReferralCodeRecord[]> {
    const res = await sql<ReferralCodeTbl>`
      SELECT
        code,
        referrer_addr,
        agency_addr,
        broker_addr,
        trader_rebate_perc,
        agency_rebate_perc,
        referrer_rebate_perc,
        created_on,
        expiry
      FROM referral_code
      WHERE LOWER(referrer_addr)=${addr.toLowerCase()}`.execute(this.dbHandler);
    let codes: APIReferralCodeRecord[] = this._formatReferralCodes(res.rows);
    return codes;
  }

  private _formatReferralCodes(res: any[]): APIReferralCodeRecord[] {
    let codes: APIReferralCodeRecord[] = [];
    if (res == null) {
      return codes;
    }
    for (let k = 0; k < res.length; k++) {
      codes.push({
        code: res[k].code,
        referrerAddr: res[k].referrer_addr,
        agencyAddr: res[k].agency_addr ?? "",
        brokerAddr: res[k].broker_addr,
        traderRebatePerc: Number(res[k].trader_rebate_perc),
        agencyRebatePerc: Number(res[k].agency_rebate_perc),
        referrerRebatePerc: Number(res[k].referrer_rebate_perc),
        createdOn: res[k].created_on,
        expiry: res[k].expiry,
      });
    }
    return codes;
  }

  /**
   * Ensures percentages add up to 100%. Will scale down accordingly
   * @param traPerc trader, referrer, agency percentages in this order (e.g. 10=10%)
   * @returns all percentage shares
   */
  public adjustPercentages(traPerc: [number, number, number]): {
    trader: number;
    referrer: number;
    agency: number;
  } {
    function twoDig(x: number): number {
      return Math.round(x * 100) / 100;
    }
    let v0 = twoDig(traPerc[0]);
    let v1 = twoDig(traPerc[1]);
    let v2 = Math.max(0, 100 - v0 - v1);
    // convert to string
    return {
      trader: v0,
      referrer: v1,
      agency: v2,
    };
  }

  /**
   * Traders that don't have a referral code are treated according to
   * "default referral code"
   * @param brokerPayoutAddr address the broker is paid to
   * @param referrerAddr address of the default referrer
   * @param agencyAddr address of the default agency or ""
   * @param traderReferrerAgencyPerc 3-tuple of percentages
   */
  public async writeDefaultReferralCodeToDB(
    brokerPayoutAddr: string,
    referrerAddr: string,
    agencyAddr: string,
    traderReferrerAgencyPerc: [number, number, number]
  ) {
    const defaultCodeName = "DEFAULT";
    let exists = (await this.codeExistsReferrerAndAgency(defaultCodeName)).exists;
    let rd: ReferralCodeData = {
      brokerPayoutAddr: brokerPayoutAddr,
      referrerAddr: referrerAddr,
      agencyAddr: agencyAddr,
      traderReferrerAgencyPerc: traderReferrerAgencyPerc,
    };
    if (exists) {
      await this.update("DEFAULT", rd);
      this.l.info("updated DEFAULT code entry");
    } else {
      await this.insert(defaultCodeName, rd);
      this.l.info("replaced default referral code data");
    }
  }
}
