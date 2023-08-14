
CREATE OR REPLACE VIEW referral_last_payment AS
SELECT 
    pool_id,
	trader_addr, 
	broker_addr, 
	BOOL_AND(tx_confirmed) as tx_confirmed, -- false if there are payments that haven't been confirmed yet
	MAX(timestamp) as last_payment_ts 
FROM referral_payment GROUP BY trader_addr, broker_addr, pool_id;