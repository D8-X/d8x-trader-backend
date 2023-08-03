begin;
-- Referral cut as specified in referralSettings.json
-- The amount is stored in decimal-N format
-- CreateTable
CREATE TABLE if not exists "referral_setting_cut" (
    "is_agency_cut" BOOLEAN NOT NULL,
    "cut_perc" DECIMAL(5,2) NOT NULL,
    "holding_amount_dec_n" DECIMAL(77,0),
    "token_addr" VARCHAR(42) NOT NULL,

    CONSTRAINT "referral_setting_cut_pkey" PRIMARY KEY ("is_agency_cut","cut_perc")
);


-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_setting_cut_cut_perc_idx" ON "referral_setting_cut"("cut_perc");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_setting_cut_holding_amount_dec_n_idx" ON "referral_setting_cut"("holding_amount_dec_n");

end;