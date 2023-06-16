import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ABK64x64ToDecN, floatToDecN, toJson } from "utils";

export default class FeeAggregator {
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
      trader_cc_amtdec: bigint;
      referrer_cc_amtdec: bigint;
      agency_cc_amtdec: bigint;
      total_fee_cc: bigint;
      token_addr: string;
      token_name: string;
      token_decimals: number;
    }
    // poolId = floor(perpetualId/100_000)
    const feeAggr = await this.prisma.$queryRaw<OpenFeesFromDB[]>`
            SELECT *
            FROM open_fees
            where broker_addr=${brokerAddr};`;
    return toJson(feeAggr);
  }
}
