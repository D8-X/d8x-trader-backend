import fs from "fs";
import dotenv from "dotenv";

import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import NoBroker from "./noBroker";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";

function chooseRandomRPC() {
  dotenv.config();
  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }
  let rpc = JSON.parse(fs.readFileSync("./src/rpc.json", "utf-8"));
  for (let k = 0; k < rpc.length; k++) {
    if (rpc[k].chainId == chainId) {
      return rpc[k].RPC[Math.floor(Math.random() * rpc[k].RPC.length)];
    }
  }
  const errStr = `No RPC defined for chainID ${chainId}`;
  throw new Error(errStr);
}

async function start() {
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig("testnet");
  sdkConfig.nodeURL = chooseRandomRPC();
  console.log(`RPC = ${sdkConfig.nodeURL}`);
  let d8XBackend = new D8XBrokerBackendApp(new NoBroker(), sdkConfig);
  await d8XBackend.initialize();
}
start();
