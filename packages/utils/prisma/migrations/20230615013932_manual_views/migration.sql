-- VIEWS (created manually)

CREATE VIEW last_payment AS
SELECT trader_addr, broker_addr, MAX(timestamp) as last_payment_ts
FROM referral_payment GROUP BY trader_addr, broker_addr;


--- Table that contains the aggregated fees since last payment
CREATE VIEW aggregated_fees_per_trader AS
SELECT th.perpetual_id/100000 as pool_id,
th.trader_addr,
th.broker_addr,
COALESCE(codes.code,'DEFAULT') as code,
sum(th.fee) as fee_sum_cc,
ROUND(SUM((th.broker_fee_tbps * ABS(th.quantity_cc))/100000)) as broker_fee_cc,
min(th.trade_timestamp) as ts_first_trade_considered,
max(th.trade_timestamp) as ts_last_trade_considered,
lp.last_payment_ts from trades_history th
LEFT JOIN last_payment lp
ON lp.trader_addr=th.trader_addr
AND lp.broker_addr=th.broker_addr
LEFT JOIN referral_code_usage codes
ON th.trader_addr = codes.trader_addr
WHERE (lp.last_payment_ts IS NULL OR lp.last_payment_ts<th.trade_timestamp)
GROUP BY pool_id, th.trader_addr, lp.last_payment_ts, th.broker_addr, codes.code;

--- Table with currently open payments
CREATE VIEW open_fees AS
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

