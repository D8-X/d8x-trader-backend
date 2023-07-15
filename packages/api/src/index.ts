import dotenv from "dotenv";
import { chooseRandomRPC, sleep } from "utils";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import BrokerNone from "./brokerNone";
import BrokerRegular from "./brokerRegular";
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
  sdkConfig.nodeURL = chooseRandomRPC(false, rpcConfig);
  const wsRPC = chooseRandomRPC(true, rpcConfig);
  console.log(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
  console.log(`RPC (WS)   = ${wsRPC}`);
  let broker;
  if (process.env.BROKER_KEY == undefined || process.env.BROKER_KEY == "" || process.env.BROKER_FEE_TBPS == undefined) {
    console.log("No broker PK or fee defined, using empty broker.");
    broker = new BrokerNone();
  } else {
    console.log("Initializing broker");
    const feeTbps = process.env.BROKER_FEE_TBPS == undefined ? 0 : Number(process.env.BROKER_FEE_TBPS);
    broker = new BrokerRegular(process.env.BROKER_KEY, feeTbps, sdkConfig);
  }
  let d8XBackend = new D8XBrokerBackendApp(broker, sdkConfig, wsRPC);
  await d8XBackend.initialize();
  while (true) {
    await sleep(60_000);
    const wsRPC = chooseRandomRPC(true, rpcConfig);
    await d8XBackend.checkTradeEventListenerHeartbeat(sdkConfig, wsRPC);
  }
}
start();
