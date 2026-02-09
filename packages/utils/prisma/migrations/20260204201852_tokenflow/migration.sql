-- AlterTable
ALTER TABLE "perpetual_long_id" ALTER COLUMN "valid_to" SET DEFAULT TO_TIMESTAMP(253402300799);

-- CreateTable
CREATE TABLE "token_flow" (
    "perpetual_id" INTEGER NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "trader_addr" VARCHAR(42) NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tx_hash" TEXT NOT NULL,
    "amount_cc" DECIMAL(40,0),
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "token_flow_pkey" PRIMARY KEY ("trader_addr","perpetual_id","tx_hash")
);

-- CreateIndex
CREATE INDEX "token_flow_trader_addr_idx" ON "token_flow"("trader_addr");

-- CreateIndex
CREATE INDEX "token_flow_perpetual_id_idx" ON "token_flow"("perpetual_id");

-- CreateIndex
CREATE INDEX "token_flow_timestamp_idx" ON "token_flow"("timestamp");
