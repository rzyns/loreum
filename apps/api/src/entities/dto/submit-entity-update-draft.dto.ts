import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";

export type EntityUpdateDraftBaseField =
  | "name"
  | "summary"
  | "description"
  | "backstory"
  | "secrets"
  | "notes"
  | "imageUrl";

export type EntityUpdateDraftPatch = Partial<
  Record<EntityUpdateDraftBaseField, string | null>
>;

export class SubmitEntityUpdateDraftDto {
  @ApiProperty({
    description:
      "Base entity scalar fields to stage for review. Missing keys are unchanged; null clears nullable fields.",
    example: { summary: "Updated summary", notes: null },
  })
  @IsObject()
  patch!: Record<string, unknown>;
}
