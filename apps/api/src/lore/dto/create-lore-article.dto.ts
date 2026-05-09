import {
  IsString,
  IsOptional,
  IsArray,
  MinLength,
  IsIn,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { CreateLoreArticleRequest } from "@loreum/types";

export const LORE_ARTICLE_CANON_STATUSES = [
  "draft",
  "staging",
  "provisional",
  "canon",
] as const;

type LoreArticleCanonStatus = (typeof LORE_ARTICLE_CANON_STATUSES)[number];

export class CreateLoreArticleDto implements CreateLoreArticleRequest {
  @ApiProperty({ example: "The One Ring" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ example: "The One Ring was forged by..." })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({ example: "artifacts" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    enum: LORE_ARTICLE_CANON_STATUSES,
    default: "provisional",
    description:
      "Canon/canonicality status for the lore article. Omitted creates a conservative provisional article until explicitly reviewed.",
  })
  @IsOptional()
  @IsIn(LORE_ARTICLE_CANON_STATUSES)
  canonStatus?: LoreArticleCanonStatus;

  @ApiPropertyOptional({ example: ["sauron", "frodo"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entitySlugs?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
