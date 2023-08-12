import { Database, NewPaymentTbl, UpdatePaymentTbl } from "./db_types";
import { Kysely, sql, QueryResult } from "kysely";
import { Logger } from "winston";
import { ABK64x64ToDecN, ABK64x64ToFloat, sleep, decNToFloat } from "utils";
import {
  ReferralOpenPayResponse,
  UnconfirmedPaymentRecord,
  PaymentEvent,
  DECIMAL40_FORMAT_STRING,
  TEMPORARY_TX_HASH,
  APIReferralVolume,
  APIRebateEarned,
  TraderOpenPayResponse,
} from "../referralTypes";
import DBBrokerFeeAccumulator from "../db/db_brokerFeeAccumulator";

export default class DBPayments {
  private lastUpdateBrokerFeesTsSec = 0;
  constructor(
    private dbBrokerFeeAccumulator: DBBrokerFeeAccumulator,
    private dbHandler: Kysely<Database>,
    public l: Logger
  ) {}

  /**
   * Pre-register a payment before on-chain execution
   * @param openPayment main data to be stored
   * @param brokerAmount amount of fees the broker collected from the trader
   * @param txHash payment transaction hash (dummy)
   * @returns true if successful
   */
  public async registerPayment(
    openPayment: ReferralOpenPayResponse,
    brokerAmount: bigint,
    txHash: string
  ): Promise<boolean> {
    try {
      let data: NewPaymentTbl = {
        trader_addr: openPayment.trader_addr.toLowerCase(),
        broker_addr: openPayment.broker_addr.toLowerCase(),
        code: openPayment.code,
        pool_id: Number(openPayment.pool_id.toString()),
        timestamp: openPayment.last_trade_considered_ts,
        trader_paid_amount_cc: openPayment.trader_cc_amtdec,
        broker_paid_amount_cc: brokerAmount,
        agency_paid_amount_cc: openPayment.trader_cc_amtdec,
        referrer_paid_amount_cc: openPayment.trader_cc_amtdec,
        tx_hash: txHash,
        tx_confirmed: false,
      };
      await this.dbHandler.insertInto("referral_payment").values(data).executeTakeFirst();
    } catch (error) {
      this.l.warn(`dbPayments: failed pre-inserting payment for trader ${openPayment.trader_addr}`);
      return false;
    }
    return true;
  }

  /**
   * Remove payment from data.
   * @param openPayment payment data entry
   */
  public async deletePaymentRecord(traderAddr: string, poolId: number, timestampDate: Date): Promise<void> {
    try {
      const result = await this.dbHandler
        .deleteFrom("referral_payment")
        .where("trader_addr", "=", traderAddr.toLowerCase())
        .where("pool_id", "=", poolId)
        .where("timestamp", "=", timestampDate)
        .executeTakeFirst();
      if (result.numDeletedRows == 0n) {
        throw Error();
      }
    } catch (error) {
      this.l.warn(`dbPayments: failed deleting failed record for trader ${traderAddr}`);
    }
  }

  /**
   * Amend pre-registered payment with transaction hash.
   * @param openPayment payment data to identify record
   * @param hash hash to be stored
   */
  public async writeTxHashForPayment(openPayment: ReferralOpenPayResponse, hash: string): Promise<void> {
    let keyTs = openPayment.last_trade_considered_ts;
    try {
      const data: UpdatePaymentTbl = {
        tx_hash: hash,
      };
      const result = await this.dbHandler
        .updateTable("referral_payment")
        .set(data)
        .where("trader_addr", "=", openPayment.trader_addr.toLowerCase())
        .where("pool_id", "=", Number(openPayment.pool_id.toString()))
        .where("timestamp", "=", keyTs)
        .executeTakeFirst();
      if (result.numUpdatedRows > 0n) {
        this.l.info(`dbPayments: inserted tx hash ${hash}`);
      }
    } catch (error) {
      this.l.warn(`dbPayments: failed inserting tx hash ${hash} for trader ${openPayment.trader_addr}`);
    }
  }

  /**
   * Confirm a payment
   * @param traderAddr trader address for payment record
   * @param poolId pool id
   * @param timestamp from last_trade_considered_ts
   */
  public async writeTxConfirmed(traderAddr: string, poolId: number, timestamp: Date): Promise<void> {
    try {
      await this.dbHandler
        .updateTable("referral_payment")
        .set({ tx_confirmed: true })
        .where("trader_addr", "=", traderAddr.toLowerCase())
        .where("pool_id", "=", poolId)
        .where("timestamp", "=", timestamp)
        .executeTakeFirst();
      this.l.info(`dbPayments: payment for trader ${traderAddr} and pool ${poolId} at ${timestamp} confirmed`);
    } catch (error) {
      this.l.warn(
        `dbPayments: failed to write confirmation for trader ${traderAddr} and pool ${poolId} at ${timestamp}`
      );
    }
  }

