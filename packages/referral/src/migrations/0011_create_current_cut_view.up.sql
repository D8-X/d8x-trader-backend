--- Table with current cut per referrer that does not use an agency
--- Current in the sense that we take the most recent tokenX holdings into account
--- to determine the referrer's cut-tier as specified in live.referralSettings.json 
CREATE OR REPLACE VIEW referral_current_cut AS
SELECT current_holdings.referrer_addr, MIN(ref_cut.cut_perc) as cut_perc
FROM referral_token_holdings current_holdings
JOIN referral_setting_cut ref_cut 
    ON current_holdings.holding_amount_dec_n >= ref_cut.holding_amount_dec_n
    AND ref_cut.is_agency_cut=false
GROUP BY current_holdings.referrer_addr;