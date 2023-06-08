/*
  Warnings:

  - You are about to alter the column `pool_id` on the `estimated_earnings_tokens` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `pool_id` on the `price_info` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "estimated_earnings_tokens" ALTER COLUMN "pool_id" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "price_info" ALTER COLUMN "pool_id" SET DATA TYPE INTEGER;
