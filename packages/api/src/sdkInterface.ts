import {
	BUY_SIDE,
	ExchangeInfo,
	NodeSDKConfig,
	Order,
	PerpetualState,
	PoolState,
	SELL_SIDE,
	TraderInterface,
	MarginAccount,
	floatToABK64x64,
	SmartContractOrder,
	D8X_SDK_VERSION,
	ZERO_ADDRESS,
} from "@d8x/perpetuals-sdk";
import dotenv from "dotenv";
import BrokerIntegration from "./brokerIntegration";
import Observable from "./observable";
import type { RedisClientType } from "redis";
import { extractErrorMsg, constructRedis } from "utils";
import RPCManager from "./rpcManager";
import { TrackedJsonRpcProvider } from "./providers";
import { toQuantity } from "ethers";
import RedisOI from "./redisOI";

export type OrderWithTraderAndId = Order & { orderId: string; trader: string };

export interface OrderBook {
	poolId: number;
	perpId: number;
	sym: string;
	numOrders: number;
	orders: OrderWithTraderAndId[];
}

export default class SDKInterface extends Observable {
	private apiInterface: TraderInterface | undefined = undefined;
	private redisClient: RedisClientType;
	private broker: BrokerIntegration;
	TIMEOUTSEC = 5 * 60; // timeout for exchange info
	private MUTEX_TS_EXCHANGE_INFO = 0; // mutex for exchange info query
	private rpcManager: RPCManager | undefined;

	constructor(broker: BrokerIntegration) {
		super();
		dotenv.config();
		this.redisClient = constructRedis("SDK Interface");
		this.broker = broker;
	}

	public async initialize(sdkConfig: NodeSDKConfig, rpcManager: RPCManager) {
		this.apiInterface = new TraderInterface(sdkConfig);
		this.rpcManager = rpcManager;
		await this.apiInterface.createProxyInstance(
			new TrackedJsonRpcProvider(sdkConfig.nodeURL),
		);
		await this.broker.initialize(sdkConfig);
		const brokerAddress = await this.broker.getBrokerAddress();
		if (!this.redisClient.isOpen) {
			await this.redisClient.connect();
		}
		console.log(`Main API initialized broker address=`, brokerAddress);
		console.log(`SDK v${D8X_SDK_VERSION} API initialized`);
	}

	private async cacheExchangeInfo() {
		const tsQuery = Date.now();
		await this.redisClient.hSet("exchangeInfo", "ts:query", tsQuery);
		const xchInfo = await this.apiInterface!.exchangeInfo({
			rpcURL: await this.rpcManager?.getRPC(),
		});
		// extend xchInfo with 24h OI
		for (let j = 0; j < xchInfo.pools.length; j++) {
			for (let k = 0; k < xchInfo.pools[j].perpetuals.length; k++) {
				const id = xchInfo.pools[j].perpetuals[k].id;
				const oi = await RedisOI.getMax24h(id, this.redisClient);
				(xchInfo.pools[j].perpetuals[k] as any).openInterestBC24h = oi;
			}
		}
		const info = JSON.stringify(xchInfo);
		await this.redisClient.hSet("exchangeInfo", [
			"ts:response",
			Date.now(),
			"content",
			info,
		]);
		this.notifyObservers("exchangeInfo");
		return info;
	}

	public async exchangeInfo(): Promise<string> {
		const obj = await this.redisClient.hGetAll("exchangeInfo");
		let info: string = "";
		this.checkAPIInitialized(); // can throw
		if (!Object.prototype.hasOwnProperty.call(obj, "ts:query")) {
			console.log("first time query");

			info = await this.cacheExchangeInfo();
		} else if (!Object.prototype.hasOwnProperty.call(obj, "content")) {
			console.log("re-query exchange info (latest: invalid)");
			info = await this.cacheExchangeInfo();
		} else {
			const timeElapsedS = (Date.now() - parseInt(obj["ts:query"])) / 1000;
			// prevent multiple clients calling at the same time via "MUTEX"
			const delay = Date.now() - this.MUTEX_TS_EXCHANGE_INFO;
			if (delay > 60_000 && timeElapsedS > this.TIMEOUTSEC) {
				this.MUTEX_TS_EXCHANGE_INFO = Date.now();
				// reload data through API
				// no await
				console.log("re-query exchange info (latest: expired)");
				this.cacheExchangeInfo();
			}
			info = obj["content"];
		}

		return info;
	}

