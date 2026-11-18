import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { Authenticated, AuthUser, CurrentUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MailService } from "../mail/mail.service";
import { primaryWebOrigin } from "../common/config";

export const ISSUE_CATEGORIES = [
  "COMIC_REQUEST",
  "BUG",
  "BROKEN_CHAPTER",
  "LOGIN_ISSUE",
  "CONTENT_ISSUE",
  "FEATURE_REQUEST",
  "ABUSE",
  "GENERAL",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

class RateDto {
  @IsInt()
  @Min(1)
  @Max(10)
  value: number;
}

class BodyDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}

class CommentDto extends BodyDto {
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class RequestComicDto {
  @IsString()
  @Length(2, 200)
  title: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  comicType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  providerOrUrl?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;
}

export class ReportDto {
  @IsOptional()
  @IsIn(["comic", "chapter", "review", "comment", "platform", "account", "comic_request"])
  targetType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  targetId?: string;

  @IsOptional()
  @IsIn(ISSUE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  comicId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  chapterId?: string;
}

@Injectable()
export class ReviewsService {
  private readonly log = new Logger("Reviews");

  constructor(
    private db: PrismaService,
    private notif: NotificationsService,
    private mail: MailService,
  ) {}

  async forComic(comicId: string) {
    const [reviews, comments, agg] = await Promise.all([
      this.db.review.findMany({
        where: { comicId, deletedAt: null },
        orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
        take: 30,
        include: { user: { select: { id: true, username: true, profile: { select: { avatarUrl: true } } } } },
      }),
      this.db.comment.findMany({
        where: { comicId, parentId: null, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          user: { select: { id: true, username: true } },
          replies: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            include: { user: { select: { id: true, username: true } } },
          },
        },
      }),
      this.db.rating.aggregate({
        where: { comicId },
        _avg: { value: true },
        _count: { value: true },
      }),
    ]);
    return {
      rating: { average: agg._avg.value ?? 0, count: agg._count.value },
      reviews,
      comments,
    };
  }

  async listForComic(comicId: string, page = 1) {
    const size = 20;
    const p = Math.max(1, Number(page) || 1);
    const [reviews, total, agg, ratings] = await Promise.all([
      this.db.review.findMany({
        where: { comicId, deletedAt: null },
        orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
        skip: (p - 1) * size,
        take: size,
        include: { user: { select: { id: true, username: true } } },
      }),
      this.db.review.count({ where: { comicId, deletedAt: null } }),
      this.db.rating.aggregate({
        where: { comicId },
        _avg: { value: true },
        _count: { value: true },
      }),
      this.db.rating.findMany({
        where: { comicId },
        select: { userId: true, value: true },
      }),
    ]);
    const ratingMap = new Map(ratings.map((r) => [r.userId, r.value]));
    return {
      average: agg._avg.value ?? null,
      ratingCount: agg._count.value ?? 0,
      total,
      page: p,
      pages: Math.max(1, Math.ceil(total / size)),
      items: reviews.map((r) => ({
        ...r,
        rating: ratingMap.get(r.userId) ?? null,
      })),
    };
  }

  async mineForComic(userId: string | null, comicId: string) {
    if (!userId) return { rating: null, review: null };
    const [ratingRow, reviewRow] = await Promise.all([
      this.db.rating.findUnique({ where: { userId_comicId: { userId, comicId } } }).catch(() => null),
      this.db.review.findUnique({ where: { userId_comicId: { userId, comicId } } }).catch(() => null),
    ]);
    return {
      rating: ratingRow?.value ?? null,
      review: reviewRow && !reviewRow.deletedAt ? { id: reviewRow.id, body: reviewRow.body } : null,
    };
  }

  rate(userId: string, comicId: string, value: number) {
    return this.db.rating.upsert({
      where: { userId_comicId: { userId, comicId } },
      create: { userId, comicId, value },
      update: { value },
    });
  }

  upsertReview(userId: string, comicId: string, body: string) {
    return this.db.review.upsert({
      where: { userId_comicId: { userId, comicId } },
      create: { userId, comicId, body },
      update: { body, deletedAt: null },
    });
  }

