import { createClient } from "redis";
import { WebsocketClientConfig } from "./wsTypes";

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

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
  let file = <WebsocketClientConfig[]>require("./indexPXWSClient/wsConfig.json");
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

function urlToConfig(): RedisConfig {
  let originUrl = process.env.REDIS_URL;
  if (originUrl == undefined) {
    throw new Error("REDIS_URL not defined");
  }
  console.log("URL=", originUrl);
  let redisURL = new URL(originUrl);
  const host = redisURL.hostname;
  const port = parseInt(redisURL.port);
  const redisPassword = redisURL.password;
  let config = { host: host, port: port, password: redisPassword! };

  return config;
}

export function constructRedis(name: string): ReturnType<typeof createClient> {
  let client;
  let redisConfig = urlToConfig();
  console.log(redisConfig);
  console.log(`${name} connecting to redis: ${redisConfig.host}`);
  client = createClient(redisConfig);
  client.on("error", (err) => console.log(`${name} Redis Client Error:` + err));
  return client;
}
