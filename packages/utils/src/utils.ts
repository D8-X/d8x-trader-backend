import type { RedisClientType } from "redis";
import { createClient } from "redis";
import { Prisma } from "@prisma/client";
import { WebsocketClientConfig, RPCConfig } from "./wsTypes";
import dotenv from "dotenv";
import parser from "cron-parser";
import fs from "fs";

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
 * 1) 0 stays zero
 * 2) only positive numbers
 * 3) n-digits after the comma (e.g. 2 as in 32.12, 121331.21)
 * 4) numbers add up to exactly 100
 * 5) numbers very close to original array
 * @param perc
 * @param digits
 */
export function adjustNDigitPercentagesTo100(perc: number[], digits: number): number[] {
	// transform to integer, e.g., 55.323 -> 5532 if digits=2
	let percDigits = perc.map((x) => Math.round(x * 10 ** digits));
	// normalize
	let s = 0;
	percDigits.forEach((x) => (s += x));
	const hundredPercent = 100 * 10 ** digits;
	let err = s - hundredPercent;
	let numNonZero = 0;
	percDigits.forEach((x) => (numNonZero += x == 0 ? 0 : 1));
	let distr = Math.round(err / numNonZero);
	s = 0;
	let max = 0;
	let maxidx = 0;
	for (let k = 0; k < percDigits.length; k++) {
		if (percDigits[k] != 0) {
			percDigits[k] -= distr;
		}
		s += percDigits[k];
		if (percDigits[k] > max) {
			max = percDigits[k];
			maxidx = k;
		}
	}
	let residual = s - hundredPercent;
	percDigits[maxidx] -= residual;
	let ndigits = percDigits.map((x) => Number((x / 10 ** digits).toFixed(digits)));
	return ndigits;
}

export function isValidAddress(addr: string): boolean {
	return /^(0x){1}([a-f]|[A-F]|[0-9]){40}/.test(addr);
}

export function cronParserCheckExpression(pattern: string): boolean {
	let splitPattern = pattern.split("-");
	if (splitPattern.length != 4) {
		console.log("provide 4 dash separated arguments.");
		return false;
	}
	let [min, hour] = [splitPattern[0], splitPattern[1]];
	if (min == "*") {
		console.log("Invalid cron expression: provide minutes");
		return false;
	}
	if (hour == "*") {
		console.log("Invalid cron expression: provide hour");
	}
	let expr = convertSimplifiedPatternToCron(pattern);
	try {
		parser.parseExpression(expr, { utc: true });
	} catch (error) {
		let message = "";
		if (error instanceof Error) {
			message = error.message;
			console.log(message);
		}
		return false;
	}
	return true;
}

/**
 * 1-2-3-4
 * ┬ ┬ ┬ ┬
 * │ │ │ └── day of week
 * │ │ └──── day of month
 * │ └────── hour
 * └──────── minute
 * @param expr
 */
function convertSimplifiedPatternToCron(expr: string): string {
	// convert into
	/**  [1] 2 3 4 5 6 [7]
	 *    ┬ ┬ ┬ ┬ ┬ ┬ ┬
	 *    │ │ │ │ │ │ └── year (not supported)
	 *    │ │ │ │ │ └──── day of week
	 *    │ │ │ │ └────── month
	 *    │ │ │ └──────── day of month
	 *    │ │ └────────── hour
	 *    │ └──────────── minute
	 *    └────────────── second (not supported)
	 * */
	let [min, hour, dayOfMth, dayOfWk] = expr.split("-");
	let reordered = [min, hour, dayOfMth, "*", dayOfWk];
	return reordered.join(" ");
}

/**
 * 1 2 3 4
 * ┬ ┬ ┬ ┬
 * │ │ │ └── day of week
 * │ │ └──── day of month
 * │ └────── hour
 * └──────── minute
 * Uses https://github.com/harrisiirak/cron-parser
 * @param pattern
 * @returns true if no payment since last pattern matching date
 */
export function getPreviousCronDate(pattern: string): Date {
	let expr = convertSimplifiedPatternToCron(pattern);
	let interval = parser.parseExpression(expr, { utc: true });
	return new Date(interval.prev().toString());
}

/**
 * 1 2 3 4
 * ┬ ┬ ┬ ┬
 * │ │ │ └── day of week
 * │ │ └──── day of month
 * │ └────── hour
 * └──────── minute
 * Uses https://github.com/harrisiirak/cron-parser
 * @param pattern
 * @returns true if no payment since last pattern matching date
 */
