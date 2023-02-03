import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";

dotenv.config();
const port = process.env.PORT;
const app: Express = express();
const sdk: SDKInterface = new SDKInterface();

app.get("/", (req: Request, res: Response) => {
  let s = "Endpoints: /, /exchangeInfo";
  res.send("Express + TypeScript Server\n" + s);
});

app.get("/exchangeInfo", async (req: Request, res: Response) => {
  let rsp = await sdk.exchangeInfo();
  res.send(rsp);
});

app.listen(port, async () => {
  await sdk.initialize();
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
