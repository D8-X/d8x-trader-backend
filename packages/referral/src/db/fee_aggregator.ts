import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";
import { ABK64x64ToDecN, floatToDecN } from "utils";

export interface FeeAggregate {
  poolId: number;
  feesPaidDecN: bigint;
  tokenAddr: string;
  tokenName: string;
  tokenDecimals: number;
}

export class FeeAggregator {
  constructor(public chainId: bigint, public prisma: PrismaClient, public l: Logger) {}

  public async aggregateFees(traderAddr: string, fromTimestampSec: number, splitPercentages: [number, number, number]) {
    interface FeeAggregateFromDB {
      poolId: number;
      feeABDK: bigint;
      broker_fee_tbps: number;
      tokenAddr: string;
      tokenName: string;
      tokenDecimals: number;
    }
    // poolId = floor(perpetualId/100_000)
    const feeAggr = await this.prisma.$queryRaw<FeeAggregateFromDB[]>`
            select m.pool_id, sum(th.fee) as feeABDK, th.broker_fee_tbps, m.token_addr, m.token_name, m.token_decimals
            from trades_history th
                left join margin_token_info m
                on m.pool_id = th.perpetual_id/100000
                where th.timestamp>=${fromTimestampSec} and th.wallet_address=${traderAddr}
            group by m.pool_id, th.broker_fee_tbps;`;
    let feeArray: Array<FeeAggregate> = [];
    /*
    for (let k = 0; k < feeAggr.length; k++) {
      let feesPaidDecN: bigint =
        ABK64x64ToDecN(feeAggr[k].feeABDK, feeAggr[k].token_decimals) * floatToDecN(feeAggr[k].broker_fee_tbps * 1e-5);
      // continue here...
      feeArray.push({
        poolId: feeAggr[k].pool_id,
        feesPaidDecN: feesPaidDecN,
        tokenAddr: feeAggr[k].tokenAddr,
        tokenName: feeAggr[k].tokenName,
        tokenDecimals: feeAggr[k].tokenDecimals,
      });
    }*/
  }
}
