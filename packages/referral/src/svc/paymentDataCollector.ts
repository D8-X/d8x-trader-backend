import { Logger } from "winston";
import { BigNumber, ethers, providers, Wallet } from "ethers";
import { calculateBlockFromTime } from "utils";
import DBPayments from "../db/db_payments";
import { PaymentEvent } from "../referralTypes";
const ctrMultiPayAbi = require("../abi/MultiPay.json");

/**
 * Collect historical onchain payment data to ensure we do not carry out multiple
 * payments in case the database was flushed.
 * Cases:
 *  1) no payment record at all -> enter all the data
 *  2) payment record with dummy transaction hash, which means that either
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
    let payments = await this.filterPayments(payerAddr, since);
    for (let k = 0; k < payments.length; k++) {
      await this.dbPayments.confirmPayment(payments[k]);
    }
    // now that all payments were collected,
    // we can delete all remaining entries with a tx hash = 'unconfirmed'
    // TODO
    console.log("\nTODO: delete remaining entries with unconfirmed tx hash");
  }

  /**
   * Query historical events from 'since' up to the current block
   * @param payerAddr address of the broker that executes the payments to referrer, agency, trader, brokerPayoutAddr
   * @param since Date from when we execute
   * @returns Collected payment events
   */
  private async filterPayments(payerAddr: string, since: Date): Promise<PaymentEvent[]> {
    this.l.info("started payment filtering", { date: since });
    const provider = new providers.StaticJsonRpcProvider(this.rpcURL);
    const contract = new ethers.Contract(this.multiPayContractAddr, ctrMultiPayAbi, provider);
    // filter all payments from payerAddr
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
      const timestamp = new Date(Number(eventArgs[1].toString()));
      let p: PaymentEvent = {
        brokerAddr: eventArgs.args[0],
        traderAddr: eventArgs.args[4][0], // first entry of payees
        poolId: Number(poolIdStr),
        batchTimestamp: Number(batchTsStr),
        code: code,
        timestamp: timestamp, // uint256 indexed id
        token: eventArgs.args[2], // Access the third argument (address indexed token)
        amounts: eventArgs.args[3].map((amount: BigNumber) => BigInt(amount.toString())),
        payees: eventArgs.args[4], // Access the fifth argument (address[] payees)
        message: eventArgs.args[5], // Access the sixth argument (string message)
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
      };
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
