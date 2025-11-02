-- AlterTable
ALTER TABLE "perpetual_long_id" ALTER COLUMN "valid_to" SET DEFAULT TO_TIMESTAMP(253402300799);

-- CreateTable
CREATE TABLE "settle_history" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "perpetual_id" INTEGER NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "quantity_cc" DECIMAL(40,0),
    "tx_hash" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "settle_history_pkey" PRIMARY KEY ("trader_addr","perpetual_id","tx_hash")
);

-- CreateIndex
CREATE INDEX "settle_history_trader_addr_idx" ON "settle_history"("trader_addr");

-- CreateIndex
CREATE INDEX "settle_history_perpetual_id_idx" ON "settle_history"("perpetual_id");

-- CreateIndex
CREATE INDEX "settle_history_timestamp_idx" ON "settle_history"("timestamp");
