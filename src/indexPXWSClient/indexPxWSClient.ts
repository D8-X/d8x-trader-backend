import WebSocket from "ws";
import { sleep } from "../utils";
import { WebsocketClientConfig } from "../wsTypes";
import FeedHandler from "./feedHandler";

export interface IndexPriceFeedRequest {
  type: string; // subscribe/unsubscribe
  ids: string[]; //e.g. BTC-USD, ETH-USD
}

/**
 * Class to stream index prices from off-chain oracles to
 * front-end
 */
export default class IndexPxWSClient {
  private config: WebsocketClientConfig;
  private ws: WebSocket | undefined;
  private tickers: string[]; // ticker names
  private tickerIds: string[]; // ticker ids
  private idToTicker: Map<string, string>;
  private name: string;
  private feedHandler: FeedHandler;
  protected lastHeartBeatMs: number = 0;

  constructor(config: WebsocketClientConfig, feedHandler: FeedHandler) {
    this.config = config;
    this.tickers = config.tickers;
    this.feedHandler = feedHandler;
    this.tickerIds = new Array<string>();
    this.idToTicker = new Map<string, string>();
    for (let j = 0; j < this.tickers.length; j++) {
      let ticker = this.tickers[j];
      for (let k = 0; k < config.feedIds.length; k++) {
        if (config.feedIds[k][0] == ticker) {
          this.tickerIds.push(config.feedIds[k][1]);
          this.idToTicker.set(config.feedIds[k][1], ticker);
          k = config.feedIds.length;
        }
      }
    }
    if (this.tickers.length != this.tickerIds.length) {
      throw new Error("Could not find ticker id for each ticker supplied");
    }
    this.name = config.streamName;
  }

  /**
   * Connect to WebSocket server and initialize Redis
   * @param idx optional index of websocket server
   */
  public async init(idx: number = 0): Promise<void> {
    await this.initWS(idx);
  }

  /**
   * Connect to websocket server
   * @param idx index of chosen server
   */
  private async initWS(idx: number) {
    console.log("Endpoint ", this.config.wsEndpoints[idx], "for ", this.name);
    let wsAddr = this.config.wsEndpoints[idx];
    this.ws = new WebSocket(wsAddr);
    await this.waitForSocketState(this.ws, this.ws.OPEN);
    this.onOpen();
    this.ws.on("ping", () => {
      this.lastHeartBeatMs = Date.now();
      this.ws!.pong();
    });
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
  }

  private onOpen(): void {
    console.log(this.name + " opened");
    this.lastHeartBeatMs = Date.now();
    this.reSubscribe();
  }

  public timeMsSinceHeartbeat() {
    return Date.now() - this.lastHeartBeatMs;
  }

  /**
   * Randomly choose a WebSocket server, connect, and re-subscribe.
   */
  public async switchWSServer() {
    if (this.ws != undefined) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", ids: this.tickerIds }));
    }
    let idx = Math.floor(Math.random() * this.config.wsEndpoints.length);
    await this.initWS(idx);
  }

  /**
   * Reset subscription to the given tickers
   */
  public reSubscribe() {
    this.ws!.send(JSON.stringify({ type: "unsubscribe", ids: this.tickerIds }));

    let request: IndexPriceFeedRequest = { type: "subscribe", ids: this.tickerIds };
    this.ws!.send(JSON.stringify(request));
  }

  private async waitForSocketState(client: WebSocket, state: number): Promise<void> {
    while (client.readyState !== state) {
      await sleep(10);
    }
  }

  /**
   * handle data received from websocket server
   * @param data response
   */
  async onMessage(data: WebSocket.RawData) {
    let dataJSON = JSON.parse(data.toString());
    this.lastHeartBeatMs = Date.now();
    if (dataJSON.type == "price_update") {
      let ticker = this.idToTicker.get("0x" + dataJSON.price_feed.id);
      if (ticker == undefined) {
        return;
      }
      let priceBN: number = parseInt(dataJSON.price_feed.price.price);
      let exponent: number = parseInt(dataJSON.price_feed.price.expo);
      let priceFloat: number = priceBN * 10 ** exponent;
      let timestampMs = parseFloat(dataJSON.price_feed.price.publish_time) * 1000;
      // notify subscribers with ticker and price
      await this.feedHandler.notifyPriceUpdateFromWS(ticker, priceFloat, timestampMs);
      this.lastHeartBeatMs = Date.now();
    } else if (dataJSON.type == "response") {
      this.lastHeartBeatMs = Date.now();
      console.log(dataJSON);
    } else {
      this.lastHeartBeatMs = Date.now();
    }
  }
}
