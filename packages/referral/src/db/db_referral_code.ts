import { PrismaClient, ReferralCodeUsage } from "@prisma/client";
import { Logger } from "winston";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import {
  APIReferralCodePayload,
  ReferralSettings,
  APIReferralCodeRecord,
  APITraderCode,
  APIReferralCodeSelectionPayload,
} from "../referralTypes";

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

  public async insertNewCodeFromPayload(payload: APIReferralCodePayload) {
    const dbData: ReferralCodeData = {
      brokerPayoutAddr: this.settings.brokerPayoutAddr,
      referrerAddr: payload.referrerAddr,
      agencyAddr: payload.agencyAddr,
      traderReferrerAgencyPerc: [payload.traderRebatePerc, payload.referrerRebatePerc, payload.agencyRebatePerc],
    };
    await this.insert(payload.code, dbData);
  }

  public async insertCodeSelectionFromPayload(payload: APIReferralCodeSelectionPayload) {
    try {
      await this.prisma.referralCodeUsage.upsert({
        where: {
          trader_addr: payload.traderAddr.toLowerCase(),
        },
        update: {
          code: payload.code,
        },
        create: {
          trader_addr: payload.traderAddr.toLowerCase(),
          code: payload.code,
        },
      });
      this.l.info("upsert code selection info", {
        payload,
      });
    } catch (error) {
      this.l.warn("Error when inserting referralCodeUsage", error);
      throw Error("Could not select code in database");
    }
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

  public async queryTraderCode(addr: string): Promise<APITraderCode> {
    const res = await this.prisma.referralCodeUsage.findFirst({
      where: {
        trader_addr: {
          equals: addr,
          mode: "insensitive",
        },
      },
      select: {
        code: true,
        timestamp: true,
      },
    });
    if (res == null) {
      return { code: "", activeSince: undefined };
    }
    return { code: res.code, activeSince: res.timestamp };
  }

  public async queryAgencyCodes(addr: string): Promise<APIReferralCodeRecord[]> {
    const res = await this.prisma.referralCode.findMany({
      where: {
        agency_addr: {
          equals: addr,
          mode: "insensitive", //ensure no uppercase/lowercase problem
        },
      },
      select: {
        code: true,
        referrer_addr: true,
        agency_addr: true,
        broker_addr: true,
        trader_rebate_perc: true,
        agency_rebate_perc: true,
        referrer_rebate_perc: true,
        created_on: true,
        expiry: true,
      },
    });
    let codes: APIReferralCodeRecord[] = this._formatReferralCodes(res);
    return codes;
  }

  public async queryReferrerCodes(addr: string): Promise<APIReferralCodeRecord[]> {
    const res = await this.prisma.referralCode.findMany({
      where: {
        referrer_addr: {
          equals: addr,
          mode: "insensitive",
        },
      },
      select: {
        code: true,
        referrer_addr: true,
        agency_addr: true,
        broker_addr: true,
        trader_rebate_perc: true,
        agency_rebate_perc: true,
        referrer_rebate_perc: true,
        created_on: true,
        expiry: true,
      },
    });
    let codes: APIReferralCodeRecord[] = this._formatReferralCodes(res);
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
