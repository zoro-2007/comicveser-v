-- Additive migration for provider rating & genre metadata preservation (Requirements 3, 4, 6, 7, 8)
ALTER TABLE "Comic" ADD COLUMN IF NOT EXISTS "providerRating" DOUBLE PRECISION;
ALTER TABLE "SourceTitle" ADD COLUMN IF NOT EXISTS "providerRating" DOUBLE PRECISION;
ALTER TABLE "SourceTitle" ADD COLUMN IF NOT EXISTS "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
