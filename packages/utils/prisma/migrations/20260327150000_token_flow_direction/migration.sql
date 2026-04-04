ALTER TABLE "token_flow" ADD COLUMN "deposit" BOOLEAN NOT NULL DEFAULT true;

UPDATE "token_flow" SET "deposit" = false WHERE amount_cc < 0;

ALTER TABLE "token_flow" DROP CONSTRAINT "token_flow_pkey";
ALTER TABLE "token_flow" ADD CONSTRAINT "token_flow_pkey" PRIMARY KEY ("trader_addr", "perpetual_id", "tx_hash", "deposit");
