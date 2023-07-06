import Redis from "ioredis";
import { Prisma } from "@prisma/client";
import { WebsocketClientConfig } from "./wsTypes";
import parser from "cron-parser";
import dotenv from "dotenv";

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

export function isValidAddress(addr: string): boolean {
  return /^(0x){1}([a-f]|[A-F]|[0-9]){40}/.test(addr);
}

/**
 * Load websocket-client config into object of type WebsocketClientConfig
 * Looks for all entries with given chainId
 * @param chainId chain id for which we want the config
 * @returns configuration of type WebsocketClientConfig
 */
export function loadConfigJSON(chainId: number): WebsocketClientConfig[] {
  let file = <WebsocketClientConfig[]>require("../../../config/wsConfig.json");
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

/**
 * Find a close block to 'since'.
 *
 * Approach:
 *  - get a block in the past which covers approximately the timespan
 *    of now-since (exact if each block were to take 2 seconds)
 *  - calculate the average block time for this timespan
 *  - repeat the calculation of the average block-time over the period that
 *    now more accurately reflects now-since
 *  - report the estimated block number based on the repeated average block-time
 * @param provider ethers.provider
 * @param since date for which we are searching the block
 * @param mustBeBefore if set to true, guarantees that the block.timestamp is smaller
 *  than the since timestamp. If set to false 4 rpc calls are needed, usually 5 if
 *  set to true
 * @returns block number that closely matches 'since', latest block number
 */
export async function calculateBlockFromTime(
  provider: any, //ethers.provider
  since: Date,
  mustBeBefore = true
): Promise<[number, number]> {
  // rpc #1 & #2
  //   let max = await provider.getBlockNumber();
  //   const blk1 = await provider.getBlock(max);
  let blk1 = await provider.getBlock("latest");
  let max = blk1.number;
  const targetTimestamp = since.getTime() / 1000;
  const secElapsed = blk1.timestamp - targetTimestamp;

  let blockSampleNum = Math.floor(secElapsed / 2);
  if (blockSampleNum >= max) {
    // 2 second blocks would mean more than current number of blocks
    // --> too many, it was a bad estimate, default to a simpler estimate
    blockSampleNum = Math.floor(max / 10);
  }
  // rpc #3
  let blk0 = await provider.getBlock(max - blockSampleNum);
  let secPerBlockInSample = (blk1.timestamp - blk0.timestamp) / blockSampleNum;
  // sample again
  blockSampleNum = Math.floor(secElapsed / secPerBlockInSample);
  // rpc #4
  blk0 = await provider.getBlock(max - blockSampleNum);
  secPerBlockInSample = (blk1.timestamp - blk0.timestamp) / blockSampleNum;
  let numBlocksBack = Math.floor(secElapsed / secPerBlockInSample);
  if (!mustBeBefore) {
    return [Math.max(0, max - numBlocksBack), max];
  }
  // get the block we would arrive at and its timestamp
  //let rpcCount = 5;
  let blk = await provider.getBlock(max - numBlocksBack);
  let currTimestamp = blk.timestamp;
  // estimate blocktime for the period between the first and second sampling
  secPerBlockInSample = Math.abs((blk.timestamp - blk0.timestamp) / (blk.number - blk0.number));
  // linearly step back by number of blocks
  while (currTimestamp > targetTimestamp) {
    let numBlocks = Math.ceil((currTimestamp - targetTimestamp) / secPerBlockInSample);
    blk = await provider.getBlock(blk.number - numBlocks);
    //rpcCount++;
    currTimestamp = blk.timestamp;
  }
  //console.log("rpccount=", rpcCount);
  return [blk.number, max];
}

/**
 * Get the nearest block number for given time
 * @param provider ethers provider from ethers 5 or 6 (hence any type)
 * @param time
 * @returns [startblock, endblock]
 */
export async function calculateBlockFromTimeOld(
  provider: any, //ethers.provider
  time: Date | undefined
): Promise<[number, number]> {
  let countRPC = 1;
  let max = await provider.getBlockNumber();
  const nowblock = max;
  let min = Math.max(0, max - 2592000);

  if (time === undefined) {
    return [min, max];
  }
  const timestamp = time.getTime() / 1000;
  let midpoint = Math.floor((max + min) / 2);
  let blk = await provider.getBlock(min);
  if (blk.timestamp > timestamp) {
    throw Error("not working");
  }
  // allow up to 5 blocks (in past) of error when finding the block
  // number. Threshold is in seconds (5 times ETH block time)
  const threshold = 15 * 5;

  let found = false;
  while (!found) {
    let blk = await provider.getBlock(midpoint);
    countRPC++;
    if (blk) {
      if (blk.timestamp > timestamp) {
        max = blk.number;
      } else {
        min = blk.number;
      }
      // Found our block
      if (blk.timestamp - threshold <= timestamp && blk.timestamp + threshold >= timestamp) {
        console.log("final RPC count=", countRPC);
        return [blk.number, nowblock];
      }

      midpoint = Math.floor((max + min) / 2);
    } else {
      throw Error(`block ${midpoint} not found!`);
    }
  }
  return [0, nowblock];
}

export function chooseRandomRPC(ws = false): string {
  dotenv.config();
  let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
  if (chainId == -1) {
    throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
  }
  const rpc = require("../../../config/rpc.json");

  let urls: string[] = [];
  let otherRPC: string | undefined;
  for (let k = 0; k < rpc.length; k++) {
    if (rpc[k].chainId == chainId) {
      if (ws) {
        urls = rpc[k].WS;
        otherRPC = process.env.WS_RPC_URL as string;
      } else {
        urls = rpc[k].HTTP;
        otherRPC = process.env.HTTP_RPC_URL as string;
      }
      if (otherRPC != undefined) {
        urls.push(otherRPC);
      }
    }
  }
  if (urls.length < 1) {
    throw new Error(`No ${ws ? "Websocket" : "HTTP"} RPC defined for chain ID ${chainId}`);
  }
  return urls[Math.floor(Math.random() * urls.length)];
}
