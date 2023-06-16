export interface ReferralSettings {
  agencyCutPercent: number;
  permissionedAgencies: string[];
  referrerCutPercentForTokenXHolding: Array<[number, number]>;
  tokenX: {
    address: string;
    decimals: number;
  };
  paymentScheduleMinHourDayofweekDayofmonth: string;
  minimalRebateCollateralCurrencyAmountPerPool: Array<[number, number]>;
  defaultReferralCode: {
    brokerPayoutAddr: string;
    referrerAddr: string;
    agencyAddr: string;
    traderReferrerAgencyPerc: [number, number, number];
  };
}

export interface TokenAccount {
  referrerAddr: string;
  tokenHoldings: bigint;
}
export interface DBActiveReferrer {
  referrer_addr: string;
  last_updated: Date | null;
}
