import { toJson } from "utils";
import BrokerIntegration from "./brokerIntegration";
import axios from "axios";
import { BrokerTool, NodeSDKConfig, Order, SmartContractOrder, ZERO_ADDRESS } from "@d8x/perpetuals-sdk";

/**
 * This is a remote broker that relays signature requests to a REST API.
 * This type of broker does not need to manage a private key and the broker
 * fee is set in the remote location
 */
export default class BrokerRemote extends BrokerIntegration {
  private endpointGetBrokerAddress = "/broker-address";
  private endpointGetBrokerFee = "/broker-fee";
  private endpointSignOrder = "/sign-order";
  private brokerAddr: string = "";
  private brokerFee: number | undefined;

  constructor(private apiURL: string, private myId: string, private chainId: number) {
    super();
  }

  public async initialize(config: NodeSDKConfig): Promise<string> {
    return await this.getBrokerAddress();
  }

  public async getBrokerAddress(): Promise<string> {
    if (this.brokerAddr == "") {
      let arg = "?id=" + this.myId;
      let endpoint = this.apiURL + this.endpointGetBrokerAddress + arg;
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

  public async getBrokerFeeTBps(traderAddr: string, order?: Order): Promise<number> {
    let arg = "?id=" + this.myId;
    let endpoint = this.apiURL + this.endpointGetBrokerFee + arg;
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      this.brokerFee = Number(data.BrokerFeeTbps);
    } catch (error) {
      console.log("brokerRemote: failed to fetch broker address");
    }

    return this.brokerFee!;
  }

  public async signOrder(SCOrder: SmartContractOrder): Promise<string> {
    const reqData = {
      order: {
          flags: SCOrder.flags,
          iPerpetualId: SCOrder.iPerpetualId,
          traderAddr: SCOrder.traderAddr,
          brokerAddr: SCOrder.brokerAddr,
          fAmount: SCOrder.fAmount,
          fLimitPrice: SCOrder.fLimitPrice,
          fTriggerPrice: SCOrder.fTriggerPrice,
          leverageTDR: SCOrder.leverageTDR,
          iDeadline: SCOrder.iDeadline,
          executionTimestamp: SCOrder.executionTimestamp,
      },
      chainId: this.chainId,
    };
    // send post request to endpoint with r as data
    try {
      const response = await axios.post(this.apiURL + this.endpointSignOrder, reqData);
      const responseData = response.data;
      return responseData.brokerSignature;
    } catch (error) {
      throw Error("Error signOrder:" + error);
    }
  }
}
