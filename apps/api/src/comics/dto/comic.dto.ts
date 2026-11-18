import { ComicStatus, ComicType, PublishState } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { Allow, ArrayMaxSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from "class-validator";

const toOptionalRating = ({ value }: { value: unknown }) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class CreateComicDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @Length(1, 200) altTitle?: string;
  @IsString() @Length(1, 5000) description: string;
  @IsString() @Length(1, 120) author: string;
  @IsString() @Length(1, 120) artist: string;
  @IsEnum(ComicType) type: ComicType;
  @IsOptional() @IsEnum(ComicStatus) status?: ComicStatus;
  @IsOptional() @IsEnum(PublishState) publishState?: PublishState;
  @IsInt() @Min(1900) @Max(2100) releaseYear: number;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) genreSlugs: string[];
  @IsOptional() @IsString() @Length(1, 300) coverKey?: string;
  @IsOptional() @IsString() @Length(1, 300) bannerKey?: string;

  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  providerRating?: number | null;

  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  rating?: number | null;
}

export class UpdateComicDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsString() @Length(1, 200) altTitle?: string;
  @IsOptional() @IsString() @Length(1, 5000) description?: string;
  @IsOptional() @IsString() @Length(1, 120) author?: string;
  @IsOptional() @IsString() @Length(1, 120) artist?: string;
  @IsOptional() @IsEnum(ComicType) type?: ComicType;
  @IsOptional() @IsEnum(ComicStatus) status?: ComicStatus;
  @IsOptional() @IsEnum(PublishState) publishState?: PublishState;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2100) releaseYear?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) genreSlugs?: string[];
  @IsOptional() @IsString() @Length(1, 300) coverKey?: string;
  @IsOptional() @IsString() @Length(1, 300) bannerKey?: string;

  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  providerRating?: number | null;

  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  rating?: number | null;
}

export class UpdateComicRatingDto {
  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  providerRating?: number | null;

  @Allow()
  @IsOptional()
  @Transform(toOptionalRating)
  @IsNumber()
  @Min(0)
  @Max(10)
  rating?: number | null;
}

export class ListComicsQuery {
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @IsString() @Length(1, 200) genre?: string;
  @IsOptional() @IsEnum(ComicType) type?: ComicType;
  @IsOptional() @IsEnum(ComicStatus) status?: ComicStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(10) minRating?: number;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @IsOptional() @IsEnum(["updated", "added", "popular", "alpha", "rating", "chapters"]) sort?: "updated" | "added" | "popular" | "alpha" | "rating" | "chapters";
  @IsOptional() @IsString() @Length(1, 100) creator?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) minChapters?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) pageSize: number = 12;
}
