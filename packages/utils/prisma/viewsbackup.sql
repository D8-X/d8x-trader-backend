-- VIEWS (created manually)

CREATE VIEW referral_last_payment AS
SELECT 
    pool_id,
	trader_addr, 
	broker_addr, 
	BOOL_AND(tx_confirmed) as tx_confirmed, -- false if there are payments that haven't been confirmed yet
	MAX(timestamp) as last_payment_ts 
FROM referral_payment GROUP BY trader_addr, broker_addr, pool_id;


--- UNITS
---  1) Token amounts from perpetuals are in ABDK 64x64 format in which a decimal x is represented as x * 2^64,
---  that is, if we can divide accurately with decimal numbers, if v is in ABDK format, v/2^64 is the corresponding decimal number
---  2) ERC-20 tokens are represented in "decimal N"-format in which a decimal x is represented as x * 10^N
---  3) some number denoted by TBPS from perpetuals are 'tenth of a basis point'-format in a number v is converted by v/1e5,
---     for example 60 TBPS = 0.0006 = 6 bps

--- Table that contains the aggregated fees since last payment
--- We ensure only trades that happened after the last payment are included
--- We ensure only trader-addresses for which the payment-record has been confirmed
--- are included or they have no payment record 
--- if trader switch codes between payments only the latest code is reflected 
--- starting at the last payment or, if there was no payment, at the day defined by now()-paymentMaxLookBackDays
CREATE VIEW referral_aggr_fees_per_trader AS
SELECT 
    th.perpetual_id/100000 as pool_id,
    th.trader_addr,
    th.broker_addr,
    COALESCE(codeusg.code,'DEFAULT') as code,
    sum(th.fee) as fee_sum_cc,
    FLOOR(SUM((th.broker_fee_tbps * ABS(th.quantity_cc))/100000)) as broker_fee_cc, -- ABDK 64x64 format
    min(th.trade_timestamp) as first_trade_considered_ts,
    max(th.trade_timestamp) as last_trade_considered_ts,
    lp.last_payment_ts,
    coalesce(lp.last_payment_ts, current_date::timestamp - (rs.value || ' days')::interval) as pay_period_start_ts
FROM trades_history th
join referral_settings rs on rs.property = 'paymentMaxLookBackDays'
LEFT JOIN referral_last_payment lp
    ON lp.trader_addr=th.trader_addr
    AND lp.broker_addr=th.broker_addr
LEFT JOIN referral_code_usage codeusg
    ON th.trader_addr = codeusg.trader_addr
    AND codeusg.valid_to > NOW()
WHERE ((lp.last_payment_ts IS null and current_date::timestamp - (rs.value || ' days')::interval < th.trade_timestamp) OR lp.last_payment_ts<th.trade_timestamp)
    AND (lp.pool_id IS NULL OR lp.pool_id = th.perpetual_id/100000)
    AND (lp.tx_confirmed IS NULL OR lp.tx_confirmed=true)
GROUP BY pool_id, th.trader_addr, lp.last_payment_ts, th.broker_addr, codeusg.code, th.perpetual_id/100000, rs.value
ORDER BY th.trader_addr;

--- Table with current cut per referrer that does not use an agency
--- Current in the sense that we take the most recent tokenX holdings into account
--- to determine the referrer's cut-tier as specified in live.referralSettings.json 
CREATE VIEW referral_current_cut AS
SELECT current_holdings.referrer_addr, MIN(ref_cut.cut_perc) as cut_perc
FROM referral_token_holdings current_holdings
JOIN referral_setting_cut ref_cut 
    ON current_holdings.holding_amount_dec_n >= ref_cut.holding_amount_dec_n
    AND ref_cut.is_agency_cut=false
GROUP BY current_holdings.referrer_addr;

--- Table with code for each trader and
--- broker fee cut attributable to other participants
CREATE VIEW referral_current_rebate AS
SELECT usg.trader_addr, 
    usg.code, 
    code.referrer_addr,
    code.agency_addr,
    code.broker_addr,
    code.broker_payout_addr,
    code.trader_rebate_perc,
    code.referrer_rebate_perc,
    code.agency_rebate_perc,
    CASE 
        WHEN code.agency_addr != '' THEN (
        SELECT cut_perc
        FROM referral_setting_cut
        WHERE is_agency_cut = true
        LIMIT 1
        )
    ELSE curr_cut.cut_perc
  END AS cut_perc
FROM referral_code_usage usg
JOIN referral_code code 
    ON usg.code = code.code 
    AND usg.valid_to>NOW()
LEFT JOIN referral_current_cut curr_cut
    ON curr_cut.referrer_addr = code.referrer_addr
WHERE code.expiry>now();

-- broker fee, cut attributable to the different stakeholders and 
-- their relative share
-- [1] default to 100% in case of no referral code, in which the setting
--     in live.referralSettings.json defaultReferralCode kicks in with 100% 
--     of fees earned
CREATE VIEW referral_open_pay_relative AS
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

--- Table with currently open payments
CREATE VIEW referral_open_pay AS
SELECT opf.pool_id,
    opf.trader_addr,
    opf.broker_addr,
    opf.first_trade_considered_ts, 
    opf.last_trade_considered_ts,
    opf.last_payment_ts,
    opf.pay_period_start_ts,
    opf.code,
    opf.referrer_addr,
    opf.agency_addr,
    opf.broker_payout_addr,
    opf.trader_rebate_perc,
    opf.referrer_rebate_perc,
    opf.agency_rebate_perc,
    (opf.broker_fee_cc * opf.cut_perc * opf.trader_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as trader_cc_amtdec,
    (opf.broker_fee_cc * opf.cut_perc * opf.referrer_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as referrer_cc_amtdec,
    (opf.broker_fee_cc * opf.cut_perc * opf.agency_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as agency_cc_amtdec,
    (opf.broker_fee_cc * POWER(10, minfo.token_decimals))/18446744073709551616 as broker_fee_cc_amtdec, -- convert ABDK to decN format
    opf.cut_perc,
    minfo.token_addr,
    minfo.token_name,
    minfo.token_decimals as token_decimals
FROM referral_open_pay_relative opf
LEFT JOIN margin_token_info minfo
    ON opf.pool_id=minfo.pool_id;


-- Trading volume per referral code
--- > replaced with API query
CREATE VIEW referral_vol AS
SELECT 
  perpetual_id/100000 as pool_id,
  SUM(ABS(th.quantity_cc)) as quantity_cc_abdk,
  cusg.code as code,
  cd.referrer_addr
FROM trades_history th
JOIN referral_code_usage cusg
ON cusg.trader_addr = th.trader_addr
 AND th.trade_timestamp >= cusg.valid_from
 AND th.trade_timestamp < cusg.valid_to
JOIN referral_code cd
ON cd.code = cusg.code
GROUP BY cusg.code, pool_id, cd.referrer_addr;

-- Paid amounts
CREATE VIEW referral_payment_X_code AS
SELECT 
    p.code,
    p.pool_id,
    p.trader_addr,
    c.referrer_addr,
    c.agency_addr,
    c.broker_addr,
    p.trader_paid_amount_cc,-- decimal N
    p.broker_paid_amount_cc,
    p.agency_paid_amount_cc,
    p.referrer_paid_amount_cc,
    m.token_name,
    m.token_decimals
FROM referral_payment p
LEFT JOIN referral_code c
    ON p.code = c.code
    AND p.tx_confirmed=true
LEFT JOIN margin_token_info m
    ON m.pool_id = p.pool_id;