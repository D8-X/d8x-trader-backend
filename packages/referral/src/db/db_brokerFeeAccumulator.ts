import { Database, NewMarginTokenInfoTbl, NewBrokerFeesPerTraderTbl, UpdateMarginTokenInfoTbl } from "./db_types";
import { Kysely } from "kysely";
import { Logger } from "winston";

interface BrokerFeePayments {
  poolId: number;
  traderAddr: string;
  quantityCcAbdk: string;
  brokerFeeCcAbdk: string;
  tradeTimestamp: Date;
}

interface MarginTokenInfo {
  poolId: number;
  tokenAddr: string;
  tokenName: string;
  tokenDecimals: number;
}

/**
 * This class
 *  1)  queries broker fees from the history-API
 *      and inserts the data into the table referral_broker_fees_per_trader
 *  2)  queries margin token infos, which also contains the information on
 *      number of pools. Stores in margin_token_info table
 * Subsequently, the data is used for the payment system
 */
export default class DBBrokerFeeAccumulator {
  public historyAPIEndpoint;
  private lastMarginTokenInfoUpdateTsMs;
  private poolIds = new Array<number>();
  private latestFeeRecordInPoolTsSec = new Array<number>();
  constructor(
    private dbHandler: Kysely<Database>,
    historyAPIEndpoint: string,
    private brokerAddr: string,
    public l: Logger
  ) {
    this.historyAPIEndpoint = historyAPIEndpoint.replace(/\/+$/, ""); // remove trailing slash
    this.lastMarginTokenInfoUpdateTsMs = 0;
  }

  private async queryBrokerFeesFromAPI(fromTsSec: number, poolId: number): Promise<BrokerFeePayments[]> {
    const endp = this.historyAPIEndpoint + "/broker-fee-payments";
    //???????/??????x
    const req = `${endp}?brokerAddr=${this.brokerAddr}&poolId=${poolId}&fromTimestamp=${fromTsSec}`;
    let res = await fetch(req);
    const data: BrokerFeePayments[] = await res.json();
    return data;
  }

  private async queryMarginTokenInfoFromAPI(): Promise<MarginTokenInfo[]> {
    const req = `${this.historyAPIEndpoint}/margin-token-info`;
    let res = await fetch(req);
    const data: MarginTokenInfo[] = await res.json();
    return data;
  }

  public async updateMarginTokenInfoFromAPI(forceUpdate: boolean) {
    if (!forceUpdate && Date.now() - this.lastMarginTokenInfoUpdateTsMs < 86400_000) {
      return;
    }
    const tokenData = await this.queryMarginTokenInfoFromAPI();
    if (tokenData.length > 0) {
      this.lastMarginTokenInfoUpdateTsMs = Date.now();
    }
    this.poolIds = new Array<number>();
    for (let k = 0; k < tokenData.length; k++) {
      const currRecord: MarginTokenInfo = tokenData[k];
      this.poolIds.push(currRecord.poolId);
      let res = await this.dbHandler
        .selectFrom("referral_margin_token_info")
        .select("token_addr")
        .where("pool_id", "=", currRecord.poolId)
        .executeTakeFirst();
      if (res == undefined) {
        // doesn't exist*/
        const data: NewMarginTokenInfoTbl = {
          pool_id: currRecord.poolId,
          token_addr: currRecord.tokenAddr,
          token_name: currRecord.tokenName,
          token_decimals: currRecord.tokenDecimals,
        };
        await this.dbHandler.insertInto("referral_margin_token_info").values(data).executeTakeFirst();
      } else {
        // update
        const data: UpdateMarginTokenInfoTbl = {
          token_addr: currRecord.tokenAddr,
          token_name: currRecord.tokenName,
          token_decimals: currRecord.tokenDecimals,
        };
        await this.dbHandler
          .updateTable("referral_margin_token_info")
          .set(data)
          .where("pool_id", "=", currRecord.poolId)
          .executeTakeFirst();
      }
    }
    // ensure we have one slot per pool in latestFeeRecordInPoolTsSec which
    // is initialized with 14 days in the past
    while (this.latestFeeRecordInPoolTsSec.length < this.poolIds.length) {
      this.latestFeeRecordInPoolTsSec.push(Date.now() / 1000 - 86_400 * 14);
    }
  }

  /**
   * Queries data from history API to fill table referralBrokerFeesPerTrader.
   * If no timestamp provided, the function will take the last recorded
   * timestamp per pool as starting point or at max 14 days in past.
   * @param fromTsSec timestamp for API, or undefined
   * @returns void
   */
  public async updateBrokerFeesFromAPIAllPools(fromTsSec: number | undefined) {
    // ensure we have the token information
    await this.updateMarginTokenInfoFromAPI(false);
    if (this.poolIds.length == 0) {
      this.l.info("No pools in queryMarginTokenInfoFromAPI");
      return;
    }
    const takeLatest = fromTsSec == undefined;
    for (let k = 0; k < this.poolIds.length; k++) {
      const j = this.poolIds[k];
      this.l.info(`updating broker fees for pool ${j}`);
      if (takeLatest) {
        fromTsSec = this.latestFeeRecordInPoolTsSec[j - 1];
      }
      if (!this.updateBrokerFeesFromAPIForPool(fromTsSec!, j)) {
        const msg = `broker fee update of pool ${j} failed`;
        this.l.error(msg);
        throw Error(msg);
      }
    }
  }

  public async updateBrokerFeesFromAPIForPool(fromTsSec: number, poolId: number): Promise<boolean> {
    // insert into DB referral_broker_fees_per_trader
    try {
      // ensure we have the token information
      await this.updateMarginTokenInfoFromAPI(false);
      const feeData = await this.queryBrokerFeesFromAPI(fromTsSec, poolId);
      let dtCreatedAt = new Date();
      let latestRecordTsSec = Date.now() / 1000 - 86_400 * 30;
      for (let k = 0; k < feeData.length; k++) {
        const currRecord: BrokerFeePayments = feeData[k];
        const dateTs = new Date(currRecord.tradeTimestamp);
        if (dateTs.getTime() / 1000 > latestRecordTsSec) {
          latestRecordTsSec = dateTs.getTime() / 1000;
        }
        let data: NewBrokerFeesPerTraderTbl = {
          pool_id: poolId,
          trader_addr: currRecord.traderAddr,
          quantity_cc: BigInt(currRecord.quantityCcAbdk), // signed quantity traded in ABDK format
          fee_cc: BigInt(currRecord.brokerFeeCcAbdk), // fee paid in ABDK format
          trade_timestamp: dateTs,
          broker_addr: this.brokerAddr,
        };
        await this.dbHandler.insertInto("referral_broker_fees_per_trader").values(data).executeTakeFirst();
      }
      this.latestFeeRecordInPoolTsSec[poolId - 1] = latestRecordTsSec;
    } catch (error) {
      this.l.error("updateBrokerFeesFromAPI update/insert failed", error);
      return false;
    }

    this.l.info(`updateBrokerFeesFromAPI for pool ${poolId} succeeded`);
    return true;
  }
}
