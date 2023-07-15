import express, { Express, Request, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg } from "utils";
import { Order, PerpetualState, NodeSDKConfig, MarginAccount } from "@d8x/perpetuals-sdk";
import EventListener, { TradeInteractionEvent } from "./eventListener";
import BrokerIntegration from "./brokerIntegration";
import fs from "fs";
import cors from "cors";
dotenv.config();
//https://roger13.github.io/SwagDefGen/
//setAllowance?

export default class D8XBrokerBackendApp {
  public express: express.Application;
  private swaggerData;
  private swaggerDocument;
  private sdk: SDKInterface;
  private sdkConfig: NodeSDKConfig;
  private port: number;
  private portWS: number;
  private wss: WebSocketServer;
  private eventListener: EventListener;
  private CORS_ON: boolean;

  constructor(broker: BrokerIntegration, sdkConfig: NodeSDKConfig, wsRPC: string) {
    dotenv.config();
    this.express = express();

    this.swaggerData = fs.readFileSync(__dirname + "/swagger.json", "utf-8");
    this.swaggerDocument = JSON.parse(this.swaggerData);
    if (process.env.PORT_REST == undefined) {
      throw Error("define PORT_REST in .env");
    }
    this.CORS_ON = !(process.env.CORS_ON == undefined || process.env.CORS_ON == "FALSE");
    if (process.env.PORT_WEBSOCKET == undefined) {
      throw Error("define PORT_WEBSOCKET in .env");
    }
    this.port = Number(process.env.PORT_REST);
    this.portWS = Number(process.env.PORT_WEBSOCKET);
    this.wss = new WebSocketServer({ port: this.portWS });
    this.swaggerDocument.servers[0].url += ":" + process.env.PORT_REST;
    this.sdkConfig = sdkConfig;
    this.eventListener = new EventListener(sdkConfig, wsRPC);
    console.log("url=", this.swaggerDocument.servers[0].url);
    this.sdk = new SDKInterface(broker);

    this.middleWare();
  }

  public async initialize() {
    await this.sdk.initialize(this.sdkConfig);
    await this.eventListener.initialize(this.sdk);
    this.initWebSocket();
    this.routes();
  }

  public async checkTradeEventListenerHeartbeat(sdkConfig: NodeSDKConfig, newWsRPC: string) {
    const lastEventTs = this.eventListener.timeMsSinceLastBlockchainEvent();
    const lastTradeEventsTs = this.eventListener.timeMsSinceLastTradeBlockchainEvents();
    let mins = lastTradeEventsTs.map((x) => Math.floor(x / 1000 / 6) / 10);
    const msg = `Last events/RPC reset: trade ${mins[TradeInteractionEvent.TradeEvt]}mins, overall ${
      Math.floor(lastEventTs / 1000 / 6) / 10
    }mins.`;

    const lastEventTooOld =
      lastEventTs > 10 * 60_000 ||
      mins[TradeInteractionEvent.TradeEvt] > 20 ||
      mins[TradeInteractionEvent.LimitOrderCreatedEvt] > 20;
    const tradeEventTooOldRelativeToEvent =
      mins[TradeInteractionEvent.TradeEvt] - mins[TradeInteractionEvent.LimitOrderCreatedEvt] > 15;
    const tradeEventDiffTooLarge =
      Math.abs(mins[TradeInteractionEvent.TradeEvt] - mins[TradeInteractionEvent.LimitOrderCreatedEvt]) > 2;
    if (lastEventTooOld || tradeEventTooOldRelativeToEvent || tradeEventDiffTooLarge) {
      // no event since timeSeconds, restart listener
      console.log(msg + ` - restarting event listener`);
      this.eventListener.resetRPCWebsocket(newWsRPC);
      if (sdkConfig == undefined) {
        sdkConfig = this.sdkConfig;
      }
    } else {
      console.log(msg + ` - no restart`);
    }
  }

  public static JSONResponse(type: string, msg: string, dataObj: object | string): string {
    if (typeof dataObj == "string") {
      dataObj = JSON.parse(dataObj);
    }
    return JSON.stringify({ type: type, msg: msg, data: dataObj });
  }

