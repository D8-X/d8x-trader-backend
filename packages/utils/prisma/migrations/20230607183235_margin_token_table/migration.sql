-- CreateTable
CREATE TABLE "margin_token_info" (
    "pool_id" INTEGER NOT NULL,
    "token_addr" VARCHAR(42) NOT NULL,
    "token_name" VARCHAR(20) NOT NULL,
    "token_decimals" INTEGER NOT NULL,

    CONSTRAINT "margin_token_info_pkey" PRIMARY KEY ("pool_id")
);
