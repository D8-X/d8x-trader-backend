import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv } from "../utils/abi";
import { JsonRpcProvider, ethers } from "ethers";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { add } from "date-fns";

export let retrievedShareTokenContracts: string[] = [];

// Retrieves shared tokens contract addresses from exchange info. Each index in
// return array is the ith pool. Pool ids are counted from 1 in the contratcs.
export const retrieveShareTokenContracts = async () => {
	if (retrievedShareTokenContracts.length === 0) {
		const sdk = getSDKFromEnv();
		const md = new MarketData(sdk);
		await md.createProxyInstance();
		const info = await md.exchangeInfo();
		const addresses = info.pools.map((p) => p.poolShareTokenAddr);
		retrievedShareTokenContracts = addresses;
	}

	return retrievedShareTokenContracts;
};
