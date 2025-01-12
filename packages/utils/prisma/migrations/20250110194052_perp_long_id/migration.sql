-- CreateTable
CREATE TABLE "perpetual_long_id" (
    "perpetual_id" INTEGER NOT NULL,
    "perpetual_name" VARCHAR(20) NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_to" TIMESTAMPTZ NOT NULL DEFAULT TO_TIMESTAMP(253402300799),
    "tx_hash" TEXT NOT NULL,

    CONSTRAINT "perpetual_long_id_pkey" PRIMARY KEY ("tx_hash")
);
