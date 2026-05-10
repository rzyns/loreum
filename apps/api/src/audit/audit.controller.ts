import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { User } from "../auth/decorators/user.decorator";
import { ApiKeyAuthGuard } from "../auth/guards/api-key-auth.guard";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { AuthUser } from "../auth/types/jwt.types";
import { ProjectsService } from "../projects/projects.service";
import { AuditService } from "./audit.service";

@ApiTags("Project audit")
@Controller("projects/:projectSlug")
@UseGuards(ApiKeyAuthGuard)
@ApiCookieAuth("auth_token")
export class AuditController {
  constructor(
    private projectsService: ProjectsService,
    private capabilities: ProjectCapabilitiesService,
    private auditService: AuditService,
  ) {}

  @Get("activity")
  @ApiOperation({ summary: "List a safe project activity changelog feed" })
  async activity(
    @Param("projectSlug") projectSlug: string,
    @User() user: AuthUser,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    return this.auditService.listProjectActivity(project.id, actor, {
      limit,
      offset,
    });
  }

  @Get("audit/:auditEventId")
  @ApiOperation({ summary: "Read a redacted project audit event detail" })
  async detail(
    @Param("projectSlug") projectSlug: string,
    @Param("auditEventId") auditEventId: string,
    @User() user: AuthUser,
  ) {
    const project = await this.projectsService.findBySlug(projectSlug, user.id);
    const actor = this.resolveActor(project, user);
    const detail = await this.auditService.getAuditDetail(
      project.id,
      auditEventId,
      actor,
    );
    if (!detail) {
      throw new NotFoundException("Audit event not found");
    }
    return detail;
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
