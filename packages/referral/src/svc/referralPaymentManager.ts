import { Logger } from "winston";
import { parseCronExpression } from "cron-schedule";
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

  public async run() {
    // find out what date we should start with payment execution
    let since: Date =
      (await this.dbPayment.queryEarliestUnconfirmedTxDate()) ??
      new Date(Date.now() - this.settings.paymentMaxLookBackDays * 86_400 * 1000);

    await this.paymentDataCollector.confirmPayments(this.brokerAddr, since);
    this.l.info("Historical payment data collector confirmation processed");
    // TODO:
    // get last payment execution date from db
    let dateLast = await this.dbPayment.queryLastRecordedPaymentDate();
    // check whether we need to execute now
    if (this.checkExecutionNeeded(dateLast, this.settings.paymentScheduleMinHourDayofweekDayofmonthMonthWeekday)) {
      //TODO
    }
    // create scheduler that regularly checks if we need to execute according to pattern
    // TODO
  }

  /**       ┌───────────── second (0 - 59, optional)
   *        │ ┌───────────── minute (0 - 59)
   *        │ │ ┌───────────── hour (0 - 23)
   *        │ │ │ ┌───────────── day of month (1 - 31)
   *        │ │ │ │ ┌───────────── month (1 - 12)
   *        │ │ │ │ │ ┌───────────── weekday (0 - 7)
   *        * * * * * *
   * @param pattern
   * @param startDate
   * @returns
   */
  private checkExecutionNeeded(lastExecution: Date | undefined, execPattern: string): boolean {
    //https://github.com/P4sca1/cron-schedule
    //pattern:   "paymentScheduleMinHourDayofweekDayofmonthMonthWeekday": "0-14-*-*-0",
    if (lastExecution == undefined) {
      return true;
    }
    const cron = parseCronExpression(execPattern);
    let lastDate = cron.getPrevDate();
    return lastExecution.getTime() < lastDate.getTime();
  }
}
