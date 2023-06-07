/*
  Warnings:

  - You are about to alter the column `perpetual_id` on the `funding_rate_payments` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to alter the column `perpetual_id` on the `trades_history` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - Made the column `broker_fee_tbps` on table `trades_history` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "funding_rate_payments" ALTER COLUMN "perpetual_id" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "trades_history" ALTER COLUMN "perpetual_id" SET DATA TYPE INTEGER,
ALTER COLUMN "broker_fee_tbps" SET NOT NULL;
