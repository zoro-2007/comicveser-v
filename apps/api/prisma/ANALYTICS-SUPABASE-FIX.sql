-- ComicVerse consent-based analytics table (safe to run more than once).
-- Use Supabase Dashboard -> SQL Editor if /api/analytics/event returns a database error.
CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "userId" TEXT,
  "comicId" TEXT,
  "chapterId" TEXT,
  "path" TEXT,
  "query" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_createdAt_idx"
  ON "AnalyticsEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_type_createdAt_idx"
  ON "AnalyticsEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_comicId_idx"
  ON "AnalyticsEvent"("comicId");
