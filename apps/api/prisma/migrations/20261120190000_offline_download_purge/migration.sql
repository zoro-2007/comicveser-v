ALTER TABLE "OfflineDownloadSetting"
  ADD COLUMN "purgeRevision" INTEGER NOT NULL DEFAULT 0;

UPDATE "OfflineDownloadSetting"
  SET "purgeRevision" = 1
  WHERE "enabled" = false;