export function getNextCronDate(pattern: string): Date {
	let expr = convertSimplifiedPatternToCron(pattern);
	let interval = parser.parseExpression(expr, { utc: true });
	return new Date(interval.next().toString());
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

export function constructRedis(name: string): RedisClientType {
	let originUrl = process.env.REDIS_URL;
	if (originUrl == undefined) {
		throw new Error("REDIS_URL not defined");
	}
	let config = { url: originUrl };
	console.log(`${name} connecting to redis: ${originUrl}`);
	let client: RedisClientType = createClient(config);
	const msg = `Redis Client ${name} Error`;
	client.on("error", (err) => console.log(msg, err));
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
 *
 * @param promise async function to be executed
 * @param timeoutMs timeout in MS
 * @param errMsgOnTimeout optional error message
 * @returns function return value or ends in error
 */
export function executeWithTimeout<T>(
	promise: Promise<T>,
	timeout: number,
	errMsgOnTimeout: string | undefined = undefined
): Promise<T> {
	let timeoutId: NodeJS.Timeout;

	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => {
			const msg = errMsgOnTimeout ?? "Function execution timed out.";
			reject(new Error(msg));
		}, timeout);
	});

	return Promise.race([promise, timeoutPromise]).finally(() => {
		clearTimeout(timeoutId);
	});
}

/**
 * Simple binary search approximation for finding block number nearest to since
 * date.
 * @param provider
 * @param since
 * @param mustBeBefore
 * @returns [block number most likely matching `since`, max block number]
 */
export async function calculateBlockFromTime(
	provider: any, // ethers.Provider,
	since: Date,
	mustBeBefore = true
): Promise<[number, number]> {
	// Maximum number of rpc calls to make for binary search. More calls gives
	// more precise results. 7 seems to find block number with at least matching
	// the day to `since`. 10 seems to be enough to match the hour. More calls
	// will take more time, but on premium RPC it should not matter too much.
	const MAX_RPC_CALLS = 7;
	// Precision in seconds when we'll treat the result as good enough.
	// Currently set to 6 hours.
	const precision = 6 * 3600;

	let { timestamp: rightBlockTime, number: rightBlockNum } = (await provider.getBlock(
		"latest"
	))!;

	const maxBlockNum = rightBlockNum;

	// Do not hardcode the values since they will differ between chains.
	let leftBlockTime = new Date(0).getTime() / 1000;
	let leftBlockNum = 0;

	let i = 0;
	while (i < MAX_RPC_CALLS) {
		let middleBlockNum = Math.round((leftBlockNum + rightBlockNum) / 2);
		let { timestamp: middleBlockTime } = (await provider.getBlock(middleBlockNum))!;
		if (middleBlockTime < since.getTime() / 1000) {
			leftBlockNum = middleBlockNum;
			leftBlockTime = middleBlockTime;
		} else {
			rightBlockNum = middleBlockNum;
			rightBlockTime = middleBlockTime;
		}

		// Once desired precision is reached, stop
		if (rightBlockTime - leftBlockTime < precision) {
			break;
		}
		i++;
	}

	// If we want to guarantee the result is before the desired time, return the
	// left pointers. Otherwise return the right pointers.
	if (mustBeBefore) {
		return [leftBlockNum, maxBlockNum];
	}
	return [rightBlockNum, maxBlockNum];
}

/**
 * Find a close block to 'since'.
 *
 * Approach:
 *  - get a past block and a proxy for the first block
 *  - linearly interpolate both segments, and find the implied block closest to 'since'
 *  - repeat the calculation until the maximum number of RPC calls is reached
 * @param provider ethers.provider
 * @param since date for which we are searching the block
 * @param mustBeBefore if set to true, guarantees that the block.timestamp is smaller
 *  than the since timestamp.
 * @returns block number that closely matches 'since', latest block number
 */