  public async queryReferredVolume(referrerAddr: string): Promise<APIReferralVolume[]> {
    let addr = referrerAddr.toLowerCase();
    interface VolResponse {
      pool_id: number;
      quantity_cc_abdk: string;
      code: string;
    }
    try {
      // 1) identify codes for the referrer
      // 2) for each code look-up code usage for (trader, from, to)
      // 3) query trading volume (trader, from, to) from API for each record found in 2
      // 4) aggregate
      /* 1 + 2 */
      type Response = {
        code: string;
        trader_addr: string;
        valid_from: Date;
        valid_to: Date;
      };
      let tradingPeriods = await sql<Response>`
        SELECT rcu.trader_addr,
                rcu.valid_from,
                rcu.valid_to,
                rcu.code
        FROM referral_code_usage rcu
        JOIN referral_code rc
            ON rc.referrer_addr = ${addr}
            AND rcu.code = rc.code
        `.execute(this.dbHandler);
      const api = this.dbBrokerFeeAccumulator.historyAPIEndpoint;
      interface ApiResponse {
        poolId: number;
        quantityCcAbdk: string;
      }
      // sum up all volumes per (pool,code)-pair
      let accumulatedVolume = new Map<string, bigint>();
      for (let k = 0; k < tradingPeriods.rows.length; k++) {
        let fromTimestamp = Math.round(tradingPeriods.rows[k].valid_from.getTime() / 1000);
        let toTimestamp = Math.round(tradingPeriods.rows[k].valid_to.getTime() / 1000);
        let traderAddr = tradingPeriods.rows[k].trader_addr;
        const query = `/trading-volume?traderAddr=${traderAddr}&fromTimestamp=${fromTimestamp}&toTimestamp=${toTimestamp}`;
        let res = await fetch(api + query);
        const data: ApiResponse[] = await res.json();
        for (let j = 0; j < data.length; j++) {
          const pId = data[j].poolId;
          const key = pId.toString() + "." + tradingPeriods.rows[k].code;
          const v = BigInt(data[j].quantityCcAbdk);
          if (accumulatedVolume.get(key) == undefined) {
            accumulatedVolume.set(key, v);
          } else {
            let v0 = accumulatedVolume.get(key)!;
            accumulatedVolume.set(key, v + v0);
          }
        }
        await sleep(10);
      }
      // construct response
      let volArr: APIReferralVolume[] = [];
      for (let [key, value] of accumulatedVolume) {
        const [pId, code] = key.split(".");
        const vol: APIReferralVolume = {
          poolId: Number(pId),
          quantityCC: ABK64x64ToFloat(value),
          code: code,
        };
        volArr.push(vol);
      }
      return volArr;
    } catch (err) {
      this.l.warn(`dbPayments: failed to query referral volume for referrer ${addr}`);
      return [];
    }
  }

  /**
   * Given an event polled from the blockchain, we aim to confirm the event.
   * If we don't find the data, we insert it into the database.
   * @param pay payment event collected via http poll
   */
  public async confirmPayment(pay: PaymentEvent): Promise<void> {
    try {
      let response = await this.dbHandler
        .selectFrom("referral_payment")
        .select(["tx_hash", "tx_confirmed"])
        .where("trader_addr", "=", pay.payees[0].toLowerCase())
        .where("pool_id", "=", pay.poolId)
        .where("timestamp", "=", pay.timestamp)
        .executeTakeFirst();
      if (response != undefined) {
        if (response.tx_hash != pay.txHash) {
          //payment record with dummy transaction hash in db
          this.l.info(`confirmPayment: set tx hash ${response.tx_hash} to ${pay.txHash}`);
          try {
            await this.dbHandler
              .updateTable("referral_payment")
              .set({ tx_hash: pay.txHash })
              .where("trader_addr", "=", pay.payees[0].toLowerCase())
              .where("pool_id", "=", pay.poolId)
              .where("timestamp", "=", pay.timestamp)
              .executeTakeFirst();
          } catch (error) {
            this.l.warn(`confirmPayment: failed resetting tx hash`);
          }
        }
        if (!response.tx_confirmed) {
          //payment record exists with tx hash -d> ensure ReferralPayment.tx_confirmed=true
          this.l.info(`confirmPayment: confirming payment for hash ${response.tx_hash}`);
          try {
            await this.dbHandler
              .updateTable("referral_payment")
              .set({ tx_confirmed: true })
              .where("trader_addr", "=", pay.payees[0].toLowerCase())
              .where("pool_id", "=", pay.poolId)
              .where("timestamp", "=", pay.timestamp)
              .executeTakeFirst();
          } catch (error) {
            this.l.warn(`confirmPayment: failed confirming payment`);
          }
        }
      } else {
        // no payment record at all in database -> enter all the data into db
        // insert record into DB
        this.l.info(`confirmPayment: could not find pay record in DB, inserting tx=${pay.txHash}.`);
        let data: NewPaymentTbl = {
          trader_addr: pay.traderAddr.toLowerCase(),
          broker_addr: pay.brokerAddr.toLowerCase(),
          code: pay.code,
          pool_id: pay.poolId,
          timestamp: pay.timestamp,
          trader_paid_amount_cc: pay.amounts[0],
          referrer_paid_amount_cc: pay.amounts[1],
          agency_paid_amount_cc: pay.amounts[2],
          broker_paid_amount_cc: pay.amounts[3],
          tx_hash: pay.txHash,
          tx_confirmed: true,
        };
        await this.dbHandler.insertInto("referral_payment").values(data).executeTakeFirst();
      }
    } catch (error) {
      this.l.warn(`confirmPayment: error`, error);
    }
  }

