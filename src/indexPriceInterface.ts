import { createClient } from "redis";
import { ExchangeInfo, NodeSDKConfig, PerpetualState } from "@d8x/perpetuals-sdk";
import { extractErrorMsg, constructRedis } from "./utils";
import SDKInterface from "./sdkInterface";
import Observer from "./observer";

/**
 * This class handles the communication with the websocket client
 * that streams oracle-index prices via Redis.
 * Upon receipt of new index prices, idx+mid+mark price are updated
 * and the subscribers are informed.
 */
export default abstract class IndexPriceInterface extends Observer {
  private redisClient: ReturnType<typeof createClient>;
  private redisSubClient: ReturnType<typeof createClient>;
  private idxNamesToPerpetualIds: Map<string, number[]>;
  protected idxPrices: Map<string, number>;
  protected midPremium: Map<string, number>;
  protected mrkPremium: Map<string, number>;

  protected sdkInterface: SDKInterface | undefined;

  constructor() {
    super();
    this.redisClient = constructRedis("SDK Interface");
    this.redisSubClient = constructRedis("SDK Interface Sub");
    this.idxNamesToPerpetualIds = new Map<string, number[]>();
    this.idxPrices = new Map<string, number>();
    this.midPremium = new Map<string, number>();
    this.mrkPremium = new Map<string, number>();
  }

  public async initialize(sdkInterface: SDKInterface) {
    await this.redisClient.connect();
    await this.redisSubClient.connect();
    await this.redisSubClient.subscribe("feedHandler", (message) => this._onRedisFeedHandlerMsg(message));
    sdkInterface.registerObserver(this);
    this.sdkInterface = sdkInterface;
  }

  /**
   * Handles updates from sdk interface
   * We make sure we register the relevant indices with the
   * websocket client
   * @param msg from observable
   */
  public async update(msg: String) {
    if (this.idxNamesToPerpetualIds.size == 0 && this.sdkInterface != undefined) {
      console.log("Index Px Interface: gathering index names");
      let info = await this.sdkInterface.exchangeInfo();
      await this._initIdxNamesToPerpetualIds(<ExchangeInfo>JSON.parse(info));
    }
  }

  /**
   * We store the names of the indices that we want to get
   * from the oracle-websocket client and register what perpetuals
   * the indices are used for (e.g., BTC-USD can be used in the MATIC pool and USDC pool)
   * We also set initial values for idx/mark/mid prices
   * @param info exchange-info
   */
  private async _initIdxNamesToPerpetualIds(info: ExchangeInfo) {
    // gather perpetuals index-names from exchange data
    for (let k = 0; k < info.pools.length; k++) {
      let pool = info.pools[k];
      for (let j = 0; j < pool.perpetuals.length; j++) {
        let perpState: PerpetualState = pool.perpetuals[j];
        let index = perpState.baseCurrency + "-" + perpState.quoteCurrency;
        let idxs = this.idxNamesToPerpetualIds.get(index);
        if (idxs == undefined) {
          this.idxNamesToPerpetualIds.set(index, new Array<number>());
          idxs = this.idxNamesToPerpetualIds.get(index);
        }
        idxs!.push(perpState.id);
        let px = perpState.indexPrice;
        this.idxPrices.set(index, px);
        this.mrkPremium.set(index, perpState.markPrice / px - 1);
        this.midPremium.set(index, perpState.midPrice / px - 1);
      }
    }
    // use the RedisFeedhandler to publish the intent that we want
    // to subscribe to the indices
    await this._onRedisFeedHandlerMsg("query-request");
  }

  private async _onRedisFeedHandlerMsg(message: string) {
    if (message == "query-request") {
      // we need to inform which indices we want to get prices for
      let indices = "";
      for (let item in this.idxNamesToPerpetualIds.keys()) {
        indices = indices + ":" + item;
      }
      indices = indices.substring(1); //cut initial colon
      console.log(`redis publish "feedRequest": ${indices}`);
      this.redisClient.publish("feedRequest", indices);
    } else {
      // message must be indices separated by colon
      let indices = message.split(":");
      for (let k = 0; k < indices.length; k++) {
        // get price from redit
        let px: number = Number(await this.redisClient.get(indices[k]));
        this.idxPrices.set(indices[k], px);
      }
      this._updatePricesOnIndexPrice(indices);
    }
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
   * Upon receipt of new index prices, the index prices are factored into
   * mid-price and mark-price and the 3 prices are sent to ws-subscribers
   * @param indices index names, such as BTC-USDC
   */
  private _updatePricesOnIndexPrice(indices: string[]) {
    for (let k = 0; k < indices.length; k++) {
      let perpetualIds: number[] | undefined = this.idxNamesToPerpetualIds.get(indices[k]);
      if (perpetualIds == undefined) {
        continue;
      }
      let px = this.idxPrices.get(indices[k]);
      let markPremium = this.mrkPremium.get(indices[k]);
      let midPremium = this.midPremium.get(indices[k]);
      if (px == undefined || markPremium == undefined || midPremium == undefined) {
        continue;
      }
      let mrkPx = px * (1 + markPremium);
      let midPx = px * (1 + midPremium);
      // call update to inform websocket
      perpetualIds.forEach((id) => this.updateMarkPrice(id, midPx, mrkPx, px!));
    }
  }
}
