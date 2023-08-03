-- broker fee, cut attributable to the different stakeholders and 
-- their relative share
-- [1] default to 100% in case of no referral code, in which the setting
--     in live.referralSettings.json defaultReferralCode kicks in with 100% 
--     of fees earned
CREATE OR REPLACE VIEW referral_open_pay_relative AS
SELECT af.pool_id,
    af.trader_addr,
    af.broker_addr,-- broker addr from trades -> ensure we only pay from this brkr
    af.first_trade_considered_ts, af.last_trade_considered_ts,
    af.last_payment_ts,
    af.pay_period_start_ts,
    COALESCE(curr.code,'DEFAULT') as code,
    COALESCE(curr.referrer_addr, def.referrer_addr) as referrer_addr,
    COALESCE(curr.agency_addr, def.agency_addr) as agency_addr,
    COALESCE(curr.broker_payout_addr, def.broker_payout_addr) as broker_payout_addr,
    COALESCE(curr.trader_rebate_perc, def.trader_rebate_perc) as trader_rebate_perc,
    COALESCE(curr.agency_rebate_perc, def.agency_rebate_perc) as agency_rebate_perc,
    COALESCE(curr.referrer_rebate_perc, def.referrer_rebate_perc) as referrer_rebate_perc,
    COALESCE(curr.cut_perc, 100) as cut_perc,-- see [1]
    af.broker_fee_cc -- ABDK 64x64 format
FROM referral_aggr_fees_per_trader af
LEFT JOIN referral_current_rebate curr
    ON curr.trader_addr = af.trader_addr
LEFT JOIN referral_code def
    ON def.code='DEFAULT';