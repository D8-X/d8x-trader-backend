import { BigNumber, ethers, providers, Wallet } from "ethers";
import { Logger } from "winston";

export default abstract class AbstractPayExecutor {
  protected ctrMultiPayAbi = require("../abi/MultiPay.json");
  constructor(
    protected privateKey: string,
    protected multiPayContractAddr: string,
    protected rpcUrl: string,
    protected l: Logger
  ) {}

  protected connectMultiPayContractInstance(): ethers.Contract {
    let provider = new providers.StaticJsonRpcProvider(this.rpcUrl);
    const wallet = new Wallet(this.privateKey!);
    const signer = wallet.connect(provider);
    return new ethers.Contract(this.multiPayContractAddr, this.ctrMultiPayAbi, signer);
  }

  protected dataReshapeForContract(
    amounts: bigint[],
    paymentToAddr: string[]
  ): { amountsPayable: BigNumber[]; addrPayable: string[] } {
    let amountsPayable: BigNumber[] = [];
    let addrPayable: string[] = [];
    for (let k = 0; k < amounts.length; k++) {
      // also push zero amounts
      amountsPayable.push(BigNumber.from(amounts[k].toString()));
      let addr = paymentToAddr[k] == "" ? ethers.constants.AddressZero : paymentToAddr[k];
      addrPayable.push(addr);
    }
    return { amountsPayable: amountsPayable, addrPayable: addrPayable };
  }

  public abstract transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: number,
    msg: string
  ): Promise<string>;

  public abstract getBrokerAddress(): Promise<string>;
}
