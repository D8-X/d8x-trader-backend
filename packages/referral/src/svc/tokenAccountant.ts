import { Contract, ethers } from "ethers";

import TokenHoldings from "../db/token_holdings";
import { TokenAccount } from "../referralTypes";

export default class TokenAccountant {
  private th: TokenHoldings;
  private tokenXAddr: string;
  private provider: ethers.providers.JsonRpcProvider | undefined;
  tknAbi = [
    // ... ERC-20 standard ABI ...
    // Include the "decimals" function
    "function balanceOf(address account) view returns (uint256)",
  ];

  constructor(th: TokenHoldings, tokenXAddr: string) {
    this.th = th;
    this.tokenXAddr = tokenXAddr;
  }

  public initProvider(rpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  }

  public async fetchFromChain() {
    if (this.provider == undefined) {
      throw new Error("TokenAccountant: provider not defined");
    }
    const contract = new Contract(this.tokenXAddr, this.tknAbi, this.provider);
    let refs = ["0x9d5aaB428e98678d0E645ea4AeBd25f744341a05"]; //await this.th.queryActiveReferrers();
    let accounts: TokenAccount[] = [];
    for (let k = 0; k < refs.length; k++) {
      let amountDecN: bigint = 0n;
      // get amount
      amountDecN = BigInt((await contract.balanceOf(refs[k])).toString());
      accounts.push({ referrerAddr: refs[k], tokenHoldings: amountDecN });
    }
    this.th.writeTokenHoldingsToDB(accounts, this.tokenXAddr);
  }
}
