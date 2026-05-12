import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { User } from "../auth/decorators/user.decorator";
import { ApiKeyAuthGuard } from "../auth/guards/api-key-auth.guard";
import { AuthUser } from "../auth/types/jwt.types";
import { ProjectsService } from "../projects/projects.service";
import { LORE_ARTICLE_CANON_STATUSES } from "./dto/create-lore-article.dto";
import { LoreArticleDraftsService } from "./lore-article-drafts.service";

export class CreateLoreArticleDraftDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(LORE_ARTICLE_CANON_STATUSES)
  canonStatus?: "draft" | "staging" | "provisional" | "canon";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  entitySlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

@ApiTags("Lore article drafts")
@Controller("projects/:projectSlug/drafts/lore-articles")
@UseGuards(ApiKeyAuthGuard)
@ApiCookieAuth("auth_token")
export class LoreArticleDraftsController {
  constructor(
    private projectsService: ProjectsService,
    private capabilities: ProjectCapabilitiesService,
    private loreArticleDraftsService: LoreArticleDraftsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List safe lore article draft review rows" })
  async list(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Query("status") status?: string,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.loreArticleDraftsService.listLoreArticleDrafts(
      project.id,
      actor,
      status,
    );
  }

  @Get(":draftId")
  @ApiOperation({ summary: "Read a safe lore article draft review detail" })
  async detail(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.loreArticleDraftsService.getLoreArticleDraftDetail(
      project.id,
      draftId,
      actor,
    );
  }

  @Post()
  @ApiOperation({
    summary: "Submit a draft lore article without applying canonically",
  })
  async submit(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Body() dto: CreateLoreArticleDraftDto,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.loreArticleDraftsService.submitLoreArticleDraft(
      project.id,
      dto,
      actor,
    );
  }

  @Post(":draftId/approve")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve and apply a submitted lore article draft" })
  async approve(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { reviewNote?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.loreArticleDraftsService.approveAndApplyLoreArticleDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  @Post(":draftId/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject a submitted lore article draft" })
  async reject(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { rejectionReason?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.loreArticleDraftsService.rejectLoreArticleDraft(
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
