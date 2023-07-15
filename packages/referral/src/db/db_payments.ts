import { Prisma, PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ABK64x64ToDecN, ABK64x64ToFloat, decNToFloat } from "utils";
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

// Make sure the decimal values are always return as normal numeric strings
// instead of scientific notation
Prisma.Decimal.prototype.toJSON = function () {
  return this.toFixed();
};

export default class DBPayments {
  constructor(public chainId: bigint, public prisma: PrismaClient, public l: Logger) {}

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
      await this.prisma.referralPayment.create({
        data: {
          trader_addr: openPayment.trader_addr.toLowerCase(),
          broker_addr: openPayment.broker_addr.toLowerCase(),
          code: openPayment.code,
          pool_id: Number(openPayment.pool_id.toString()),
          timestamp: openPayment.last_trade_considered_ts,
          trader_paid_amount_cc: openPayment.trader_cc_amtdec.toString(),
          broker_paid_amount_cc: brokerAmount.toString(),
          agency_paid_amount_cc: openPayment.trader_cc_amtdec.toString(),
          referrer_paid_amount_cc: openPayment.trader_cc_amtdec.toString(),
          tx_hash: txHash,
          tx_confirmed: false,
        },
      });
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
      await this.prisma.referralPayment.delete({
        where: {
          trader_addr_pool_id_timestamp: {
            trader_addr: traderAddr.toLowerCase(),
            pool_id: poolId,
            timestamp: timestampDate,
          },
        },
      });
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
      await this.prisma.referralPayment.update({
        where: {
          trader_addr_pool_id_timestamp: {
            trader_addr: openPayment.trader_addr.toLowerCase(),
            pool_id: Number(openPayment.pool_id.toString()),
            timestamp: keyTs,
          },
        },
        data: {
          tx_hash: hash,
        },
      });
      this.l.info(`dbPayments: inserted tx hash ${hash}`);
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
      await this.prisma.referralPayment.update({
        where: {
          trader_addr_pool_id_timestamp: {
            trader_addr: traderAddr.toLowerCase(),
            pool_id: poolId,
            timestamp: timestamp,
          },
        },
        data: {
          tx_confirmed: true,
        },
      });
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
      let record = await this.prisma.$queryRaw<VolResponse[]>`
        SELECT 
            pool_id, 
            TO_CHAR(quantity_cc_abdk, ${DECIMAL40_FORMAT_STRING}) AS quantity_cc_abdk,
            code
        FROM referral_vol
        WHERE LOWER(referrer_addr) = ${addr}
        `;
      let volArr: APIReferralVolume[] = [];
      for (let k = 0; k < record.length; k++) {
        const vol: APIReferralVolume = {
          poolId: record[k].pool_id,
          quantityCC: ABK64x64ToFloat(BigInt(record[k].quantity_cc_abdk)),
          code: record[k].code,
        };
        volArr.push(vol);
      }
      return volArr;
    } catch {
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
      let record = await this.prisma.referralPayment.findUnique({
        where: {
          trader_addr_pool_id_timestamp: {
            trader_addr: pay.payees[0].toLowerCase(),
            pool_id: pay.poolId,
            timestamp: pay.timestamp,
          },
        },
      });
      if (record != null) {
        if (record.tx_hash != pay.txHash) {
          //payment record with dummy transaction hash in db
          this.l.info(`confirmPayment: set tx hash ${record.tx_hash} to ${pay.txHash}`);
          try {
            await this.prisma.referralPayment.update({
              where: {
                trader_addr_pool_id_timestamp: {
                  trader_addr: pay.payees[0].toLowerCase(),
                  pool_id: pay.poolId,
                  timestamp: pay.timestamp,
                },
              },
              data: {
                tx_hash: pay.txHash,
              },
            });
          } catch (error) {
            this.l.warn(`confirmPayment: failed resetting tx hash`);
          }
        }
        if (!record.tx_confirmed) {
          //payment record exists with tx hash -> ensure ReferralPayment.tx_confirmed=true
          this.l.info(`confirmPayment: confirming payment for hash ${record.tx_hash}`);
          try {
            await this.prisma.referralPayment.update({
              where: {
                trader_addr_pool_id_timestamp: {
                  trader_addr: pay.payees[0].toLowerCase(),
                  pool_id: pay.poolId,
                  timestamp: pay.timestamp,
                },
              },
              data: {
                tx_confirmed: true,
              },
            });
          } catch (error) {
            this.l.warn(`confirmPayment: failed confirming payment`);
          }
        }
      } else {
        // no payment record at all in database -> enter all the data into db
        // insert record into DB
        this.l.info(`confirmPayment: could not find pay record in DB, inserting tx=${pay.txHash}.`);
        await this.prisma.referralPayment.create({
          data: {
            trader_addr: pay.traderAddr.toLowerCase(),
            broker_addr: pay.brokerAddr.toLowerCase(),
            code: pay.code,
            pool_id: pay.poolId,
            timestamp: pay.timestamp,
            trader_paid_amount_cc: pay.amounts[0].toString(),
            referrer_paid_amount_cc: pay.amounts[1].toString(),
            agency_paid_amount_cc: pay.amounts[2].toString(),
            broker_paid_amount_cc: pay.amounts[3].toString(),
            tx_hash: pay.txHash,
            tx_confirmed: true,
          },
        });
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
      let records: Response[];
      if (type == "trader") {
        records = await this.prisma.$queryRaw<Response[]>`
            SELECT 
                code,
                pool_id,
                TO_CHAR(sum(trader_paid_amount_cc), ${DECIMAL40_FORMAT_STRING}) as amount_cc,
                token_decimals
            FROM referral_payment_X_code
            WHERE LOWER(trader_addr) = ${addr}
            GROUP BY code, pool_id, token_decimals
            `;
      } else if (type == "referrer") {
        records = await this.prisma.$queryRaw<Response[]>`
            SELECT 
                code,
                pool_id,
                TO_CHAR(sum(referrer_paid_amount_cc), ${DECIMAL40_FORMAT_STRING}) as amount_cc,
                token_decimals
            FROM referral_payment_X_code
            WHERE LOWER(referrer_addr) = ${addr}
            GROUP BY code, pool_id, token_decimals
            `;
      } else if (type == "agency") {
        records = await this.prisma.$queryRaw<Response[]>`
            SELECT 
                code,
                pool_id,
                TO_CHAR(sum(agency_paid_amount_cc), ${DECIMAL40_FORMAT_STRING}) as amount_cc,
                token_decimals
            FROM referral_payment_X_code
            WHERE LOWER(agency_addr) = ${addr}
            GROUP BY code, pool_id, token_decimals
            `;
      } else {
        this.l.warn(`queryReferralPaymentsFor: error unknown type ${type}`);
        records = [];
      }
      let rebates: APIRebateEarned[] = [];
      for (let k = 0; k < records.length; k++) {
        let amt = records[k].amount_cc;
        let amount = BigInt(0);
        if (amt != null) {
          amount = BigInt(amt);
        }
        let r: APIRebateEarned = {
          poolId: records[k].pool_id,
          code: records[k].code,
          amountCC: decNToFloat(amount, records[k].token_decimals),
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
      const aggrTs = await this.prisma.referralPayment.aggregate({
        _min: {
          timestamp: true,
        },
        where: {
          OR: [{ tx_confirmed: false }, { tx_hash: TEMPORARY_TX_HASH }],
        },
      });
      const timestamp: Date | null = aggrTs._min.timestamp;
      return timestamp == null ? undefined : timestamp;
    } catch (error) {
      this.l.warn(`DBPayments: failed searching for oldest unconfirmed transaction`);
      return undefined;
    }
  }

  public async queryLastRecordedPaymentDate(): Promise<Date | undefined> {
    try {
      const aggrTs = await this.prisma.referralPayment.aggregate({
        _max: {
          timestamp: true,
        },
        where: {
          OR: [{ tx_confirmed: true }],
        },
      });
      const timestamp: Date | null = aggrTs._max.timestamp;
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
    const unconfirmed = await this.prisma.$queryRaw<UnconfirmedPaymentRecord[]>`
            SELECT trader_addr, pool_id, timestamp, tx_hash
            FROM referral_payment
            WHERE tx_confirmed=false AND tx_hash!=${TEMPORARY_TX_HASH}`;

    return unconfirmed;
  }

  /**
   * Collect all currently open payments. Trader addresses for
   * incomplete/unconfirmed payment records are not reported.
   * @param brokerAddr address of relevant broker
   * @returns open payments
   */
  public async aggregateFees(brokerAddr: string): Promise<ReferralOpenPayResponse[]> {
    // poolId = floor(perpetualId/100_000)
    const feeAggr = await this.prisma.$queryRaw<ReferralOpenPayResponse[]>`
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
            where broker_addr=${brokerAddr};`;
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
    const res = await this.prisma.$queryRaw<TraderOpenPayResponse[]>`
        SELECT pool_id, first_trade_considered_ts, last_payment_ts, pay_period_start_ts, code, token_name, token_decimals, TO_CHAR(sum(trader_cc_amtdec), ${DECIMAL40_FORMAT_STRING}) AS trader_cc_amtdec
        FROM referral_open_pay
        WHERE LOWER(trader_addr)=${addr} AND broker_addr=${brokerAddr}
        GROUP BY pool_id, pay_period_start_ts,last_payment_ts, code, first_trade_considered_ts, token_name, token_decimals;`;
    // cast types
    for (let k = 0; k < res.length; k++) {
      res[k].pool_id = BigInt(res[k].pool_id);
      res[k].trader_cc_amtdec = BigInt(res[k].trader_cc_amtdec);
    }
    console.log("dbPayments=", res);
    return res;
  }
}
