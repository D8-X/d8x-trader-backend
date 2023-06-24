import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ABK64x64ToDecN, floatToDecN } from "utils";
import { ReferralOpenPayResponse, UnconfirmedPaymentRecord, PaymentEvent, TEMPORARY_TX_HASH } from "../referralTypes";

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
          trader_addr: openPayment.trader_addr,
          broker_addr: openPayment.broker_addr,
          code: openPayment.code,
          pool_id: Number(openPayment.pool_id.toString()),
          timestamp: openPayment.last_trade_considered_ts,
          trader_paid_amount_cc: openPayment.trader_cc_amtdec,
          broker_paid_amount_cc: brokerAmount.toString(),
          agency_paid_amount_cc: openPayment.trader_cc_amtdec,
          referrer_paid_amount_cc: openPayment.trader_cc_amtdec,
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
            trader_addr: traderAddr,
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
            trader_addr: openPayment.trader_addr,
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
            trader_addr: traderAddr,
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
            trader_addr: pay.payees[0],
            pool_id: pay.poolId,
            timestamp: pay.timestamp,
          },
        },
      });
      if (record != null) {
        if (record.tx_hash != pay.txHash) {
          this.l.info(`confirmPayment: set tx hash ${record.tx_hash} to ${pay.txHash}`);
          try {
            await this.prisma.referralPayment.update({
              where: {
                trader_addr_pool_id_timestamp: {
                  trader_addr: pay.payees[0],
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
          this.l.info(`confirmPayment: confirming payment for hash ${record.tx_hash}`);
          try {
            await this.prisma.referralPayment.update({
              where: {
                trader_addr_pool_id_timestamp: {
                  trader_addr: pay.payees[0],
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
        // insert record into DB
        this.l.info(`confirmPayment: could not find pay record in DB, inserting tx=${pay.txHash}.`);
        await this.prisma.referralPayment.create({
          data: {
            trader_addr: pay.traderAddr,
            broker_addr: pay.brokerAddr,
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

  /**
   * Get the timestamp for the oldest payment entry for which
   * - either no transaction hash has been registered. This means that either the payment failed or
   *   the registration of the transaction hash failed.
   * - the transaction is unconfirmed
   */
  public async queryEarliestUnconfirmedTxDate(): Promise<Date | undefined> {
    try {
      const unconfirmedTs = await this.prisma.referralPayment.aggregate({
        _min: {
          timestamp: true,
        },
        where: {
          OR: [{ tx_confirmed: false }, { tx_hash: TEMPORARY_TX_HASH }],
        },
      });
      const unconfirmedTimestamp: Date | null = unconfirmedTs._min as unknown as Date;
      if (unconfirmedTimestamp == null) {
        return undefined;
      }
      return unconfirmedTimestamp;
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
                last_payment_ts,
                code,
                referrer_addr,
                agency_addr,
                broker_payout_addr,
                trader_rebate_perc,
                referrer_rebate_perc,
                agency_rebate_perc,
                CAST(trader_cc_amtdec AS VARCHAR) AS trader_cc_amtdec,
                CAST(referrer_cc_amtdec AS VARCHAR) AS referrer_cc_amtdec,
                CAST(agency_cc_amtdec AS VARCHAR) AS agency_cc_amtdec,
                CAST(broker_fee_cc AS VARCHAR) AS broker_fee_cc,
                cut_perc,
                token_addr,
                token_name,
                token_decimals
            FROM referral_open_pay
            where broker_addr=${brokerAddr};`;
    return feeAggr;
  }
}
