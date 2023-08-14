import { BigNumber, ethers, providers, Wallet } from "ethers";
import { Signer } from "@ethersproject/abstract-signer";
import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { keccak256 } from "@ethersproject/keccak256";
import { defaultAbiCoder } from "@ethersproject/abi";
import axios from "axios";
import AbstractPayExecutor from "./abstractPayExecutor";

import { Logger } from "winston";

interface PaySummary {
  payer: string; //addr
  executor: string; //addr
  token: string; //addr
  timestamp: number; //uint32
  id: number; //uint32
  totalAmount: string; //big int
  chainId: number;
  multiPayCtrct: string; //addr
}
/**
 * This class uses a remote server that
 * executes payments. We also have a private key here because
 * we sign our request for the payment execution.
 * There are other payment execution options that implement AbstractPayExecutor
 */
export default class PayExecutorRemote extends AbstractPayExecutor {
  private brokerAddr: string = "";
  private endpointGetBrokerAddress = "/broker-address";
  private endpointSignPaymentExecution = "/sign-payment";
  private signer: Signer;
  private apiUrl: string;
  constructor(
    privateKey: string,
    multiPayContractAddr: string,
    rpcUrl: string,
    private chainId: number,
    l: Logger,
    apiUrl: string,
    private myId: string
  ) {
    super(privateKey, multiPayContractAddr, rpcUrl, l);
    this.signer = this.createSigner(this.rpcUrl);
    // remove trailing slash:
    this.apiUrl = apiUrl.replace(/\/+$/, "");
  }

  public createSigner(nodeURL: string): Signer {
    let provider = new StaticJsonRpcProvider(nodeURL);
    const wallet = new Wallet(this.privateKey);
    return wallet.connect(provider);
  }

  /**
   * Interface method
   * We get the broker address from the remote server on
   * the first call
   * @returns address of broker
   */
  public async getBrokerAddress(): Promise<string> {
    if (this.brokerAddr == "") {
      let arg = "?id=" + this.myId;
      let endpoint = this.apiUrl + this.endpointGetBrokerAddress + arg;
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        this.brokerAddr = data.brokerAddr.toLowerCase();
      } catch (error) {
        console.log("brokerRemote: failed to fetch broker address");
      }
    }
    return this.brokerAddr;
  }

  /**
   * Interface method to execute payment
   * @param tokenAddr address of payment token
   * @param amounts array with decimal-N amounts to be paid
   * @param paymentToAddr array with addresses to pay in corresponding order to amounts
   * @param id id to be used for submission
   * @param msg message to be used for submission
   * @returns transaction hash or fail
   */
  public async transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: number,
    msg: string
  ): Promise<string> {
    let totalAmount: bigint = 0n;
    for (let k = 0; k < amounts.length; k++) {
      totalAmount = totalAmount + amounts[k];
    }
    const payerAddr = await this.getBrokerAddress();
    const executorAddr = await this.signer.getAddress();
    const amountsBN = amounts.map((x) => BigNumber.from(x.toString()));
    let ps: PaySummary = this.createPaymentSummary(payerAddr, executorAddr, tokenAddr, amountsBN, id);
    let sig = await this.signPayment(ps);
    let remoteSig;
    try {
      remoteSig = await this.getRemoteSignature(sig, ps);
    } catch (error) {
      if (error instanceof Error && error.message == "Multipay ctrct mismatch") {
        throw error;
      }
      return "fail";
    }

    return await this.smartContractCall(remoteSig, ps, amounts, paymentToAddr, msg);
  }

  private async smartContractCall(
    remoteSig: string,
    ps: PaySummary,
    amounts: bigint[],
    paymentToAddr: string[],
    msg: string
  ): Promise<string> {
    let multiPay: ethers.Contract = this.connectMultiPayContractInstance();
    let d = this.dataReshapeForContract(amounts, paymentToAddr);

    // payment execution
    try {
      let tx = await multiPay.delegatedPay(ps, remoteSig, d.amountsPayable, d.addrPayable, msg, { gasLimit: 150_000 });
      return tx.hash;
    } catch (error) {
      this.l.warn(`error when executing multipay for token ${ps.token}`, error);
      if (Object(error).code !== undefined && Object(error).code == "INSUFFICIENT_FUNDS") {
        throw Error("executor has insufficient funds");
      }
      return "fail";
    }
  }

  /**
   * Retrieve signature of payment request from broker which enables us to execute the
   * payment in lieu of the broker
   * @param signature
   * @param ps
   */
  private async getRemoteSignature(signature: string, ps: PaySummary) {
    let reqData = {
      payment: ps,
      signature: signature,
    };
    try {
      const response = await axios.post(this.apiUrl + this.endpointSignPaymentExecution, reqData);
      const responseData = response.data;
      const brokerSignature = responseData.brokerSignature;
      if (brokerSignature == undefined) {
        throw Error(response.data.error);
      }
      console.log("Broker Signature:", brokerSignature);
      return brokerSignature;
      // Handle the brokerSignature here
    } catch (error) {
      this.l.error("remote payment signature failed", error);
      // Handle the error here
      throw error;
    }
  }

  public async signPayment(summary: PaySummary) {
    const digestBuffer = await PayExecutorRemote.digestBuffer(summary, this.chainId, this.multiPayContractAddr);
    if (this.signer == undefined) {
    }
    return await this.signer!.signMessage(digestBuffer);
  }

  public static async digestBuffer(
    summary: PaySummary,
    chainId: number,
    multiPayContractAddr: string
  ): Promise<Buffer> {
    const NAME = "Multipay";
    const DOMAIN_TYPEHASH = keccak256(
      Buffer.from("EIP712Domain(string name,uint256 chainId,address verifyingContract)")
    );
    let abiCoder = defaultAbiCoder;
    let domainSeparator = keccak256(
      abiCoder.encode(
        ["bytes32", "bytes32", "uint256", "address"],
        [DOMAIN_TYPEHASH, keccak256(Buffer.from(NAME)), chainId, multiPayContractAddr]
      )
    );
    const PAY_SUMMARY_TYPEHASH = keccak256(
      Buffer.from(
        "PaySummary(address payer,address executor,address token,uint32 timestamp,uint32 id,uint256 totalAmount)"
      )
    );

    let structHash = keccak256(
      abiCoder.encode(
        ["bytes32", "address", "address", "address", "uint32", "uint32", "uint256"],
        [
          PAY_SUMMARY_TYPEHASH,
          summary.payer,
          summary.executor,
          summary.token,
          summary.timestamp,
          summary.id,
          summary.totalAmount,
        ]
      )
    );

    let digest = keccak256(abiCoder.encode(["bytes32", "bytes32"], [domainSeparator, structHash]));
    return Buffer.from(digest.substring(2, digest.length), "hex");
  }

  private createPaymentSummary(
    payerAddr: string,
    executorAddr: string,
    tokenAddr: string,
    amounts: BigNumber[],
    id: number
  ): PaySummary {
    let sm = BigNumber.from(0);
    for (let k = 0; k < amounts.length; k++) {
      sm = sm.add(amounts[k]);
    }
    return {
      payer: payerAddr,
      executor: executorAddr,
      token: tokenAddr,
      timestamp: Math.floor(Date.now() / 1000),
      id: id,
      totalAmount: sm.toString(),
      chainId: this.chainId,
      multiPayCtrct: this.multiPayContractAddr,
    };
  }
}
