import { Kysely } from "kysely";
import { Logger } from "winston";
import { Database, NewSettingCutTbl } from "./db_types";

interface ReferralCodeData {
  brokerPayoutAddr: string;
  referrerAddr: string;
  agencyAddr: string;
  traderReferrerAgencyPerc: [number, number, number];
}

export default class DBReferralCut {
  constructor(private dbHandler: Kysely<Database>, private l: Logger) {}

  private async _insert(
    isAgency: boolean,
    cutPercentageAndHolding: Array<[number, number]>,
    decimals: number,
    tokenAddr: string
  ): Promise<boolean> {
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    for (let k = 0; k < cutPercentageAndHolding.length; k++) {
      const amountHolding = BigInt(cutPercentageAndHolding[k][1]) * BigInt(10) ** BigInt(decimals);
      const cutPerc = cutPercentageAndHolding[k][0];
      const data: NewSettingCutTbl = {
        is_agency_cut: isAgency,
        cut_perc: cutPerc,
        holding_amount_dec_n: amountHolding,
        token_addr: tokenAddr,
      };
      await this.dbHandler.insertInto("referral_setting_cut").values(data).execute();
      this.l.info("inserted new referralSettingCut", {
        isAgency,
        cutPerc,
        amountHolding,
        tokenAddr,
      });
    }

    return true;
  }

  public async referralSettingExists(tokenAddr: string): Promise<boolean> {
    const exists = await this.dbHandler
      .selectFrom("referral_setting_cut")
      .where("token_addr", "=", tokenAddr)
      .execute();
    return exists.length > 0;
  }

  /**
   * Traders that don't have a referral code are treated according to
   * "default referral code"
   * @param brokerPayoutAddr address the broker is paid to
   * @param referrerAddr address of the default referrer
   * @param agencyAddr address of the default agency or ""
   * @param traderReferrerAgencyPerc 3-tuple of percentages
   */
  public async writeReferralCutsToDB(
    isAgency: boolean,
    cutPercentageAndHolding: Array<[number, number]>,
    decimals: number,
    tokenAddr: string
  ) {
    if (await this.referralSettingExists(tokenAddr)) {
      await this.dbHandler.deleteFrom("referral_setting_cut").where("token_addr", "=", tokenAddr).executeTakeFirst();
    }
    await this._insert(isAgency, cutPercentageAndHolding, decimals, tokenAddr);
  }
}
