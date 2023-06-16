import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { TokenAccount } from "../referralTypes";

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
        last_updated: Date(),
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
   * Query all referrer addresses with active referral codes
   * @returns array of referrer addresses
   */
  public async queryActiveReferrers(): Promise<string[]> {
    const ref = await this.prisma.$queryRaw<string[]>`
		    select distinct referrer_addr from referral_code
		    where expiry > ${Date()} AND referrer_addr!=NULL
		    order by referrer_addr
		`;
    return ref;
  }
}
