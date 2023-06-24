import { Logger } from "winston";
import ReferralPaymentExecutor from "./referralPaymentExecutor";
import PaymentDataCollector from "./paymentDataCollector";
import DBPayments from "../db/db_payments";
import { ReferralSettings } from "../referralTypes";

export class ReferralPaymentManager {
  private paymentExecutor: ReferralPaymentExecutor;
  private paymentDataCollector: PaymentDataCollector;

  constructor(
    private brokerAddr: string,
    private dbPayment: DBPayments,
    private settings: ReferralSettings,
    private rpcURL: string,
    private privateKey: string,
    private l: Logger
  ) {
    this.paymentExecutor = new ReferralPaymentExecutor(
      dbPayment,
      settings.multiPayContractAddr,
      rpcURL,
      privateKey,
      settings.minBrokerFeeCCForRebatePerPool,
      l
    );
    this.paymentDataCollector = new PaymentDataCollector(settings.multiPayContractAddr, dbPayment, rpcURL, l);
  }

  public async start() {
    // find out what date we should start with payment execution
    let since: Date =
      (await this.dbPayment.queryEarliestUnconfirmedTxDate()) ??
      new Date(Date.now() - this.settings.paymentMaxLookBackDays * 86_400 * 1000);

    await this.paymentDataCollector.confirmPayments(this.brokerAddr, since);
    this.l.info("Historical payment data collector confirmation processed");
    // TODO:
    // get last payment execution date from db
    // check whether we need to execute now
    // create scheduler that checks if we need to execute according to pattern
  }
}
