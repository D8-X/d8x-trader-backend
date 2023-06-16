import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";

interface ReferralCodeData {
  brokerPayoutAddr: string;
  referrerAddr: string;
  agencyAddr: string;
  traderReferrerAgencyPerc: [number, number, number];
}

export default class ReferralCode {
  constructor(private chainId: bigint, private prisma: PrismaClient, private brokerAddr: string, private l: Logger) {}

  public async insert(codeName: string, rd: ReferralCodeData): Promise<boolean> {
    if (await this.codeExists(codeName)) {
      this.l.warn("cannot insert code, already exists", codeName);
      return false;
    }
    const cleanCodeName = this.washCode(codeName);

    for (let j = 0; j < 3; j++) {
      if (rd.traderReferrerAgencyPerc[j] < 0) {
        this.l.warn("percentage must>0, setting to 0");
        rd.traderReferrerAgencyPerc[j] = 0;
      }
    }
    if (rd.agencyAddr == "" && rd.traderReferrerAgencyPerc[2] > 0) {
      this.l.warn("no agency address provided but percentage>0, setting to 0");
      rd.traderReferrerAgencyPerc[2] = 0;
    }
    // ensure percentages add up to 100%
    let feeDistribution = this.adjustPercentages(rd.traderReferrerAgencyPerc);
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    await this.prisma.referralCode.create({
      data: {
        code: cleanCodeName,
        referrer_addr: rd.referrerAddr,
        broker_addr: this.brokerAddr,
        broker_payout_addr: rd.brokerPayoutAddr,
        trader_rebate_perc: feeDistribution.trader,
        referrer_rebate_perc: feeDistribution.referrer,
        agency_rebate_perc: feeDistribution.agency,
      },
    });
    this.l.info("inserted new margin token info", {
      codeName,
      rd,
    });
    return true;
  }

  public washCode(rawCode: string): string {
    return rawCode.replace(/[^a-z0-9\_-]/gi, "").toUpperCase();
  }

  public async codeExists(code: string): Promise<boolean> {
    let cleanCode = this.washCode(code);
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
    if (traPerc[0] + traPerc[1] + traPerc[2] > 100) {
      // scale down
      const oldCake = traPerc[0] + traPerc[1] + traPerc[2];
      traPerc[0] = (traPerc[0] / oldCake) * 100;
      traPerc[1] = (traPerc[1] / oldCake) * 100;
    }
    return {
      trader: traPerc[0],
      referrer: traPerc[1],
      agency: 100 - traPerc[0] - traPerc[1],
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
