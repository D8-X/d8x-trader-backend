import { Logger } from "winston";
import ReferralPaymentExecutor from "./referralPaymentExecutor";
import PaymentDataCollector from "./paymentDataCollector";
import DBPayments from "../db/db_payments";
import { getPreviousCronDate, getNextCronDate } from "utils";
import { ReferralSettings } from "../referralTypes";

/**
 * This class has a mutex for payment execution
 */
export default class ReferralPaymentManager {
  private mutex: boolean = false;
  private paymentExecutor: ReferralPaymentExecutor;
  private paymentDataCollector: PaymentDataCollector;
  private lastPaymentExecution: undefined | Date;
  private intervalId: NodeJS.Timeout | undefined;
  private intervalTime: number = 60_000;

  constructor(
    private brokerAddr: string,
    private dbPayment: DBPayments,
    private settings: ReferralSettings,
    rpcURL: string,
    privateKey: string,
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
    // get last payment execution date from db
    this.lastPaymentExecution = await this.dbPayment.queryLastRecordedPaymentDate();
    // check whether we need to execute now
    await this.checkAndExecutePayments();
    // launch scheduler that checks every minute if we need to execute according to pattern
    this.startPaymentScheduler();
  }

  startPaymentScheduler(): void {
    this.intervalId = setInterval(async () => {
      await this.checkAndExecutePayments();
    }, this.intervalTime);
  }

  private async checkAndExecutePayments() {
    if (this.mutex) {
      this.l.info("ReferralPaymentManager: payment mutex on");
      return;
    } else {
      this.mutex = true;
    }
    try {
      if (this.checkExecutionNeeded()) {
        this.l.info("ReferralPaymentManager: payment execution start");
        let numExecuted = await this.executePayments();
        if (numExecuted > 0) {
          this.lastPaymentExecution = await this.dbPayment.queryLastRecordedPaymentDate();
          this.l.info("ReferralPaymentManager: payment execution end");
        } else {
          this.lastPaymentExecution = new Date();
          this.l.info("ReferralPaymentManager: no payments due");
        }
      } else {
        this.l.info("ReferralPaymentManager: NO payment execution needed");
      }
    } finally {
      await this.scheduleNextPaymentCheck();
      this.mutex = false;
    }
  }

  private async executePayments(): Promise<number> {
    let numPayments = await this.paymentExecutor.executePayments();
    await this.paymentExecutor.confirmPaymentTransactions();
    return numPayments;
  }

  /**
   * paymentScheduleMinHourDayofmonthWeekday
   * @param pattern  cron-type pattern dash separated 0-14-*-*
   * @returns true if no payment since last pattern matching date
   */
  private checkExecutionNeeded(): boolean {
    //https://github.com/P4sca1/cron-schedule
    //pattern:   "paymentScheduleMinHourDayofmonthWeekday": "0-14-*-*-0",
    if (this.lastPaymentExecution == undefined) {
      return true;
    }
    let execPattern = this.settings.paymentScheduleMinHourDayofmonthWeekday;
    let lastDate = getPreviousCronDate(execPattern);
    return this.lastPaymentExecution.getTime() < lastDate.getTime();
  }

  private scheduleNextPaymentCheck() {
    let execPattern = this.settings.paymentScheduleMinHourDayofmonthWeekday;
    let nextDate = getNextCronDate(execPattern);
    let timeToExec = nextDate.getTime() - Date.now();
    let timeToWait = timeToExec < 0 ? 0 : Math.max(60_000, Math.round(timeToExec / 2));
    this.l.info(`Waiting for ${Math.round(timeToWait / 60_000)}min to check payment execution`);
    // Set a new interval with the updated delay
    this.intervalTime = timeToWait;
  }
}
