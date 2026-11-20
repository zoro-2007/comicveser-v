import { Module } from "@nestjs/common";
import { ComicsController } from "./comics.controller";
import { ComicsService } from "./comics.service";
import { StorageService } from "../storage/storage.service";
import { DownloadPolicyModule } from "../downloads/download-policy.module";
@Module({ imports: [DownloadPolicyModule], controllers: [ComicsController], providers: [ComicsService, StorageService], exports: [ComicsService] })
export class ComicsModule {}
