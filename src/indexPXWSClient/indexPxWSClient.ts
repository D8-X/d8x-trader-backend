import WebSocket from "ws";
import { createClient } from "redis";
import { WebsocketClientConfig } from "../wsTypes";

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
  private redisClient: ReturnType<typeof createClient>;
  protected lastHeartBeatMs: number = 0;
  private prices: Map<string, [number, number]>;

  constructor(config: WebsocketClientConfig) {
    this.config = config;
    this.tickers = config.tickers;
    this.prices = new Map<string, [number, number]>();
    this.name = config.streamName;
    this.redisClient = this.constructRedis();
  }

  public constructRedis(): ReturnType<typeof createClient> {
    let redisUrl: string | undefined = process.env.REDIS_URL;
    let client;
    if (redisUrl == undefined || redisUrl == "") {
      console.log(`${this.name} connecting to redis`);
      client = createClient();
    } else {
      console.log(`${this.name} connecting to redis: ${redisUrl}`);
      client = createClient({ url: redisUrl });
    }
    client.on("error", (err) => console.log(`${this.name} Redis Client Error:` + err));
    return client;
  }

  /**
   * Connect to WebSocket server and initialize Redis
   * @param idx optional index of websocket server
   */
  public async init(idx?: number): Promise<void> {
    await this.redisClient!.connect();
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
      this.prices.set(dataJSON.ticker, [parseFloat(dataJSON.price), parseInt(dataJSON.ts)]);
      await this.redisClient!.hSet(dataJSON.ticker, [dataJSON.price, dataJSON.ts]);
      // notify subscribers with ticker and price
      console.log(this.name, " publish " + dataJSON.ticker + ":" + dataJSON.price + ":" + dataJSON.ts);
      await this.redisClient!.publish("px-idx", dataJSON.ticker + ":" + dataJSON.price + ":" + dataJSON.ts);
      this.lastHeartBeatMs = Date.now();
    } else if (dataJSON.type == "pong") {
      this.lastHeartBeatMs = Date.now();
    }
  }
}
