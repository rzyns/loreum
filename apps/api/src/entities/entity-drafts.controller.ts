import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
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
    const actor = user.apiKey
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
    const actor = user.apiKey
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
    const actor = user.apiKey
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
    return this.entityDraftsService.rejectEntityDraft(
      project.id,
      draftId,
      actor,
      dto,
    );
  }
}
