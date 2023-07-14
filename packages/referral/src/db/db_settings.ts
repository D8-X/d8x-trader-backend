import { Prisma, PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ReferralSettings } from "../referralTypes";

export default class DBSettings {
  constructor(private settings: ReferralSettings, public prisma: PrismaClient, public l: Logger) {}

  public async writeSettings(): Promise<boolean> {
    try {
      let lookback = this.settings.paymentMaxLookBackDays.toString();
      await this.prisma.referralSettings.upsert({
        where: {
          property: "paymentMaxLookBackDays",
        },
        update: {
          value: lookback,
        },
        create: {
          property: "paymentMaxLookBackDays",
          value: lookback,
        },
      });
      this.l.info("upsert settings");
    } catch (error) {
      this.l.error("DBSettings update/insert failed", error);
      return false;
    }
    return true;
  }
}