  async voteHelpful(userId: string, reviewId: string) {
    const exists = await this.db.reviewVote.findUnique({
      where: { userId_reviewId: { userId, reviewId } },
    });
    if (exists) return;
    await this.db.$transaction([
      this.db.reviewVote.create({ data: { userId, reviewId } }),
      this.db.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { increment: 1 } },
      }),
    ]);
  }

  async comment(userId: string, comicId: string, d: CommentDto) {
    const c = await this.db.comment.create({
      data: { userId, comicId, body: d.body, parentId: d.parentId },
    });
    if (d.parentId) {
      const parent = await this.db.comment.findUnique({ where: { id: d.parentId } });
      if (parent && parent.userId !== userId) {
        await this.notif.push(
          parent.userId,
          "REVIEW_REPLY",
          "New reply to your comment",
          d.body.slice(0, 120),
        );
      }
    }
    return c;
  }

  async deleteComment(u: AuthUser, id: string) {
    const c = await this.db.comment.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    if (c.userId !== u.id && !u.permissions.includes("review:moderate")) {
      throw new ForbiddenException();
    }
    await this.db.comment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async deleteReview(u: AuthUser, id: string) {
    const r = await this.db.review.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.userId !== u.id && !u.permissions.includes("review:moderate")) {
      throw new ForbiddenException();
    }
    await this.db.review.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async report(u: AuthUser, d: ReportDto) {
    const description = (d.description ?? d.reason ?? "").trim();
    const subject = (d.subject ?? "").trim() || description.slice(0, 80) || "User Issue Report";
    if (description.length < 3 && (d.reason ?? "").trim().length < 3) {
      throw new BadRequestException("Please provide a description or reason (at least 3 characters).");
    }

    const category = (
      (subject.startsWith("Comic Request:") ? "COMIC_REQUEST" : d.category) ||
      (d.targetType === "chapter"
        ? "BROKEN_CHAPTER"
        : d.targetType === "comic"
        ? "CONTENT_ISSUE"
        : d.targetType === "comment" || d.targetType === "review"
        ? "ABUSE"
        : "GENERAL")
    ).toUpperCase();

    const targetType = d.targetType ?? (d.chapterId ? "chapter" : d.comicId ? "comic" : "platform");
    const targetId = d.targetId ?? d.chapterId ?? d.comicId ?? "general";
    const combinedReason =
      d.reason?.trim() ||
      (d.subject ? `[${category}] ${subject}: ${description}` : description).slice(0, 500);

    const comicId = d.comicId ?? (targetType === "comic" && targetId !== "general" ? targetId : null);
    const chapterId = d.chapterId ?? (targetType === "chapter" && targetId !== "general" ? targetId : null);

    let created: any;
    try {
      created = await (this.db.report as any).create({
        data: {
          reporterId: u.id,
          targetType,
          targetId,
          category,
          subject,
          description: description || combinedReason,
          reason: combinedReason,
          comicId,
          chapterId,
          isRead: false,
        },
        include: {
          reporter: { select: { id: true, username: true, email: true } },
        },
      });
    } catch {
      // Fallback if Prisma client DMMF predates extended Report columns
      created = await this.db.report.create({
        data: {
          reporterId: u.id,
          targetType,
          targetId,
          reason: combinedReason,
        },
        include: {
          reporter: { select: { id: true, username: true, email: true } },
        },
      });
      try {
        await this.db.$executeRawUnsafe(
          `UPDATE "Report"
           SET "category" = $1, "subject" = $2, "description" = $3, "comicId" = $4, "chapterId" = $5, "isRead" = false
           WHERE "id" = $6`,
          category,
          subject,
          description || combinedReason,
          comicId,
          chapterId,
          created.id,
        );
      } catch {
        // Ignore in mock environment
      }
      created = {
        ...created,
        category,
        subject,
        description: description || combinedReason,
        comicId,
        chapterId,
        isRead: false,
      };
    }

    // Notify all active ADMIN users in-app (and via email if configured)
    try {
      const admins = await this.db.user.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          role: { name: "ADMIN" },
        },
        select: { id: true, email: true, username: true },
      });

      const alertTitle = `New Issue Report (${category}): ${subject.slice(0, 80)}`;
      const alertBody = `@${u.username} (${u.email}): ${(description || combinedReason).slice(0, 240)}`;
      await Promise.all(
        admins.map((admin) =>
          this.notif
            .push(admin.id, "PLATFORM", alertTitle, alertBody, "/admin/reviews")
            .catch(() => undefined),
        ),
      );

      for (const admin of admins) {
        if (admin.email) {
          void this.mail
            .sendAdminIssueAlertEmail(admin.email, {
              id: created.id,
              username: u.username,
              email: u.email,
              category,
              subject,
              description: description || combinedReason,
              adminUrl: `${primaryWebOrigin()}/admin/reviews`,
            })
            .catch((err) => {
              this.log.warn(`Admin alert email failed for ${admin.email}: ${(err as Error).message}`);
            });
        }
      }
    } catch (err) {
      this.log.warn(`Failed to fan out admin notifications for report ${created.id}: ${(err as Error).message}`);
    }

    return {
      id: created.id,
      reporterId: u.id,
      username: created.reporter?.username ?? u.username,
      email: created.reporter?.email ?? u.email,
      category: created.category ?? category,
      subject: created.subject ?? subject,
      description: created.description ?? (description || combinedReason),
      reason: created.reason ?? combinedReason,
      targetType: created.targetType,
      targetId: created.targetId,
      comicId: created.comicId ?? comicId,
      chapterId: created.chapterId ?? chapterId,
      status: created.status ?? "OPEN",
      isRead: Boolean(created.isRead),
      adminResponse: created.adminResponse ?? null,
      respondedAt: created.respondedAt ?? null,
      createdAt: created.createdAt,
      resolvedAt: created.resolvedAt ?? null,
    };
  }

  async requestComic(u: AuthUser, d: RequestComicDto) {
    const cleanTitle = (d.title ?? "").trim();
    if (cleanTitle.length < 2) {
      throw new BadRequestException("Please enter the comic title you want to request (at least 2 characters).");
    }
    const typeLabel = (d.comicType ?? "Manhwa").trim() || "Manhwa";
    const sourceText = (d.providerOrUrl ?? "").trim();
    const notesText = (d.notes ?? d.description ?? "").trim();
    const subject = `Comic Request: ${cleanTitle} (${typeLabel})`;
    const detailsParts = [
      `Requested Title: ${cleanTitle}`,
      `Format / Type: ${typeLabel}`,
      ...(sourceText ? [`Preferred Source / URL: ${sourceText}`] : []),
      ...(notesText ? [`Notes: ${notesText}`] : []),
    ];
    const fullDescription = detailsParts.join("\n");
    const reasonText = `[COMIC_REQUEST] ${subject} — ${detailsParts.join(" | ")}`.slice(0, 500);

    return this.report(u, {
      targetType: "comic_request",
      targetId: cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "comic-request",
      category: "COMIC_REQUEST",
      subject,
      description: fullDescription,
      reason: reasonText,
    });
  }

  async myReports(userId: string) {
    const items = await this.db.report.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return items.map((r: any) => ({
      id: r.id,
      category: r.category ?? "GENERAL",
      subject: r.subject || r.reason?.slice(0, 80) || "Issue report",
      description: r.description || r.reason || "",
      reason: r.reason,
      targetType: r.targetType,
      targetId: r.targetId,
      comicId: r.comicId ?? null,
      chapterId: r.chapterId ?? null,
      status: r.status,
      adminResponse: r.adminResponse ?? null,
      respondedAt: r.respondedAt ?? null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? null,
    }));
  }
}

