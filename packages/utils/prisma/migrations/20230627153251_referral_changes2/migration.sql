/*
  Warnings:

  - The primary key for the `referral_code_usage` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `timestamp` on the `referral_code_usage` table. All the data in the column will be lost.
  - The primary key for the `referral_token_holdings` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "referral_code_usage" DROP CONSTRAINT "referral_code_usage_pkey",
DROP COLUMN "timestamp",
ADD COLUMN     "valid_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "valid_to" TIMESTAMPTZ NOT NULL DEFAULT '2042-01-01 00:42:42 +00:00',
ADD CONSTRAINT "referral_code_usage_pkey" PRIMARY KEY ("trader_addr", "valid_from");

-- AlterTable
ALTER TABLE "referral_token_holdings" DROP CONSTRAINT "referral_token_holdings_pkey",
ADD CONSTRAINT "referral_token_holdings_pkey" PRIMARY KEY ("referrer_addr", "token_addr");

-- CreateIndex
CREATE INDEX "referral_code_usage_code_idx" ON "referral_code_usage"("code");

-- CreateIndex
CREATE INDEX "referral_code_usage_valid_to_idx" ON "referral_code_usage"("valid_to");
