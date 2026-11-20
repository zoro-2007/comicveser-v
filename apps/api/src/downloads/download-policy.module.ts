import { Body, Controller, Get, Header, Injectable, Module, Put } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import type { Response } from "express";
import { RequireAdmin } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";

const ID = "global";
const statusFields = { enabled: true, revision: true, purgeRevision: true } as const;

@Injectable()
export class DownloadPolicyService {
  constructor(private readonly db: PrismaService) {}

  async get() {
    return (await this.db.offlineDownloadSetting.findUnique({
      where: { id: ID },
      select: statusFields,
    })) ?? { enabled: true, revision: 0, purgeRevision: 0 };
  }

  set(enabled: boolean) {
    return this.db.offlineDownloadSetting.upsert({
      where: { id: ID },
      create: { id: ID, enabled, revision: 1, purgeRevision: enabled ? 0 : 1 },
      update: {
        enabled,
        revision: { increment: 1 },
        ...(enabled ? {} : { purgeRevision: { increment: 1 } }),
      },
      select: statusFields,
    });
  }

  async rejectIfDisabled(res: Response) {
    const status = await this.get();
    if (status.enabled) return false;
    res.setHeader("Cache-Control", "private, no-store");
    res.status(403).json({
      error: {
        statusCode: 403,
        code: "DOWNLOADS_DISABLED",
        message: "Downloads and offline reading are disabled.",
        revision: status.revision,
        purgeRevision: status.purgeRevision,
      },
    });
    return true;
  }
}

class SetDownloadPolicyDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller()
class DownloadPolicyController {
  constructor(private readonly policy: DownloadPolicyService) {}

  @Get("settings/offline-downloads")
  @Header("Cache-Control", "private, no-store")
  get() {
    return this.policy.get();
  }

  @RequireAdmin()
  @Put("admin/settings/offline-downloads")
  @Header("Cache-Control", "private, no-store")
  set(@Body() body: SetDownloadPolicyDto) {
    return this.policy.set(body.enabled);
  }
}

@Module({
  controllers: [DownloadPolicyController],
  providers: [DownloadPolicyService],
  exports: [DownloadPolicyService],
})
export class DownloadPolicyModule {}
