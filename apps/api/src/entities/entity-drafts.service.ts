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
const listInclude = {
  character: true,
  location: true,
  organization: true,
  item: { include: { itemType: true } },
  entityTags: { include: { tag: true } },
} as const;

@Injectable()
export class EntityDraftsService {
  constructor(
    private prisma: PrismaService,
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
    this.capabilities.assertCanApproveDraft(actor, draft);

    if (draft.status === "APPLIED") {
      return this.toAppliedResponse(draft);
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending approval");
    }

    const proposedData = this.toCreateEntityDto(draft.proposedData);
    const { applied, canonical } = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.draftProposal.updateMany({
          where: {
            id: draft.id,
            projectId,
            targetType: "ENTITY",
            operation: "CREATE",
            status: { in: ["SUBMITTED", "DRAFT"] },
          },
          data: {
            status: "APPROVED",
            reviewNote: input?.reviewNote,
            reviewedByUserId: actor.userId,
            reviewedAt: new Date(),
          },
        });

        if (claimed.count !== 1) {
          throw new BadRequestException("Entity draft is not pending approval");
        }

        const canonical = await this.createCanonicalEntity(
          tx,
          projectId,
          proposedData,
        );
        const applied = await tx.draftProposal.update({
          where: { id: draft.id },
          data: {
            status: "APPLIED",
            appliedTargetId: canonical.id,
            appliedAt: new Date(),
          },
        });

        await this.auditService.record(
          {
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
          },
          { client: tx },
        );

        return { applied, canonical };
      },
    );

    return {
      status: "applied",
      canonicalApplied: true,
      draftId: applied.id,
      batchId: applied.batchId,
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
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending rejection");
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "ENTITY",
          operation: "CREATE",
          status: { in: ["SUBMITTED", "DRAFT"] },
        },
        data: {
          status: "REJECTED",
          rejectionReason: input?.rejectionReason,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });

      if (claimed.count !== 1) {
        throw new BadRequestException("Entity draft is not pending rejection");
      }

      const rejected = await tx.draftProposal.findUniqueOrThrow({
        where: { id: draft.id },
      });

      await this.auditService.record(
        {
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
        },
        { client: tx },
      );

      return rejected;
    });

    return {
      status: "rejected",
      canonicalApplied: false,
      draftId: rejected.id,
      batchId: rejected.batchId,
      rejectionReason: rejected.rejectionReason,
    };
  }

  private async createCanonicalEntity(
    client: Prisma.TransactionClient,
    projectId: string,
    dto: CreateEntityDto,
  ) {
    const slug = await generateUniqueSlug(
      client as unknown as PrismaService,
      "entity",
      dto.name,
      projectId,
    );

    const entity = await client.entity.create({
      data: {
        projectId,
        type: dto.type,
        name: dto.name,
        slug,
        summary: dto.summary,
        description: dto.description,
        backstory: dto.backstory,
        secrets: dto.secrets,
        notes: dto.notes,
        imageUrl: dto.imageUrl,
      },
    });

    switch (dto.type) {
      case "CHARACTER":
        await client.character.create({
          data: { entityId: entity.id, ...dto.character },
        });
        break;
      case "LOCATION":
        await client.location.create({
          data: { entityId: entity.id, ...dto.location },
        });
        break;
      case "ORGANIZATION":
        await client.organization.create({
          data: { entityId: entity.id, ...dto.organization },
        });
        break;
      case "ITEM":
        await client.item.create({
          data: {
            entityId: entity.id,
            itemTypeId: dto.item?.itemTypeId,
            fields: (dto.item?.fields ?? {}) as Prisma.InputJsonValue,
          },
        });
        break;
    }

    return client.entity.findUniqueOrThrow({
      where: { id: entity.id },
      include: listInclude,
    });
  }

  private async toAppliedResponse(draft: {
    id: string;
    batchId: string;
    appliedTargetId: string | null;
  }) {
    if (!draft.appliedTargetId) {
      throw new BadRequestException("Entity draft is missing applied target");
    }

    const canonical = await this.prisma.entity.findUniqueOrThrow({
      where: { id: draft.appliedTargetId },
      include: listInclude,
    });

    return {
      status: "applied",
      canonicalApplied: true,
      draftId: draft.id,
      batchId: draft.batchId,
      canonical,
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
