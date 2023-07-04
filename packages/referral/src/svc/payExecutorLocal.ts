import { BigNumber, ethers, providers, Wallet } from "ethers";
import { Logger } from "winston";
import AbstractPayExecutor from "./abstractPayExecutor";
const ctrMultiPayAbi = require("../abi/MultiPay.json");

/**
 * This class uses a local private key to
 * execute payments
 */
export default class PayExecutorLocal extends AbstractPayExecutor {
  private brokerAddr: string;
  private approvedTokens = new Map<string, boolean>();

  constructor(
    private privateKey: string,
    private multiPayContractAddr: string,
    private rpcUrl: string,
    private l: Logger
  ) {
    super();
    this.brokerAddr = new Wallet(privateKey).address;
  }

  private _connectMultiPayContractInstance(): ethers.Contract {
    let provider = new providers.StaticJsonRpcProvider(this.rpcUrl);
    const wallet = new Wallet(this.privateKey!);
    const signer = wallet.connect(provider);
    return new ethers.Contract(this.multiPayContractAddr, ctrMultiPayAbi, signer);
  }

  public getBrokerAddress() {
    return this.brokerAddr;
  }

  public async transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: bigint,
    msg: string
  ): Promise<string> {
    let multiPay: ethers.Contract = this._connectMultiPayContractInstance();
    if (!(await this._approveTokenToBeSpent(tokenAddr))) {
      this.l.warn("PayExecutorLocal: could not approve token", tokenAddr);
      return "fail";
    }
    // filter out zero payments
    let amountsPayable: BigNumber[] = [];
    let addrPayable: string[] = [];
    for (let k = 0; k < amounts.length; k++) {
      // also push zero amounts
      amountsPayable.push(BigNumber.from(amounts[k].toString()));
      let addr = paymentToAddr[k] == "" ? ethers.constants.AddressZero : paymentToAddr[k];
      addrPayable.push(addr);
    }

    // payment execution
    try {
      let tx = await multiPay.pay(id, tokenAddr, amountsPayable, addrPayable, msg, { gasLimit: 75_000 });
      return tx.hash;
    } catch (error) {
      this.l.warn(`error when executing multipay for token ${tokenAddr}`, error);
      return "fail";
    }
  }

  private async _approveTokenToBeSpent(tokenAddr: string): Promise<boolean> {
    if (this.approvedTokens.get(tokenAddr) != undefined) {
      return true;
    }
    try {
      let provider = new providers.StaticJsonRpcProvider(this.rpcUrl);
      const wallet = new Wallet(this.privateKey!);
      const signer = wallet.connect(provider);
      const tokenAbi = ["function approve(address spender, uint256 amount) external returns (bool)"];
      const tokenContract = new ethers.Contract(tokenAddr, tokenAbi, signer);
      const approvalTx = await tokenContract
        .connect(signer)
        .approve(this.multiPayContractAddr, ethers.constants.MaxUint256);
      await approvalTx.wait();
      console.log(`Successfully approved spender ${this.multiPayContractAddr} for token ${tokenAddr}`);
      this.approvedTokens.set(tokenAddr, true);
      return true;
    } catch (error) {
      console.log(`error approving token ${tokenAddr}:`, error);
      return false;
    }
  }
}
