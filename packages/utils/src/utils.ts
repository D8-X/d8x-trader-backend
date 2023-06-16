import Redis from "ioredis";
import { Prisma } from "@prisma/client";
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
/**
 * Convert arbitrary data to json string
 */
export function toJson(data: any): string {
  return JSON.stringify(data, (key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Prisma.Decimal) {
      return value.toFixed();
    }
    return value;
  });
}

export function getRedisConfig(): RedisConfig {
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

export function constructRedis(name: string): Redis {
  let client;
  let redisConfig = getRedisConfig();
  //console.log(redisConfig);
  console.log(`${name} connecting to redis: ${redisConfig.host}`);
  client = new Redis(redisConfig);
  client.on("error", (err) => console.log(`${name} Redis Client Error:` + err));
  return client;
}
export const DECIMALS18 = BigInt(Math.pow(10, 18));
export const ONE_64x64 = BigInt(Math.pow(2, 64));

/**
 *
 * @param {bigint} x BigNumber in Dec18 format
 * @returns {number} x as a float (number)
 */
export const dec18ToFloat = (x: bigint) => {
  var sign = x < 0 ? -1 : 1;
  var s = BigInt(sign);
  x = x * s;
  var xInt = x / DECIMALS18;
  var xDec = x - xInt * DECIMALS18;
  var k = 18 - xDec.toString().length;
  var sPad = "0".repeat(k);
  var NumberStr = xInt.toString() + "." + sPad + xDec.toString();
  return parseFloat(NumberStr) * sign;
};

/**
 *
 * @param {bigint} x BigNumber in Dec-N format
 * @returns {number} x as a float (number)
 */
export function decNToFloat(x: bigint, numDec: number) {
  //x: BigNumber in DecN format to float
  const DECIMALS = BigInt(Math.pow(10, numDec));
  let sign = x < 0 ? -1 : 1;
  let s = BigInt(sign);
  x = x * s;
  let xInt = x / DECIMALS;
  let xDec = x - xInt * DECIMALS;
  let k = numDec - xDec.toString().length;
  let sPad = "0".repeat(k);
  let NumberStr = xInt.toString() + "." + sPad + xDec.toString();
  return parseFloat(NumberStr) * sign;
}

/**
 *
 * @param {number} x number (float)
 * @returns {bigint} x as a BigNumber in Dec18 format
 */
export function floatToDec18(x: number): bigint {
  if (x === 0) {
    return BigInt(0);
  }
  let sg = Math.sign(x);
  x = Math.abs(x);
  let strX = x.toFixed(18);
  const arrX = strX.split(".");
  let xInt = BigInt(arrX[0]);
  let xDec = BigInt(arrX[1]);
  let xIntBig = xInt * DECIMALS18;
  return (xIntBig + xDec) * BigInt(sg);
}

/**
 *
 * @param {number} x number (float)
 * @returns {bigint} x as a BigNumber
 */
export function floatToDecN(x: number, numDec: number): bigint {
  // float number to dec 18
  if (x === 0) {
    return BigInt(0);
  }
  const DECIMALS = BigInt(Math.pow(10, numDec));
  let sg = Math.sign(x);
  x = Math.abs(x);
  let strX = x.toFixed(numDec);
  const arrX = strX.split(".");
  let xInt = BigInt(arrX[0]);
  let xDec = BigInt(arrX[1]);
  let xIntBig = xInt * DECIMALS;
  return (xIntBig + xDec) * BigInt(sg);
}

/**
 * Convert ABK64x64 bigint-format to float.
 * Result = x/2^64 if big number, x/2^29 if number
 * @param  {bigint|number} x number in ABDK-format or 2^29
 * @returns {number} x/2^64 in number-format (float)
 */
export function ABK64x64ToFloat(x: bigint): number {
  let sign = x < 0 ? -1 : 1;
  let s = BigInt(sign);
  x = x * s;
  let xInt = x / ONE_64x64;
  let xDec = x - xInt * ONE_64x64;
  xDec = (xDec * DECIMALS18) / ONE_64x64;
  let k = 18 - xDec.toString().length;
  let sPad = "0".repeat(k);
  let NumberStr = xInt.toString() + "." + sPad + xDec.toString();
  return parseFloat(NumberStr) * sign;
}

export function ABK64x64ToDecN(x: bigint, N: number): bigint {
  const decimalsN = BigInt(Math.pow(10, N));
  const hugo = x * decimalsN;
  return hugo / ONE_64x64;
}

/**
 * Converts x into ABDK64x64 format
 * @param {number} x   number (float)
 * @returns {bigint} x * 2^64 in big number format
 */
export function floatToABK64x64(x: number): bigint {
  if (x === 0) {
    return BigInt(0);
  }
  let sg = Math.sign(x);
  x = Math.abs(x);
  let strX = Number(x).toFixed(18);
  const arrX = strX.split(".");
  let xInt = BigInt(arrX[0]);
  let xDec = BigInt(arrX[1]);
  let xIntBig = xInt * ONE_64x64;
  let xDecBig = (xDec * ONE_64x64) / DECIMALS18;
  return (xIntBig + xDecBig) * BigInt(sg);
}
