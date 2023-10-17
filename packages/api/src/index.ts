import dotenv from "dotenv";
import { chooseRandomRPC, sleep, executeWithTimeout, loadConfigRPC } from "utils";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import BrokerNone from "./brokerNone";
import BrokerIntegration from "./brokerIntegration";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";
import BrokerRemote from "./brokerRemote";

async function start() {
  dotenv.config();
  let configName: string = <string>process.env.SDK_CONFIG_NAME || "";
  if (configName == "") {
    throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
  }
  console.log(`loading configuration ${configName}`);
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);
  const rpcConfig = loadConfigRPC();

  const priceFeedEndpoints: Array<{ type: string; endpoint: string }> = [];
 
  if (priceFeedEndpoints.length > 0) {
    sdkConfig.priceFeedEndpoints = priceFeedEndpoints;
  }
  let broker: BrokerIntegration;
  let remoteBrokerAddr = process.env.REMOTE_BROKER_HTTP;

  if (remoteBrokerAddr != undefined && process.env.REMOTE_BROKER_HTTP != "") {
    const brokerIdName = "1";
    remoteBrokerAddr = remoteBrokerAddr.replace(/\/+$/, '');// remove trailing slash
    console.log("Creating remote broker for order signatures");
    broker = new BrokerRemote(remoteBrokerAddr, brokerIdName, sdkConfig.chainId);
  } else {
    console.log("No broker PK/fee or remore broker defined, using empty broker.");
    broker = new BrokerNone();
  }
  sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);
  let wsRPC = chooseRandomRPC(true, rpcConfig);
  let d8XBackend = new D8XBrokerBackendApp(broker!, sdkConfig, wsRPC);
  let count = 0;
  let isSuccess = false;
  while (!isSuccess) {
    try {
      console.log(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
      console.log(`RPC (WS)   = ${wsRPC}`);
      await executeWithTimeout(d8XBackend.initialize(sdkConfig, wsRPC), 60_000, "initialize timeout");
      isSuccess = true;
    } catch (error) {
      await sleep(500);
      if (count > 10) {
        throw error;
      }
      console.log("retrying new rpc...");
      sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);
      wsRPC = chooseRandomRPC(true, rpcConfig);
    }
    count++;
  }

  while (true) {
    await sleep(60_000);
    wsRPC = chooseRandomRPC(true, rpcConfig);
    sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);
    await d8XBackend!.checkTradeEventListenerHeartbeat(wsRPC);
  }
}
start();
