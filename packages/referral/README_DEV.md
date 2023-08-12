# Referral System DEV

### Testing Codes

INSERT INTO referral_code (code, referrer_addr, agency_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc, agency_rebate_perc)
VALUES ('CUMULUS3', '0x863AD9Ce46acF07fD9390147B619893461036194', '0x6fe871703eb23771c4016eb62140367944e8edfc',
'0x5a09217f6d36e73ee5495b430e889f8c57876ef3', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', 20, 60, 20);

insert into referral_code_usage (trader_addr, code, valid_from) values ('0x0ab6527027ecff1144dec3d78154fce309ac838c', 'CUMULUS', '2023-04-13 12:10:00+00:00');

frankencoin:
0xf33c07b1e0e16f97fd04f9bce4db4783eaab3815
0x0aB6527027EcFF1144dEc3d78154fce309ac838c
