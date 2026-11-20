CREATE TABLE "OfflineDownloadSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OfflineDownloadSetting_pkey" PRIMARY KEY ("id")
);
