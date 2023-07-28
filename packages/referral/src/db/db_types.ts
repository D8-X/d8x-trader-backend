import { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

// See https://kysely.dev/docs/getting-started#types

export interface Database {
  referral_code: ReferralCodeTable;
  referral_code_usage: ReferralCodeUsageTable;
  margin_token_info: MarginTokenInfoTable;
  broker_fees_per_trader: BrokerFeesPerTraderTable;
  payment_table: PaymentTable;
  referral_setting_cut: SettingCutTable;
  referral_settings: SettingsTable;
  referral_token_holdings: TokenHoldingsTable;
}

export type ReferralCodeTbl = Selectable<ReferralCodeTable>;
export type NewReferralCodeTbl = Insertable<ReferralCodeTable>;
export type UpdateReferralCodeTbl = Updateable<ReferralCodeTable>;

export type ReferralCodeUsageTbl = Selectable<ReferralCodeUsageTable>;
export type NewReferralCodeUsageTbl = Insertable<ReferralCodeUsageTable>;
export type UpdateReferralCodeUsageTbl = Updateable<ReferralCodeUsageTable>;

export type MarginTokenInfoTbl = Selectable<MarginTokenInfoTable>;
export type NewMarginTokenInfoTbl = Insertable<MarginTokenInfoTable>;
export type UpdateMarginTokenInfoTbl = Updateable<MarginTokenInfoTable>;

export type BrokerFeesPerTraderTbl = Selectable<BrokerFeesPerTraderTable>;
export type NewBrokerFeesPerTraderTbl = Insertable<BrokerFeesPerTraderTable>;
export type UpdateBrokerFeesPerTraderTbl = Updateable<BrokerFeesPerTraderTable>;

export type BrokerPaymentTableTbl = Selectable<PaymentTable>;
export type NewPaymentTableTbl = Insertable<PaymentTable>;
export type UpdatePaymentTableTbl = Updateable<PaymentTable>;

export type SettingCutTbl = Selectable<SettingCutTable>;
export type NewSettingCutTbl = Insertable<SettingCutTable>;
export type UpdateSettingCutTbl = Updateable<SettingCutTable>;

export type SettingsTbl = Selectable<SettingsTable>;
export type NewSettingsTbl = Insertable<SettingsTable>;
export type UpdateSettingsTbl = Updateable<SettingsTable>;

export type TokenHoldingsTbl = Selectable<TokenHoldingsTable>;
export type NewTokenHoldingsTbl = Insertable<TokenHoldingsTable>;
export type UpdateTokenHoldingsTbl = Updateable<TokenHoldingsTable>;

export interface ReferralCodeTable {
  code: string;
  referrer_addr: string;
  agency_addr: string | null;
  broker_addr: string;
  broker_payout_addr: string;
  //`ColumnType<SelectType, InsertType, UpdateType>
  created_on: ColumnType<Date, undefined, Date>;
  expiry: ColumnType<Date, undefined, undefined | Date>;
  trader_rebate_perc: ColumnType<number, number, number>;
  referrer_rebate_perc: ColumnType<number, number, number>;
  agency_rebate_perc: ColumnType<number, number, number>;
}

export interface ReferralCodeUsageTable {
  trader_addr: string;
  code: string;
  //`ColumnType<SelectType, InsertType, UpdateType>
  valid_from: ColumnType<Date, undefined, undefined | Date>;
  valid_to: ColumnType<Date, undefined, undefined | Date>;
}

export interface MarginTokenInfoTable {
  pool_id: number;
  token_addr: string;
  token_name: string;
  token_decimals: number;
}

export interface BrokerFeesPerTraderTable {
  pool_id: number;
  trader_addr: string;
  quantity_cc: bigint; // signed quantity traded in ABDK format
  fee_cc: bigint; // fee paid in ABDK format
  trade_timestamp: Date;
  broker_addr: string;
  //`ColumnType<SelectType, InsertType, UpdateType>
  created_at: ColumnType<Date, undefined, undefined | Date>;
}

export interface PaymentTable {
  trader_addr: string;
  broker_addr: string;
  // no constraint for referral code because we could collect the data from onchain
  // and we could encounter an unknown referral code in this case
  code: string;
  pool_id: number;
  //`ColumnType<SelectType, InsertType, UpdateType>
  timestamp: ColumnType<Date, undefined, undefined | Date>;
  // payment in token's number format, single transaction
  trader_paid_amount_cc: bigint;
  referrer_paid_amount_cc: bigint;
  agency_paid_amount_cc: bigint;
  broker_paid_amount_cc: bigint;
  tx_hash: string;
  tx_confirmed: ColumnType<boolean, undefined, undefined | boolean>;
}

export interface SettingCutTable {
  is_agency_cut: boolean;
  cut_perc: number;
  holding_amount_dec_n: bigint;
  token_addr: string;
}

export interface SettingsTable {
  property: string;
  value: string;
}

export interface TokenHoldingsTable {
  referrer_addr: string;
  holding_amount_dec_n: bigint;
  token_addr: string;
  //`ColumnType<SelectType, InsertType, UpdateType>
  last_updated: ColumnType<Date, undefined, undefined | Date>;
}
