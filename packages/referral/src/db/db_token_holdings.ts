import { Database, NewTokenHoldingsTbl, UpdateTokenHoldingsTbl } from "./db_types";
import { Kysely, sql } from "kysely";
import { Logger } from "winston";
import { TokenAccount, DBActiveReferrer, DBTokenAmount } from "../referralTypes";

export default class DBTokenHoldings {
  constructor(private dbHandler: Kysely<Database>, private l: Logger) {}

  private async _insert(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    const data: NewTokenHoldingsTbl = {
      referrer_addr: referrerAddr.toLowerCase(),
      holding_amount_dec_n: holdingAmountDecN,
      token_addr: tokenAddr.toLowerCase(),
    };
    const result = await this.dbHandler.insertInto("referral_token_holdings").values(data).executeTakeFirst();
    if (result.numInsertedOrUpdatedRows == undefined || result.numInsertedOrUpdatedRows == 0n) {
      throw Error("insert failed");
    }
  }

  private async _update(referrerAddr: string, holdingAmountDecN: bigint, tokenAddr: string) {
    const data: UpdateTokenHoldingsTbl = {
      holding_amount_dec_n: holdingAmountDecN,
      last_updated: new Date(),
    };
    const result = await this.dbHandler
      .updateTable("referral_token_holdings")
      .set(data)
      .where("referrer_addr", "=", referrerAddr.toLowerCase())
      .where("token_addr", "=", tokenAddr.toLowerCase())
      .executeTakeFirst();
    if (result.numUpdatedRows == 0n) {
      throw Error("insert failed");
    }
  }

  /**
   * does referral_token_holdings entry for referrer and token exist?
   * @param referrerAddr address of referrer
   * @param tokenAddr address of token
   * @returns true if there is an entry in referral_token_holdings
   */
  private async _exists(referrerAddr: string, tokenAddr: string): Promise<boolean> {
    interface Response {
      count: number;
    }
    const result = await sql<Response>`
        SELECT COUNT(*)
        FROM referral_token_holdings
        WHERE LOWER(referrer_addr)=${referrerAddr.toLowerCase()}
            AND LOWER(token_addr)=${tokenAddr.toLowerCase()}`.execute(this.dbHandler);
    return result.rows[0].count > 0;
  }

  /**
   *
   * @param referrerAddr address of referrer
   * @param tokenAddr address of requested token
   * @returns amount and lastUpdated date for token amount
   */
  public async queryTokenAmountForReferrer(referrerAddr: string, tokenAddr: string): Promise<DBTokenAmount> {
    const result = await this.dbHandler
      .selectFrom("referral_token_holdings")
      .select(["holding_amount_dec_n", "last_updated"])
      .where("referrer_addr", "~*", "^" + referrerAddr.toLowerCase())
      .where("token_addr", "~*", "^" + tokenAddr.toLowerCase())
      .executeTakeFirst();

    if (result == undefined) {
      return { amount: undefined, lastUpdated: undefined };
    }
    return { amount: BigInt(result.holding_amount_dec_n), lastUpdated: result.last_updated };
  }

  /**
   * Insert/update token holdings for addresses into DB
   * referrer_addr | holding_amount_dec_n | token_addr | last_updated
   * @param hld array of token amounts, and referrer's amount. Will be lowercased
   * @param tokenAddr address of token, will be lowercased
   */
  public async writeTokenHoldingsToDB(hld: Array<TokenAccount>, tokenAddr: string) {
    tokenAddr = tokenAddr.toLowerCase();
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
   *  last-update can be null
   */
  public async queryActiveReferrers(): Promise<Array<DBActiveReferrer>> {
    const response = await sql<DBActiveReferrer>`SELECT distinct rc.referrer_addr, th.last_updated 
        FROM referral_code rc
        LEFT JOIN referral_token_holdings th
            ON (th.referrer_addr)=lower(rc.referrer_addr) AND rc.agency_addr=''
        WHERE ${new Date()}::timestamp < expiry AND rc.referrer_addr!=''
        order by rc.referrer_addr`.execute(this.dbHandler);
    return response.rows;
  }

  /**
   * Queries how much rebate the referrer gets for the given token holding amount
   * @param holdingAmount token holding (decimal N)
   * @param tokenAddr address of the token
   * @returns percentage number, e.g. 1.2 for 1.2%
   */
  public async queryCutPercentForTokenHoldings(holdingAmount: bigint, tokenAddr: string): Promise<number> {
    let addr = tokenAddr.toLowerCase();
    interface Response {
      max_cut: number;
    }
    const response = await sql<Response>`
        SELECT MAX(cut_perc) as max_cut
        FROM referral_setting_cut
        WHERE LOWER(token_addr)=${addr}
         AND holding_amount_dec_n<${holdingAmount}
         AND is_agency_cut=false
        `.execute(this.dbHandler);
    if (response.rows.length == 0) {
      let msg = `could not determine cut percent for token ${tokenAddr} holding ${holdingAmount}`;
      this.l.error(msg);
      throw Error(msg);
    }
    return Number(response.rows[0].max_cut);
  }
}