	/**
	 * Get the loyalty score of the trader
	 * @param traderAddr address of the trader
	 * @returns loyalty score
	 */
	public async traderLoyalty(traderAddr: string): Promise<string> {
		const key = "loyal:" + traderAddr;
		let res: string | null = await this.redisClient.get(key);
		if (res == null) {
			const expirationSec = 86400;
			const score = await this.apiInterface!.getTraderLoyalityScore(traderAddr);
			res = score.toString();
			this.redisClient.setEx(key, expirationSec, res);
		}
		return res;
	}

	public perpetualStaticInfo(symbol: string): string {
		const staticInfo = this.apiInterface!.getPerpetualStaticInfo(symbol);
		const info = JSON.stringify(staticInfo);
		return info;
	}

	public isPredictionMarket(symbol: string): boolean {
		return this.apiInterface!.isPredictionMarket(symbol);
	}

	/**
	 * Get perpetual symbol from perpetual id
	 * @param perpId id of perpetual
	 * @returns symbol (BTC-USD-MATIC) or undefined - not JSON
	 */
	public getSymbolFromPerpId(perpId: number): string | undefined {
		return this.apiInterface!.getSymbolFromPerpId(perpId);
	}

	public async updateExchangeInfoNumbersOfPerpetual(
		symbol: string,
		values: number[],
		propertyNames: string[],
	) {
		const obj = await this.redisClient.hGetAll("exchangeInfo");
		const info = <ExchangeInfo>JSON.parse(obj["content"]);
		const [k, j] = SDKInterface.findPoolAndPerpIdx(symbol, info);
		const perpState: PerpetualState = info.pools[k].perpetuals[j];
		for (let m = 0; m < values.length; m++) {
			switch (propertyNames[m]) {
				case "indexPrice":
					perpState.indexPrice = values[m];
					break;
				case "markPrice":
					perpState.markPrice = values[m];
					break;
				case "currentFundingRateBps":
					if (values[m] != 0) {
						perpState.currentFundingRateBps = values[m];
					}
					break;
				case "midPrice":
					perpState.midPrice = values[m];
					break;
				case "openInterestBC":
					if (values[m] != 0) {
						perpState.openInterestBC = values[m];
					}
					break;
				default:
					throw new Error(`unknown property name ${propertyNames[m]}`);
			}
		}
		// store back to redis: we don't update the timestamp "ts:query", so that
		// all information will still be pulled at some time
		const infoStr = JSON.stringify(info);
		await this.redisClient.hSet("exchangeInfo", [
			"ts:response",
			Date.now(),
			"content",
			infoStr,
		]);
		// we do not notify the observers since this function is called as a result of eventListener changes and
		// eventListeners are observers
	}

	public static findPoolIdx(poolSymbol: string, pools: PoolState[]): number {
		let k = 0;
		while (k < pools.length) {
			if (pools[k].poolSymbol == poolSymbol) {
				// pool found
				return k;
			}
			k++;
		}
		return -1;
	}

	public static findPerpetualInPool(
		base: string,
		quote: string,
		perpetuals: PerpetualState[],
	): number {
		let k = 0;
		while (k < perpetuals.length) {
			if (
				perpetuals[k].baseCurrency == base &&
				perpetuals[k].quoteCurrency == quote
			) {
				// perpetual found
				return k;
			}
			k++;
		}
		return -1;
	}

	public static findPoolAndPerpIdx(
		symbol: string,
		info: ExchangeInfo,
	): [number, number] {
		const pools = <PoolState[]>info.pools;
		const symbols = symbol.split("-");
		const k = SDKInterface.findPoolIdx(symbols[2], pools);
		if (k == -1) {
			throw new Error(`No pool found with symbol ${symbol}`);
		}
		const j = SDKInterface.findPerpetualInPool(
			symbols[0],
			symbols[1],
			pools[k].perpetuals,
		);
		if (j == -1) {
			throw new Error(`No perpetual found with symbol ${symbol}`);
		}
		return [k, j];
	}

	/**
	 * Get the PerpetualState from exchange info
	 * @param symbol perpetual symbol (e.g., BTC-USD-MATIC)
	 */
	public async extractPerpetualStateFromExchangeInfo(
		symbol: string,
	): Promise<PerpetualState> {
		const info = JSON.parse(await this.exchangeInfo());
		const [k, j] = SDKInterface.findPoolAndPerpIdx(symbol, info);
		const perpState: PerpetualState = info.pools[k].perpetuals[j];
		return perpState;
	}

