
-- Paid amounts
CREATE OR REPLACE VIEW referral_payment_X_code AS
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
LEFT JOIN referral_margin_token_info m
    ON m.pool_id = p.pool_id;