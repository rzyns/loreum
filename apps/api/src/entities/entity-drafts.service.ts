import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ActorContext } from "../auth/actor-context";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { generateUniqueSlug } from "../common/utils/slug";
import { CreateEntityDto } from "./dto/create-entity.dto";
import { EntitiesService } from "./entities.service";

@Injectable()
export class EntityDraftsService {
  constructor(
    private prisma: PrismaService,
    private entitiesService: EntitiesService,
    private capabilities: ProjectCapabilitiesService,
    private auditService: AuditService,
  ) {}

  async submitEntityDraft(
    projectId: string,
    dto: CreateEntityDto,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:create",
      "draft:submit",
    ]);

    const proposedSlug = await generateUniqueSlug(
      this.prisma,
      "entity",
      dto.name,
      projectId,
    );
    const proposedData = { ...dto, slug: proposedSlug };

    const draft = await this.prisma.draftProposal.create({
      data: {
        projectId,
        targetType: "ENTITY",
        operation: "CREATE",
        status: "SUBMITTED",
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        displayName: dto.name,
        displaySummary: dto.summary,
        submittedByKind: actor.kind,
        submittedByUserId: actor.userId,
        submittedByApiKeyId: actor.apiKeyId,
        submittedByLabel: actor.label,
        sourceKind: actor.sourceKind,
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_ENTITY_SUBMITTED",
      actor,
      operation: "CREATE",
      targetType: "ENTITY",
      draftId: draft.id,
      batchId: draft.batchId,
      targetDisplay: dto.name,
      summary: `Submitted entity draft ${dto.name}`,
      newData: proposedData,
    });

    return this.toSubmittedResponse(draft, proposedSlug);
  }

  async approveAndApplyEntityDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { reviewNote?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    const draft = await this.prisma.draftProposal.findFirst({
      where: {
        id: draftId,
        projectId,
        targetType: "ENTITY",
        operation: "CREATE",
      },
    });

    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending approval");
    }

    this.capabilities.assertCanApproveDraft(actor, draft);

    const proposedData = this.toCreateEntityDto(draft.proposedData);
    const canonical = await this.entitiesService.create(
      projectId,
      proposedData,
    );

    const applied = await this.prisma.draftProposal.update({
      where: { id: draft.id },
      data: {
        status: "APPLIED",
        reviewNote: input?.reviewNote,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
        appliedTargetId: canonical.id,
        appliedAt: new Date(),
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_ENTITY_APPLIED",
      actor,
      operation: "CREATE",
      targetType: "ENTITY",
      targetId: canonical.id,
      targetModel: "Entity",
      targetDisplay: canonical.name,
      draftId: draft.id,
      batchId: draft.batchId,
      approvalId: applied.id,
      summary: `Applied entity draft ${canonical.name}`,
      newData: canonical,
    });

    return {
      status: "applied",
      canonicalApplied: true,
      draftId: draft.id,
      batchId: draft.batchId,
      canonical,
    };
  }

  async rejectEntityDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { rejectionReason?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, ["draft:reject"]);

    const draft = await this.prisma.draftProposal.findFirst({
      where: {
        id: draftId,
        projectId,
        targetType: "ENTITY",
        operation: "CREATE",
      },
    });
    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }

    const rejected = await this.prisma.draftProposal.update({
      where: { id: draft.id },
      data: {
        status: "REJECTED",
        rejectionReason: input?.rejectionReason,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_ENTITY_REJECTED",
      actor,
      operation: "CREATE",
      targetType: "ENTITY",
      draftId: draft.id,
      batchId: draft.batchId,
      targetDisplay: draft.displayName,
      summary: `Rejected entity draft ${draft.displayName}`,
      metadata: { rejectionReason: input?.rejectionReason },
    });

    return {
      status: "rejected",
      canonicalApplied: false,
      draftId: rejected.id,
      batchId: rejected.batchId,
      rejectionReason: rejected.rejectionReason,
    };
  }

  private toSubmittedResponse(
    draft: { id: string; batchId: string; displayName: string },
    proposedSlug: string,
  ) {
    return {
      status: "submitted",
      canonicalApplied: false,
      draftId: draft.id,
      batchId: draft.batchId,
      proposedSlug,
      displayName: draft.displayName,
    };
  }

  private toCreateEntityDto(value: Prisma.JsonValue): CreateEntityDto {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Entity draft payload is invalid");
    }
    const dto = { ...(value as Record<string, unknown>) };
    delete dto.slug;
    return dto as unknown as CreateEntityDto;
  }

  private assertProjectActor(projectId: string, actor: ActorContext) {
    if (!actor.projectId || actor.projectId !== projectId) {
      throw new BadRequestException(
        "Draft operations require matching project actor context",
      );
    }
  }
}