  public async queryReferralPaymentsFor(agentAddr: string, type: string): Promise<APIRebateEarned[]> {
    let addr = agentAddr.toLowerCase();
    interface Response {
      code: string;
      pool_id: number;
      amount_cc: string;
      token_decimals: number;
    }
    try {
      let records: QueryResult<Response>;
      if (type == "trader") {
        records = await sql<Response>`
            SELECT 
            code,
            pool_id,
            TO_CHAR(sum(trader_paid_amount_cc), ${DECIMAL40_FORMAT_STRING}) as amount_cc,
            token_decimals
            FROM referral_payment_X_code
                WHERE LOWER(trader_addr) = ${addr}
            GROUP BY code, pool_id, token_decimals
            `.execute(this.dbHandler);
      } else if (type == "referrer") {
        records = await sql<Response>`
            SELECT 
                code,
                pool_id,
                TO_CHAR(sum(referrer_paid_amount_cc), 
                ${DECIMAL40_FORMAT_STRING}) as amount_cc,
                token_decimals
            FROM referral_payment_X_code
                WHERE LOWER(referrer_addr) = ${addr}
            GROUP BY code, pool_id, token_decimals
            `.execute(this.dbHandler);
      } else if (type == "agency") {
        records = await sql<Response>`
            SELECT 
                code,
                pool_id,
                TO_CHAR(sum(agency_paid_amount_cc), ${DECIMAL40_FORMAT_STRING}) as amount_cc,
                token_decimals
            FROM referral_payment_X_code
            WHERE LOWER(agency_addr) = ${addr}
                GROUP BY code, pool_id, token_decimals
            `.execute(this.dbHandler);
      } else {
        this.l.warn(`queryReferralPaymentsFor: error unknown type ${type}`);
        return [];
      }
      let rebates: APIRebateEarned[] = [];
      for (let k = 0; k < records.rows.length; k++) {
        let amt = records.rows[k].amount_cc;
        let amount = BigInt(0);
        if (amt != null) {
          amount = BigInt(amt);
        }
        let r: APIRebateEarned = {
          poolId: records.rows[k].pool_id,
          code: records.rows[k].code,
          amountCC: decNToFloat(amount, records.rows[k].token_decimals),
        };
        rebates.push(r);
      }
      return rebates;
    } catch (error) {
      this.l.warn(`queryReferralPaymentsFor: error`, error);
      return [];
    }
  }

  /**
   * Get the timestamp for the oldest payment entry for which
   * - either no transaction hash has been registered. This means that either the payment failed or
   *   the registration of the transaction hash failed.
   * - the transaction is unconfirmed
   */
  public async queryEarliestUnconfirmedTxDate(): Promise<Date | undefined> {
    try {
      interface Response {
        min_ts: Date;
      }
      const aggrTs = await sql<Response>`
        SELECT min(timestamp) as min_ts
        FROM referral_payment
        WHERE tx_confirmed=false OR tx_hash = ${TEMPORARY_TX_HASH}`.execute(this.dbHandler);
      const timestamp: Date | null = aggrTs.rows[0].min_ts;
      return timestamp == null ? undefined : timestamp;
    } catch (error) {
      this.l.warn(`DBPayments: failed searching for oldest unconfirmed transaction`);
      return undefined;
    }
  }

