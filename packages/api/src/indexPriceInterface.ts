import { createClient } from "redis";
import type { RedisClientType } from "redis";
import * as redis from "redis";
import {
	ExchangeInfo,
	NodeSDKConfig,
	PerpetualState,
	probToPrice,
} from "@d8x/perpetuals-sdk";
import { extractErrorMsg, constructRedis } from "utils";
import SDKInterface from "./sdkInterface";
import Observer from "./observer";

/**
 * This class handles the communication with the websocket client
 * that streams oracle-index prices via Redis.
 * Upon receipt of new index prices, idx+mid+mark price are updated
 * and the subscribers are informed.
 */
export default abstract class IndexPriceInterface extends Observer {
	private redisClient: RedisClientType;
	private redisSubClient: RedisClientType;
	private idxNamesToPerpetualIds: Map<string, number[]>; //ticker (e.g. BTC-USD) -> [10001, 10021, ..]
	protected idxPrices: Map<string, number>; //ticker -> price
	protected emaPrices: Map<number, number>; //perpId -> ema of s2 index price
	protected midPremium: Map<number, number>; //perpId -> price (e.g. we can have 2 BTC-USD with different mid-price)
	protected mrkPremium: Map<number, number>; //perpId -> mark premium

	protected isPredictionMkt: Map<number, boolean>; //perpId -> true if index is probability and needs 1+x transformation
	protected sdkInterface: SDKInterface | undefined;

	constructor() {
		super();
		this.redisClient = constructRedis("PX Interface");
		this.redisSubClient = constructRedis("PX Interface Sub");
		this.idxNamesToPerpetualIds = new Map<string, number[]>();
		this.idxPrices = new Map<string, number>();
		this.midPremium = new Map<number, number>();
		this.mrkPremium = new Map<number, number>();
		this.emaPrices = new Map<number, number>();
		this.isPredictionMkt = new Map<number, boolean>();
	}

	public async priceInterfaceInitialize(sdkInterface: SDKInterface) {
		if (!this.redisSubClient.isOpen) {
			console.log("Connecting to REDIS PUB/SUB...");
			await this.redisSubClient.connect();
			console.log("done");
		}
		if (!this.redisClient.isOpen) {
			await this.redisClient.connect();
		}

		await this.redisSubClient.subscribe("px_update", (message) =>
			this._onRedisFeedHandlerMsg(message),
		);

		sdkInterface.registerObserver(this);
		this.sdkInterface = sdkInterface;
		// note: this exchangeInfo call does not actually issue the "update"
		// call, since initialization is not yet done in EventListener when
		// priceInterfaceInitialize is called. Initial _update is called in the
		// eventListener initialization.
		const info = await this.sdkInterface.exchangeInfo();
		await this._initIdxNamesToPerpetualIds(<ExchangeInfo>JSON.parse(info));
	}

	/**
	 * Internal function to update prices and informs websocket subscribers
	 * @param perpetualId id of the perpetual for which prices are being updated
	 * @param newMidPrice mid price in decimals
	 * @param newMarkPrice mark price
	 * @param newIndexPrice index price
	 */
	protected abstract updateMarkPrice(
		perpetualId: number,
		newMidPrice: number,
		newMarkPrice: number,
		newIndexPrice: number,
	): void;

	/**
	 * Handles updates from sdk interface
	 * We make sure we register the relevant indices with the
	 * websocket client. Must call super._update(msg)
	 * @param msg from observable
	 */
	protected abstract _update(msg: String): void;

	/**
	 * Handles updates from sdk interface
	 * We make sure we register the relevant indices with the
	 * websocket client
	 * @param msg from observable
	 */
	public async update(msg: String) {
		console.log("update");
		this._update(msg);
	}

