-- CreateTable
CREATE TABLE "referral_setting_cut" (
    "is_agency_cut" BOOLEAN NOT NULL,
    "cut_perc" DECIMAL(5,2) NOT NULL,
    "holding_amount_dec_n" DECIMAL(77,0),
    "token_addr" VARCHAR(42) NOT NULL,

    CONSTRAINT "referral_setting_cut_pkey" PRIMARY KEY ("is_agency_cut","cut_perc")
);

-- CreateTable
CREATE TABLE "referral_token_holdings" (
    "referrer_addr" VARCHAR(42) NOT NULL,
    "holding_amount_dec_n" DECIMAL(77,0) NOT NULL,
    "token_addr" VARCHAR(42) NOT NULL,
    "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_token_holdings_pkey" PRIMARY KEY ("referrer_addr")
);

-- CreateIndex
CREATE INDEX "referral_setting_cut_cut_perc_idx" ON "referral_setting_cut"("cut_perc");

-- CreateIndex
CREATE INDEX "referral_setting_cut_holding_amount_dec_n_idx" ON "referral_setting_cut"("holding_amount_dec_n");
