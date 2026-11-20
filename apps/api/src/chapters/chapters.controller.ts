import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AuthUser, CurrentUser, RequirePermission } from "../auth/auth.guard";
import { ChaptersService } from "./chapters.service";
import { CreateChapterDto, ImagesQuery, RegisterImagesDto, ReorderDto, UpdateChapterDto, UploadUrlDto } from "./dto/chapter.dto";

@ApiTags("chapters")
@Controller()
export class ChaptersController {
  constructor(private svc: ChaptersService) {}
  @Get("chapters/:id") meta(@Param("id") id: string) { return this.svc.meta(id); }
  @Get("chapters/:id/images") images(@Param("id") id: string, @Query() q: ImagesQuery) { return this.svc.images(id, q.from, q.limit); }

  @Throttle({ default: { ttl: 60_000, limit: 2000 } })
  @Get("chapters/:id/pages/:position/file")
  async pageFile(
    @Param("id") id: string,
    @Param("position", ParseIntPipe) position: number,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.svc.pageFile(id, position);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  }

  @RequirePermission("chapter:write") @Post("admin/chapters")
  create(@CurrentUser() u: AuthUser, @Body() d: CreateChapterDto) { return this.svc.create(d, u.id); }
  @RequirePermission("chapter:write") @Put("admin/chapters/:id")
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() d: UpdateChapterDto) { return this.svc.update(id, d, u.id); }
  @RequirePermission("chapter:write") @HttpCode(200) @Post("admin/uploads")
  uploadUrl(@Body() d: UploadUrlDto) { return this.svc.uploadUrl(d); }
  @RequirePermission("chapter:write") @Post("admin/chapters/:id/images")
  register(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() d: RegisterImagesDto) { return this.svc.registerImages(id, d, u.id); }
  @RequirePermission("chapter:write") @HttpCode(204) @Put("admin/chapters/:id/images/order")
  reorder(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() d: ReorderDto) { return this.svc.reorder(id, d.ids, u.id); }
}
