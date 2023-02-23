import { createClient } from "redis";
import { WebsocketClientConfig } from "./wsTypes";

export function extractErrorMsg(error: any): string {
  let message;
  if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return message;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load websocket-client config into object of type WebsocketClientConfig
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

export function constructRedis(name: string): ReturnType<typeof createClient> {
  let redisUrl: string | undefined = process.env.REDIS_URL;
  let client;
  if (redisUrl == undefined || redisUrl == "") {
    console.log(`${name} connecting to redis`);
    client = createClient();
  } else {
    console.log(`${name} connecting to redis: ${redisUrl}`);
    client = createClient({ url: redisUrl });
  }
  client.on("error", (err) => console.log(`${name} Redis Client Error:` + err));
  return client;
}
