import { ethers, providers } from "ethers";
import {
	getPreviousCronDate,
	cronParserCheckExpression,
	calculateBlockFromTime,
	calculateBlockFromTimeOld,
	floatToDec18,
	adjustNDigitPercentagesTo100,
	chooseRandomRPC,
	calculateBlockFromTimeOld2,
} from "../packages/utils/src/utils";
import { error } from "console";

async function testCalculateBlockFromTime() {
	const rpcConfig = require("../config/example.rpc.json");
	const rpcURL = chooseRandomRPC(false, rpcConfig);
	const provider = new providers.StaticJsonRpcProvider(rpcURL);
	let R = (Math.random() - 0.5) / 0.5;
	let sinceTs =
		new Date("2023-07-01T01:01:00.000Z").getTime() +
		Math.round(1000 * R * 20 * 86400);
	let sinceDate = new Date(sinceTs);
	console.log("Target = ", sinceDate);

	console.log("\nBinary search version");
	let [from1, to1] = await calculateBlockFromTime(provider, sinceDate, true);
	let ts1 = (await provider.getBlock(from1)).timestamp;
	let from1Timestamp = new Date(ts1 * 1000);
	console.log("error sec=", ts1 - sinceDate.getTime() / 1000);
	console.log("got timestamp=", from1Timestamp);
	console.log("\t block nums=", from1, to1);

	console.log("\nReduced RPC call version");
	let [from2, to2] = await calculateBlockFromTimeOld2(provider, sinceDate, true);
	let ts2 = (await provider.getBlock(from2)).timestamp;
	let from2Timestamp = new Date(ts2 * 1000);
	console.log("error sec=", ts2 - sinceDate.getTime() / 1000);
	console.log("got timestamp=", from2Timestamp);
	console.log("\t block nums=", from2, to2);

	console.log("\nOld version");
	let [from0, to0] = await calculateBlockFromTimeOld(provider, sinceDate, true);
	let ts0 = (await provider.getBlock(from0)).timestamp;
	let from0Timestamp = new Date(ts0 * 1000);
	console.log("error sec=", ts0 - sinceDate.getTime() / 1000);
	console.log("got timestamp=", from0Timestamp);
	console.log("\t block nums=", from0, to0);
}

function testGetPrevDate() {
	//"paymentScheduleMinHourDayofmonthWeekday": "0-14-*-0",

	let bWrong = cronParserCheckExpression("0-14-8-*-*-*");

	let pattern = "0-14-*-3";
	let aRight = cronParserCheckExpression(pattern);
	let v = getPreviousCronDate(pattern);
	console.log(v);
}

function testadjustNDigitPercentagesTo100() {
	//let v = adjustNDigitPercentagesTo100([98.1212, 2, 0, 1], 2);
	let v = adjustNDigitPercentagesTo100([98.1, 0.1, 0, 0.5], 2);
	console.log(v);
	let s = 0;
	v.forEach((x) => (s += x));
	console.log("sum=", s);
}
//test();
testCalculateBlockFromTime();
//testGetPrevDate();
//testadjustNDigitPercentagesTo100();
