import express, { Express, Request, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg } from "./utils";
import { Order, PerpetualState, NodeSDKConfig } from "@d8x/perpetuals-sdk";
import EventListener from "./eventListener";
import NoBroker from "./noBroker";
import BrokerIntegration from "./brokerIntegration";
import fs from "fs";
import { type } from "os";
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

  constructor(broker: BrokerIntegration, sdkConfig: NodeSDKConfig) {
    this.express = express();

    this.swaggerData = fs.readFileSync("./src/swagger.json", "utf-8");
    this.swaggerDocument = JSON.parse(this.swaggerData);
    if (process.env.PORT == undefined) {
      throw Error("define PORT in .env");
    }
    if (process.env.PORT_WEBSOCKET == undefined) {
      throw Error("define PORT_WEBSOCKET in .env");
    }
    this.port = Number(process.env.PORT);
    this.portWS = Number(process.env.PORT_WEBSOCKET);
    this.wss = new WebSocketServer({ port: this.portWS });
    this.swaggerDocument.servers[0].url += ":" + process.env.PORT;
    this.sdkConfig = sdkConfig;
    this.eventListener = new EventListener(sdkConfig);
    console.log("url=", this.swaggerDocument.servers[0].url);
    this.sdk = new SDKInterface(broker);
    dotenv.config();
    this.middleWare();
  }

  public async initialize() {
    await this.sdk.initialize(this.sdkConfig);
    await this.eventListener.initialize(this.sdk);
    this.initWebSocket();
    this.routes();
  }

  public async checkEventListenerHeartbeat(timeSeconds: number, sdkConfig: NodeSDKConfig) {
    if (this.eventListener.timeMsSinceLastBlockchainEvent() / 1000 > timeSeconds) {
      // no event since timeSeconds, restart listener
      console.log("Restarting event listener");
      if (sdkConfig == undefined) {
        sdkConfig = this.sdkConfig;
      }
      this.eventListener = new EventListener(sdkConfig);
      await this.eventListener.initialize(this.sdk);
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
    this.wss.on("connection", function connection(ws: WebSocket.WebSocket) {
      ws.on("error", console.error);
      ws.on("message", async (data: WebSocket.RawData) => {
        try {
          let obj = JSON.parse(data.toString());
          console.log("received: ", obj);
          if (typeof obj.traderAddr != "string" || typeof obj.symbol != "string") {
            throw new Error("wrong arguments. Requires traderAddr and symbol");
          } else {
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
        eventListener.unsubscribe(ws);
      });
      ws.send(D8XBrokerBackendApp.JSONResponse("connect", `success`, {}));
    });
    console.log(`⚡️[server]: WS is running at ws://localhost:${this.portWS}`);
  }

  private middleWare() {
    this.express.use(express.urlencoded({ extended: false }));
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
    this.express.get("/exchangeInfo", async (req: Request, res: Response) => {
      try {
        let rsp = await this.sdk.exchangeInfo();
        res.send(D8XBrokerBackendApp.JSONResponse("exchangeInfo", "", rsp));
      } catch (err: any) {
        res.send(D8XBrokerBackendApp.JSONResponse("error", "exchangeInfo", { error: extractErrorMsg(err) }));
      }
    });

    this.express.get("/getPerpetualMidPrice", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "mid", "getPerpetualMidPrice", res);
    });

    this.express.get("/getMarkPrice", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "mark", "getMarkPrice", res);
    });

    this.express.get("/getOraclePrice", async (req: Request, res: Response) => {
      await this.priceType(req.query.symbol, "oracle", "getOraclePrice", res);
    });

    // in swagger
    this.express.get("/openOrders", async (req: Request, res: Response) => {
      // openOrders?traderAddr=0xCafee&symbol=BTC-USD-MATIC
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
        res.send(D8XBrokerBackendApp.JSONResponse("openOrders", "", rsp));
      } catch (err: any) {
        let usg = "openOrders?traderAddr=0xCafee&symbol=BTC-USD-MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "openOrders", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/getCurrentTraderVolume", async (req: Request, res: Response) => {
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
          res.send(D8XBrokerBackendApp.JSONResponse("getCurrentTraderVolume", "", rsp));
        }
      } catch (err: any) {
        let usg = "openOrders?traderAddr=0xCafee&poolSymbol=MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "openOrders", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/getOrderIds", async (req: Request, res: Response) => {
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
          res.send(D8XBrokerBackendApp.JSONResponse("getOrderIds", "", rsp));
        }
      } catch (err: any) {
        const usg = "getOrderIds?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "getOrderIds", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/queryFee", async (req: Request, res: Response) => {
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
          res.send(D8XBrokerBackendApp.JSONResponse("queryFee", "", rsp));
        }
      } catch (err: any) {
        const usg = "queryFee?traderAddr=0xCafee&poolSymbol=MATIC";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "queryFee", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    // in swagger
    this.express.get("/positionRisk", async (req: Request, res: Response) => {
      // http://localhost:3001/positionRisk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=BTC-USD-MATIC
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
          res.send(D8XBrokerBackendApp.JSONResponse("positionRisk", "", rsp));
        }
      } catch (err: any) {
        const usg = "positionRisk?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
        res.send(
          D8XBrokerBackendApp.JSONResponse("error", "positionRisk", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    // see test/post.test.ts for an example
    this.express.post("/orderDigest", async (req, res) => {
      try {
        let order: Order = <Order>req.body.order;
        let traderAddr: string = req.body.traderAddr;
        let rsp = await this.sdk.orderDigest(order, traderAddr);
        res.send(D8XBrokerBackendApp.JSONResponse("orderDigest", "", rsp));
      } catch (err: any) {
        const usg = "{order: <orderstruct>, traderAddr: string}";
        res.send(D8XBrokerBackendApp.JSONResponse("error", "orderDigest", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/perpetualStaticInfo", async (req: Request, res: Response) => {
      try {
        if (typeof req.query.symbol != "string") {
          throw new Error("wrong argument. Requires a symbol.");
        }
        let rsp = this.sdk.perpetualStaticInfo(req.query.symbol);
        res.send(D8XBrokerBackendApp.JSONResponse("perpetualStaticInfo", "", rsp));
      } catch (err: any) {
        res.send(D8XBrokerBackendApp.JSONResponse("error", "perpetualStaticInfo", { error: extractErrorMsg(err) }));
      }
    });
  }
}
