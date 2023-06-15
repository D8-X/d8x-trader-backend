import { Prisma, PrismaClient } from "@prisma/client";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { MarketData } from "@d8x/perpetuals-sdk";
import { dec18ToFloat, ABK64x64ToFloat } from "utils";
import dotenv from "dotenv";
import cors from "cors";

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
  constructor(port: number, public l: Logger) {
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
    this.express.get("/hello-world", async (req: Request, res: Response) => {
      await this.helloworld(req, res);
    });
  }

  /**
   * test
   * @param req  request
   * @param resp response
   */
  private async helloworld(req: Request, res: Response) {
    res.send("hello");
  }
}
