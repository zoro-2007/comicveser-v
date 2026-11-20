import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthUser, CurrentUser, RequirePermission } from "../auth/auth.guard";
import { ComicsService } from "./comics.service";
import { CreateComicDto, ListComicsQuery, UpdateComicDto, UpdateComicRatingDto } from "./dto/comic.dto";
import { IsInt, IsString, Max, Min } from "class-validator";
class ComicCoverUploadDto { @IsString() contentType: string; @IsInt() @Min(1) @Max(10 * 1024 * 1024) size: number; }

@ApiTags("comics")
@Controller()
export class ComicsController {
  constructor(private svc: ComicsService) {}

  // Static routes are declared before :slug so they are not captured by it.
  @Get("comics") list(@Query() q: ListComicsQuery) { return this.svc.list(q); }
  @Get("comics/trending") trending() { return this.svc.trending(); }
  @Get("comics/latest") latest() { return this.svc.latest(); }
  @Get("comics/popular") popular(@Query("period") period?: string) { return this.svc.popular(period === "weekly" || period === "monthly" ? period : "all"); }
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Get("comics/:id/cover/file")
  async coverFile(@Param("id") id: string, @Res() res: Response) {
    const { buffer, contentType } = await this.svc.coverFile(id);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  }
  @Get("comics/:id/chapters") chapters(@Param("id") id: string, @Query("order") order?: "asc" | "desc") {
    return this.svc.chapters(id, order === "asc" ? "asc" : "desc");
  }
  @Get("comics/:slug") one(@Param("slug") slug: string) { return this.svc.bySlug(slug); }
  @Get("search") search(@Query() q: ListComicsQuery) { return this.svc.list(q); }

  @RequirePermission("comic:write")
  @HttpCode(200) @Post("admin/comic-uploads") coverUpload(@Body() d: ComicCoverUploadDto) { return this.svc.coverUploadUrl(d.contentType, d.size); }

  @RequirePermission("comic:write")
  @Post("admin/comics") create(@CurrentUser() u: AuthUser, @Body() dto: CreateComicDto) { return this.svc.create(dto, u.id); }

  @RequirePermission("comic:write")
  @Put("admin/comics/:id/rating") updateRating(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: UpdateComicRatingDto) {
    return this.svc.updateRating(id, dto, u.id);
  }

  @RequirePermission("comic:write")
  @Put("admin/comics/:id") update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: UpdateComicDto) { return this.svc.update(id, dto, u.id); }

  @RequirePermission("comic:write") @HttpCode(204)
  @Delete("admin/comics/:id") async remove(@CurrentUser() u: AuthUser, @Param("id") id: string) { await this.svc.remove(id, u.id); }
}
