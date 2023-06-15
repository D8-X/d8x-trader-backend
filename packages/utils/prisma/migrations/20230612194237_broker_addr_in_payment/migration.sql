/*
  Warnings:

  - Added the required column `broker_addr` to the `referral_payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "referral_payment" ADD COLUMN     "broker_addr" VARCHAR(42) NOT NULL;