	private checkAPIInitialized() {
		if (this.apiInterface == undefined) {
			throw Error("SDKInterface not initialized");
		}
	}

	/**
	 * Send open orders for a given trader in either one perpetual or
	 * all perpetuals of the pool
	 * @param addr trader address
	 * @param symbol either a pool symbol ("MATIC") or a perpetual ("BTC-USD-MATIC")
	 * @returns JSON array with open orders { orders: Order[]; orderIds: string[] }
	 */
	public async openOrders(addr: string, symbol?: string) {
		try {
			this.checkAPIInitialized();
			const res = await this.apiInterface?.openOrders(addr, symbol, {
				rpcURL: await this.rpcManager?.getRPC(),
			});
			return JSON.stringify(res);
		} catch (error) {
			return JSON.stringify({ error: extractErrorMsg(error) });
		}
	}

	/**
	 * Send position risk for a given trader in either one perpetual or
	 * all perpetuals of the pool
	 * @param addr address of the trader
	 * @param symbol either a pool symbol ("MATIC") or a perpetual ("BTC-USD-MATIC")
	 * @returns JSON array with MarginAccount
	 */
	public async positionRisk(addr: string, symbol?: string) {
		this.checkAPIInitialized();
		const resArray = await this.apiInterface!.positionRisk(addr, symbol);
		return JSON.stringify(resArray);
	}

	public async maxOrderSizeForTrader(addr: string, symbol: string): Promise<string> {
		this.checkAPIInitialized();
		const sizes = await this.apiInterface!.maxOrderSizeForTrader(addr, symbol);
		return JSON.stringify({ buy: sizes.buy, sell: sizes.sell });
	}

	public async queryFee(traderAddr: string, poolSymbol: string): Promise<string> {
		this.checkAPIInitialized();
		const key = "fee:" + traderAddr + ":" + poolSymbol;
		let fee: number | undefined = 0;
		let feeStr: string | null = await this.redisClient.get(key);
		if (feeStr == null) {
			const brokerAddr = await this.broker.getBrokerAddress();
			fee = await this.apiInterface?.queryExchangeFee(
				poolSymbol,
				traderAddr,
				brokerAddr,
			);
			if (fee == undefined) {
				throw new Error("could not get fee");
			}
			fee = Math.round(
				fee * 1e5 + (await this.broker.getBrokerFeeTBps(traderAddr)),
			);
			feeStr = fee.toFixed(0);
			const expirationSec = 86400;
			this.redisClient.setEx(key, expirationSec, feeStr);
		} else {
			fee = parseInt(feeStr);
		}

		return JSON.stringify(fee);
	}

	public async orderDigest(orders: Order[], traderAddr: string): Promise<string> {
		this.checkAPIInitialized();
		//console.log("order=", orders);
		if (!orders.every((order: Order) => order.symbol == orders[0].symbol)) {
			throw Error("orders must have the same symbol");
		}

		// Note that order field is not used in remote broker integration
		const brokerFeeTbps = await this.broker.getBrokerFeeTBps(traderAddr, undefined);
		const brokerAddr = await this.broker.getBrokerAddress();
		const SCOrders = await Promise.all(
			orders!.map(async (order: Order) => {
				if (order.brokerAddr == undefined) {
					order.brokerAddr = brokerAddr;
				}
				const SCOrder = this.apiInterface?.createSmartContractOrder(
					order,
					traderAddr,
				);
				SCOrder!.brokerSignature = await this.broker.signOrder(SCOrder!);
				return SCOrder!;
			}),
		);
		// now we can create the digest that is to be signed by the trader
		const digests = await Promise.all(
			SCOrders.map((SCOrder: SmartContractOrder) => {
				return this.apiInterface?.orderDigest(SCOrder);
			}),
		);
		const ids = await Promise.all(
			digests.map((digest) => {
				return this.apiInterface!.digestTool.createOrderId(digest!);
			}),
		);
		// also return the order book address and postOrder ABI
		const obAddr = this.apiInterface!.getOrderBookAddress(orders[0].symbol);
		const resp = JSON.stringify({
			digests: digests,
			orderIds: ids,
			OrderBookAddr: obAddr,
			brokerAddr,
			brokerFeeTbps,
			brokerSignatures: SCOrders.map(({ brokerSignature }) => brokerSignature),
		});
		console.log("signed order response:", resp);
		return resp;
	}

