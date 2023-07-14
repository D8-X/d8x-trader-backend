export const TEMPORARY_TX_HASH = "unconfirmed";
export const DECIMAL40_FORMAT_STRING = "FM9999999999999999999999999999999999999";
export interface ReferralSettings {
  referralSystemEnabled: boolean;
  agencyCutPercent: number;
  permissionedAgencies: string[];
  referrerCutPercentForTokenXHolding: Array<[number, number]>;
  tokenX: {
    address: string;
    decimals: number;
  };
  paymentScheduleMinHourDayofmonthWeekday: string;
  paymentMaxLookBackDays: number;
  minBrokerFeeCCForRebatePerPool: Array<[number, number]>;
  brokerPayoutAddr: string;
  defaultReferralCode: {
    referrerAddr: string;
    agencyAddr: string;
    traderReferrerAgencyPerc: [number, number, number];
  };
  multiPayContractAddr: string;
}

export interface ReferralOpenPayResponse {
  pool_id: bigint;
  trader_addr: string;
  broker_addr: string;
  first_trade_considered_ts: Date;
  last_trade_considered_ts: Date;
  pay_period_start_ts: Date;
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
  broker_fee_cc_amtdec: bigint;
  cut_perc: number;
  token_addr: string;
  token_name: string;
  token_decimals: number;
}

export interface TraderOpenPayResponse {
  pool_id: bigint;
  first_trade_considered_ts: Date;
  last_payment_ts: Date;
  pay_period_start_ts: Date;
  code: string;
  token_name: string;
  token_decimals: number;
  trader_cc_amtdec: bigint;
}

export interface TokenAccount {
  referrerAddr: string;
  tokenHoldings: bigint;
}
export interface DBActiveReferrer {
  referrer_addr: string;
  last_updated: Date | null;
}

export interface DBTokenAmount {
  amount: bigint | undefined;
  lastUpdated: Date | undefined;
}

export interface APIReferralVolume {
  poolId: number;
  quantityCC: number;
  code: string;
}

export interface APIReferralCodeRecord {
  code: string;
  referrerAddr: string;
  agencyAddr: string;
  brokerAddr: string;
  traderRebatePerc: number;
  agencyRebatePerc: number;
  referrerRebatePerc: number;
  createdOn: Date;
  expiry: Date;
}

export interface APIRebateEarned {
  poolId: number;
  code: string;
  amountCC: number;
}

export interface UnconfirmedPaymentRecord {
  trader_addr: string;
  pool_id: number;
  timestamp: Date;
  tx_hash: string;
}

export interface PaymentEvent {
  brokerAddr: string;
  traderAddr: string;
  poolId: number;
  batchTimestamp: number;
  code: string;
  timestamp: Date; // last trade considered
  token: string;
  amounts: bigint[];
  payees: string[];
  message: string;
  txHash: string;
  blockNumber: number;
}

export interface APITraderCode {
  code: string;
  activeSince: Date | undefined;
}

export interface PaySummary {
  payer: string; //addr
  executor: string; //addr
  token: string; //addr
  timestamp: number; //uint32
  id: number; //uint32
  totalAmount: bigint; //uint256
}
