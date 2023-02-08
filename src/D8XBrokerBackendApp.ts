import express, { Express, Request, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg } from "./utils";
import { Order } from "@d8x/perpetuals-sdk";
import EventListener from "./eventListener";
import NoBroker from "./noBroker";
import BrokerIntegration from "./brokerIntegration";
import fs from "fs";
dotenv.config();
//https://roger13.github.io/SwagDefGen/
//setAllowance?

export default class D8XBrokerBackendApp {
  public express: express.Application;
  private swaggerData;
  private swaggerDocument;
  private sdk: SDKInterface;
  private port: number;
  private portWS: number;
  private wss: WebSocketServer;
  private eventListener: EventListener;

  constructor(broker: BrokerIntegration) {
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
    this.eventListener = new EventListener("testnet");
    console.log("url=", this.swaggerDocument.servers[0].url);
    this.sdk = new SDKInterface(broker);
    dotenv.config();
    this.middleWare();
  }

  public async initialize() {
    await this.sdk.initialize();
    await this.eventListener.initialize();
    this.initWebSocket();
    this.routes();
  }

  private initWebSocket() {
    let eventListener = this.eventListener;
    this.wss.on("connection", function connection(ws: WebSocket.WebSocket) {
      ws.on("error", console.error);
      ws.on("message", (data: WebSocket.RawData) => {
        try {
          let obj = JSON.parse(data.toString());
          console.log("received: ", obj);
          if (typeof obj.traderAddr != "string" || typeof obj.symbol != "string") {
            throw new Error("wrong arguments. Requires traderAddr and symbol");
          } else {
            eventListener.subscribe(ws, obj.symbol, obj.traderAddr);
            ws.send(JSON.stringify("success"));
          }
        } catch (err: any) {
          let usage = "{symbol: BTC-USD-MATIC, traderAddr: 0xCAFE...}";
          ws.send(JSON.stringify({ usage: usage, error: extractErrorMsg(err) }));
        }
      });
      ws.on("close", () => {
        eventListener.unsubscribe(ws);
      });
      ws.send("something");
    });
    console.log(`⚡️[server]: WS is running at ws://localhost:${this.portWS}`);
  }

  private middleWare() {
    this.express.use(express.urlencoded({ extended: false }));
    this.express.use(express.json());
  }

  private async priceType(symbol: any, priceType: string): Promise<string> {
    try {
      if (typeof symbol != "string") {
        throw new Error("wrong arguments");
      }
      let rsp = await this.sdk.getPerpetualPriceOfType(symbol, priceType);
      return rsp;
    } catch (err: any) {
      let usage = "Parameter: symbol=BTC-USD-MATIC";
      return JSON.stringify({ usage: usage, error: extractErrorMsg(err) });
    }
  }
  private routes() {
    this.express.listen(this.port, async () => {
      console.log(`⚡️[server]: HTTP is running at http://localhost:${this.port}`);
    });

    // swagger docs
    this.express.use("/api/docs", swaggerUi.serve, swaggerUi.setup(this.swaggerDocument));

    this.express.post("/", (req: Request, res: Response) => {
      let s = "see: /api/docs";
      res.status(201).send("Express + TypeScript Server\n" + s);
    });

    // in swagger
    this.express.get("/exchangeInfo", async (req: Request, res: Response) => {
      let rsp = await this.sdk.exchangeInfo();
      res.send(rsp);
    });

    this.express.get("/getPerpetualMidPrice", async (req: Request, res: Response) => {
      let rsp = await this.priceType(req.query.symbol, "mid");
      res.send(rsp);
    });
    this.express.get("/getMarkPrice", async (req: Request, res: Response) => {
      let rsp = await this.priceType(req.query.symbol, "mark");
      res.send(rsp);
    });
    this.express.get("/getOraclePrice", async (req: Request, res: Response) => {
      let rsp = await this.priceType(req.query.symbol, "oracle");
      res.send(rsp);
    });

    // in swagger
    this.express.get("/openOrders", async (req: Request, res: Response) => {
      // openOrders?address=0xCafee&symbol=BTC-USD-MATIC
      let rsp;
      try {
        let addr: string;
        let symbol: string;
        if (typeof req.query.address != "string" || typeof req.query.symbol != "string") {
          throw new Error("wrong arguments. Requires address and symbol");
        } else {
          addr = req.query.address;
          symbol = req.query.symbol;
          rsp = await this.sdk.openOrders(addr.toString(), symbol.toString());
        }
        res.send(rsp);
      } catch (err: any) {
        res.send(JSON.stringify({ error: extractErrorMsg(err) }));
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
          res.send(rsp);
        }
      } catch (err: any) {
        res.send(JSON.stringify({ error: extractErrorMsg(err) }));
      }
    });

    this.express.get("/getOrderIds", async (req: Request, res: Response) => {
      let rsp;
      try {
        let traderAddr: string;
        let poolSymbol: string;
        if (typeof req.query.traderAddr != "string" || typeof req.query.poolSymbol != "string") {
          throw new Error("wrong arguments. Requires traderAddr and poolSymbol");
        } else {
          traderAddr = req.query.traderAddr;
          poolSymbol = req.query.poolSymbol;
          rsp = await this.sdk.getOrderIds(traderAddr, poolSymbol);
          res.send(rsp);
        }
      } catch (err: any) {
        res.send(JSON.stringify({ error: extractErrorMsg(err) }));
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
          res.send(rsp);
        }
      } catch (err: any) {
        res.send(JSON.stringify({ error: extractErrorMsg(err) }));
      }
    });

    // in swagger
    this.express.get("/positionRisk", async (req: Request, res: Response) => {
      // http://localhost:3001/positionRisk?address=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=BTC-USD-MATIC
      let rsp;
      try {
        let addr: string;
        let symbol: string;
        if (typeof req.query.address != "string" || typeof req.query.symbol != "string") {
          console.log(req.query.address);
          console.log(req.query.symbol);
          throw new Error("wrong arguments. Requires address and symbol");
        } else {
          addr = req.query.address;
          symbol = req.query.symbol;
          rsp = await this.sdk.positionRisk(addr.toString(), symbol.toString());
        }
        res.send(rsp);
      } catch (err: any) {
        res.send(JSON.stringify({ error: extractErrorMsg(err) }));
      }
    });

    // see test/post.test.ts for an example
    this.express.post("/orderDigest", async (req, res) => {
      try {
        let order: Order = <Order>req.body.order;
        let traderAddr: string = req.body.traderAddr;
        let rsp = await this.sdk.orderDigest(order, traderAddr);
        res.send(rsp);
      } catch (err: any) {
        let usage = "{order: <orderstruct>, traderAddr: string}";
        res.send(JSON.stringify({ usage: usage, error: extractErrorMsg(err) }));
      }
    });
  }
}
