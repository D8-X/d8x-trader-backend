import AbstractPayExecutor from "./abstractPayExecutor";
import { Logger } from "winston";

/**
 * This class uses a remote server that
 * executes payments. We also have a private key here because
 * we sign our request for the payment execution.
 */
export default class PayExecutorRemote extends AbstractPayExecutor {
  private brokerAddr: string = "";
  private endpointGetBrokerAddress = "/broker-address";

  constructor(
    privateKey: string,
    multiPayContractAddr: string,
    rpcUrl: string,
    l: Logger,
    private apiUrl: string,
    private myId: string
  ) {
    super(privateKey, multiPayContractAddr, rpcUrl, l);
  }

  public async transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: bigint,
    msg: string
  ): Promise<string> {
    return "todo";
  }

  public async getBrokerAddress(): Promise<string> {
    if (this.brokerAddr == "") {
      let arg = "?id=" + this.myId;
      let endpoint = this.apiUrl + this.endpointGetBrokerAddress + arg;
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        this.brokerAddr = data.brokerAddr;
      } catch (error) {
        console.log("brokerRemote: failed to fetch broker address");
      }
    }
    return this.brokerAddr;
  }
}
