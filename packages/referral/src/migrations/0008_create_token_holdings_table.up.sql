-- Amount of tokens that the referrer_addr holds
-- The token address is specified in referral settings
-- The amount is stored in decimal-N format
    -- CreateTable
    CREATE TABLE if not exists "referral_token_holdings" (
        "referrer_addr" VARCHAR(42) NOT NULL,
        "holding_amount_dec_n" DECIMAL(77,0) NOT NULL,
        "token_addr" VARCHAR(42) NOT NULL,
        "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "referral_token_holdings_pkey" PRIMARY KEY ("referrer_addr","token_addr")
    );

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_token_holdings_referrer_addr_idx" ON "referral_token_holdings" USING HASH ("referrer_addr");