export async function calculateBlockFromTimeOld2(
	provider: any, //ethers.provider
	since: Date,
	mustBeBefore = true
): Promise<[number, number]> {
	const MAX_RPC_CALLS = 7;
	const TS_PRECISION = 60 * 2;
	const TS_MIN = 1680000000;

	const tsSinceMs = since.getTime();
	if (tsSinceMs < TS_MIN * 1000 || tsSinceMs > Date.now()) {
		const msg = `calculateBlockFromTime: invalid date since ${since}`;
		throw Error(msg);
	}
	const targetTS = Math.floor(since.getTime() / 1_000);

	// latest block: RPC #1
	let { number: latestBN, timestamp: latestTS } = await provider.getBlock("latest");
	//   console.log("rpc 1 block #", latestBN, "ts", latestTS);
	const maxBlockNumber = latestBN;
	if (latestTS <= targetTS) {
		// target is in the future, done
		return [latestBN, maxBlockNumber];
	}

	// early, reference block: RPC #2
	let factor = 0.9;
	let interpolatedBN = Math.max(1, Math.round(latestBN * factor));
	let { number: earlyBN, timestamp: earlyTS } = await provider.getBlock(interpolatedBN);
	//   console.log("rpc 2 block #", earlyBN, "ts", earlyTS);

	let numRPC = 2;
	while (numRPC < MAX_RPC_CALLS) {
		// piece-wise linear interpolation
		if (targetTS < earlyTS) {
			latestBN = earlyBN;
			latestTS = earlyTS;
			interpolatedBN = Math.round((targetTS / earlyTS) * earlyBN);
			//   earlyTS = TS_MIN;
		} else {
			interpolatedBN = Math.round(
				earlyBN +
					((latestBN - earlyBN) / (latestTS - earlyTS)) * (targetTS - earlyTS)
			);
		}
		let { number: bn, timestamp: ts } = await provider.getBlock(interpolatedBN);
		numRPC += 1;

		if (ts <= targetTS) {
			earlyBN = bn;
			earlyTS = ts;
		} else {
			latestBN = bn;
			latestTS = ts;
		}
		// console.log("rpc", numRPC, "block #", bn, "ts", ts, "|t_R - t_L| =", Math.round(latestTS - earlyTS));
		if (latestTS - earlyTS < TS_PRECISION) {
			return [earlyBN, maxBlockNumber];
		}
	}
	// didn't find the exact block, but have one that's not too much earlier
	if (mustBeBefore) {
		return [earlyBN, maxBlockNumber];
	} else {
		return [Math.round((earlyBN + latestBN) / 2), maxBlockNumber];
	}
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
export async function calculateBlockFromTimeOld(
	provider: any, //ethers.provider
	since: Date,
	mustBeBefore = true
): Promise<[number, number]> {
	// rpc #1 & #2
	//   let max = await provider.getBlockNumber();
	//   const blk1 = await provider.getBlock(max);
	const tsSinceMs = since.getTime();
	if (tsSinceMs < 1640995232000 || tsSinceMs > Date.now()) {
		const msg = `calculateBlockFromTime: invalid date since ${since}`;
		throw Error(msg);
	}
	let blk1 = await provider.getBlock("latest");
	let max = blk1.number;
	const targetTimestamp = tsSinceMs / 1000;
	const secElapsed = blk1.timestamp - targetTimestamp;

	let blockSampleNum = Math.floor(secElapsed / 2);
	if (blockSampleNum >= max) {
		// 2 second blocks would mean more than current number of blocks
		// --> too many, it was a bad estimate, default to a simpler estimate
		blockSampleNum = Math.floor(max / 10);
	}
	// rpc #3
	let blk0;
	let iterNum = 0;
	let rpcErr = true;
	while (rpcErr) {
		try {
			blk0 = await provider.getBlock(max - blockSampleNum);
			rpcErr = false;
		} catch (err) {
			// likely Blockheight too far in the past
			blockSampleNum = Math.ceil(blockSampleNum * 0.75);
			iterNum++;
			if (iterNum > 10) {
				throw err;
			}
		}
	}
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
	secPerBlockInSample = Math.abs(
		(blk.timestamp - blk0.timestamp) / (blk.number - blk0.number)
	);
	// linearly step back by number of blocks
	while (currTimestamp > targetTimestamp) {
		let numBlocks = Math.ceil(
			(currTimestamp - targetTimestamp) / secPerBlockInSample
		);
		blk = await provider.getBlock(blk.number - numBlocks);
		//rpcCount++;
		currTimestamp = blk.timestamp;
	}
	//console.log("rpccount=", rpcCount);
	return [blk.number, max];
}

export function chooseRandomRPC(ws = false, rpcConfig: RPCConfig[]): string {
	dotenv.config();
	let chainId: number = Number(<string>process.env.CHAIN_ID || -1);
	if (chainId == -1) {
		throw new Error("Set CHAIN_ID in .env (e.g. CHAIN_ID=80001)");
	}
	let urls: string[] = [];
	for (let k = 0; k < rpcConfig.length; k++) {
		if (rpcConfig[k].chainId == chainId) {
			if (ws) {
				urls = rpcConfig[k].WS;
			} else {
				urls = rpcConfig[k].HTTP;
			}
		}
	}
	if (urls.length < 1) {
		throw new Error(
			`No ${ws ? "Websocket" : "HTTP"} RPC defined for chain ID ${chainId}`
		);
	}
	return urls[Math.floor(Math.random() * urls.length)];
}

export const loadConfigRPC = (): any => loadConfigFile("rpc", "CONFIG_PATH_RPC");
export const loadConfigReferralSettings = (): any =>
	loadConfigFile("referralSettings", "CONFIG_PATH_REFERRAL_SETTINGS");
export const loadConfigWsConfig = (): any =>
	loadConfigFile("wsConfig", "CONFIG_PATH_WSCFG");

/**
 * Attempt to load config files. Environment variables CONFIG_PATH_RPC,
 * CONFIG_PATH_REFERRAL_SETTINGS, CONFIG_PATH_WSCFG can be used to provide
 *
 * @param cfgName name of config file
 * @param cfgEnvKey process.env key of config path
 * @throws Error if config file can not be found
 */
export const loadConfigFile = (cfgName: string, cfgEnvKey: string): any => {
	const envPath = process.env[cfgEnvKey]!;
	if (envPath !== undefined) {
		console.log(`[INFO] attempting to load config ${envPath}`);
		const fileContent = fs.readFileSync(envPath).toString();
		return JSON.parse(fileContent);
	} else {
		console.warn(`[WARNING] ENV variable ${cfgEnvKey} is not set`);
	}

	// Attempt to load default development path from the root of monorepo.
	// Assuming the caller is in packages/<svc>/dist/index.js
	const defaultPath = `../../../config/live.${cfgName}.json`;
	try {
		const fileContent = fs.readFileSync(defaultPath).toString();
		return JSON.parse(fileContent);
	} catch (e) {
		throw Error(`Configuration file ${defaultPath} could not be loaded`);
	}
};
