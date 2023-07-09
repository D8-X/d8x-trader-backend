import { Logger } from "winston";
import { providers } from "ethers";
import DBPayments from "../db/db_payments";
import { ReferralOpenPayResponse, UnconfirmedPaymentRecord, TEMPORARY_TX_HASH } from "../referralTypes";
import AbstractPayExecutor from "./abstractPayExecutor";
enum TransactionState {
  Failed = 1,
  Succeeded = 2,
  NotFound = 3,
}
/**
 * This class has methods to
 * executePayments():
 * - execute payments using the "MultiPay" smart contract
 * - it records executed payments in the database
 * confirmPaymentTransactions()
 * - checks whether transactions succeded and adjusts the data in the db
 *
 * PaymentDataCollector must be run before execution is run.
 * This is handled by PaymentManager
 */
export default class ReferralPaymentExecutor {
  private rpcUrl: string;

  private dbPayment: DBPayments;
  private minBrokerFeeCCForRebate = new Map<number, number>(); //pool-id -> fee in coll.currency
  private payExecutor: AbstractPayExecutor;
  private brokerAddr = "";

  constructor(
    dbPayment: DBPayments,
    rpcURL: string,
    minBrokerFeeCCForRebatePerPool: Array<[number, number]>,
    payExecutor: AbstractPayExecutor,
    private l: Logger
  ) {
    this.payExecutor = payExecutor;
    this.rpcUrl = rpcURL;
    this.dbPayment = dbPayment;
    for (let k = 0; k < minBrokerFeeCCForRebatePerPool.length; k++) {
      // pool id --> minimal fee
      this.minBrokerFeeCCForRebate.set(minBrokerFeeCCForRebatePerPool[k][1], minBrokerFeeCCForRebatePerPool[k][0]);
    }
  }

  /**
   * Process all open payments
   * @returns number of payments executed
   */
  public async executePayments(): Promise<number> {
    this.brokerAddr = await this.payExecutor.getBrokerAddress();
    let openPayments = await this.dbPayment.aggregateFees(this.brokerAddr);
    const msg4Chain = Math.round(Date.now() / 1000).toString();
    let executionNum = 0;
    for (let k = 0; k < openPayments.length; k++) {
      let tokenAddr = openPayments[k].token_addr;
      let [amounts, addr] = this._extractPaymentDirections(openPayments[k]);
      if (addr.length == 0) {
        this.l.info(
          `Pay amount (total fee=${openPayments[k].broker_fee_cc_amtdec}) too small for trader ${openPayments[k].trader_addr}`
        );
        continue;
      }

      const brokerAmount = amounts[3];
      // first call 'registerPayment' to store the event with a tx_hash
      // that indicates the non-execution
      // this order is to prevent double payments in case the system stops after paying
      // and before writing the db entry
      // Timestamp needs to be set to: last_trade_considered_ts
      if (!(await this.dbPayment.registerPayment(openPayments[k], brokerAmount, TEMPORARY_TX_HASH))) {
        continue;
      }
      // we must use the timestamp in seconds of the latest payment as id
      const id: number = Math.round(openPayments[k].last_payment_ts.getTime() / 1000);
      // we must encode the code and pool-id into the message
      const msg = msg4Chain + "." + openPayments[k].code + "." + openPayments[k].pool_id.toString();
      let txHash = await this.payExecutor.transactPayment(tokenAddr, amounts, addr, id, msg);
      if (txHash == "fail") {
        // wipe payment entry
        let keyTs = openPayments[k].last_trade_considered_ts;
        let poolId = Number(openPayments[k].pool_id.toString());
        await this.dbPayment.deletePaymentRecord(openPayments[k].trader_addr, poolId, keyTs);
        continue;
      }
      // we update the database with the received transaction hash
      await this.dbPayment.writeTxHashForPayment(openPayments[k], txHash);
      executionNum++;
    }
    return executionNum;
  }

  /**
   * - Query all unconfirmed transactions (tx_confirmed=false) from the database
   * - Traverse the unconfirmed transactions and check whether they succeded or not
   * - If tx succeeded record in db, if tx failed remove from db, if tx not found leave there
   */
  public async confirmPaymentTransactions() {
    let unRecords: UnconfirmedPaymentRecord[] = await this.dbPayment.queryUnconfirmedTransactions();
    let provider = new providers.StaticJsonRpcProvider(this.rpcUrl);
    for (let k = 0; k < unRecords.length; k++) {
      let u = unRecords[k];
      let state: TransactionState = await this.getTransactionState(u.tx_hash, provider);
      if (state == TransactionState.Succeeded) {
        // adjust db entry
        this.dbPayment.writeTxConfirmed(u.trader_addr, u.pool_id, u.timestamp);
      } else if (state == TransactionState.Failed) {
        this.l.warn(`Payment transaction failed, tx ${u.tx_hash}; deleting record.`);
        this.dbPayment.deletePaymentRecord(u.trader_addr, u.pool_id, u.timestamp);
      } else {
        this.l.warn(`Payment transaction ${u.tx_hash} not found in DB.`);
      }
    }
  }

  /**
   * Extract payment directions. Trader must be the first address.
   * @param openPayment ReferralOpenPayResponse
   * @returns arrays of amounts and addresses
   */
  private _extractPaymentDirections(openPayment: ReferralOpenPayResponse): [bigint[], string[]] {
    console.log(openPayment);
    const totalFees = BigInt(openPayment.broker_fee_cc_amtdec);
    const poolId = Number(openPayment.pool_id);
    if (totalFees < this.minBrokerFeeCCForRebate.get(poolId)!) {
      return [[], []];
    }
    let [amtTrader, amtReferrer, amtAgency] = [
      openPayment.trader_cc_amtdec,
      openPayment.referrer_cc_amtdec,
      openPayment.agency_cc_amtdec,
    ];

    let amtBroker = totalFees - amtTrader - amtReferrer - amtAgency;
    let amount: bigint[] = [amtTrader, amtReferrer, amtAgency, amtBroker];
    let addr: string[] = [
      openPayment.trader_addr,
      openPayment.referrer_addr,
      openPayment.agency_addr,
      openPayment.broker_addr,
    ];
    return [amount, addr];
  }

  public async getTransactionState(txHash: string, provider: providers.JsonRpcProvider): Promise<TransactionState> {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt.status === 1 ? TransactionState.Succeeded : TransactionState.Failed;
      } else {
        return TransactionState.NotFound;
      }
    } catch (error) {
      this.l.warn(`getTransactionState hash=${txHash}`, error);
      return TransactionState.Failed;
    }
  }
}
