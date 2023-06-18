import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import { ReferralCodePayload, ReferralSettings } from "../referralTypes";

interface ReferralCodeData {
  brokerPayoutAddr: string;
  referrerAddr: string;
  agencyAddr: string;
  traderReferrerAgencyPerc: [number, number, number];
}

export default class DBReferralCode {
  constructor(
    private chainId: bigint,
    private prisma: PrismaClient,
    private brokerAddr: string,
    private settings: ReferralSettings,
    private l: Logger
  ) {}

  public async insertFromPayload(payload: ReferralCodePayload) {
    const dbData: ReferralCodeData = {
      brokerPayoutAddr: this.settings.brokerPayoutAddr,
      referrerAddr: payload.referrerAddr,
      agencyAddr: payload.agencyAddr,
      traderReferrerAgencyPerc: [payload.traderRebatePerc, payload.referrerRebatePerc, payload.agencyRebatePerc],
    };
    await this.insert(payload.code, dbData);
  }

  /**
   * No checks on percentages correctness or other consistencies
   * @param codeName
   * @param rd
   */
  public async insert(codeName: string, rd: ReferralCodeData): Promise<void> {
    const cleanCodeName = ReferralCodeValidator.washCode(codeName);
    if (await this.codeExists(codeName)) {
      throw Error("cannot insert code, already exists" + cleanCodeName);
    }

    // ensure percentages add up to 100%
    let feeDistribution = this.adjustPercentages(rd.traderReferrerAgencyPerc);
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    await this.prisma.referralCode.create({
      data: {
        code: cleanCodeName,
        referrer_addr: rd.referrerAddr,
        agency_addr: rd.agencyAddr,
        broker_addr: this.brokerAddr,
        broker_payout_addr: rd.brokerPayoutAddr,
        trader_rebate_perc: feeDistribution.trader,
        referrer_rebate_perc: feeDistribution.referrer,
        agency_rebate_perc: feeDistribution.agency,
      },
    });
    this.l.info("inserted new referral code info", {
      codeName,
      rd,
    });
  }

  public async codeExists(code: string): Promise<boolean> {
    let cleanCode = ReferralCodeValidator.washCode(code);
    const exists = await this.prisma.referralCode.findFirst({
      where: {
        code: {
          equals: cleanCode,
        },
      },
    });
    return exists != null;
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
      return Math.round(traPerc[0] * 100) / 100;
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
    if (await this.codeExists(defaultCodeName)) {
      await this.prisma.referralCode.delete({
        where: {
          code: defaultCodeName,
        },
      });
      this.l.info("deleted DEFAULT code entry for replacement");
    }
    let rd: ReferralCodeData = {
      brokerPayoutAddr: brokerPayoutAddr,
      referrerAddr: referrerAddr,
      agencyAddr: agencyAddr,
      traderReferrerAgencyPerc: traderReferrerAgencyPerc,
    };
    await this.insert(defaultCodeName, rd);
    this.l.info("replaced default referral code data", {
      rd,
    });
  }
}
