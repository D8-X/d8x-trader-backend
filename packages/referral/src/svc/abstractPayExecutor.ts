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

  public abstract transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: bigint,
    msg: string
  ): Promise<string>;

  public abstract getBrokerAddress(): Promise<string>;
}
