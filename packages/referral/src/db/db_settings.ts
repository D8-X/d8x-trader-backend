import { Database } from "./db_types";
import { Kysely } from "kysely";
import { Logger } from "winston";
import { ReferralSettings } from "../referralTypes";

export default class DBSettings {
  constructor(private settings: ReferralSettings, public dbHandler: Kysely<Database>, public l: Logger) {}

  public async writeSettings(): Promise<boolean> {
    try {
      let lookback = this.settings.paymentMaxLookBackDays.toString();
      let dbLookback = await this.dbHandler
        .selectFrom("referral_settings")
        .select("value")
        .where("property", "=", "paymentMaxLookBackDays")
        .executeTakeFirst();
      console.log(dbLookback);
      if (dbLookback == undefined) {
        await this.dbHandler
          .insertInto("referral_settings")
          .values({ property: "paymentMaxLookBackDays", value: lookback })
          .executeTakeFirst();
      } else if (dbLookback.value != lookback) {
        await this.dbHandler
          .updateTable("referral_settings")
          .set({ value: lookback })
          .where("property", "=", "paymentMaxLookBackDays")
          .executeTakeFirst();
      }
      this.l.info("upsert settings");
    } catch (error) {
      this.l.error("DBSettings update/insert failed", error);
      return false;
    }
    return true;
  }
}
