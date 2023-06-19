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
  brokerPayoutAddr: string;
  defaultReferralCode: {
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

export interface ReferralCodePayload {
  code: string;
  referrerAddr: string;
  agencyAddr: string;
  createdOn: number;
  traderRebatePerc: number;
  agencyRebatePerc: number;
  referrerRebatePerc: number;
  signature: string;
}