  private initWebSocket() {
    let eventListener = this.eventListener;
    let sdk = this.sdk;
    this.wss.on("connection", function connection(ws: WebSocket.WebSocket, req: IncomingMessage) {
      ws.on("error", console.error);
      ws.on("message", async (data: WebSocket.RawData) => {
        try {
          let obj = JSON.parse(data.toString());
          if (obj.type == "ping") {
            if (eventListener.isWsKnown(ws)) {
              ws.send(D8XBrokerBackendApp.JSONResponse("ping", "pong", {}));
            }
          } else if (obj.type == "unsubscribe") {
            eventListener.unsubscribe(ws, req);
          } else {
            console.log("received: ", obj);
            //type = subscription
            if (typeof obj.traderAddr != "string" || typeof obj.symbol != "string") {
              throw new Error("wrong arguments. Requires traderAddr and symbol");
            }
            let perpState: PerpetualState = await sdk.extractPerpetualStateFromExchangeInfo(obj.symbol);
            eventListener.subscribe(ws, obj.symbol, obj.traderAddr);
            ws.send(D8XBrokerBackendApp.JSONResponse("subscription", obj.symbol, perpState));
          }
        } catch (err: any) {
          const usage = "{symbol: BTC-USD-MATIC, traderAddr: 0xCAFE...}";
          ws.send(
            D8XBrokerBackendApp.JSONResponse("error", "websocket subscribe", {
              usage: usage,
              error: extractErrorMsg(err),
            })
          );
        }
      });
      ws.on("close", () => {
        eventListener.unsubscribe(ws, req);
      });
      ws.send(D8XBrokerBackendApp.JSONResponse("connect", `success`, {}));
    });
    console.log(`⚡️[server]: WS is running at ws://localhost:${this.portWS}`);
  }

  private middleWare() {
    this.express.use(express.urlencoded({ extended: false }));
    if (this.CORS_ON) {
      this.express.use(cors()); //needs to be above express.json
    }
    this.express.use(express.json());
  }

  /**
   * Generic price query
   * @param symbol symbol of perpetual (BTC-USD-MATIC)
   * @param priceType mid/mark/spot
   * @param type endpoint name
   * @param res response object
   */
  private async priceType(symbol: any, priceType: string, type: string, res: Response) {
    try {
      if (typeof symbol != "string") {
        throw new Error("wrong arguments");
      }
      let rsp = await this.sdk.getPerpetualPriceOfType(symbol, priceType);
      res.send(D8XBrokerBackendApp.JSONResponse(type, "", rsp));
    } catch (err: any) {
      let usg = "symbol=BTC-USD-MATIC";
      res.send(D8XBrokerBackendApp.JSONResponse("error", type, { error: extractErrorMsg(err), usage: usg }));
    }
  }

