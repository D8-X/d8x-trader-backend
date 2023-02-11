import fs from "fs";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import NoBroker from "./noBroker";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";

async function start() {
  let rpc = JSON.parse(fs.readFileSync("./src/rpc.json", "utf-8"));
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig("testnet");
  sdkConfig.nodeURL = rpc.RPC[Math.floor(Math.random() * rpc.RPC.length)];
  console.log(`RPC = ${sdkConfig.nodeURL}`);
  let d8XBackend = new D8XBrokerBackendApp(new NoBroker(), sdkConfig);
  await d8XBackend.initialize();
}
start();
