import { PrismaClient, ReferralCodeUsage } from "@prisma/client";
import { Logger } from "winston";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import { ReferralSettings, APIReferralCodeRecord, APITraderCode } from "../referralTypes";
import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import { sleep } from "utils";

interface ReferralCodeData {
  brokerPayoutAddr: string;
  referrerAddr: string;
  agencyAddr: string;
  traderReferrerAgencyPerc: [number, number, number];
}

export default class DBReferralCode {
  private codeUsgMUTEX = new Map<string, boolean>(); //mutex per trader address
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

  public async updateCodeFromPayload(payload: APIReferralCodePayload) {
    const dbData: ReferralCodeData = {
      brokerPayoutAddr: this.settings.brokerPayoutAddr,
      referrerAddr: payload.referrerAddr,
      agencyAddr: payload.agencyAddr,
      traderReferrerAgencyPerc: [payload.traderRebatePerc, payload.referrerRebatePerc, payload.agencyRebatePerc],
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
      let latestCode = await this.prisma.referralCodeUsage.findMany({
        where: {
          trader_addr: traderAddr,
        },
        orderBy: {
          valid_to: "desc",
        },
        take: 1,
      });

      // if we found a code usage and it's not the same code we update the existing code's valid until
      if (latestCode.length > 0) {
        if (latestCode[0].code == payload.code) {
          this.l.info(`Tried to select same code ${payload.code} again`);
          return;
        }
        await this.prisma.referralCodeUsage.update({
          where: {
            trader_addr_valid_from: {
              trader_addr: latestCode[0].trader_addr,
              valid_from: latestCode[0].valid_from.toISOString(),
            },
          },
          data: {
            valid_to: new Date(Date.now()).toISOString(),
          },
        });
        this.l.info(`invalidated old code ${latestCode[0].code} selection for ${traderAddr}`);
      }

      // now insert new code
      await this.prisma.referralCodeUsage.create({
        data: {
          trader_addr: traderAddr,
          code: payload.code,
        },
      });
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

  /**
   * No checks on percentages correctness or other consistencies
   * @param codeName
   * @param rd
   */
  public async update(codeName: string, rd: ReferralCodeData): Promise<void> {
    const cleanCodeName = ReferralCodeValidator.washCode(codeName);
    // ensure percentages add up to 100%
    let feeDistribution = this.adjustPercentages(rd.traderReferrerAgencyPerc);
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    await this.prisma.referralCode.update({
      where: {
        code: cleanCodeName,
      },
      data: {
        referrer_addr: rd.referrerAddr.toLowerCase(),
        agency_addr: rd.agencyAddr.toLowerCase(),
        broker_addr: this.brokerAddr.toLowerCase(),
        broker_payout_addr: rd.brokerPayoutAddr.toLowerCase(),
        trader_rebate_perc: feeDistribution.trader,
        referrer_rebate_perc: feeDistribution.referrer,
        agency_rebate_perc: feeDistribution.agency,
      },
    });
    this.l.info("updated referral code info", {
      codeName,
      rd,
    });
  }

  /**
   * No checks on percentages correctness or other consistencies
   * @param codeName
   * @param rd
   */
  public async insert(codeName: string, rd: ReferralCodeData): Promise<void> {
    const cleanCodeName = ReferralCodeValidator.washCode(codeName);
    let r = await this.codeExistsReferrerAndAgency(codeName);
    if (r.exists) {
      throw Error("cannot insert code, already exists" + cleanCodeName);
    }

    // ensure percentages add up to 100%
    let feeDistribution = this.adjustPercentages(rd.traderReferrerAgencyPerc);
    //INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
    await this.prisma.referralCode.create({
      data: {
        code: cleanCodeName,
        referrer_addr: rd.referrerAddr.toLowerCase(),
        agency_addr: rd.agencyAddr.toLowerCase(),
        broker_addr: this.brokerAddr.toLowerCase(),
        broker_payout_addr: rd.brokerPayoutAddr.toLowerCase(),
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

  public async codeExistsReferrerAndAgency(
    code: string
  ): Promise<{ exists: boolean; referrer: string; agency: string }> {
    let cleanCode = ReferralCodeValidator.washCode(code);
    const exists = await this.prisma.referralCode.findFirst({
      where: {
        code: {
          equals: cleanCode,
        },
      },
    });
    if (exists != null) {
      return { exists: true, referrer: exists.referrer_addr, agency: exists.agency_addr || "" };
    } else {
      return { exists: false, referrer: "", agency: "" };
    }
  }

  public async queryTraderCode(addr: string): Promise<APITraderCode> {
    const res = await this.prisma.referralCodeUsage.findFirst({
      where: {
        trader_addr: {
          equals: addr,
          mode: "insensitive",
        },
        valid_from: {
          gte: new Date().toISOString(),
        },
      },
      select: {
        code: true,
        valid_from: true,
      },
    });
    if (res == null) {
      return { code: "", activeSince: undefined };
    }
    return { code: res.code, activeSince: res.valid_from };
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
    let exists = (await this.codeExistsReferrerAndAgency(defaultCodeName)).exists;
    if (exists) {
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
