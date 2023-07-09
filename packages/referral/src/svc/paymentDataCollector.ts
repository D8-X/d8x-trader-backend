import { Logger } from "winston";
import { BigNumber, ethers, providers, Wallet } from "ethers";
import { calculateBlockFromTime } from "utils";
import DBPayments from "../db/db_payments";
import { PaymentEvent } from "../referralTypes";
const ctrMultiPayAbi = require("../abi/MultiPay.json");

/**
 * Collect historical onchain payment data to ensure we do not carry out multiple
 * payments in case the database was flushed.
 * Cases when an on-chain event is found:
 *  1) no payment record at all in database -> enter all the data into db
 *  2) payment record with dummy transaction hash in db, which means that either
 *    the payment was not executed or the payment was executed but the database
 *    did not write the transaction
 *
 *  3) payment record exists with tx hash -> ensure ReferralPayment.tx_confirmed=true
 */
export default class PaymentDataCollector {
  constructor(
    private multiPayContractAddr: string,
    private dbPayments: DBPayments,
    private rpcURL: string,
    private l: Logger
  ) {}

  public async confirmPayments(payerAddr: string, since: Date): Promise<void> {
    let payments = await this.filterPayments(payerAddr.toLowerCase(), since);
    for (let k = 0; k < payments.length; k++) {
      await this.dbPayments.confirmPayment(payments[k]);
    }
    // now that all payments were collected,
    // we can delete all remaining entries with a tx hash = 'unconfirmed'
    // --> this is done after payment execution in the call of confirmPaymentTransactions
  }

  /**
   * Query historical events from 'since' up to the current block
   * @param payerAddr address of the broker that executes or permissions the payments to referrer, agency, trader, brokerPayoutAddr
   * @param since Date from when we execute
   * @returns Collected payment events
   */
  private async filterPayments(payerAddr: string, since: Date): Promise<PaymentEvent[]> {
    this.l.info("started payment filtering starting at", { date: since });
    const provider = new providers.StaticJsonRpcProvider(this.rpcURL);
    const contract = new ethers.Contract(this.multiPayContractAddr, ctrMultiPayAbi, provider);
    // filter all payments from payerAddr (recall we have one broker, so these are all the relevant events)
    const filter = contract.filters.Payment(payerAddr);
    const [blockStart, blockEnd] = await calculateBlockFromTime(provider, since);
    let paymentEvents = await this.filterEvents(blockStart, blockEnd, contract, filter);
    // Process all collected events
    let payments: PaymentEvent[] = [];
    for (let i = 0; i < paymentEvents.length; i++) {
      const event = paymentEvents[i];
      // Access event properties
      const eventArgs = event.args as ethers.utils.Result;
      // decode pool Id from message, and timestamp from event id
      const [batchTsStr, code, poolIdStr] = eventArgs[5].split(".");
      // timestamp emitted is in seconds
      const timestamp = new Date(Number(eventArgs[1].toString()) * 1000);
      /*
        event Payment(
        0: address indexed from, // broker
        1: uint32 indexed id,
        2: address indexed token,
        3: uint256[] amounts,
        4: address[] payees,//Trader, Referrer, Agency, BrokerPaymentAddr
        5: string message);
      */
      let p: PaymentEvent = {
        brokerAddr: eventArgs[0].toLowerCase(),
        traderAddr: eventArgs[4][0].toLowerCase(), // first entry of payees
        poolId: Number(poolIdStr),
        batchTimestamp: Number(batchTsStr),
        code: code,
        timestamp: timestamp, // uint32 indexed id
        token: eventArgs[2], // Access the third argument (address indexed token)
        amounts: eventArgs[3].map((amount: BigNumber) => BigInt(amount.toString())),
        payees: eventArgs[4].map((x: string) => x.toLowerCase()), // Access the fifth argument (address[] payees)
        message: eventArgs[5], // Access the sixth argument (string message)
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
      };
      console.log(`tx=${event.transactionHash}, trader=${eventArgs[4][0]}, timestamp=${eventArgs[1]}, ${timestamp}`);
      payments.push(p);
    }
    this.l.info(`found ${payments.length} payment events since ${since}`);
    return payments;
  }

  private async filterEvents(
    blockStart: number,
    blockEnd: number,
    contract: ethers.Contract,
    filter: ethers.EventFilter
  ): Promise<ethers.Event[]> {
    // Iterate over the blocks starting from blockStart
    // limit: 10_000 blocks in one eth_getLogs call
    const deltaBlocks = 9_999;
    let numRequests = 0;
    let lastWaitSeconds = 2;
    let maxWaitSeconds = 32;
    let allEvents = [];
    for (let k = blockStart; k <= blockEnd; ) {
      const _startBlock = k;
      const _endBlock = Math.min(blockEnd, k + deltaBlocks - 1);
      try {
        const events = await contract.queryFilter(filter, _startBlock, _endBlock);
        allEvents.push(...events);
        // limit: 25 requests per second
        numRequests++;
        if (numRequests >= 25) {
          numRequests = 0;
          lastWaitSeconds = 2;
          await new Promise((resolve) => setTimeout(resolve, 1_100));
        }
        k = k + deltaBlocks;
      } catch (error) {
        this.l.info("seconds", { maxWaitSeconds, lastWaitSeconds });
        if (maxWaitSeconds > lastWaitSeconds) {
          this.l.warn("attempted to make too many requests to node, performing a wait", {
            wait_seconds: lastWaitSeconds,
          });
          // rate limited: wait before re-trying
          await new Promise((resolve) => setTimeout(resolve, lastWaitSeconds * 1000));
          numRequests = 0;
          lastWaitSeconds *= 2;
        } else {
          throw new Error(error as string | undefined);
        }
      }
    }
    return allEvents;
  }
}
