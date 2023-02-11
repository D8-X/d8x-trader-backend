import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import NoBroker from "./noBroker";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";

async function start() {
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig("testnet");
  let d8XBackend = new D8XBrokerBackendApp(new NoBroker(), sdkConfig);
  await d8XBackend.initialize();
}
start();
