import { ethers, providers } from "ethers";
import { calculateBlockFromTime2, calculateBlockFromTime, floatToDec18 } from "../packages/utils/src/utils";
import { error } from "console";
async function test() {
  const rpcURL = process.env.HTTP_RPC_URL;
  if (rpcURL == "") {
    throw Error("define HTTP_RPC_URL in env");
  }
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
test();
