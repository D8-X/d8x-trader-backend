# Referral System

## DEV

### Testing Codes

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('CASPAR', '0x863AD9Ce46acF07fD9390147B619893461036194', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 10, 50);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('MARCO', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc, expiry)
VALUES ('EXPIRED', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60, '2023-04-13 12:10:00+00:00');

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('DEFAULT', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);

INSERT INTO referral_code_usage (trader_addr, code)
VALUES ('0x6fe871703eb23771c4016eb62140367944e8edfc', 'CASPAR');

INSERT INTO referral_code_usage (trader_addr, code)
VALUES ('0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', 'CASPAR');

### Testing Queries

Get last payment date per trader and aggregate all trades of a trader by broker, perpetual id,

```
CREATE VIEW last_payment AS
SELECT trader_addr, broker_addr, MAX(timestamp) as last_payment_ts
FROM referral_payment GROUP BY trader_addr, broker_addr;
```

Directly applying the collateral currency fee calculation yields:

```
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
```

```
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
```
