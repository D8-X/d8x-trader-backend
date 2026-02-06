-- AlterTable
ALTER TABLE "perpetual_long_id" ALTER COLUMN "valid_to" SET DEFAULT TO_TIMESTAMP(253402300799);

-- AlterTable
ALTER TABLE "trades_history" ADD COLUMN     "leverage" INTEGER;
