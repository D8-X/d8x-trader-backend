/**
 * Runs multiple websocket clients for which each of them
 * can have several websocket servers
 */
import dotenv from "dotenv";
import IndexPXWSClient from "./indexPxWSClient";
import { WebsocketClientConfig } from "../wsTypes";
import { sleep } from "../utils";

/**
 * Load config into object of type WebsocketClientConfig
 * Looks for all entries with given chainId
 * @param chainId chain id for which we want the config
 * @returns configuration of type WebsocketClientConfig
 */
export function loadConfigJSON(chainId: number): WebsocketClientConfig[] {
  let file = <WebsocketClientConfig[]>require("./wsConfig.json");
  let relevantConfigs: WebsocketClientConfig[] = [];
  for (let k = 0; k < file.length; k++) {
    if (file[k].chainId == chainId) {
      relevantConfigs.push(file[k]);
    }
  }
  if (relevantConfigs.length == 0) {
    throw new Error(`Did not find any entries for chain id ${chainId} in config`);
  }
  return relevantConfigs;
}

async function main() {
  dotenv.config();
  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }
  let configs = loadConfigJSON(chainId);
  let clients = new Array<IndexPXWSClient>();
  for (let k = 0; k < configs.length; k++) {
    clients.push(new IndexPXWSClient(configs[k]));
    await clients[k].init();
  }
  await sleep(20_000);
  while (true) {
    for (let k = 0; k < clients.length; k++) {
      try {
        clients[k].sendPing();
      } catch (err) {
        console.log("Ping failed: " + err);
      }
    }
    await sleep(20_000);
    for (let k = 0; k < clients.length; k++) {
      if (clients[k].timeMsSinceHeartbeat() > 60_000) {
        // something fishy, switch server
        console.log(`switching server for configuration ${configs[k].streamName}`);
        clients[k].switchWSServer();
      }
    }
  }
}

main();
