import dotenv from "dotenv";
import cors from "cors";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { extractErrorMsg } from "utils";
import ReferralCodeSigner from "../svc/referralCodeSigner";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import { ReferralCodePayload } from "../referralTypes";
import DBFeeAggregator from "../db/db_fee_aggregator";
import DBReferralCode from "../db/db_referral_code";

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
  constructor(
    port: number,
    private dbFeeAggregator: DBFeeAggregator,
    private dbReferralCode: DBReferralCode,
    private referralCodeValidator: ReferralCodeValidator,
    private brokerAddr: string,
    public l: Logger
  ) {
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

  public static JSONResponse(type: string, msg: string, dataObj: object | string): string {
    if (typeof dataObj == "string") {
      dataObj = JSON.parse(dataObj);
    }
    return JSON.stringify({ type: type, msg: msg, data: dataObj });
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
    this.express.post("/create-referral-code", async (req, res) => {
      try {
        let payload: ReferralCodePayload = <ReferralCodePayload>req.body;
        await this.referralCodeValidator.checkPayload(payload);
        if (!(await ReferralCodeSigner.checkSignature(payload))) {
          throw Error("signature invalid");
        }
        console.log(" PAYLOAD ------------");
        console.log(payload);
        // all checks passed, we can insert the code into the db
        const code = ReferralCodeValidator.washCode(payload.code);
        const rsp = "yourcode:" + code;
        await this.dbReferralCode.insertFromPayload(payload);
        console.log(rsp);
        res.send(ReferralAPI.JSONResponse("create-referral-code", "", { code: code }));
      } catch (err: any) {
        const usg =
          `specify code:string, referrerAddr:string, agencyAddr:string, createdOn:` +
          `number, traderRebatePerc:number, agencyRebatePerc:number, referrerRebatePerc:` +
          `number, signature:string`;
        res
          .status(400)
          .send(ReferralAPI.JSONResponse("error", "create-referral-code", { error: extractErrorMsg(err), usage: usg }));
      }
    });
  }

  /**
   * test
   * @param req  request
   * @param resp response
   */
  private async openFees(req: Request, res: Response) {
    let table = await this.dbFeeAggregator.aggregateFees(this.brokerAddr);
    res.send(table);
  }
}
