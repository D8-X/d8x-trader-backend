-- AlterTable
ALTER TABLE "trades_history" ADD COLUMN "broker_fee_tbps" INTEGER;
-- Step 2: Set the values to 0
UPDATE trades_history SET broker_fee_tbps = 0;
