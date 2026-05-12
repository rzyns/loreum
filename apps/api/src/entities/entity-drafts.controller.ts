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
import { ApiKeyAuthGuard } from "../auth/guards/api-key-auth.guard";
import { User } from "../auth/decorators/user.decorator";
import { AuthUser } from "../auth/types/jwt.types";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { ProjectsService } from "../projects/projects.service";
import { CreateEntityDto } from "./dto/create-entity.dto";
import { EntityDraftsService } from "./entity-drafts.service";

@ApiTags("Entity drafts")
@Controller("projects/:projectSlug/drafts/entities")
@UseGuards(ApiKeyAuthGuard)
@ApiCookieAuth("auth_token")
export class EntityDraftsController {
  constructor(
    private projectsService: ProjectsService,
    private capabilities: ProjectCapabilitiesService,
    private entityDraftsService: EntityDraftsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List entity drafts waiting in the review queue" })
  async list(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Query("status") status?: string,
    @Query("targetType") targetType?: string,
    @Query("operation") operation?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("archived") archived?: string,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.listReviewQueue(project.id, actor, {
      status,
      targetType,
      operation,
      limit,
      offset,
      archived,
    });
  }

  @Get(":draftId")
  @ApiOperation({ summary: "Read a safe entity draft review detail" })
  async detail(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.getReviewQueueDetail(
      project.id,
      draftId,
      actor,
    );
  }

  @Post()
  @ApiOperation({
    summary: "Submit a draft entity without applying canonically",
  })
  async submit(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Body() dto: CreateEntityDto,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.submitEntityDraft(project.id, dto, actor);
  }

  @Post(":draftId/approve")
  @HttpCode(200)
  @ApiOperation({ summary: "Approve and apply a submitted entity draft" })
  async approve(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { reviewNote?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.approveAndApplyEntityDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  @Post(":draftId/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Reject a submitted entity draft" })
  async reject(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { rejectionReason?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.rejectEntityDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  @Post(":draftId/archive")
  @HttpCode(200)
  @ApiOperation({
    summary: "Archive a terminal entity draft from default history",
  })
  async archive(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { reason?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.archiveEntityDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }

  @Post(":draftId/unarchive")
  @HttpCode(200)
  @ApiOperation({
    summary: "Restore an archived terminal entity draft to history",
  })
  async unarchive(
    @Param("projectSlug") projectSlug: string,
    @Param("draftId") draftId: string,
    @User() user: AuthUser,
    @Body() dto: { reason?: string },
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.entityDraftsService.unarchiveEntityDraft(
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
