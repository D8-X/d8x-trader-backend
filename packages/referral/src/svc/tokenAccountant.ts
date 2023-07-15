import { Contract, ethers } from "ethers";
import { Logger } from "winston";
import DBTokenHoldings from "../db/db_token_holdings";
import { TokenAccount, DBActiveReferrer, DBTokenAmount } from "../referralTypes";
import { sleep } from "utils";

// specify maximal time until we update the token balance again
const MAXIMAL_BALANCE_AGE_SEC = 7 * 86_400;

export default class TokenAccountant {
  private dbTokenHoldings: DBTokenHoldings;
  private tokenXAddr: string;
  private provider: ethers.providers.JsonRpcProvider | undefined;
  tknAbi = [
    // ... ERC-20 standard ABI ...
    // Include the "decimals" function
    "function balanceOf(address account) view returns (uint256)",
  ];

  constructor(th: DBTokenHoldings, tokenXAddr: string, private l: Logger) {
    this.dbTokenHoldings = th;
    this.tokenXAddr = tokenXAddr.toLowerCase();
  }

  public initProvider(rpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get token holdings of referrer from the database.
   * If not available query from onchain
   * @param referrerAddr address of the referrer
   * @returns token amount in token's decimal convention
   */
  private async getSetTokenAmountForReferrer(referrerAddr: string): Promise<bigint> {
    referrerAddr = referrerAddr.toLowerCase();
    let amountObj: DBTokenAmount = await this.dbTokenHoldings.queryTokenAmountForReferrer(
      referrerAddr,
      this.tokenXAddr
    );
    let expired =
      amountObj.lastUpdated == undefined || Date.now() - amountObj.lastUpdated?.getTime() > MAXIMAL_BALANCE_AGE_SEC;
    if (!expired) {
      return amountObj.amount!;
    }
    // need to query from onchain
    const contract = new Contract(this.tokenXAddr, this.tknAbi, this.provider);
    let amountDecN = BigInt((await contract.balanceOf(referrerAddr)).toString());
    // and store in db
    this.dbTokenHoldings.writeTokenHoldingsToDB(
      [{ referrerAddr: referrerAddr, tokenHoldings: amountDecN }],
      this.tokenXAddr
    );
    return amountDecN;
  }

  public async getCutPercentageForReferrer(referrerAddr: string): Promise<number> {
    let tokenAmount = await this.getSetTokenAmountForReferrer(referrerAddr);
    return this.dbTokenHoldings.queryCutPercentForTokenHoldings(tokenAmount, this.tokenXAddr);
  }
  public async getCutPercentageForAgency(): Promise<number> {
    return this.dbTokenHoldings.queryCutPercentForTokenHoldings(BigInt(0), "");
  }

  /**
   * Fetches balances of tokenX
   * - for all referrers that have a code which is not
   *   expired.
   * - fetch only if last update is older than MAXIMAL_BALANCE_AGE_SEC to save on RPC calls
   */
  public async fetchBalancesFromChain() {
    if (this.provider == undefined) {
      throw new Error("TokenAccountant: provider not defined");
    }
    const contract = new Contract(this.tokenXAddr, this.tknAbi, this.provider);
    let refs: DBActiveReferrer[] = await this.dbTokenHoldings.queryActiveReferrers();
    console.log("\n\nACTIVE REFERRERS", refs.length);
    console.log("\nREFERRERS=", refs);
    let accounts: TokenAccount[] = [];
    let now = Date.now();
    let waitTime = 1100;
    const maxWait = 60_000;
    for (let k = 0; k < refs.length; k++) {
      let amountDecN: bigint = 0n;
      console.log("referrer=", refs[k].referrer_addr);
      if (refs[k].last_updated == null || now - refs[k].last_updated!.getTime() > MAXIMAL_BALANCE_AGE_SEC) {
        // get amount
        try {
          amountDecN = BigInt((await contract.balanceOf(refs[k].referrer_addr)).toString());
          accounts.push({ referrerAddr: refs[k].referrer_addr, tokenHoldings: amountDecN });
        } catch (error) {
          if (waitTime > maxWait) {
            this.l.warn("fetchBalancesFromChain: RPC wait time exceeded, exiting");
            break;
          }
          this.l.warn("could not get token holding amount:", error);
          waitTime = waitTime * 2;
          await sleep(waitTime);
        }
      } else {
        const msg = `Token holding update not required yet for ${refs[k].referrer_addr}`;
        this.l.info(msg);
      }
      await sleep(1_100);
    }
    this.dbTokenHoldings.writeTokenHoldingsToDB(accounts, this.tokenXAddr);
  }
}
