import { JsonRpcProvider, Contract } from "ethers";
import { MarketData, PerpetualStaticInfo } from "@d8x/perpetuals-sdk";
import { getSDKFromEnv } from "../utils/abi";
import { MarginTokenInfo, MarginTokenData } from "../db/margin_token_info";
import { floatToABK64x64 } from "utils";

export let retrievedShareTokenAddresses: string[] = [];
export let retrievedMarginTokenInfo: Array<MarginTokenData>;

// Retrieves shared tokens contract addresses from exchange info. Each index in
// return array is the ith pool. Pool ids are counted from 1 in the contracts.
export async function retrieveShareTokenContracts(): Promise<string[]> {
	if (retrievedShareTokenAddresses.length === 0) {
		throw Error("initShareAndPoolTokenContracts required");
	}
	return retrievedShareTokenAddresses;
}

/**
 * Initialize "static" data (that changes nor or not rarely):
 * - margin token information for each pool
 * - share token addresses for each pool
 * - referral rebate that people who execute trades receive
 * @param provider RPC
 */
export async function initStaticData(provider: JsonRpcProvider) {
	const sdk = getSDKFromEnv();
	const md = new MarketData(sdk);

	await md.createProxyInstance();
	const info = await md.exchangeInfo();
	const addresses = info.pools.map((p) => p.poolShareTokenAddr);
	retrievedShareTokenAddresses = addresses;
	retrievedMarginTokenInfo = new Array<MarginTokenData>();
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
		// referrel rebates
		for (let k = 0; k < info.pools[j].perpetuals.length; k++) {
			const perpId = info.pools[j].perpetuals[k].id;
			const perpSymbol = md.getSymbolFromPerpId(perpId);
			if (perpSymbol == undefined) {
				console.log(`No symbol found for perpetual id=${perpId}`);
				continue;
			}
			let perpInfo: PerpetualStaticInfo = await md.getPerpetualStaticInfo(
				perpSymbol
			);
		}
	}
}

export async function checkAndWriteMarginTokenInfoToDB(dbHandler: MarginTokenInfo) {
	if (retrievedMarginTokenInfo.length === 0) {
		throw Error("initStaticData required");
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
