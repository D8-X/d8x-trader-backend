import { Contract, ethers } from "ethers";
import { Logger } from "winston";
import TokenHoldings from "../db/token_holdings";
import { TokenAccount, DBActiveReferrer } from "../referralTypes";

// specify maximal time until we update the token balance again
const MAXIMAL_BALANCE_AGE_SEC = 7 * 86_400;
export default class TokenAccountant {
  private th: TokenHoldings;
  private tokenXAddr: string;
  private provider: ethers.providers.JsonRpcProvider | undefined;
  tknAbi = [
    // ... ERC-20 standard ABI ...
    // Include the "decimals" function
    "function balanceOf(address account) view returns (uint256)",
  ];

  constructor(th: TokenHoldings, tokenXAddr: string, private l: Logger) {
    this.th = th;
    this.tokenXAddr = tokenXAddr;
  }

  public initProvider(rpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
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
    let refs: DBActiveReferrer[] = await this.th.queryActiveReferrers();
    console.log("\n\nACTIVE REFERRERS", refs.length);
    console.log("\nREFERRERS=", refs);
    let accounts: TokenAccount[] = [];
    let now = Date.now();
    for (let k = 0; k < refs.length; k++) {
      let amountDecN: bigint = 0n;
      console.log("referrer=", refs[k].referrer_addr);
      if (refs[k].last_updated == null || now - refs[k].last_updated!.getTime() > MAXIMAL_BALANCE_AGE_SEC) {
        // get amount
        try {
          amountDecN = BigInt((await contract.balanceOf(refs[k].referrer_addr)).toString());
          accounts.push({ referrerAddr: refs[k].referrer_addr, tokenHoldings: amountDecN });
        } catch (error) {
          this.l.warn("could not get token holding amount:", error);
        }
      } else {
        const msg = `Token holding update not required yet for ${refs[k].referrer_addr}`;
        this.l.info(msg);
      }
    }
    this.th.writeTokenHoldingsToDB(accounts, this.tokenXAddr);
  }
}
