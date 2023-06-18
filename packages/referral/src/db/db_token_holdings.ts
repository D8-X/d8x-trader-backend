import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { TokenAccount, DBActiveReferrer } from "../referralTypes";

export default class TokenHoldings {
  constructor(private chainId: bigint, private prisma: PrismaClient, private l: Logger) {}

  private async _insert(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    await this.prisma.referralTokenHoldings.create({
      data: {
        referrer_addr: referrerAddr,
        holding_amount_dec_n: holdingAmountDecN.toString(),
        token_addr: tokenAddr,
      },
    });
    const inf = `inserted new referralTokenHoldings for ${referrerAddr} ${holdingAmountDecN.toString()}`;
    this.l.info(inf);
  }

  private async _update(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    await this.prisma.referralTokenHoldings.update({
      where: {
        referrer_addr: referrerAddr,
      },
      data: {
        holding_amount_dec_n: holdingAmountDecN.toString(),
        token_addr: tokenAddr,
        last_updated: new Date().toISOString(),
      },
    });
  }

  private async _exists(referrerAddr: string): Promise<boolean> {
    const exists = await this.prisma.referralTokenHoldings.findFirst({
      where: {
        referrer_addr: {
          equals: referrerAddr,
        },
      },
    });
    return exists != null;
  }

  public async writeTokenHoldingsToDB(hld: Array<TokenAccount>, tokenAddr: string) {
    for (let k = 0; k < hld.length; k++) {
      if (await this._exists(hld[k].referrerAddr)) {
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
                ON th.referrer_addr=rc.referrer_addr AND rc.agency_addr=''
            WHERE ${new Date()}::timestamp < expiry AND rc.referrer_addr!=''
		    order by rc.referrer_addr
		`;
    return ref;
  }
}
