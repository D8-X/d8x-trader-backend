
--- Table with code for each trader and
--- broker fee cut attributable to other participants
CREATE OR REPLACE VIEW referral_current_rebate AS
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