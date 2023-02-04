import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg } from "./utils";
import { Order } from "@d8x/perpetuals-sdk";

dotenv.config();
const port = process.env.PORT;
const router = express.Router();
const app: Express = express();
const sdk: SDKInterface = new SDKInterface();
//app.use(express.json());
//app.use(express.urlencoded({ extended: false }));

//app.use("/", router);
//Here we are configuring express to use body-parser as middle-ware.
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/", (req: Request, res: Response) => {
  let s = "Endpoints: /, /exchangeInfo, /openOrders, positionRisk";
  res.send("Express + TypeScript Server\n" + s);
});

app.post("/", (req: Request, res: Response) => {
  let s = "Endpoints: /, /exchangeInfo, /openOrders, positionRisk";
  res.status(201).send("Express + TypeScript Server\n" + s);
});

app.get("/exchangeInfo", async (req: Request, res: Response) => {
  let rsp = await sdk.exchangeInfo();
  res.send(rsp);
});

app.get("/openOrders", async (req: Request, res: Response) => {
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
      rsp = await sdk.openOrders(addr.toString(), symbol.toString());
    }
    res.send(rsp);
  } catch (err: any) {
    res.send(JSON.stringify({ error: extractErrorMsg(err) }));
  }
});

app.get("/positionRisk", async (req: Request, res: Response) => {
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
      rsp = await sdk.positionRisk(addr.toString(), symbol.toString());
    }
    res.send(rsp);
  } catch (err: any) {
    res.send(JSON.stringify({ error: extractErrorMsg(err) }));
  }
});

app.post("/orderDigest", async (req, res) => {
  console.log(req.body);
  let order: Order = <Order>req.body;
  //let rsp = await sdk.orderDigest(order);
  let rsp = "test";
  res.send(order);
});

app.listen(port, async () => {
  await sdk.initialize();
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
