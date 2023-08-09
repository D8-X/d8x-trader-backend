
-- CreateTable
CREATE TABLE if not exists "referral_code_usage" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "code" VARCHAR(200) NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ NOT NULL DEFAULT '2042-01-01 00:42:42 +00:00',

    CONSTRAINT "referral_code_usage_pkey" PRIMARY KEY ("trader_addr","valid_from")
);

-- CreateIndex
CREATE INDEX  IF NOT EXISTS "referral_code_usage_code_idx" ON "referral_code_usage"("code");

-- CreateIndex
CREATE INDEX  IF NOT EXISTS "referral_code_usage_valid_to_idx" ON "referral_code_usage"("valid_to");

