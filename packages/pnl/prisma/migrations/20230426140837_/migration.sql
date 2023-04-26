-- CreateEnum
CREATE TYPE "estimated_earnings_event_type" AS ENUM ('liquidity_added', 'liquidity_removed', 'share_token_p2p_transfer');

-- CreateTable
CREATE TABLE "estimated_earnings_tokens" (
    "id" BIGSERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "perpetual_id" BIGINT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "token_amount" DECIMAL(40,0) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" "estimated_earnings_event_type" NOT NULL,

    CONSTRAINT "estimated_earnings_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_tx_hash_idx" ON "estimated_earnings_tokens" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_wallet_address_idx" ON "estimated_earnings_tokens" USING HASH ("wallet_address");

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_perpetual_id_idx" ON "estimated_earnings_tokens" USING HASH ("perpetual_id");
