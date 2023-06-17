-- VIEWS (created manually)

CREATE VIEW referral_last_payment AS
SELECT trader_addr, broker_addr, MAX(timestamp) as last_payment_ts
FROM referral_payment GROUP BY trader_addr, broker_addr;


--- Table that contains the aggregated fees since last payment
CREATE VIEW referral_aggr_fees_per_trader AS
SELECT 
    th.perpetual_id/100000 as pool_id,
    th.trader_addr,
    th.broker_addr,
    COALESCE(codes.code,'DEFAULT') as code,
    sum(th.fee) as fee_sum_cc,
    ROUND(SUM((th.broker_fee_tbps * ABS(th.quantity_cc))/100000)) as broker_fee_cc,
    min(th.trade_timestamp) as ts_first_trade_considered,
    max(th.trade_timestamp) as ts_last_trade_considered,
    lp.last_payment_ts from trades_history th
LEFT JOIN referral_last_payment lp
    ON lp.trader_addr=th.trader_addr
    AND lp.broker_addr=th.broker_addr
LEFT JOIN referral_code_usage codes
    ON th.trader_addr = codes.trader_addr
WHERE (lp.last_payment_ts IS NULL OR lp.last_payment_ts<th.trade_timestamp)
GROUP BY pool_id, th.trader_addr, lp.last_payment_ts, th.broker_addr, codes.code
ORDER BY th.trader_addr;

--- Table with current cut per referrer that does not use an agency
--- Current in the sense that we take the most recent tokenX holdings into account
--- to determine the referrer's cut-tier as specified in referralSettings.json 
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
SELECT usg.trader_addr, usg.code, 
    code.referrer_addr,
    code.agency_addr,
    code.broker_addr,
    code.broker_payout_addr,
    code.trader_rebate_perc,
    code.referrer_rebate_perc,
    code.agency_rebate_perc,
    CASE 
        WHEN code.agency_addr = '' THEN (
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
LEFT JOIN referral_current_cut curr_cut
    ON curr_cut.referrer_addr = code.referrer_addr
WHERE code.expiry>now();

-- broker fee, cut attributable to the different stakeholders and 
-- their relative share
CREATE VIEW referral_open_pay_relative AS
SELECT af.pool_id,
    af.trader_addr,
    af.broker_addr,-- broker addr from trades -> ensure we only pay from this brkr
    af.ts_first_trade_considered, af.ts_last_trade_considered,
    af.last_payment_ts,
    COALESCE(curr.code,'DEFAULT') as code,
    COALESCE(curr.referrer_addr, def.referrer_addr) as referrer_addr,
    COALESCE(curr.agency_addr, def.agency_addr) as agency_addr,
    COALESCE(curr.broker_payout_addr, def.broker_payout_addr) as broker_payout_addr,
    COALESCE(curr.trader_rebate_perc, def.trader_rebate_perc) as trader_rebate_perc,
    COALESCE(curr.agency_rebate_perc, def.agency_rebate_perc) as agency_rebate_perc,
    COALESCE(curr.referrer_rebate_perc, def.referrer_rebate_perc) as referrer_rebate_perc,
    COALESCE(curr.cut_perc, 100) as cut_perc,
    af.broker_fee_cc
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
    opf.ts_first_trade_considered, opf.ts_last_trade_considered,
    opf.last_payment_ts,
    opf.code,
    opf.referrer_addr,
    opf.agency_addr,
    opf.broker_payout_addr,
    opf.trader_rebate_perc,
    opf.referrer_rebate_perc,
    opf.agency_rebate_perc,
    (af.broker_fee_cc * opf.cut_perc * codes.trader_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as trader_cc_amtdec,
    (af.broker_fee_cc * opf.cut_perc * codes.referrer_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as referrer_cc_amtdec,
    (af.broker_fee_cc * opf.cut_perc * codes.agency_rebate_perc * POWER(10, minfo.token_decimals))/100/100/18446744073709551616 as agency_cc_amtdec,
    minfo.token_addr,
    minfo.token_name,
    minfo.token_decimals as token_decimals
FROM open_fees_relative opf
LEFT JOIN margin_token_info minfo
    ON af.pool_id=minfo.pool_id;


--- Table with currently open payments
---- OLD
CREATE VIEW open_fees_final AS
SELECT af.pool_id,
    af.trader_addr,
    af.broker_addr,
    af.ts_first_trade_considered, af.ts_last_trade_considered,
    af.last_payment_ts,
    codes.code,
    codes.referrer_addr,
    codes.agency_addr,
    codes.broker_payout_addr,
    codes.trader_rebate_perc,
    codes.referrer_rebate_perc,
    codes.agency_rebate_perc,
    (af.fee_sum_cc * codes.trader_rebate_perc * POWER(10, minfo.token_decimals))/100/18446744073709551616 as trader_cc_amtdec,
    (af.fee_sum_cc * codes.referrer_rebate_perc * POWER(10, minfo.token_decimals))/100/18446744073709551616 as referrer_cc_amtdec,
    (af.fee_sum_cc * codes.agency_rebate_perc * POWER(10, minfo.token_decimals))/100/18446744073709551616 as agency_cc_amtdec,
    af.fee_sum_cc as total_fee_cc,
    minfo.token_addr,
    minfo.token_name,
    minfo.token_decimals as token_decimals
FROM aggregated_fees_per_trader af
LEFT JOIN referral_code codes
    ON af.code = codes.code AND codes.expiry>ts_first_trade_considered AND af.broker_addr=codes.broker_addr
LEFT JOIN margin_token_info minfo
    ON af.pool_id=minfo.pool_id;

