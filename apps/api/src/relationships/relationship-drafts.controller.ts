import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";
import { ApiKeyAuthGuard } from "../auth/guards/api-key-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { ProjectsService } from "../projects/projects.service";
import { RelationshipDraftsService } from "./relationship-drafts.service";

export class CreateRelationshipDraftDto {
  @IsString()
  sourceEntitySlug!: string;

  @IsString()
  targetEntitySlug!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  bidirectional?: boolean;
}

@ApiTags("Relationship drafts")
@Controller("projects/:projectSlug/drafts/relationships")
@UseGuards(ApiKeyAuthGuard)
@ApiCookieAuth("auth_token")
export class RelationshipDraftsController {
  constructor(
    private projectsService: ProjectsService,
    private capabilities: ProjectCapabilitiesService,
    private relationshipDraftsService: RelationshipDraftsService,
  ) {}

  @Get(":draftId")
  @ApiOperation({ summary: "Read a safe relationship draft review detail" })
  async detail(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.relationshipDraftsService.getRelationshipDraftDetail(
      project.id,
      draftId,
      actor,
    );
  }

  @Post()
  @ApiOperation({
    summary: "Submit a draft relationship without applying canonically",
  })
  async submit(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Body() dto: CreateRelationshipDraftDto,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.relationshipDraftsService.submitRelationshipDraft(
      project.id,
      dto,
      actor,
    );
  }

  @Post(":draftId/approve")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve and apply a submitted relationship draft" })
  async approve(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { reviewNote?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.relationshipDraftsService.approveAndApplyRelationshipDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  @Post(":draftId/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject a submitted relationship draft" })
  async reject(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { rejectionReason?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.relationshipDraftsService.rejectRelationshipDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  private resolveActor(
    project: Awaited<ReturnType<ProjectsService["findBySlug"]>>,
    user: AuthUser,
  ) {
    return user.apiKey
      ? this.capabilities.resolveApiKeyActor({
          project,
          apiKey: {
            id: user.apiKey.id,
            name: "project API key",
            userId: user.id,
            permissions: user.apiKey.permissions,
          },
        })
      : this.capabilities.resolveHumanActor({ project, user });
  }
}
