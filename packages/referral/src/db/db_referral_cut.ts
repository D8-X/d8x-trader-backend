import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";

interface ReferralCodeData {
  brokerPayoutAddr: string;
  referrerAddr: string;
  agencyAddr: string;
  traderReferrerAgencyPerc: [number, number, number];
}

export default class ReferralCut {
  constructor(private chainId: bigint, private prisma: PrismaClient, private l: Logger) {}

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
      await this.prisma.referralSettingCut.create({
        data: {
          is_agency_cut: isAgency,
          cut_perc: cutPerc,
          holding_amount_dec_n: amountHolding.toString(),
          token_addr: tokenAddr,
        },
      });
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
    const exists = await this.prisma.referralSettingCut.findFirst({
      where: {
        token_addr: {
          equals: tokenAddr,
        },
      },
    });
    return exists != null;
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
      await this.prisma.referralSettingCut.deleteMany({
        where: {
          token_addr: tokenAddr,
        },
      });
    }
    await this._insert(isAgency, cutPercentageAndHolding, decimals, tokenAddr);
  }
}
