import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv, getShareTokenContractABI } from "../utils/abi";
import { Contract, JsonRpcProvider, Provider, ethers } from "ethers";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { add } from "date-fns";

export let retrievedShareTokenContracts: string[] = [];

// Retrieves shared tokens contract addresses from exchange info. Each index in
// return array is the ith pool. Pool ids are counted from 1 in the contratcs.
// If fresh is true, data is refreshed
export const retrieveShareTokenContracts = async (fresh: boolean = false) => {
	if (retrievedShareTokenContracts.length === 0 || fresh) {
		const sdk = getSDKFromEnv();
		const md = new MarketData(sdk);
		await md.createProxyInstance();
		const info = await md.exchangeInfo();
		const addresses = info.pools.map((p) => {
			return p.poolShareTokenAddr;
		});
		retrievedShareTokenContracts = addresses;
	}

	return retrievedShareTokenContracts;
};

// Retrieves the token decimals value
export const getShareTokenDecimals = async (
	tokenAddress: string,
	provider: Provider
): Promise<number> => {
	const abi = await getShareTokenContractABI();
	const c = new Contract(tokenAddress, abi, provider);
	return parseInt(((await c.decimals()) as BigInt).toString());
};
