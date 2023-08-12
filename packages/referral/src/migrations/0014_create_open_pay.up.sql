
--- Table with currently open payments
CREATE OR REPLACE VIEW referral_open_pay AS
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
LEFT JOIN referral_margin_token_info minfo
    ON opf.pool_id=minfo.pool_id;