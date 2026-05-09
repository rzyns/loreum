import {
  IsString,
  IsOptional,
  IsArray,
  MinLength,
  IsIn,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import type { UpdateLoreArticleRequest } from "@loreum/types";
import { LORE_ARTICLE_CANON_STATUSES } from "./create-lore-article.dto";

export class UpdateLoreArticleDto implements UpdateLoreArticleRequest {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    enum: LORE_ARTICLE_CANON_STATUSES,
    description: "Canon/canonicality status for the lore article.",
  })
  @IsOptional()
  @IsIn(LORE_ARTICLE_CANON_STATUSES)
  canonStatus?: (typeof LORE_ARTICLE_CANON_STATUSES)[number];

  @ApiPropertyOptional()
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