@ApiTags("reviews")
@Controller()
export class ReviewsController {
  constructor(private svc: ReviewsService) {}

  @Get("comics/:comicId/reviews")
  reviewsList(@Param("comicId") id: string, @Query("page") page?: string) {
    return this.svc.listForComic(id, Number(page) || 1);
  }

  @Get("comics/:comicId/mine")
  async mine(@Req() req: any, @Param("comicId") id: string) {
    const uid = req?.user?.id ?? null;
    return this.svc.mineForComic(uid, id);
  }

  @Authenticated()
  @Put("comics/:comicId/rating")
  putRate(@CurrentUser() u: AuthUser, @Param("comicId") id: string, @Body() d: RateDto) {
    return this.svc.rate(u.id, id, d.value);
  }

  @Authenticated()
  @Put("reviews/:id")
  async updateReviewById(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() d: BodyDto) {
    const existing = await (this.svc as any).db.review.findUnique({ where: { id } });
    if (!existing || existing.userId !== u.id) throw new ForbiddenException();
    return (this.svc as any).db.review.update({ where: { id }, data: { body: d.body, deletedAt: null } });
  }

  @Get("comics/:comicId/engagement")
  forComic(@Param("comicId") id: string) {
    return this.svc.forComic(id);
  }

  @Authenticated()
  @Post("comics/:comicId/rating")
  rate(@CurrentUser() u: AuthUser, @Param("comicId") id: string, @Body() d: RateDto) {
    return this.svc.rate(u.id, id, d.value);
  }

  @Authenticated()
  @Post("comics/:comicId/reviews")
  review(@CurrentUser() u: AuthUser, @Param("comicId") id: string, @Body() d: BodyDto) {
    return this.svc.upsertReview(u.id, id, d.body);
  }

  @Authenticated()
  @HttpCode(204)
  @Post("reviews/:id/helpful")
  helpful(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.svc.voteHelpful(u.id, id);
  }

  @Authenticated()
  @HttpCode(204)
  @Delete("reviews/:id")
  delReview(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.svc.deleteReview(u, id);
  }

  @Authenticated()
  @Post("comics/:comicId/comments")
  comment(@CurrentUser() u: AuthUser, @Param("comicId") id: string, @Body() d: CommentDto) {
    return this.svc.comment(u.id, id, d);
  }

  @Authenticated()
  @HttpCode(204)
  @Delete("comments/:id")
  delComment(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.svc.deleteComment(u, id);
  }

  @Authenticated()
  @Post("reports")
  report(@CurrentUser() u: AuthUser, @Body() d: ReportDto) {
    return this.svc.report(u, d);
  }

  @Authenticated()
  @Post("comics/requests")
  requestComic(@CurrentUser() u: AuthUser, @Body() d: RequestComicDto) {
    return this.svc.requestComic(u, d);
  }

  @Authenticated()
  @Get("reports/mine")
  myReports(@CurrentUser() u: AuthUser) {
    return this.svc.myReports(u.id);
  }
}

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
