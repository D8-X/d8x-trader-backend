import dotenv from "dotenv";
import cors from "cors";
import express, { Express, Request, Response, response } from "express";
import { Logger, error } from "winston";
import { extractErrorMsg, toJson, isValidAddress, decNToFloat } from "utils";
import { ReferralCodeSigner } from "@d8x/perpetuals-sdk";
import ReferralCodeValidator from "../svc/referralCodeValidator";
import { APITraderCode, APIReferralCodeRecord, APIReferralVolume, APIRebateEarned } from "../referralTypes";
import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import DBPayments from "../db/db_payments";
import DBReferralCode from "../db/db_referral_code";
import TokenAccountant from "../svc/tokenAccountant";

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
    private dbReferralCode: DBReferralCode,
    private dbPayment: DBPayments,
    private referralCodeValidator: ReferralCodeValidator,
    private tokenAccountant: TokenAccountant,
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
    this.express.post("/upsert-referral-code", async (req: Request, res: Response) => {
      try {
        await this.onCreateOrUpdateReferralCode(req, res);
      } catch (err: any) {
        const usg =
          `specify code:string, referrerAddr:string, agencyAddr:string, createdOn:` +
          `number, traderRebatePerc:number, agencyRebatePerc:number, referrerRebatePerc:` +
          `number, signature:string`;
        res.send(
          ReferralAPI.JSONResponse("error", "upsert-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    /**
     * tested
     */
    this.express.post("/select-referral-code", async (req: Request, res: Response) => {
      try {
        await this.onSelectReferralCode(req, res);
      } catch (err: any) {
        const usg = `specify code:string, traderAddr:string, createdOn:` + `number, signature:string`;
        res.send(
          ReferralAPI.JSONResponse("error", "select-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/referral-rebate/", async (req: Request, res: Response) => {
      try {
        await this.onReferralRebate(req, res);
      } catch (err: any) {
        const usg = `referral-rebate?referrerAddr=0x...`;
        res.send(ReferralAPI.JSONResponse("error", "referral-rebate", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/agency-rebate/", async (req: Request, res: Response) => {
      try {
        await this.onAgencyRebate(req, res);
      } catch (err: any) {
        const usg = `agency-rebate`;
        res.send(ReferralAPI.JSONResponse("error", "agency-rebate", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/open-trader-rebate/", async (req: Request, res: Response) => {
      try {
        await this.openTraderRebate(req, res);
      } catch (err: any) {
        const usg = `open-trader-rebate?addr=0x...`;
        res.send(ReferralAPI.JSONResponse("error", "open-trader-rebate", { error: extractErrorMsg(err), usage: usg }));
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

    this.express.get("/referral-volume", async (req: Request, res: Response) => {
      try {
        await this.onReferralVolume(req, res);
      } catch (err: any) {
        const usg = `referral-volume?referrerAddr=0x...`;
        res.send(
          ReferralAPI.JSONResponse("error", "create-referral-code", { error: extractErrorMsg(err), usage: usg })
        );
      }
    });

    this.express.get("/is-agency", async (req: Request, res: Response) => {
      try {
        await this.onIsAgency(req, res);
      } catch (err: any) {
        const usg = `is-agency?addr=0x...`;
        res.send(ReferralAPI.JSONResponse("error", "is-agency", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/earned-rebate", async (req: Request, res: Response) => {
      try {
        await this.onEarnedRebate(req, res);
      } catch (err: any) {
        const usg = `earned-rebate?referrerAddr=0x...|traderAddr=0x...|agencyAddr=0x...`;
        res.send(ReferralAPI.JSONResponse("error", "earned-rebate", { error: extractErrorMsg(err), usage: usg }));
      }
    });

    this.express.get("/code-info", async (req: Request, res: Response) => {
      try {
        await this.onCodeInfo(req, res);
      } catch (err: any) {
        const usg = `code-info?code=HAMZA1`;
        res.send(ReferralAPI.JSONResponse("error", "earned-rebate", { error: extractErrorMsg(err), usage: usg }));
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

  private throwErrorIfNoCode(rawCode: any): string {
    if (typeof rawCode != "string") {
      throw Error("invalid code");
    }
    let codeAdj = ReferralCodeValidator.washCode(rawCode);
    return codeAdj;
  }

  private async onCodeInfo(req: Request, res: Response) {
    let addr: string = this.throwErrorIfNoCode(req.query.code);
    let codeData: APIReferralCodeRecord;
    try {
      codeData = await this.dbReferralCode.queryCode(addr);
      // anonymize address
      codeData.referrerAddr = codeData.referrerAddr.substring(0, 15) + "...";
      codeData.brokerAddr = codeData.brokerAddr.substring(0, 15) + "...";
      codeData.agencyAddr = codeData.agencyAddr == "" ? "" : codeData.agencyAddr.substring(0, 15) + "...";

      res.send(ReferralAPI.JSONResponse("code-info", "", [codeData]));
    } catch (error) {
      res.send(ReferralAPI.JSONResponse("code-info", "code not found", []));
    }
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

  private async onReferralRebate(req: Request, res: Response) {
    let addr = this.throwErrorIfInvalidAddr(req.query.referrerAddr);
    let perc: number = await this.tokenAccountant.getCutPercentageForReferrer(addr);
    res.send(ReferralAPI.JSONResponse("referral-rebate", "", { percentageCut: perc }));
  }

  private async onIsAgency(req: Request, res: Response) {
    let addr = this.throwErrorIfInvalidAddr(req.query.addr);
    let isPermissioned = this.referralCodeValidator.isPermissionedAgency(addr);

    res.send(ReferralAPI.JSONResponse("is-agency", "", { isAgency: isPermissioned }));
  }

  private async onReferralVolume(req: Request, res: Response) {
    let addr = this.throwErrorIfInvalidAddr(req.query.referrerAddr);
    let vol: APIReferralVolume[] = await this.dbPayment.queryReferredVolume(addr);
    res.send(ReferralAPI.JSONResponse("referral-volume", "", vol));
  }

  private async onEarnedRebate(req: Request, res: Response) {
    let addr;
    let type;
    if (req.query.traderAddr != undefined) {
      addr = this.throwErrorIfInvalidAddr(req.query.traderAddr);
      type = "trader";
    } else if (req.query.agencyAddr != undefined) {
      addr = this.throwErrorIfInvalidAddr(req.query.agencyAddr);
      type = "agency";
    } else if (req.query.referrerAddr != undefined) {
      addr = this.throwErrorIfInvalidAddr(req.query.referrerAddr);
      type = "referrer";
    } else {
      throw Error("no trader, agency, or referrer address defined");
    }

    let rebates: APIRebateEarned[] = await this.dbPayment.queryReferralPaymentsFor(addr, type);
    res.send(ReferralAPI.JSONResponse("earned-rebates", "", rebates));
  }

  private async onAgencyRebate(req: Request, res: Response) {
    let perc: number = await this.tokenAccountant.getCutPercentageForAgency();
    res.send(ReferralAPI.JSONResponse("agency-rebate", "", { percentageCut: perc }));
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

  private async onCreateOrUpdateReferralCode(req: Request, res: Response) {
    let payload: APIReferralCodePayload = <APIReferralCodePayload>req.body;
    let existsCode = await this.referralCodeValidator.checkCode(payload);
    if (!(await ReferralCodeSigner.checkNewCodeSignature(payload))) {
      throw Error("signature invalid");
    }
    console.log(" PAYLOAD ------------");
    console.log(payload);
    // all checks passed, we can insert the code into the db
    const code = ReferralCodeValidator.washCode(payload.code);
    const rsp = "yourcode:" + code;
    if (!existsCode) {
      await this.dbReferralCode.insertNewCodeFromPayload(payload);
    } else {
      // update code
      await this.dbReferralCode.updateCodeFromPayload(payload);
    }
    console.log(rsp);
    res.send(ReferralAPI.JSONResponse("upsert-referral-code", "", { code: code, isNewCode: !existsCode }));
  }

  private async openTraderRebate(req: Request, res: Response) {
    let addr = this.throwErrorIfInvalidAddr(req.query.addr);
    let table = await this.dbPayment.queryOpenPaymentsForTrader(addr, this.brokerAddr);
    interface APIOpenPayResponse {
      poolId: number;
      lastPayment: Date;
      code: string;
      amountCC: number;
      tokenName: string;
    }
    let result: APIOpenPayResponse[] = [];
    for (let k = 0; k < table.length; k++) {
      result.push({
        poolId: Number(table[k].pool_id.toString()),
        lastPayment: table[k].last_payment_ts,
        code: table[k].code,
        amountCC: decNToFloat(table[k].trader_cc_amtdec, table[k].token_decimals),
        tokenName: table[k].token_name,
      });
    }
    res.send(ReferralAPI.JSONResponse("open-trader-rebate", "", result));
  }

  /**
   * test
   * @param req  request
   * @param resp response
   */
  private async openFees(req: Request, res: Response) {
    let table = await this.dbPayment.aggregateFees(this.brokerAddr);
    res.send(toJson(table));
  }
}
