import Redis from "ioredis";
import { constructRedis } from "utils";
import { WebsocketClientConfig } from "utils/src/wsTypes";
import Triangulator from "./triangulator";

/**
 * Handle the index-price feeds oracle-websocket-server to this indexPXWSClient
 * - the FeedHandler knows from the config what indices are covered by the websocket (e.g. BTC-USD, USDC-USD)
 * - the FeedHandler requests interested peers (the eventListener) to register desired indices (e.g. BTC-USDC)
 *   via publish("feedHandler", "query-request")
 * - the FeedHandler is notified through the function notifyPriceUpdateFromWS about websocket updates
 * - the FeedHandler can be referenced by several indexPXWSClients (they all send prices to the FeedHandler)
 */
export default class FeedHandler {
  private redisPubClient: Redis;
  private redisSubClient: Redis;
  private clientIdxPrices: Map<string, number>; // current price of the client idx
  private feedIdxPrices: Map<string, { price: number; ts: number }>; // hold the "raw" prices and timestamps from websocket
  private feedIdxNames: string[]; //available price feeds from oracle-websocket
  private clientIdxToFeedIdxPath: Map<string, { feedIdxNames: string[]; isInverse: boolean[] }>; //for each client index we store the path
  private feedToDependentClientIndices: Map<string, string[]>;

  constructor(config: WebsocketClientConfig[]) {
    this.feedIdxPrices = new Map<string, { price: number; ts: number }>();
    this.clientIdxPrices = new Map<string, number>();
    this.clientIdxToFeedIdxPath = new Map<string, { feedIdxNames: string[]; isInverse: boolean[] }>();
    this.feedToDependentClientIndices = new Map<string, string[]>();
    this.feedIdxNames = new Array<string>();
    for (let k = 0; k < config.length; k++) {
      config[k].tickers.forEach((x) => {
        this.feedIdxNames.push(x);
      });
    }
    this.redisPubClient = constructRedis("FeedHandlerPub");
    this.redisSubClient = constructRedis("FeedHandlerSub");
  }

  public async init() {
    // feed request is sent by the entity requiring perpetual index prices
    await this.redisSubClient.subscribe("feedRequest");
    this.redisSubClient.on("message", async (channel, message) => await this.onSubscribeIndices(message));
    await this.callForIndices();
  }

  /**
   * Notify subscribers that we would like to
   * inform about price updates
   */
  public async callForIndices() {
    console.log("Calling for indices");
    await this.redisPubClient!.publish("feedHandler", "query-request");
  }

  /**
   * Inform subscribers of updated index names
   * @param clientIdxNames array of index names that were updated
   */
  private async informSubscribers(clientIdxNames: string[]) {
    let names = clientIdxNames.join(":");
    await this.redisPubClient.publish("feedHandler", names);
  }

  /**
   * This function is called ultimately when websocket prices arrive (indexPxWSClient)
   * @param ticker ticker of the form BTC-USD
   * @param price price (float)
   * @param timestampMs timestamp in milliseconds
   */
  public async notifyPriceUpdateFromWS(ticker: string, price: number, timestampMs: number) {
    // update price
    this.feedIdxPrices.set(ticker, { price: price, ts: timestampMs });
    // recalculate indices
    let affectedClientIdxNames: string[] | undefined = this.feedToDependentClientIndices.get(ticker);
    //console.log("affected ids", affectedClientIdxNames);
    if (affectedClientIdxNames == undefined) {
      // no subscribers, leave
      // log: console.log(`no dependent subscribers for ticker ${ticker}`);
      return;
    }
    // recalculate prices
    let updatedClientIdxNames = new Array<string>();
    for (let k = 0; k < affectedClientIdxNames?.length; k++) {
      let idxName = affectedClientIdxNames[k];
      let path: { feedIdxNames: string[]; isInverse: boolean[] } | undefined = this.clientIdxToFeedIdxPath.get(idxName);
      let px = this.calculatePricePath(path);
      if (px == -1) {
        // price not available for this index
        continue;
      }
      this.clientIdxPrices.set(idxName, px);
      updatedClientIdxNames.push(idxName);
      await this.redisPubClient.set(idxName, px.toString());
    }
    this.informSubscribers(updatedClientIdxNames);
  }

  /**
   * calculate the price, given the path and the stored websocket feed prices
   * @param path feed index names and information whether inverse or not
   * @returns price or -1 if information not available
   */
  private calculatePricePath(path: { feedIdxNames: string[]; isInverse: boolean[] } | undefined): number {
    if (path == undefined) {
      return -1;
    }
    let px = 1;
    for (let j = 0; j < path.feedIdxNames.length; j++) {
      let pxFeedIdx = this.feedIdxPrices.get(path.feedIdxNames[j]);
      if (pxFeedIdx == undefined) {
        // no price available for given index
        return -1;
      }
      px = path.isInverse[j] ? px / pxFeedIdx.price : px * pxFeedIdx.price;
    }
    return px;
  }

  /**
   * The price subscriber (eventListener.ts) subscribes via the indices separated by colon
   * This function looks for the smallest available path using the available websocket sources
   * @param message
   */
  private async onSubscribeIndices(message: string) {
    // message: BTC-USDC:MATIC-USD:ETH-USD
    console.log("Received feedRequest", message);
    let indices = message.split(":");
    // clear state
    this.clientIdxToFeedIdxPath.clear();
    this.feedToDependentClientIndices.clear();
    // for each index in indices, we know
    //  which ws-indices in what order
    //  whether we multiply or divide
    for (let k = 0; k < indices.length; k++) {
      let [feedNames, isInverse]: [string[], boolean[]] = Triangulator.triangulate(this.feedIdxNames, indices[k]);
      this.clientIdxToFeedIdxPath.set(indices[k], { feedIdxNames: feedNames, isInverse: isInverse });
      // all of the feednames need to register this index
      for (let j = 0; j < feedNames.length; j++) {
        let dependsOn = this.feedToDependentClientIndices.get(feedNames[j]);
        if (dependsOn == undefined) {
          this.feedToDependentClientIndices.set(feedNames[j], new Array<string>());
          dependsOn = this.feedToDependentClientIndices.get(feedNames[j]);
        }
        dependsOn!.push(indices[k]);
      }
    }
  }
}
