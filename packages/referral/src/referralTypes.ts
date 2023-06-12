export interface ReferralSettings {
  minimalBrokerSharePercent: number;
  permissionedAgencies: string[];
  referrerGeneratedCodeRebatesPercentForD8XHolding: Array<[number, number]>;
  paymentScheduleMinHourDayofweekDayofmonth: "0-14-7-*";
  minimalRebateCollateralCurrencyAmountPerPool: Array<[number, number]>;
  defaultReferralCode: {
    brokerPayoutAddr: string;
    referrerAddr: string;
    agencyAddr: string;
    traderReferrerAgencyPerc: [number, number, number];
  };
}