  private routes() {
    this.express.listen(this.port, async () => {
      console.log(`⚡️[server]: HTTP is running at http://localhost:${this.port}`);
    });

    // swagger docs
    this.express.use("/api/docs", swaggerUi.serve, swaggerUi.setup(this.swaggerDocument));

    this.express.post("/", (req: Request, res: Response) => {
      res.status(201).send(D8XBrokerBackendApp.JSONResponse("/", "Express + TypeScript Server", {}));
    });

    // in swagger
    this.express.get("/exchange-info", async (req: Request, res: Response) => {
      try {
        let rsp = await this.sdk.exchangeInfo();
        res.send(D8XBrokerBackendApp.JSONResponse("exchange-info", "", rsp));
      } catch (err: any) {
        res.send(D8XBrokerBackendApp.JSONResponse("error", "exchange-info", { error: extractErrorMsg(err) }));
      }
    });

    this.express.get("/perpetual-mid-price", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "mid", "perpetual-mid-price", res);
    });

    this.express.get("/mark-price", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "mark", "mark-price", res);
    });

    this.express.get("/oracle-price", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "oracle", "oracle-price", res);
    });

    // in swagger
    this.express.get("/open-orders", async (req: Request, res: Response) => {
      // open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC
      let rsp;
      try {
        let addr: string;
        let symbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.symbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and symbol");
        } else {
          addr = req.query.traderAddr;
          symbol = req.query.symbol;
          rsp = await this.sdk.openOrders(addr.toString(), symbol.toString());
        }
        res.send(D8XBrokerBackendApp.JSONResponse("open-orders", "", rsp));
      } catch (err: any) {
        let usg = "open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "open-orders", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/current-trader-volume", async (req: Request, res: Response) => {
      let rsp;
      try {
        let traderAddr: string;
        let poolSymbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.poolSymbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and poolSymbol");
        } else {
          traderAddr = req.query.traderAddr;
          poolSymbol = req.query.poolSymbol;
          rsp = await this.sdk.getCurrentTraderVolume(traderAddr, poolSymbol);
          res.send(D8XBrokerBackendApp.JSONResponse("current-trader-volume", "", rsp));
        }
      } catch (err: any) {
        let usg = "current-trader-volume?traderAddr=0xCafee&poolSymbol=MATIC";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "current-trader-volume", {
            error: extractErrorMsg(err),
            usage: usg,
          })
        );
      }
    });

    this.express.get("/order-ids", async (req: Request, res: Response) => {
      let rsp;
      try {
        let traderAddr: string;
        let symbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.symbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and symbol");
        } else {
          traderAddr = req.query.traderAddr;
          symbol = req.query.symbol;
          rsp = await this.sdk.getOrderIds(traderAddr, symbol);
          res.send(D8XBrokerBackendApp.JSONResponse("order-ids", "", rsp));
        }
      } catch (err: any) {
        const usg = "order-ids?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "order-ids", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/trading-fee", async (req: Request, res: Response) => {
      let rsp;
      try {
        let traderAddr: string;
        let poolSymbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.poolSymbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and poolSymbol");
        } else {
          traderAddr = req.query.traderAddr;
          poolSymbol = req.query.poolSymbol;
          rsp = await this.sdk.queryFee(traderAddr, poolSymbol);
          res.send(D8XBrokerBackendApp.JSONResponse("trading-fee", "", rsp));
        }
      } catch (err: any) {
        const usg = "trading-fee?traderAddr=0xCafee&poolSymbol=MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "trading-fee", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    // in swagger
    this.express.get("/position-risk", async (req: Request, res: Response) => {
      // http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=BTC-USD-MATIC
      // http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC
      let rsp;
      try {
        let addr: string;
        let symbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.symbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and symbol");
        } else {
          addr = req.query.traderAddr;
          symbol = req.query.symbol;
          rsp = await this.sdk.positionRisk(addr.toString(), symbol.toString());
          res.send(D8XBrokerBackendApp.JSONResponse("position-risk", "", rsp));
        }
      } catch (err: any) {
        const usg = "position-risk?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "position-risk", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/max-order-size-for-trader", async (req: Request, res: Response) => {
      let rsp: string;
      try {
        let addr: string;
        let symbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.symbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and symbol");
        } else {
          addr = req.query.traderAddr;
          symbol = req.query.symbol;
          rsp = await this.sdk.maxOrderSizeForTrader(addr.toString(), symbol.toString());
          res.send(D8XBrokerBackendApp.JSONResponse("max-order-size-for-trader", "", rsp));
        }
      } catch (err: any) {
        const usg = "max-order-size-for-trader?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "max-order-size-for-trader", {
            error: extractErrorMsg(err),
            usage: usg,
          })
        );
      }
    });

    this.express.get("/trader-loyalty", async (req: Request, res: Response) => {
      let rsp: string;
      try {
        let addr: string;
        if (typeof req.query.traderAddr != "string") {
          throw new Error("wrong arguments. Requires traderAddr");
        } else {
          addr = req.query.traderAddr;
          rsp = await this.sdk.traderLoyalty(addr.toString());
          res.send(D8XBrokerBackendApp.JSONResponse("trader-loyalty", "", rsp));
        }
      } catch (err: any) {
        const usg = "trader-loyalty?traderAddr=0xCafee";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "trader-loyalty", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/perpetual-static-info", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string") {
          throw new Error("wrong argument. Requires a symbol.");
        }
        let rsp = this.sdk.perpetualStaticInfo(req.query.symbol);
        res.send(D8XBrokerBackendApp.JSONResponse("perpetual-static-info", "", rsp));
      } catch (err: any) {
        const usg = "perpetual-static-info?symbol=BTC-USD-MATIC";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "perpetual-static-info", {
            error: extractErrorMsg(err),
            usage: usg,
          })
        );
      }
    });

    // see test/post.test.ts for an example
    this.express.post("/order-digest", async (req, res) => {
      try {
        let orders: Order[] = <Order[]>req.body.orders;
        let traderAddr: string = req.body.traderAddr;
        let rsp = await this.sdk.orderDigest(orders, traderAddr);
        res.send(D8XBrokerBackendApp.JSONResponse("order-digest", "", rsp));
      } catch (err: any) {
        const usg = "{orders: <orderstruct>, traderAddr: string}";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "order-digest", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.post("/position-risk-on-trade", async (req, res) => {
      try {
        let order: Order = <Order>req.body.order;
        let traderAddr: string = req.body.traderAddr;
        let rsp = await this.sdk.positionRiskOnTrade(order, traderAddr);
        res.send(D8XBrokerBackendApp.JSONResponse("position-risk-on-trade", "", rsp));
      } catch (err: any) {
        const usg = "{order: <orderstruct>, traderAddr: string}";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "position-risk-on-trade", {
            error: extractErrorMsg(err),
            usage: usg,
          })
        );
      }
    });

    this.express.post("/position-risk-on-collateral-action", async (req, res) => {
      try {
        let traderAddr: string = req.body.traderAddr;
        let deltaCollateral: number = <number>req.body.amount;
        let curPositionRisk: MarginAccount = <MarginAccount>req.body.positionRisk;
        let rsp = await this.sdk.positionRiskOnCollateralAction(traderAddr, deltaCollateral, curPositionRisk);
        res.send(D8XBrokerBackendApp.JSONResponse("position-risk-on-collateral-action", "", rsp));
      } catch (err: any) {
        const usg = "{traderAddr: string, amount: number, positionRisk: <MarginAccount struct>}";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "position-risk-on-collateral-action", {
            error: extractErrorMsg(err),
            usage: usg,
          })
        );
      }
    });

    this.express.get("/add-collateral", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string" || typeof req.query.amount != "string") {
          throw new Error("wrong arguments. Requires a symbol and an amount.");
        }
        let rsp = await this.sdk.addCollateral(req.query.symbol, req.query.amount);
        res.send(D8XBrokerBackendApp.JSONResponse("add-collateral", "", rsp));
      } catch (err: any) {
        const usg = "add-collateral?symbol=MATIC&amount='110.4'";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "add-collateral", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/remove-collateral", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string" || typeof req.query.amount != "string") {
          throw new Error("wrong arguments. Requires a symbol and an amount.");
        }
        let rsp = await this.sdk.removeCollateral(req.query.symbol, req.query.amount);
        res.send(D8XBrokerBackendApp.JSONResponse("remove-collateral", "", rsp));
      } catch (err: any) {
        const usg = "remove-collateral?symbol=MATIC&amount='110.4'";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "remove-collateral", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/available-margin", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string" || typeof req.query.traderAddr != "string") {
          throw new Error("wrong arguments. Requires a symbol and a trader address.");
        }
        let rsp = await this.sdk.getAvailableMargin(req.query.symbol, req.query.traderAddr);
        res.send(D8XBrokerBackendApp.JSONResponse("available-margin", "", rsp));
      } catch (err: any) {
        const usg = "available-margin?symbol=BTC-USD-MATIC&traderAddr=0xCaffEe";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "available-margin", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/cancel-order", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string" || typeof req.query.orderId != "string") {
          throw new Error("wrong arguments. Requires a symbol and an order Id.");
        }
        let rsp = await this.sdk.cancelOrder(req.query.symbol, req.query.orderId);
        res.send(D8XBrokerBackendApp.JSONResponse("cancel-order", "", rsp));
      } catch (err: any) {
        const usg = "cancel-order?symbol=BTC-USD-MATIC&orderId=0xCaffEe";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "cancel-order", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });
  }
}
