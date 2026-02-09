-- AlterTable
ALTER TABLE "perpetual_long_id" ALTER COLUMN "valid_to" SET DEFAULT TO_TIMESTAMP(253402300799);

-- AlterTable
ALTER TABLE "settle_history" ADD COLUMN     "cash_cc" DECIMAL(40,0);
