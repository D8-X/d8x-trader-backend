import { Prisma, PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { TokenAccount, DBActiveReferrer, DBTokenAmount } from "../referralTypes";

// Make sure the decimal values are always return as normal numeric strings
// instead of scientific notation
Prisma.Decimal.prototype.toJSON = function () {
  return this.toFixed();
};

export default class DBTokenHoldings {
  constructor(private chainId: bigint, private prisma: PrismaClient, private l: Logger) {}

  private async _insert(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    await this.prisma.referralTokenHoldings.create({
      data: {
        referrer_addr: referrerAddr.toLowerCase(),
        holding_amount_dec_n: holdingAmountDecN.toString(),
        token_addr: tokenAddr.toLowerCase(),
      },
    });
    const inf = `inserted new referralTokenHoldings for ${referrerAddr} ${holdingAmountDecN.toString()}`;
    this.l.info(inf);
  }

  private async _update(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    await this.prisma.referralTokenHoldings.update({
      where: {
        referrer_addr_token_addr: {
          referrer_addr: referrerAddr.toLowerCase(),
          token_addr: tokenAddr.toLowerCase(),
        },
      },
      data: {
        holding_amount_dec_n: holdingAmountDecN.toString(),
        last_updated: new Date().toISOString(),
      },
    });
  }

  private async _exists(referrerAddr: string, tokenAddr: string): Promise<boolean> {
    const exists = await this.prisma.referralTokenHoldings.findFirst({
      where: {
        referrer_addr: {
          equals: referrerAddr,
          mode: "insensitive",
        },
        token_addr: {
          equals: tokenAddr,
          mode: "insensitive",
        },
      },
    });
    return exists != null;
  }

  public async queryTokenAmountForReferrer(referrerAddr: string, tokenAddr: string): Promise<DBTokenAmount> {
    const res = await this.prisma.referralTokenHoldings.findFirst({
      where: {
        referrer_addr: {
          equals: referrerAddr,
          mode: "insensitive",
        },
        token_addr: {
          equals: tokenAddr,
          mode: "insensitive",
        },
      },
      select: {
        holding_amount_dec_n: true,
        last_updated: true,
      },
    });
    if (res == null) {
      return { amount: undefined, lastUpdated: undefined };
    }
    return { amount: BigInt(res.holding_amount_dec_n.toJSON().toString()), lastUpdated: res.last_updated };
  }

  public async writeTokenHoldingsToDB(hld: Array<TokenAccount>, tokenAddr: string) {
    for (let k = 0; k < hld.length; k++) {
      if (await this._exists(hld[k].referrerAddr, tokenAddr)) {
        await this._update(hld[k].referrerAddr, hld[k].tokenHoldings, tokenAddr);
      } else {
        await this._insert(hld[k].referrerAddr, hld[k].tokenHoldings, tokenAddr);
      }
    }
  }

  /**
   * Query all referrer addresses with active referral codes and without
   * agency address (with agency token holdings do not matter)
   * @returns array of referrer addresses and date of last-update of token holdings
   */
  public async queryActiveReferrers(): Promise<Array<DBActiveReferrer>> {
    const ref = await this.prisma.$queryRaw<DBActiveReferrer[]>`
		    SELECT distinct rc.referrer_addr, th.last_updated 
            FROM referral_code rc
		    LEFT JOIN referral_token_holdings th
                ON (th.referrer_addr)=lower(rc.referrer_addr) AND rc.agency_addr=''
            WHERE ${new Date()}::timestamp < expiry AND rc.referrer_addr!=''
		    order by rc.referrer_addr
		`;
    //TODO" lower on th.referrer_addr
    return ref;
  }

  public async queryCutPercentForTokenHoldings(holdingAmount: bigint, tokenAddr: string): Promise<number> {
    let addr = tokenAddr.toLowerCase();
    let res = await this.prisma.referralSettingCut.aggregate({
      _max: {
        cut_perc: true,
      },
      where: {
        token_addr: {
          equals: addr,
          mode: "insensitive",
        },
      },
    });
    if (res == null) {
      let msg = `could not determine cut percent for token ${tokenAddr} holding ${holdingAmount}`;
      this.l.error(msg);
      throw Error(msg);
    }
    return Number(res._max.cut_perc);
  }
}
