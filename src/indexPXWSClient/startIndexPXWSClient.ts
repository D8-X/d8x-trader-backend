/**
 * Runs multiple websocket clients for which each of them
 * can have several websocket servers
 */
import dotenv from "dotenv";
import IndexPXWSClient from "./indexPxWSClient";
import { WebsocketClientConfig } from "../wsTypes";
import { loadConfigJSON } from "../utils";
import { sleep } from "../utils";
import FeedHandler from "./feedHandler";

async function main() {
  dotenv.config();
  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }
  let configs: WebsocketClientConfig[] = loadConfigJSON(chainId);
  let clients = new Array<IndexPXWSClient>();
  let feedHandler = new FeedHandler(configs);
  await feedHandler.init();
  for (let k = 0; k < configs.length; k++) {
    clients.push(new IndexPXWSClient(configs[k], feedHandler));
    await clients[k].init();
  }
  await sleep(20_000);
  while (true) {
    await sleep(60_000);
    for (let k = 0; k < clients.length; k++) {
      if (clients[k].timeMsSinceHeartbeat() > 60_000) {
        // something fishy, switch server
        console.log(`switching server for configuration ${configs[k].streamName}`);
        await clients[k].switchWSServer();
      }
    }
  }
}

main();
