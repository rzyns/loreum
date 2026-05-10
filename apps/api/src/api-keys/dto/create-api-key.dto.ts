import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  MinLength,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const PERMISSIONS = ["READ_ONLY", "DRAFT_WRITE", "CANONICAL_WRITE"] as const;

export class CreateApiKeyDto {
  @ApiProperty({ example: "Claude Desktop" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ enum: PERMISSIONS, default: "DRAFT_WRITE" })
  @IsOptional()
  @IsEnum(PERMISSIONS)
  permissions?: (typeof PERMISSIONS)[number];

  @ApiPropertyOptional({ example: "2026-12-31T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