	public async positionRiskOnCollateralAction(
		traderAddr: string,
		deltaCollateral: number,
		positionRisk: MarginAccount,
	): Promise<string> {
		this.checkAPIInitialized();
		const res: MarginAccount =
			await this.apiInterface!.positionRiskOnCollateralAction(
				deltaCollateral,
				positionRisk,
			);
		return JSON.stringify({
			newPositionRisk: res,
			availableMargin: await this.apiInterface!.getAvailableMargin(
				traderAddr,
				positionRisk.symbol,
			),
		});
	}

	public async addCollateral(symbol: string): Promise<string> {
		this.checkAPIInitialized();
		// contract data
		const proxyAddr = this.apiInterface!.getProxyAddress();
		// call data
		const perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
		const priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
		return JSON.stringify({
			perpId: perpId,
			proxyAddr: proxyAddr,
			priceUpdate: {
				updateData: priceUpdate.priceFeedVaas,
				publishTimes: priceUpdate.timestamps,
				updateFee:
					this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
					priceUpdate.priceFeedVaas.length,
			},
		});
	}

	public async removeCollateral(symbol: string): Promise<string> {
		this.checkAPIInitialized();
		// contract data
		const proxyAddr = this.apiInterface!.getProxyAddress();
		// call data
		const perpId = this.apiInterface!.getPerpetualStaticInfo(symbol).id;
		const priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
		return JSON.stringify({
			perpId: perpId,
			proxyAddr: proxyAddr,
			priceUpdate: {
				updateData: priceUpdate.priceFeedVaas,
				publishTimes: priceUpdate.timestamps,
				updateFee:
					this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
					priceUpdate.priceFeedVaas.length,
			},
		});
	}

	public async getAvailableMargin(symbol: string, traderAddr: string) {
		this.checkAPIInitialized();
		const amount = await this.apiInterface!.getAvailableMargin(traderAddr, symbol);
		return JSON.stringify({ amount: amount });
	}

	public async cancelOrder(symbol: string, orderId: string) {
		this.checkAPIInitialized();
		const cancelDigest = await this.apiInterface!.cancelOrderDigest(symbol, orderId);
		const cancelABI = this.apiInterface!.getOrderBookABI(symbol, "cancelOrder");
		const priceUpdate = await this.apiInterface!.fetchLatestFeedPriceInfo(symbol);
		return JSON.stringify({
			OrderBookAddr: cancelDigest.OBContractAddr,
			abi: cancelABI,
			digest: cancelDigest.digest,
			priceUpdate: {
				updateData: priceUpdate.priceFeedVaas,
				publishTimes: priceUpdate.timestamps,
				updateFee:
					this.apiInterface!.PRICE_UPDATE_FEE_GWEI *
					priceUpdate.priceFeedVaas.length,
			},
		});
	}

	public async findPerpetualById(
		perpetualId: number,
	): Promise<PerpetualState | undefined> {
		const ei = await this.exchangeInfo();
		const info = <ExchangeInfo>JSON.parse(ei);

		let perp: PerpetualState | undefined = undefined;
		info.pools.forEach((pool) => {
			pool.perpetuals.forEach((p) => {
				if (p.id === perpetualId) {
					perp = p;
				}
			});
		});

		return perp;
	}

	public async queryOrderBooks(sym: string): Promise<OrderBook> {
		const [orders, orderIds, traderAddresses] =
			await this.apiInterface!.getAllOpenOrders(sym);
		const perpId = this.apiInterface!.getPerpIdFromSymbol(sym);
		const poolId = Math.floor(perpId / 1e5);

		const ordersWithTraderAndId: OrderWithTraderAndId[] = [];

		for (let k = 0; k < orders.length; k++) {
			orders[k].brokerSignature =
				orders[k].brokerSignature?.toString().substring(0, 5) + "...";

			const orderWithTraderAndId: OrderWithTraderAndId = {
				...orders[k],
				orderId: orderIds[k],
				trader: traderAddresses[k],
			};
			ordersWithTraderAndId.push(orderWithTraderAndId);
		}
		const OB: OrderBook = {
			poolId: poolId,
			perpId: perpId,
			sym: sym,
			numOrders: orders.length,
			orders: ordersWithTraderAndId,
		};
		return OB;
	}
}
