import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv, getShareTokenContractABI } from "../utils/abi";
import { Contract, JsonRpcProvider, Provider, ethers } from "ethers";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { add } from "date-fns";
import { TokenDecimals } from "../db/token_decimals";

export let retrievedShareTokenContracts: string[] = [];
export let retrievedMarginTokenContracts: string[] = [];

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

// same as retrieveShareTokenContracts but for margin tokens
export const retrieveMarginTokenContracts = async (fresh: boolean = false) => {
	if (retrievedMarginTokenContracts.length === 0 || fresh) {
		const sdk = getSDKFromEnv();
		const md = new MarketData(sdk);
		await md.createProxyInstance();
		const info = await md.exchangeInfo();
		const addresses = info.pools.map((p) => {
			return p.marginTokenAddr;
		});
		retrievedMarginTokenContracts = addresses;
	}

	return retrievedMarginTokenContracts;
};

// getPoolTokenAddress attempts to retrieve share or margin token address for
// given poolId. If pool can't be found, undefined will be returned
export const getPoolTokenAddress = async (poolId: number, shareToken: boolean = true) => {
	if (poolId <= 0) {
		return undefined;
	}
	const addressesList = shareToken
		? retrievedShareTokenContracts
		: retrieveMarginTokenContracts;

	// Attempt to refetch stale data if given pool id is larger than what we currently have
	if (addressesList.length < poolId) {
		if (shareToken) {
			await retrieveShareTokenContracts(true);
		} else {
			await retrieveMarginTokenContracts(true);
		}
	}

	// Pool ids are counted from 1
	return (shareToken ? retrievedShareTokenContracts : retrievedMarginTokenContracts)[
		poolId - 1
	];
};

export const getPoolShareTokenAddress = async (poolId: number) =>
	getPoolTokenAddress(poolId, true);
export const getPoolMarginTokenAddress = async (poolId: number) =>
	getPoolTokenAddress(poolId, false);

// Retrieves the token decimals value
export const getTokenDecimals = async (
	tokenAddress: string,
	provider: Provider
): Promise<number> => {
	const abi = await getShareTokenContractABI(); //  we just need erc-20
	const c = new Contract(tokenAddress, abi, provider);
	return parseInt(((await c.decimals()) as BigInt).toString());
};

// Attempts to retrieve share and margin token decimals and insert them into db
export const insertPoolTokenDecimalsInDb = async (
	poolId: number,
	dbDecimals: TokenDecimals,
	httpProvider: Provider
) => {
	// Attempt to insert share token decimals
	const shareTokenAddress = await getPoolShareTokenAddress(poolId);
	if (shareTokenAddress) {
		const dec = await getTokenDecimals(shareTokenAddress, httpProvider);
		await dbDecimals.insert(poolId, shareTokenAddress, dec, true);
	}

	const marginTokenAddress = await getPoolMarginTokenAddress(poolId);
	if (marginTokenAddress) {
		const dec = await getTokenDecimals(marginTokenAddress, httpProvider);
		await dbDecimals.insert(poolId, marginTokenAddress, dec, false);
	}
};
