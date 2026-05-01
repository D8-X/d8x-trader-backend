import { ExchangeInfo, PerpetualState, probToPrice } from "@d8-x/d8x-node-sdk";
import type { RedisClientType } from "redis";
import { constructRedis, extractErrorMsg } from "utils";
import Observer from "./observer.js";
import SDKInterface from "./sdkInterface.js";
import { logger } from "./logger.js";

/**
 * This class handles the communication with the websocket client
 * that streams oracle-index prices via Redis.
 * Upon receipt of new index prices, idx+mid+mark price are updated
 * and the subscribers are informed.
 */
export default abstract class IndexPriceInterface extends Observer {
	protected redisClient: RedisClientType;
	private redisSubClient: RedisClientType;
	private idxNamesToPerpetualIds: Map<string, number[]>; //ticker (e.g. BTC-USD) -> [10001, 10021, ..]
	protected idxPrices: Map<string, number>; //ticker -> price
	protected emaPrices: Map<string, number>; //indexname -> ema of s2 index price; for sports/prediction
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
		this.emaPrices = new Map<string, number>();
		this.isPredictionMkt = new Map<number, boolean>();
	}

	public async priceInterfaceInitialize(sdkInterface: SDKInterface) {
		if (!this.redisSubClient.isOpen) {
			logger.info("Connecting to REDIS PUB/SUB...");
			await this.redisSubClient.connect();
			logger.info("done");
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

	private async refreshIndexNames() {
		logger.info("[@refreshIndexNames] start", {
			beforeIdxNamesCount: this.idxNamesToPerpetualIds.size,
			beforeIdxPricesCount: this.idxPrices.size,
		});
		const t0 = Date.now();
		const info = await this.sdkInterface!.exchangeInfo();
		await this._initIdxNamesToPerpetualIds(<ExchangeInfo>JSON.parse(info));
		logger.info("[@refreshIndexNames] done", { elapsedMs: Date.now() - t0 });
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
		logger.info("[@update] sdk observer notified", { msg });
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
		logger.info("[@_initIdxNamesToPerpetualIds] start", {
			pools: info.pools.length,
		});
		// gather perpetuals index-names from exchange data
		const indices: string[] = [];
		for (let k = 0; k < info.pools.length; k++) {
			const pool = info.pools[k];
			if (!pool.isRunning) {
				logger.info("[@_initIdxNamesToPerpetualIds] skip pool (not running)", {
					poolSymbol: pool.poolSymbol,
				});
				continue;
			}
			for (let j = 0; j < pool.perpetuals.length; j++) {
				const perpState: PerpetualState = pool.perpetuals[j];
				const perpId: number = perpState.id;
				// Use letter-case as it comes from the exchange info. Symbols should be
				// in uppercase by default.
				const baseQuote = perpState.baseCurrency + "-" + perpState.quoteCurrency;
				const longSym = baseQuote + "-" + pool.poolSymbol; // <-- needs the pool symbole
				const isPred = this.sdkInterface!.isPredictionMarket(longSym);
				const pxIdxName = isPred ? longSym : baseQuote;
				const idxs = this.idxNamesToPerpetualIds.get(pxIdxName);
				if (idxs == undefined) {
					const idx: number[] = [perpState.id];
					this.idxNamesToPerpetualIds.set(pxIdxName, idx);
				} else {
					idxs!.push(perpId);
				}
				const px = perpState.indexPrice; // price, even for pred markets (prob + 1)

				indices.push(pxIdxName);
				if (isPred) {
					// save prob and additive premia
					indices[indices.length - 1] = "sport:" + indices[indices.length - 1];
					indices.push("sport:" + pxIdxName + "|mark");
					this.idxPrices.set(pxIdxName, px - 1);
					this.mrkPremium.set(perpId, perpState.markPrice - px);
					this.midPremium.set(perpId, perpState.midPrice - px);
				} else {
					// set price and relative premia
					this.idxPrices.set(pxIdxName, px);
					this.mrkPremium.set(perpId, perpState.markPrice / px - 1);
					this.midPremium.set(perpId, perpState.midPrice / px - 1);
				}
				// ^--- todo: other types than sport
				this.isPredictionMkt.set(perpId, isPred);
				logger.info("[@_initIdxNamesToPerpetualIds] perp registered", {
					perpId,
					poolSymbol: pool.poolSymbol,
					baseCurrency: perpState.baseCurrency,
					quoteCurrency: perpState.quoteCurrency,
					pxIdxName,
					isPred,
					indexPrice: px,
					markPrice: perpState.markPrice,
					midPrice: perpState.midPrice,
				});
			}
			// initialize index prices
			await this.fetchIndicesFromRedis(indices);
		}
		logger.info("[@_initIdxNamesToPerpetualIds] done", {
			idxNamesCount: this.idxNamesToPerpetualIds.size,
			idxPricesCount: this.idxPrices.size,
			emaPricesCount: this.emaPrices.size,
			isPredCount: this.isPredictionMkt.size,
			idxNamesToPerpetualIds: Object.fromEntries(this.idxNamesToPerpetualIds),
			idxPriceKeys: [...this.idxPrices.keys()],
			emaPriceKeys: [...this.emaPrices.keys()],
		});
	}

	public async _onRedisFeedHandlerMsg(message: string) {
		const indices = message.split(";");
		logger.info("[@_onRedisFeedHandlerMsg] px_update received", { indices });
		const updatedIndices = await this.fetchIndicesFromRedis(indices);
		const isRecent = await this.isMappingRecent(updatedIndices);
		if (!isRecent) {
			logger.info(
				"[@_onRedisFeedHandlerMsg] mapping stale, refreshing index names",
			);
			await this.refreshIndexNames();
		}
		logger.info("[@_onRedisFeedHandlerMsg] px_update fetched", { updatedIndices });
		this._updatePricesOnIndexPrice(updatedIndices);
	}

	protected async fetchIndicesFromRedis(indices: string[]): Promise<string[]> {
		const updatedIndices: string[] = [];
		let hits = 0;
		let nullReplies = 0;
		let missing = 0;
		let errors = 0;
		const sources = new Map<string, number>();
		const sourceHits = new Map<string, number>();

		for (let k = 0; k < indices.length; k++) {
			const source = indices[k].split(":")[0];
			sources.set(source, (sources.get(source) ?? 0) + 1);
			try {
				const px_ts = await this.redisClient.ts.get(indices[k]);
				if (px_ts !== null) {
					hits++;
					sourceHits.set(source, (sourceHits.get(source) ?? 0) + 1);
					const symbol = indices[k].split(":").pop() + "";
					const markSplit = symbol.split("|");
					if (markSplit.length == 2) {
						const idxSym = markSplit[0];
						this.emaPrices.set(idxSym, px_ts.value);
					} else {
						const px = px_ts.value;
						this.idxPrices.set(symbol, px);
						updatedIndices.push(symbol);
					}
				} else {
					nullReplies++;
				}
			} catch (error) {
				const msg = extractErrorMsg(error);
				if (msg.includes("TSDB: the key does not exist")) {
					missing++;
					logger.info("idx feed key missing", { index: indices[k] });
				} else {
					errors++;
					logger.warn("[@fetchIndicesFromRedis] error", {
						error: msg,
						index: indices[k],
					});
				}
			}
		}
		logger.info("[@fetchIndicesFromRedis] stats", {
			requested: indices.length,
			hits,
			nullReplies,
			missing,
			errors,
			updated: updatedIndices.length,
			bySource: Object.fromEntries(sources),
			hitsBySource: Object.fromEntries(sourceHits),
		});
		return updatedIndices;
	}

	private async isMappingRecent(indices: string[]): Promise<boolean> {
		const tif = this.sdkInterface?.getTraderInterface();
		if (indices.length > 0) {
			return true;
		}
		// index still exists?
		if (tif != undefined) {
			try {
				for (let j = 0; j < indices.length; j++) {
					await tif.getShortSymbol(indices[j]);
				}
			} catch (error) {
				// if index doesn't exist the function throws an error
				return false;
			}
		}
		return true;
	}

	/**
	 * Upon receipt of new index prices, the index prices are factored into
	 * mid-price and mark-price and the 3 prices are sent to ws-subscribers
	 * @param indices index names, such as BTC-USDC
	 */
	protected _updatePricesOnIndexPrice(indices: string[]) {
		for (let k = 0; k < indices.length; k++) {
			const perpetualIds: number[] | undefined = this.idxNamesToPerpetualIds.get(
				indices[k],
			);
			if (perpetualIds == undefined) {
				logger.info("[@_updatePricesOnIndexPrice] no perp mapping", {
					index: indices[k],
				});
				continue;
			}
			let px = this.idxPrices.get(indices[k]);
			logger.info("[@_updatePricesOnIndexPrice] routing", {
				index: indices[k],
				perpetualIds,
				px,
			});
			for (let j = 0; j < perpetualIds.length; j++) {
				const isPred = this.isPredictionMkt.get(perpetualIds[j]);
				const markPremium = this.mrkPremium.get(perpetualIds[j]);
				const midPremium = this.midPremium.get(perpetualIds[j]);
				if (isPred === undefined) {
					logger.error(
						"perpetualId missing from isPredictionMkt. Restarting to refresh mapping",
						{ perpetualId: perpetualIds[j] },
					);
					process.exit(1);
				}
				if (
					px == undefined ||
					markPremium == undefined ||
					midPremium == undefined
				) {
					logger.info("[@_updatePricesOnIndexPrice] missing values, skip", {
						perpetualId: perpetualIds[j],
						px,
						markPremium,
						midPremium,
					});
					continue;
				}
				let midPx, markPx: number;
				if (isPred) {
					// for pred markets, px and emaPrices are probabilities (set by candles)
					px = probToPrice(px);
					// per contract: mid = index + additive premium (clamped),
					// mark = index (no premium)
					midPx = Math.min(Math.max(1, px + midPremium), 2);
					markPx = px;
				} else {
					// premia are relative
					midPx = px * (1 + midPremium);
					markPx = px * (1 + markPremium);
				}
				// call update to inform websocket
				this.updateMarkPrice(perpetualIds[j], midPx, markPx!, px!);
			}
		}
	}
}
