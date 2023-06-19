import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ABK64x64ToDecN, floatToDecN, toJson } from "utils";

export default class DBFeeAggregator {
  constructor(public chainId: bigint, public prisma: PrismaClient, public l: Logger) {}

  public async aggregateFees(brokerAddr: string) {
    interface OpenFeesFromDB {
      pool_id: bigint;
      trader_addr: string;
      broker_addr: string;
      ts_first_trade_considered: Date;
      ts_last_trade_considered: Date;
      last_payment_ts: Date;
      code: string;
      referrer_addr: string;
      agency_addr: string;
      broker_payout_addr: string;
      trader_rebate_perc: number;
      referrer_rebate_perc: number;
      agency_rebate_perc: number;
      trader_cc_amtdec: string;
      referrer_cc_amtdec: string;
      agency_cc_amtdec: string;
      broker_fee_cc: string;
      cut_perc: number;
      token_addr: string;
      token_name: string;
      token_decimals: number;
    }
    // poolId = floor(perpetualId/100_000)
    const feeAggr = await this.prisma.$queryRaw<OpenFeesFromDB[]>`
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
    return toJson(feeAggr);
  }
}