  public async queryLastRecordedPaymentDate(): Promise<Date | undefined> {
    try {
      interface Response {
        max_ts: Date;
      }
      const aggrTs = await sql<Response>`
        SELECT max(timestamp) as max_ts
        FROM referral_payment
        where tx_confirmed = true`.execute(this.dbHandler);
      const timestamp: Date | null = aggrTs.rows[0].max_ts;
      return timestamp == null ? undefined : timestamp;
    } catch (error) {
      this.l.warn(`DBPayments: failed searching for oldest unconfirmed transaction`);
      return undefined;
    }
  }

  /**
   * Get all payment entries for which a transaction hash has been registered
   * but the transaction was not confirmed.
   * @returns all unconfirmed payments
   */
  public async queryUnconfirmedTransactions(): Promise<UnconfirmedPaymentRecord[]> {
    const unconfirmed = await sql<UnconfirmedPaymentRecord>`
        SELECT trader_addr, pool_id, timestamp, tx_hash
        FROM referral_payment
        WHERE tx_confirmed=false AND tx_hash!=${TEMPORARY_TX_HASH}`.execute(this.dbHandler);

    return unconfirmed.rows;
  }

  /**
   * Collect all currently open payments. Trader addresses for
   * incomplete/unconfirmed payment records are not reported.
   * @param brokerAddr address of relevant broker
   * @returns open payments
   */
  public async aggregateFees(brokerAddr: string): Promise<ReferralOpenPayResponse[]> {
    // poolId = floor(perpetualId/100_000)
    const feeAggrQ = await sql<ReferralOpenPayResponse>`
        SELECT 
            pool_id,
            trader_addr,
            broker_addr,
            first_trade_considered_ts,
            last_trade_considered_ts,
            pay_period_start_ts,
            code,
            referrer_addr,
            agency_addr,
            broker_payout_addr,
            trader_rebate_perc,
            referrer_rebate_perc,
            agency_rebate_perc,
            TO_CHAR(trader_cc_amtdec, ${DECIMAL40_FORMAT_STRING}) AS trader_cc_amtdec,
            TO_CHAR(referrer_cc_amtdec, ${DECIMAL40_FORMAT_STRING}) AS referrer_cc_amtdec,
            TO_CHAR(agency_cc_amtdec, ${DECIMAL40_FORMAT_STRING}) AS agency_cc_amtdec,
            TO_CHAR(broker_fee_cc_amtdec, ${DECIMAL40_FORMAT_STRING}) AS broker_fee_cc_amtdec,
            cut_perc,
            token_addr,
            token_name,
            token_decimals
        FROM referral_open_pay
        where broker_addr=${brokerAddr}`.execute(this.dbHandler);
    const feeAggr = feeAggrQ.rows;
    // cast types
    for (let k = 0; k < feeAggr.length; k++) {
      feeAggr[k].pool_id = BigInt(feeAggr[k].pool_id);
      feeAggr[k].trader_cc_amtdec = BigInt(feeAggr[k].trader_cc_amtdec);
      feeAggr[k].referrer_cc_amtdec = BigInt(feeAggr[k].referrer_cc_amtdec);
      feeAggr[k].agency_cc_amtdec = BigInt(feeAggr[k].agency_cc_amtdec);
      feeAggr[k].broker_fee_cc_amtdec = BigInt(feeAggr[k].broker_fee_cc_amtdec);
    }
    //console.log("dbPayments=", feeAggr);
    return feeAggr;
  }

  public async queryOpenPaymentsForTrader(traderAddr: string, brokerAddr: string) {
    const addr = traderAddr.toLowerCase();
    const res = await sql<TraderOpenPayResponse>`
        SELECT 
            pool_id, 
            first_trade_considered_ts, 
            last_payment_ts, 
            pay_period_start_ts, 
            code, token_name, 
            token_decimals, 
            TO_CHAR(sum(trader_cc_amtdec), 
            ${DECIMAL40_FORMAT_STRING}) AS trader_cc_amtdec
        FROM referral_open_pay
        WHERE LOWER(trader_addr)=${addr} AND broker_addr=${brokerAddr}
        GROUP BY pool_id, pay_period_start_ts,last_payment_ts, 
            code, first_trade_considered_ts, token_name, token_decimals;`.execute(this.dbHandler);

    // cast types
    for (let k = 0; k < res.rows.length; k++) {
      res.rows[k].pool_id = BigInt(res.rows[k].pool_id);
      res.rows[k].trader_cc_amtdec = BigInt(res.rows[k].trader_cc_amtdec);
    }
    console.log("dbPayments=", res.rows);
    return res.rows;
  }
}
