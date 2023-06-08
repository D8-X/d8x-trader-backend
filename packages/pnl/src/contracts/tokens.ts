import { JsonRpcProvider, Contract } from "ethers";
import { MarketData } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv } from "../utils/abi";
import { MarginTokenInfo, MarginTokenData } from "../db/margin_token_info";

export let retrievedShareTokenAddresses: string[] = [];
export let retrievedMarginTokenInfo: Array<MarginTokenData>;

// Retrieves shared tokens contract addresses from exchange info. Each index in
// return array is the ith pool. Pool ids are counted from 1 in the contratcs.
export async function retrieveShareTokenContracts(): Promise<string[]> {
	if (retrievedShareTokenAddresses.length === 0) {
		throw Error("initShareAndPoolTokenContracts required");
	}
	return retrievedShareTokenAddresses;
}

export async function initShareAndPoolTokenContracts(provider: JsonRpcProvider) {
	const sdk = getSDKFromEnv();
	const md = new MarketData(sdk);
	await md.createProxyInstance();
	const info = await md.exchangeInfo();
	const addresses = info.pools.map((p) => p.poolShareTokenAddr);
	retrievedShareTokenAddresses = addresses;
	retrievedMarginTokenInfo = new Array<{
		poolId: number;
		tokenAddr: string;
		tokenName: string;
		tokenDecimals: number;
	}>();

	const tknAbi = [
		// ... ERC-20 standard ABI ...
		// Include the "decimals" function
		"function decimals() view returns (uint8)",
	];

	for (let j = 0; j < info.pools.length; j++) {
		const c = new Contract(info.pools[j].marginTokenAddr, tknAbi, provider);
		let dec = await c.decimals();
		retrievedMarginTokenInfo.push({
			poolId: j + 1,
			tokenAddr: info.pools[j].marginTokenAddr,
			tokenName: info.pools[j].poolSymbol,
			tokenDecimals: Number(dec),
		});
	}
}

export async function checkAndWriteMarginTokenInfoToDB(dbHandler: MarginTokenInfo) {
	if (retrievedMarginTokenInfo.length === 0) {
		throw Error("initShareAndPoolTokenContracts required");
	}
	// check db
	for (let j = 0; j < retrievedMarginTokenInfo.length; j++) {
		let dbEntry = await dbHandler.getMarginTokenInfo(
			retrievedMarginTokenInfo[j].poolId
		);
		if (dbEntry == undefined) {
			await dbHandler.insert(retrievedMarginTokenInfo[j]);
		} else {
			// check data
			if (
				dbEntry.poolId != retrievedMarginTokenInfo[j].poolId ||
				dbEntry.tokenAddr != retrievedMarginTokenInfo[j].tokenAddr ||
				dbEntry.tokenName != retrievedMarginTokenInfo[j].tokenName
			) {
				await dbHandler.replace(retrievedMarginTokenInfo[j]);
			}
		}
	}
}
