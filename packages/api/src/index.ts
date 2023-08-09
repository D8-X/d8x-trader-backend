import dotenv from "dotenv";
import { chooseRandomRPC, loadConfigJSON, sleep } from "utils";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import BrokerNone from "./brokerNone";
import BrokerRegular from "./brokerRegular";
import BrokerIntegration from "./brokerIntegration";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";

async function start() {
  dotenv.config();
  let configName: string = <string>process.env.SDK_CONFIG_NAME || "";
  if (configName == "") {
    throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
  }
  console.log(`loading configuration ${configName}`);
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);
  const rpcConfig = require("../../../config/live.rpc.json");
  const wsConfigs = loadConfigJSON(sdkConfig.chainId);

  const priceFeedEndpoints: Array<{ type: string; endpoint: string }> = [];
  wsConfigs.map((wsConfig) => {
    const arr = wsConfig.httpEndpoints;
    if (arr.length > 0) {
      priceFeedEndpoints.push({ type: wsConfig.type, endpoint: arr[Math.floor(Math.random() * arr.length)] });
    }
  });
  if (priceFeedEndpoints.length > 0) {
    sdkConfig.priceFeedEndpoints = priceFeedEndpoints;
  }
  let wsRPC = chooseRandomRPC(true, rpcConfig);

  let broker: BrokerIntegration;
  if (process.env.BROKER_KEY == undefined || process.env.BROKER_KEY == "" || process.env.BROKER_FEE_TBPS == undefined) {
    console.log("No broker PK or fee defined, using empty broker.");
    broker = new BrokerNone();
  } else {
    console.log("Initializing broker");
    const feeTbps = process.env.BROKER_FEE_TBPS == undefined ? 0 : Number(process.env.BROKER_FEE_TBPS);
    let count = 0;
    while (count < 10) {
      try {
        sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);

        console.log(`RPC (HTTP) = ${sdkConfig.nodeURL}`);

        broker = new BrokerRegular(process.env.BROKER_KEY, feeTbps, sdkConfig);
        count = 10;
      } catch (error) {
        await sleep(5_000);
        if (count > 10) {
          throw error;
        }
        console.log("retrying new rpc...", error);
      }
      count++;
    }
  }
  wsRPC = chooseRandomRPC(true, rpcConfig);
  console.log(`RPC (WS)   = ${wsRPC}`);
  let d8XBackend = new D8XBrokerBackendApp(broker!, sdkConfig, wsRPC);
  let count = 0;
  while (count < 10) {
    try {
      await d8XBackend.initialize(sdkConfig);
      count = 10;
    } catch (error) {
      await sleep(5_000);
      if (count > 10) {
        throw error;
      }
      console.log("retrying new rpc...");
      sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);
      wsRPC = chooseRandomRPC(false, rpcConfig);
      console.log(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
      console.log(`RPC (WS)   = ${wsRPC}`);
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
