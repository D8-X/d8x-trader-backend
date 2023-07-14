import { ethers, providers } from "ethers";
import {
  getPreviousCronDate,
  cronParserCheckExpression,
  calculateBlockFromTime,
  floatToDec18,
  adjustNDigitPercentagesTo100,
  chooseRandomRPC,
} from "../packages/utils/src/utils";
import { error } from "console";
async function test() {
  const rpcConfig = require("../config/example.rpc.json");
  const rpcURL = chooseRandomRPC(false, rpcConfig);
  const provider = new providers.StaticJsonRpcProvider(rpcURL);
  let R = (Math.random() - 0.5) / 0.5;
  let sinceTs = new Date("2023-06-01T01:01:00.000Z").getTime() + Math.round(1000 * R * 20 * 86400);
  let sinceDate = new Date(sinceTs);
  console.log("Target = ", sinceDate);

  console.log("\nReduced RPC call version");
  let [from1, to1] = await calculateBlockFromTime(provider, sinceDate, true);
  let ts1 = (await provider.getBlock(from1)).timestamp;
  let from1Timestamp = new Date(ts1 * 1000);
  console.log("error sec=", ts1 - sinceDate.getTime() / 1000);
  console.log("\t", from1, to1, from1Timestamp);

  /*console.log("\nExisting version");
  let [from0, to0] = await calculateBlockFromTimeOld(provider, sinceDate);
  let ts0 = (await provider.getBlock(from0)).timestamp;
  let from0Timestamp = new Date(ts0 * 1000);
  console.log("error sec=", ts0 - sinceDate.getTime() / 1000);
  console.log("\t", from0, to0, from0Timestamp);*/
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

//testGetPrevDate();
testadjustNDigitPercentagesTo100();
