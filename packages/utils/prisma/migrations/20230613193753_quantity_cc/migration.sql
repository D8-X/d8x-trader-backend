/*
  Warnings:

  - Added the required column `quantity_cc` to the `trades_history` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "trades_history" ADD COLUMN     "quantity_cc" DECIMAL(40,0);
