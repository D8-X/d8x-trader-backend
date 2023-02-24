import WebSocket from "ws";
import { createClient } from "redis";
import { WebsocketClientConfig } from "../wsTypes";
import { constructRedis } from "../utils";
import FeedHandler from "./feedHandler";

export interface IndexPriceFeedRequest {
  type: string; // subscribe/unsubscribe
  priceType: string; //idx or local
  tickers: string[]; //e.g. BTC-USD, ETH-USD
}

/**
 * Class to stream index prices from off-chain oracles to
 * front-end
 */
export default class IndexPxWSClient {
  private config: WebsocketClientConfig;
  private ws: WebSocket | undefined;
  private tickers: string[];
  private name: string;
  protected lastHeartBeatMs: number = 0;
  private prices: Map<string, [number, number]>;
  private feedHandler: FeedHandler; // reference to feedHandler (potentially shared by multiple WS Clients)

  constructor(config: WebsocketClientConfig, feedHandler: FeedHandler) {
    this.feedHandler = feedHandler;
    this.config = config;
    this.tickers = config.tickers;
    this.prices = new Map<string, [number, number]>();
    this.name = config.streamName;
  }

  /**
   * Connect to WebSocket server and initialize Redis
   * @param idx optional index of websocket server
   */
  public async init(idx?: number): Promise<void> {
    if (idx == undefined) {
      idx = Math.floor(Math.random() * this.config.wsEndpoints.length);
    }
    this.initWS(idx);
  }

  /**
   * Connect to websocket server
   * @param idx index of chosen server
   */
  private initWS(idx: number) {
    console.log("Endpoint ", this.config.wsEndpoints[idx], "for ", this.name);
    let wsAddr = this.config.wsEndpoints[idx];
    this.ws = new WebSocket(wsAddr);
    this.ws.on("open", () => this.onOpen());
    this.ws.on("message", (data: WebSocket.RawData) => this.onMessage(data));
  }

  private onOpen(): void {
    console.log(this.name + " opened");
    this.lastHeartBeatMs = Date.now();
    this.reSubscribe(this.tickers);
  }

  public timeMsSinceHeartbeat() {
    return Date.now() - this.lastHeartBeatMs;
  }

  /**
   * Randomly choose a WebSocket server, connect, and re-subscribe.
   */
  public switchWSServer() {
    if (this.ws != undefined) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", priceType: "idx", tickers: this.tickers }));
    }
    let idx = Math.floor(Math.random() * this.config.wsEndpoints.length);
    this.initWS(idx);
  }

  /**
   * Reset subscription to the given tickers
   * @param tickers subscribe to only these tickers
   */
  public reSubscribe(tickers: string[]) {
    this.ws!.send(JSON.stringify({ type: "unsubscribe", priceType: "idx", tickers: this.tickers }));
    for (let ticker in this.tickers) {
      if (!tickers.includes(ticker)) {
        this.prices.delete(ticker);
      }
    }
    this.tickers = tickers;
    let request: IndexPriceFeedRequest = { type: "subscribe", priceType: "idx", tickers: tickers };
    this.ws!.send(JSON.stringify(request));
  }

  /**
   * Send ping message to check alive status and get
   */
  public async sendPing() {
    //console.log("ping");
    await this.ws?.send(JSON.stringify({ type: "ping" }));
  }

  /**
   * handle data received from websocket server
   * @param data response
   */
  async onMessage(data: WebSocket.RawData) {
    let dataJSON = JSON.parse(data.toString());
    this.lastHeartBeatMs = Date.now();
    if (dataJSON.type == "subscription" && dataJSON.hasOwnProperty("ticker")) {
      this.feedHandler.notifyPriceUpdateFromWS(dataJSON.ticker, parseFloat(dataJSON.price), parseInt(dataJSON.ts));
      // notify subscribers with ticker and price
      console.log(this.name, " publish " + dataJSON.ticker + ":" + dataJSON.price + ":" + dataJSON.ts);
      this.lastHeartBeatMs = Date.now();
    } else if (dataJSON.type == "pong") {
      this.lastHeartBeatMs = Date.now();
    }
  }
}
