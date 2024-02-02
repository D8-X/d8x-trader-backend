import { createClient } from "redis";
import type { RedisClientType } from "redis";
import * as redis from "redis";
import { ExchangeInfo, NodeSDKConfig, PerpetualState } from "@d8x/perpetuals-sdk";
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
	protected midPremium: Map<number, number>; //perpId -> price (e.g. we can have 2 BTC-USD with different mid-price)
	protected mrkPremium: Map<number, number>; //perpId -> mark premium

	protected sdkInterface: SDKInterface | undefined;

	constructor() {
		super();
		this.redisClient = constructRedis("PX Interface");
		this.redisSubClient = constructRedis("PX Interface Sub");
		this.idxNamesToPerpetualIds = new Map<string, number[]>();
		this.idxPrices = new Map<string, number>();
		this.midPremium = new Map<number, number>();
		this.mrkPremium = new Map<number, number>();
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
			this._onRedisFeedHandlerMsg(message)
		);

		sdkInterface.registerObserver(this);
		this.sdkInterface = sdkInterface;
		// trigger exchange info so we get an "update" message
		let info = await this.sdkInterface.exchangeInfo();
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
		newIndexPrice: number
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
	 * from the oracle-websocket client and register what perpetuals
	 * the indices are used for (e.g., BTC-USD can be used in the MATIC pool and USDC pool)
	 * We also set initial values for idx/mark/mid prices
	 * @param info exchange-info
	 */
	private async _initIdxNamesToPerpetualIds(info: ExchangeInfo) {
		console.log("Initialize index names");
		// gather perpetuals index-names from exchange data
		for (let k = 0; k < info.pools.length; k++) {
			let pool = info.pools[k];
			for (let j = 0; j < pool.perpetuals.length; j++) {
				let perpState: PerpetualState = pool.perpetuals[j];
				let perpId: number = perpState.id;
				// Use letter-case as it comes from the exchange info. Symbols should be
				// in uppercase by default.
				let pxIdxName = perpState.baseCurrency + "-" + perpState.quoteCurrency;
				let idxs = this.idxNamesToPerpetualIds.get(pxIdxName);
				if (idxs == undefined) {
					let idx: number[] = [perpState.id];
					this.idxNamesToPerpetualIds.set(pxIdxName, idx);
				} else {
					idxs!.push(perpId);
				}
				this.idxNamesToPerpetualIds.get(pxIdxName);
				let px = perpState.indexPrice;
				this.idxPrices.set(pxIdxName, px);
				this.mrkPremium.set(perpId, perpState.markPrice / px - 1);
				this.midPremium.set(perpId, perpState.midPrice / px - 1);
			}
		}
	}

	private async _onRedisFeedHandlerMsg(message: string) {
		// message must be indices separated by semicolon
		// console.log("Received REDIS message" + message);
		let indices = message.split(";");
		for (let k = 0; k < indices.length; k++) {
			// get price from redit
			let px_ts = await this.redisClient.ts.get(indices[k]);
			let px = px_ts?.value;
			if (px != undefined) {
				this.idxPrices.set(indices[k], px);
			}
			//console.log(indices[k], px);
		}
		this._updatePricesOnIndexPrice(indices);
	}

	/**
	 * Upon receipt of new index prices, the index prices are factored into
	 * mid-price and mark-price and the 3 prices are sent to ws-subscribers
	 * @param indices index names, such as BTC-USDC
	 */
	private _updatePricesOnIndexPrice(indices: string[]) {
		for (let k = 0; k < indices.length; k++) {
			let perpetualIds: number[] | undefined = this.idxNamesToPerpetualIds.get(
				indices[k]
			);
			if (perpetualIds == undefined) {
				continue;
			}
			let px = this.idxPrices.get(indices[k]);
			for (let j = 0; j < perpetualIds.length; j++) {
				let markPremium = this.mrkPremium.get(perpetualIds[j]);
				let midPremium = this.midPremium.get(perpetualIds[j]);
				if (
					px == undefined ||
					markPremium == undefined ||
					midPremium == undefined
				) {
					continue;
				}
				const midPx = px * (1 + midPremium);
				const markPx = px * (1 + markPremium);
				// call update to inform websocket
				this.updateMarkPrice(perpetualIds[j], midPx, markPx!, px!);
			}
		}
	}

	/**
	 * Upon receipt of new mark-price from the blockchain event,
	 * we update mark-price and mid-price premium. No update of
	 * index price because the index price is generally ahead in time.
	 * @param perpetualId: perpetual id
	 * @param newMidPrice: new mid price from onchain
	 * @param newMarkPrice: new mark price from onchain
	 * @param newIndexPrice: new index price from onchain
	 * @returns midprice, markprice, index-price; index and mid price are adjusted by
	 * newest index price
	 */
	protected updatePricesOnMarkPriceEvent(
		perpetualId: number,
		newMidPrice: number,
		newMarkPrice: number,
		newIndexPrice: number
	) {
		let midPrem = newMidPrice / newIndexPrice - 1;
		this.midPremium.set(perpetualId, midPrem);
		let markPrem = newMarkPrice / newIndexPrice - 1;
		this.mrkPremium.set(perpetualId, markPrem);
		let pxIdxName = this.sdkInterface!.getSymbolFromPerpId(perpetualId);
		let px = this.idxPrices.get(pxIdxName!);
		if (px == undefined) {
			return [newMidPrice, newMarkPrice, newIndexPrice];
		}
		newMidPrice = px * (1 + midPrem);
		newIndexPrice = px;
		return [newMidPrice, newMarkPrice, newIndexPrice];
	}
}
