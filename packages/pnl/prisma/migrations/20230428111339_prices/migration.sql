-- CreateTable
CREATE TABLE "price_info" (
    "id" BIGSERIAL NOT NULL,
    "pool_token_price" DOUBLE PRECISION NOT NULL,
    "pool_id" BIGINT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_info_pool_id_idx" ON "price_info" USING HASH ("pool_id");

-- CreateIndex
CREATE INDEX "price_info_timestamp_idx" ON "price_info"("timestamp");
