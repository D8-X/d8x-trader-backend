import { JsonRpcProvider, Contract } from "ethers";
import { MarketData, PerpetualStaticInfo, SDKState } from "@d8-x/d8x-node-sdk";
import { getSDKConfigFromEnv } from "../utils/abi.js";
import { MarginTokenInfo, MarginTokenData } from "../db/margin_token_info.js";

export default class StaticInfo {
	public retrievedShareTokenAddresses: string[] = [];
	public retrievedMarginTokenInfo: Map<number, MarginTokenData>; //pool->tokenInfo
	public sdkState: SDKState | undefined;

	constructor() {
		this.retrievedMarginTokenInfo = new Map<number, MarginTokenData>();
	}

	/**
	 * Retrieves shared tokens contract addresses from exchange info. Each index in
	 * @returns array of share token contract addresses, where index 0 corresponds to pool id 1
	 */
	public retrieveShareTokenContracts(): string[] {
		if (this.retrievedShareTokenAddresses.length === 0) {
			throw Error("initStaticData required");
		}
		return this.retrievedShareTokenAddresses;
	}

	/**
	 * Initialize "static" data (that changes not or rarely) from blockchain:
	 * - margin token information for each pool
	 * - share token addresses for each pool
	 * - referral rebate that people who execute trades receive
	 * @param provider RPC
	 */
	public async initialize(provider: JsonRpcProvider, httpRpcUrl: string) {
		const config = getSDKConfigFromEnv();
		config.nodeURL = httpRpcUrl;
		const md = new MarketData(config);

		await md.createProxyInstance();
		this.sdkState = md.exportState();
		const info = await md.exchangeInfo();
		const addresses = info.pools.map((p) => p.poolShareTokenAddr);
		this.retrievedShareTokenAddresses = addresses;
		this.retrievedMarginTokenInfo = new Map<number, MarginTokenData>();
		const tknAbi = [
			// ... ERC-20 standard ABI ...
			// Include the "decimals" function
			"function decimals() view returns (uint8)",
		];

		for (let j = 0; j < info.pools.length; j++) {
			const c = new Contract(info.pools[j].marginTokenAddr, tknAbi, provider);
			const dec = await c.decimals();
			this.retrievedMarginTokenInfo.set(j + 1, {
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
				const perpInfo: PerpetualStaticInfo =
					await md.getPerpetualStaticInfo(perpSymbol);
			}
		}
	}

	/**
	 * Get the decimal number convention (e.g. Decimal 18, a 10^18 fixed-point representation)
	 * for the margin collateral token of a given pool
	 * @param poolId id of the pool (starting at 1)
	 * @returns token decimals for the margin token of this pool
	 */
	public getMarginTokenDecimals(poolId: number): number {
		const val = this.retrievedMarginTokenInfo.get(poolId);
		if (val == undefined) {
			throw Error("margin token decimals not defined");
		}
		return val.tokenDecimals;
	}

	/**
	 * Checks if margin token info in DB is up to date with the one retrieved from chain, and if not, updates the DB
	 * @param dbHandler DB handler for margin token info
	 */
	public async checkAndWriteMarginTokenInfoToDB(dbHandler: MarginTokenInfo) {
		if (this.retrievedMarginTokenInfo.size === 0) {
			throw Error("initStaticData required");
		}
		for (let j = 0; j < this.retrievedMarginTokenInfo.size; j++) {
			const poolId = j + 1;
			const dbEntry = await dbHandler.getMarginTokenInfo(poolId);
			if (dbEntry == undefined) {
				await dbHandler.insert(this.retrievedMarginTokenInfo.get(poolId)!);
			} else {
				const el = this.retrievedMarginTokenInfo.get(poolId)!;
				if (
					dbEntry.poolId != poolId ||
					dbEntry.tokenAddr != el.tokenAddr ||
					dbEntry.tokenName != el.tokenName
				) {
					await dbHandler.replace(el);
				}
			}
		}
	}
}
