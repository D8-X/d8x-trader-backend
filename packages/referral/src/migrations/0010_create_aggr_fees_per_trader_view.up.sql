
--- Table that contains the aggregated fees since last payment
--- Depends on successful update of referral_broker_fees_per_trader table via API on history component
--- from "dbBrokerFeeAccumulator.updateBrokerFeesFromAPIAllPools(undefined)"
--- We ensure only trades that happened after the last payment are included
--- We ensure only trader-addresses for which the payment-record has been confirmed
--- are included or they have no payment record 
--- if trader switch codes between payments only the latest code is reflected 
--- starting at the last payment or, if there was no payment, at the day defined by now()-paymentMaxLookBackDays
CREATE OR REPLACE VIEW referral_aggr_fees_per_trader AS
SELECT 
    rbfpt.pool_id,
    rbfpt.trader_addr,
    rbfpt.broker_addr,
    COALESCE(codeusg.code,'DEFAULT') as code,
    SUM(rbfpt.fee_cc) as broker_fee_cc, -- ABDK 64x64 format
    min(rbfpt.trade_timestamp) as first_trade_considered_ts,
    max(rbfpt.trade_timestamp) as last_trade_considered_ts,
    lp.last_payment_ts,
    coalesce(lp.last_payment_ts, current_date::timestamp - (rs.value || ' days')::interval) as pay_period_start_ts
FROM referral_broker_fees_per_trader rbfpt
join referral_settings rs on rs.property = 'paymentMaxLookBackDays'
LEFT JOIN referral_last_payment lp
    ON lp.trader_addr=rbfpt.trader_addr
    AND lp.broker_addr=rbfpt.broker_addr
    and lp.pool_id = rbfpt.pool_id
LEFT JOIN referral_code_usage codeusg
    ON rbfpt.trader_addr = codeusg.trader_addr
    AND codeusg.valid_to > NOW()
WHERE ((lp.last_payment_ts IS null and current_date::timestamp - (rs.value || ' days')::interval < rbfpt.trade_timestamp) OR lp.last_payment_ts<rbfpt.trade_timestamp)
    AND (lp.tx_confirmed IS NULL OR lp.tx_confirmed=true)
GROUP BY rbfpt.pool_id, rbfpt.trader_addr, lp.last_payment_ts, rbfpt.broker_addr, codeusg.code, lp.pool_id,rs.value
ORDER BY rbfpt.trader_addr;
