import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import cors from "cors";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { MarketData } from "@d8x/perpetuals-sdk";
import { dec18ToFloat, ABK64x64ToFloat } from "utils";
import FeeAggregator from "../db/fee_aggregator";

// Profit and loss express REST API
export default class ReferralAPI {
  public express: express.Application;
  private port: number;

  private CORS_ON: boolean;

  /**
   * Initialize RestAPI parameters, routes, middleware, etc
   * @param port port number
   * @param l    logger instance
   */
  constructor(port: number, private aggregator: FeeAggregator, private brokerAddr: string, public l: Logger) {
    dotenv.config();
    this.CORS_ON = !(process.env.CORS_ON == undefined || process.env.CORS_ON == "FALSE");
    this.express = express();
    this.port = port;
    this.middleWare();
  }

  /**
   * Initialize PNLRestAPI
   */
  public async initialize() {
    this.routes();
  }

  private middleWare() {
    this.express.use(express.urlencoded({ extended: false }));
    if (this.CORS_ON) {
      this.express.use(cors()); //needs to be above express.json
    }
    this.express.use(express.json());
  }

  /**
   * Starts the express app
   */
  private async routes() {
    this.express.listen(this.port, async () => {
      console.log(`⚡️[server]: Referral HTTP is running at http://localhost:${this.port}`);
    });
    this.express.get("/open-fees", async (req: Request, res: Response) => {
      await this.openFees(req, res);
    });
  }

  /**
   * test
   * @param req  request
   * @param resp response
   */
  private async openFees(req: Request, res: Response) {
    let table = await this.aggregator.aggregateFees(this.brokerAddr);
    res.send(table);
  }
}