import dotenv from "dotenv";
import cors from "cors";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { extractErrorMsg, toJson, isValidAddress } from "utils";
import ReferralCodeSigner from "../svc/referralCodeSigner";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import {
  APIReferralCodePayload,
  APITraderCode,
  APIReferralCodeRecord,
  APIReferralCodeSelectionPayload,
} from "../referralTypes";
import DBPayments from "../db/db_payments";
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
    private dbFeeAggregator: DBPayments,
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

    /**
     * tested
     */
    this.express.post("/create-referral-code", async (req: Request, res: Response) => {
      try {
        await this.onCreateReferralCode(req, res);
      } catch (err: any) {
        const usg =
          `specify code:string, referrerAddr:string, agencyAddr:string, createdOn:` +
          `number, traderRebatePerc:number, agencyRebatePerc:number, referrerRebatePerc:` +
          `number, signature:string`;
        res.send(
          ReferralAPI.JSONResponse("error", "create-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    /**
     * tested
     */
    this.express.post("/select-referral-code", async (req: Request, res: Response) => {
      try {
        this.onSelectReferralCode(req, res);
      } catch (err: any) {
        const usg = `specify code:string, traderAddr:string, createdOn:` + `number, signature:string`;
        res.send(
          ReferralAPI.JSONResponse("error", "select-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/my-referral-codes", async (req: Request, res: Response) => {
      try {
        await this.onMyReferralCodes(req, res);
      } catch (err: any) {
        const usg = `my-referral-codes?addr=0x...`;
        res.send(
          ReferralAPI.JSONResponse("error", "create-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });
  }

  private throwErrorIfInvalidAddr(addr: any): string {
    if (typeof addr != "string") {
      throw Error("invalid address");
    }
    if (!isValidAddress(addr)) {
      throw Error("invalid address");
    }
    return addr.toLowerCase();
  }

  private async onMyReferralCodes(req: Request, res: Response) {
    let addr: string = this.throwErrorIfInvalidAddr(req.query.addr);
    let traderCode: APITraderCode = await this.dbReferralCode.queryTraderCode(addr);
    let referrerCodes: APIReferralCodeRecord[] = await this.dbReferralCode.queryReferrerCodes(addr);
    let agencyCodes: APIReferralCodeRecord[] = await this.dbReferralCode.queryAgencyCodes(addr);
    let resultObj = {
      trader: traderCode,
      referrer: referrerCodes,
      agency: agencyCodes,
    };
    res.send(ReferralAPI.JSONResponse("my-referral-codes", "", resultObj));
  }

  private async onSelectReferralCode(req: Request, res: Response) {
    let payload: APIReferralCodeSelectionPayload = <APIReferralCodeSelectionPayload>req.body;
    await this.referralCodeValidator.checkSelectCodePayload(payload);
    if (!(await ReferralCodeSigner.checkCodeSelectionSignature(payload))) {
      throw Error("signature invalid");
    }
    console.log(" PAYLOAD ------------");
    console.log(payload);
    // all checks passed, we can insert the code into the db
    const code = ReferralCodeValidator.washCode(payload.code);
    const rsp = "yourcode:" + code;
    await this.dbReferralCode.insertCodeSelectionFromPayload(payload);
    console.log(rsp);
    res.send(ReferralAPI.JSONResponse("select-referral-code", "", { code: code }));
  }

  private async onCreateReferralCode(req: Request, res: Response) {
    let payload: APIReferralCodePayload = <APIReferralCodePayload>req.body;
    await this.referralCodeValidator.checkNewCodePayload(payload);
    if (!(await ReferralCodeSigner.checkNewCodeSignature(payload))) {
      throw Error("signature invalid");
    }
    console.log(" PAYLOAD ------------");
    console.log(payload);
    // all checks passed, we can insert the code into the db
    const code = ReferralCodeValidator.washCode(payload.code);
    const rsp = "yourcode:" + code;
    await this.dbReferralCode.insertNewCodeFromPayload(payload);
    console.log(rsp);
    res.send(ReferralAPI.JSONResponse("create-referral-code", "", { code: code }));
  }

  /**
   * test
   * @param req  request
   * @param resp response
   */
  private async openFees(req: Request, res: Response) {
    let table = await this.dbFeeAggregator.aggregateFees(this.brokerAddr);
    res.send(toJson(table));
  }
}
