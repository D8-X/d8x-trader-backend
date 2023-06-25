import fs from "fs";
import dotenv from "dotenv";

import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import BrokerNone from "./brokerNone";
import BrokerRegular from "./brokerRegular";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";

function chooseRandomRPC() {
  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }
  let rpc = JSON.parse(fs.readFileSync(__dirname + "/rpc.json", "utf-8"));
  for (let k = 0; k < rpc.length; k++) {
    if (rpc[k].chainId == chainId) {
      return rpc[k].RPC[Math.floor(Math.random() * rpc[k].RPC.length)];
    }
  }
  const errStr = `No RPC defined for chainID ${chainId}`;
  throw new Error(errStr);
}

async function start() {
  dotenv.config();
  let configName: string = <string>process.env.SDK_CONFIG_NAME || "";
  if (configName == "") {
    throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
  }
  console.log(`loading configuration ${configName}`);
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);
  sdkConfig.nodeURL = chooseRandomRPC();
  console.log(`RPC = ${sdkConfig.nodeURL}`);
  let broker;
  if (process.env.BROKER_KEY == undefined || process.env.BROKER_KEY == "" || process.env.BROKER_FEE_TBPS == undefined) {
    console.log("No broker PK or fee defined, using empty broker.");
    broker = new BrokerNone();
  } else {
    console.log("Initializing broker");
    const feeTbps = process.env.BROKER_FEE_TBPS == undefined ? 0 : Number(process.env.BROKER_FEE_TBPS);
    broker = new BrokerRegular(process.env.BROKER_KEY, feeTbps, sdkConfig);
  }
  let d8XBackend = new D8XBrokerBackendApp(broker, sdkConfig);
  await d8XBackend.initialize();
}
start();