	/**
	 * We store the names of the indices that we want to get
	 * from the candles service via REDIS and register what perpetuals
	 * the indices are used for (e.g., BTC-USD can be used in the MATIC pool and USDC pool)
	 * We also set initial values for idx/mark/mid prices
	 * We also set isPredictionMkt
	 * @param info exchange-info
	 */
	private async _initIdxNamesToPerpetualIds(info: ExchangeInfo) {
		console.log("Initialize index names");
		// gather perpetuals index-names from exchange data
		for (let k = 0; k < info.pools.length; k++) {
			const pool = info.pools[k];
			for (let j = 0; j < pool.perpetuals.length; j++) {
				const perpState: PerpetualState = pool.perpetuals[j];
				const perpId: number = perpState.id;
				// Use letter-case as it comes from the exchange info. Symbols should be
				// in uppercase by default.
				const pxIdxName = perpState.baseCurrency + "-" + perpState.quoteCurrency;
				const idxs = this.idxNamesToPerpetualIds.get(pxIdxName);
				if (idxs == undefined) {
					const idx: number[] = [perpState.id];
					this.idxNamesToPerpetualIds.set(pxIdxName, idx);
				} else {
					idxs!.push(perpId);
				}
				this.idxNamesToPerpetualIds.get(pxIdxName);
				const px = perpState.indexPrice;
				this.idxPrices.set(pxIdxName, px);
				this.mrkPremium.set(perpId, perpState.markPrice / px - 1);
				this.midPremium.set(perpId, perpState.midPrice / px - 1);

				const isPred = this.sdkInterface!.isPredictionMarket(
					pxIdxName + "-" + pool.poolSymbol,
				);
				this.isPredictionMkt.set(perpId, isPred);
			}
		}
	}

	public async _onRedisFeedHandlerMsg(message: string) {
		// message must be indices separated by semicolon
		// console.log("Received REDIS message" + message);
		const indices = message.split(";");

		// Create new updated indices and only send those that were updated.
		const updatedIndices: string[] = [];

		for (let k = 0; k < indices.length; k++) {
			// get price from redit
			try {
				const px_ts = await this.redisClient.ts.get(indices[k]);
				if (px_ts !== null) {
					this.idxPrices.set(indices[k], px_ts.value);
					updatedIndices.push(indices[k]);
				}
			} catch (error) {
				console.log("[Error in _onRedisFeedHandlerMsg]", {
					error: extractErrorMsg(error),
					index: indices[k],
				});
			}
		}
		this._updatePricesOnIndexPrice(updatedIndices);
	}

	/**
	 * Upon receipt of new index prices, the index prices are factored into
	 * mid-price and mark-price and the 3 prices are sent to ws-subscribers
	 * @param indices index names, such as BTC-USDC
	 */
	private _updatePricesOnIndexPrice(indices: string[]) {
		for (let k = 0; k < indices.length; k++) {
			const perpetualIds: number[] | undefined = this.idxNamesToPerpetualIds.get(
				indices[k],
			);
			if (perpetualIds == undefined) {
				continue;
			}
			let px = this.idxPrices.get(indices[k]);
			for (let j = 0; j < perpetualIds.length; j++) {
				const markPremium = this.mrkPremium.get(perpetualIds[j]);
				const midPremium = this.midPremium.get(perpetualIds[j]);
				if (
					px == undefined ||
					markPremium == undefined ||
					midPremium == undefined
				) {
					continue;
				}
				const isPred = this.isPredictionMkt.get(perpetualIds[j]);
				let midPx, markPx: number;
				if (isPred) {
					// transform price from probability
					px = probToPrice(px);
					midPx = px + midPremium;
					// mark price is left unchanged
					if (!this.emaPrices.has(perpetualIds[j])) {
						// no mark price yet, continue
						continue;
					}
					markPx = this.emaPrices.get(perpetualIds[j])!;
					markPx = Math.min(Math.max(1, markPx + markPremium), 2); //clamp
				} else {
					midPx = px * (1 + midPremium);
					markPx = px * (1 + markPremium);
				}

				// call update to inform websocket
				this.updateMarkPrice(perpetualIds[j], midPx, markPx!, px!);
			}
		}
	}
}
