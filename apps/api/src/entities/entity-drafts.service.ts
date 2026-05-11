import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DraftOperation,
  DraftStatus,
  DraftTargetType,
  Prisma,
} from "../../generated/prisma/client";
import type { ActorContext } from "../auth/actor-context";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { AuditService } from "../audit/audit.service";
import { redactInfrastructureSecrets } from "../audit/audit-redaction";
import { PrismaService } from "../prisma/prisma.service";
import { generateUniqueSlug } from "../common/utils/slug";
import { CreateEntityDto } from "./dto/create-entity.dto";

type SafeProposedContent = {
  description?: Prisma.JsonValue;
  backstory?: Prisma.JsonValue;
  secrets?: Prisma.JsonValue;
  notes?: Prisma.JsonValue;
  imageUrl?: Prisma.JsonValue;
  character?: Prisma.JsonValue;
  location?: Prisma.JsonValue;
  organization?: Prisma.JsonValue;
  item?: Prisma.JsonValue;
  tags?: Prisma.JsonValue;
};
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

  async listReviewQueue(
    projectId: string,
    actor: ActorContext,
    filters: {
      status?: string;
      targetType?: string;
      operation?: string;
      limit?: string;
      offset?: string;
    } = {},
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, ["draft:review"]);

    const limit = this.parsePageNumber(filters.limit, 50, 100);
    const offset = this.parsePageNumber(
      filters.offset,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const where: Prisma.DraftProposalWhereInput = {
      projectId,
      targetType: this.parseEnumFilter(
        filters.targetType,
        DraftTargetType,
        DraftTargetType.ENTITY,
      ),
      operation: this.parseEnumFilter(
        filters.operation,
        DraftOperation,
        DraftOperation.CREATE,
      ),
      status: this.parseEnumFilter(
        filters.status,
        DraftStatus,
        DraftStatus.SUBMITTED,
      ),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.draftProposal.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.draftProposal.count({ where }),
    ]);

    return {
      items: items.map((draft) => this.toReviewSummary(draft)),
      page: { limit, offset, total },
    };
  }

  async getReviewQueueDetail(
    projectId: string,
    draftId: string,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:review",
      "audit:read_summary",
    ]);

    const draft = await this.prisma.draftProposal.findFirst({
      where: {
        id: draftId,
        projectId,
        targetType: "ENTITY",
        operation: "CREATE",
      },
      include: {
        auditEvents: { orderBy: { occurredAt: "asc" } },
      },
    });

    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }

    return {
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed: this.toSafeProposedSummary(draft.proposedData),
      safeLinks: this.toReviewSafeLinks(actor.projectSlug, draft),
      reviewHistory: draft.auditEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorKind: event.actorKind,
        actorLabel: redactInfrastructureSecrets(event.actorLabel),
        sourceKind: event.sourceKind,
        summary: redactInfrastructureSecrets(event.summary),
        occurredAt: event.occurredAt,
      })),
    };
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

  private toReviewSummary(draft: {
    id: string;
    status: string;
    targetType: string;
    operation: string;
    displayName: string;
    displaySummary: string | null;
    submittedByKind: string;
    submittedByLabel: string;
    sourceKind: string;
    appliedTargetId: string | null;
    appliedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: draft.id,
      status: draft.status,
      targetType: draft.targetType,
      operation: draft.operation,
      displayName: this.redactSafeText(draft.displayName),
      displaySummary: this.redactSafeText(draft.displaySummary),
      submittedByKind: draft.submittedByKind,
      submittedByLabel: this.redactSafeText(draft.submittedByLabel),
      sourceKind: draft.sourceKind,
      canonicalApplied: Boolean(draft.appliedTargetId || draft.appliedAt),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private toSafeProposedSummary(value: Prisma.JsonValue) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Entity draft payload is invalid");
    }
    const proposed = value as Record<string, Prisma.JsonValue>;
    return {
      type: proposed.type,
      name: this.redactJsonValue(proposed.name),
      title: this.redactJsonValue(proposed.name),
      slug: this.redactJsonValue(proposed.slug),
      summary: this.redactJsonValue(proposed.summary),
      content: this.toSafeProposedContent(proposed),
    };
  }

  private toSafeProposedContent(proposed: Record<string, Prisma.JsonValue>) {
    const content: SafeProposedContent = {};
    for (const key of [
      "description",
      "backstory",
      "secrets",
      "notes",
      "imageUrl",
      "character",
      "location",
      "organization",
      "item",
      "tags",
    ] as const) {
      if (proposed[key] !== undefined) {
        content[key] = this.redactDomainJsonValue(proposed[key]);
      }
    }
    return content;
  }

  private toReviewSafeLinks(
    projectSlug: string | undefined,
    draft: {
      id: string;
      proposedData: Prisma.JsonValue;
    },
  ) {
    const base = `/v1/projects/${projectSlug ?? ""}/drafts/entities/${draft.id}`;
    const proposed =
      draft.proposedData &&
      typeof draft.proposedData === "object" &&
      !Array.isArray(draft.proposedData)
        ? (draft.proposedData as Record<string, Prisma.JsonValue>)
        : {};
    const slug = typeof proposed.slug === "string" ? proposed.slug : undefined;

    return {
      review: base,
      approve: `${base}/approve`,
      reject: `${base}/reject`,
      proposedCanonical: slug
        ? `/v1/projects/${projectSlug ?? ""}/entities/${slug}`
        : null,
    };
  }

  private redactSafeText(value: string | null): string | null {
    return value === null ? null : redactInfrastructureSecrets(value);
  }

  private redactJsonValue(value: Prisma.JsonValue | undefined) {
    return redactInfrastructureSecrets(value);
  }

  private redactDomainJsonValue(value: Prisma.JsonValue | undefined) {
    return redactInfrastructureSecrets(value, {
      redactInfrastructureKeys: false,
    });
  }

  private parsePageNumber(
    value: string | undefined,
    fallback: number,
    max: number,
  ) {
    if (value === undefined) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(
        "Pagination values must be non-negative integers",
      );
    }
    return Math.min(parsed, max);
  }

  private parseEnumFilter<T extends string>(
    value: string | undefined,
    enumObject: Record<string, T>,
    fallback: T,
  ): T {
    if (value === undefined) {
      return fallback;
    }
    const normalized = value.toUpperCase();
    const allowed = Object.values(enumObject);
    const matched = allowed.find((candidate) => candidate === normalized);
    if (!matched) {
      throw new BadRequestException(`Unsupported filter value: ${value}`);
    }
    return matched;
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
