-- Add metrics JSON column to AlgoProfile (nullable for backfill safety).
ALTER TABLE "AlgoProfile" ADD COLUMN "metrics" TEXT;
