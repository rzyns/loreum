import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ActorContext } from "../auth/actor-context";
import { ProjectCapabilitiesService } from "../auth/project-capabilities.service";
import { AuditService } from "../audit/audit.service";
import { redactInfrastructureSecrets } from "../audit/audit-redaction";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRelationshipDto } from "./dto/create-relationship.dto";

const entitySelect = {
  id: true,
  name: true,
  slug: true,
  type: true,
} as const;

const relationshipInclude = {
  sourceEntity: { select: entitySelect },
  targetEntity: { select: entitySelect },
} as const;

type RelationshipEntityPreview = {
  id: string;
  name: string;
  slug: string;
  type: string;
};

type ProposedRelationshipCreate = {
  sourceEntitySlug: string;
  targetEntitySlug: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
  bidirectional?: boolean;
};

type RelationshipCreateDraftInput = Omit<CreateRelationshipDto, "label"> & {
  label?: string;
  type?: string;
};

type RelationshipDraftListStatus =
  (typeof RELATIONSHIP_DRAFT_LIST_STATUSES)[number];

const RELATIONSHIP_DRAFT_LIST_STATUSES = [
  "SUBMITTED",
  "REJECTED",
  "APPLIED",
] as const;

@Injectable()
export class RelationshipDraftsService {
  constructor(
    private prisma: PrismaService,
    private capabilities: ProjectCapabilitiesService,
    private auditService: AuditService,
  ) {}

  async submitRelationshipDraft(
    projectId: string,
    dto: RelationshipCreateDraftInput,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:create",
      "draft:submit",
    ]);

    const proposedData = this.normalizeRelationshipCreateInput(dto);
    const source = await this.findEntityBySlug(
      this.prisma,
      projectId,
      proposedData.sourceEntitySlug,
    );
    const target = await this.findEntityBySlug(
      this.prisma,
      projectId,
      proposedData.targetEntitySlug,
    );
    const displayName = this.relationshipDisplayName(
      source,
      proposedData.label,
      target,
    );

    const draft = await this.prisma.draftProposal.create({
      data: {
        projectId,
        targetType: "RELATIONSHIP",
        operation: "CREATE",
        status: "SUBMITTED",
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        validation: {
          sourceEntity: source,
          targetEntity: target,
        } as Prisma.InputJsonValue,
        displayName,
        displaySummary:
          proposedData.description ??
          `${source.name} ${proposedData.label} ${target.name}`,
        submittedByKind: actor.kind,
        submittedByUserId: actor.userId,
        submittedByApiKeyId: actor.apiKeyId,
        submittedByLabel: actor.label,
        sourceKind: actor.sourceKind,
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_RELATIONSHIP_SUBMITTED",
      actor,
      operation: "CREATE",
      targetType: "RELATIONSHIP",
      draftId: draft.id,
      batchId: draft.batchId,
      targetDisplay: displayName,
      summary: `Submitted relationship draft ${displayName}`,
      newData: proposedData,
      metadata: {
        sourceEntitySlug: source.slug,
        targetEntitySlug: target.slug,
      },
    });

    return {
      status: "submitted",
      canonicalApplied: false,
      draftId: draft.id,
      batchId: draft.batchId,
      displayName: this.redactSafeText(draft.displayName),
    };
  }

  async listRelationshipDrafts(
    projectId: string,
    actor: ActorContext,
    status?: string,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:review",
      "audit:read_summary",
    ]);

    const safeStatus = this.normalizeListStatus(status);
    const drafts = await this.prisma.draftProposal.findMany({
      where: {
        projectId,
        targetType: "RELATIONSHIP",
        operation: "CREATE",
        status: safeStatus,
      },
      orderBy: { createdAt: "asc" },
    });

    return drafts.map((draft) => ({
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed: this.toSafeRelationshipPreview(draft),
      safeLinks: this.toReviewSafeLinks(actor.projectSlug, draft.id),
    }));
  }

  async getRelationshipDraftDetail(
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
        targetType: "RELATIONSHIP",
        operation: "CREATE",
      },
      include: {
        auditEvents: { orderBy: { occurredAt: "asc" } },
      },
    });

    if (!draft) {
      throw new NotFoundException("Relationship draft not found");
    }

    return {
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed: this.toSafeRelationshipPreview(draft),
      safeLinks: this.toReviewSafeLinks(actor.projectSlug, draft.id),
      reviewHistory: draft.auditEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorKind: event.actorKind,
        actorLabel: this.redactSafeText(event.actorLabel),
        sourceKind: event.sourceKind,
        summary: this.redactSafeText(event.summary),
        reviewNote: this.getAuditMetadataRationale(
          event.metadata,
          "reviewNote",
        ),
        rejectionReason: this.getAuditMetadataRationale(
          event.metadata,
          "rejectionReason",
        ),
        occurredAt: event.occurredAt,
      })),
    };
  }

  async rejectRelationshipDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { rejectionReason?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, ["draft:reject"]);

    const draft = await this.findRelationshipDraft(projectId, draftId);
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException(
        "Relationship draft is not pending rejection",
      );
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "RELATIONSHIP",
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
        throw new BadRequestException(
          "Relationship draft is not pending rejection",
        );
      }

      const rejected = await tx.draftProposal.findUniqueOrThrow({
        where: { id: draft.id },
      });

      await this.auditService.record(
        {
          projectId,
          eventType: "DRAFT_RELATIONSHIP_REJECTED",
          actor,
          operation: "CREATE",
          targetType: "RELATIONSHIP",
          draftId: draft.id,
          batchId: draft.batchId,
          targetDisplay: draft.displayName,
          summary: `Rejected relationship draft ${draft.displayName}`,
          metadata: { rejectionReason: input?.rejectionReason ?? null },
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
      rejectionReason: this.redactReviewRationale(rejected.rejectionReason),
    };
  }

  async approveAndApplyRelationshipDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { reviewNote?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    const draft = await this.findRelationshipDraft(projectId, draftId);
    this.capabilities.assertCanApproveDraft(actor, draft);

    if (draft.status === "APPLIED") {
      return this.toAppliedResponse(draft);
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException(
        "Relationship draft is not pending approval",
      );
    }

    const proposedData = this.toProposedRelationshipCreate(draft.proposedData);
    const { applied, canonical } = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.draftProposal.updateMany({
          where: {
            id: draft.id,
            projectId,
            targetType: "RELATIONSHIP",
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
          throw new BadRequestException(
            "Relationship draft is not pending approval",
          );
        }

        const source = await this.findEntityBySlug(
          tx,
          projectId,
          proposedData.sourceEntitySlug,
        );
        const target = await this.findEntityBySlug(
          tx,
          projectId,
          proposedData.targetEntitySlug,
        );
        const canonical = await tx.relationship.create({
          data: {
            projectId,
            sourceEntityId: source.id,
            targetEntityId: target.id,
            label: proposedData.label,
            description: proposedData.description,
            ...(proposedData.metadata !== undefined && {
              metadata: proposedData.metadata as Prisma.InputJsonValue,
            }),
            bidirectional: proposedData.bidirectional ?? false,
          },
          include: relationshipInclude,
        });

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
            eventType: "DRAFT_RELATIONSHIP_APPLIED",
            actor,
            operation: "CREATE",
            targetType: "RELATIONSHIP",
            targetId: canonical.id,
            targetModel: "Relationship",
            targetDisplay: this.relationshipDisplayName(
              source,
              canonical.label,
              target,
            ),
            draftId: draft.id,
            batchId: draft.batchId,
            approvalId: applied.id,
            summary: `Applied relationship draft ${draft.displayName}`,
            newData: canonical,
            metadata: { reviewNote: input?.reviewNote ?? null },
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
      reviewNote: this.redactReviewRationale(applied.reviewNote),
    };
  }

  private normalizeListStatus(
    status: string | undefined,
  ): RelationshipDraftListStatus {
    if (status === undefined || status === "") {
      return "SUBMITTED";
    }
    if (
      RELATIONSHIP_DRAFT_LIST_STATUSES.includes(
        status as RelationshipDraftListStatus,
      )
    ) {
      return status as RelationshipDraftListStatus;
    }
    throw new BadRequestException(
      `Relationship draft status must be one of: ${RELATIONSHIP_DRAFT_LIST_STATUSES.join(", ")}`,
    );
  }

  private async findRelationshipDraft(projectId: string, draftId: string) {
    const draft = await this.prisma.draftProposal.findFirst({
      where: {
        id: draftId,
        projectId,
        targetType: "RELATIONSHIP",
        operation: "CREATE",
      },
    });
    if (!draft) {
      throw new NotFoundException("Relationship draft not found");
    }
    return draft;
  }

  private async toAppliedResponse(draft: {
    id: string;
    batchId: string;
    appliedTargetId: string | null;
    reviewNote?: string | null;
  }) {
    if (!draft.appliedTargetId) {
      throw new BadRequestException(
        "Relationship draft is missing applied target",
      );
    }

    const canonical = await this.prisma.relationship.findUniqueOrThrow({
      where: { id: draft.appliedTargetId },
      include: relationshipInclude,
    });

    return {
      status: "applied",
      canonicalApplied: true,
      draftId: draft.id,
      batchId: draft.batchId,
      canonical,
      reviewNote: this.redactReviewRationale(draft.reviewNote),
    };
  }

  private async findEntityBySlug(
    client: Prisma.TransactionClient | PrismaService,
    projectId: string,
    slug: string,
  ): Promise<RelationshipEntityPreview> {
    const entity = await client.entity.findFirst({
      where: { projectId, slug },
      select: entitySelect,
    });
    if (!entity) {
      throw new NotFoundException(`Entity not found: ${slug}`);
    }
    return entity;
  }

  private normalizeRelationshipCreateInput(
    dto: RelationshipCreateDraftInput,
  ): ProposedRelationshipCreate {
    const label = dto.label ?? dto.type;
    if (!label) {
      throw new BadRequestException(
        "Relationship draft requires label or type",
      );
    }
    return {
      sourceEntitySlug: dto.sourceEntitySlug,
      targetEntitySlug: dto.targetEntitySlug,
      label,
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      ...(dto.bidirectional !== undefined && {
        bidirectional: dto.bidirectional,
      }),
    };
  }

  private toProposedRelationshipCreate(
    value: Prisma.JsonValue,
  ): ProposedRelationshipCreate {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Relationship draft payload is invalid");
    }
    const proposed = value as Record<string, Prisma.JsonValue>;
    if (
      typeof proposed.sourceEntitySlug !== "string" ||
      typeof proposed.targetEntitySlug !== "string" ||
      typeof proposed.label !== "string"
    ) {
      throw new BadRequestException("Relationship draft payload is invalid");
    }
    return {
      sourceEntitySlug: proposed.sourceEntitySlug,
      targetEntitySlug: proposed.targetEntitySlug,
      label: proposed.label,
      ...(typeof proposed.description === "string" && {
        description: proposed.description,
      }),
      ...(proposed.metadata &&
        typeof proposed.metadata === "object" &&
        !Array.isArray(proposed.metadata) && {
          metadata: proposed.metadata as Record<string, unknown>,
        }),
      ...(typeof proposed.bidirectional === "boolean" && {
        bidirectional: proposed.bidirectional,
      }),
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
    reviewNote?: string | null;
    rejectionReason?: string | null;
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
      reviewNote: this.redactReviewRationale(draft.reviewNote),
      rejectionReason: this.redactReviewRationale(draft.rejectionReason),
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private toSafeRelationshipPreview(draft: {
    proposedData: Prisma.JsonValue;
    validation: Prisma.JsonValue;
    displayName: string;
    displaySummary: string | null;
  }) {
    const proposed = this.toProposedRelationshipCreate(draft.proposedData);
    const validation =
      draft.validation &&
      typeof draft.validation === "object" &&
      !Array.isArray(draft.validation)
        ? (draft.validation as Record<string, Prisma.JsonValue>)
        : {};

    return {
      title: this.redactSafeText(draft.displayName),
      summary: this.redactSafeText(draft.displaySummary),
      content: {
        sourceEntity: this.redactDomainJsonValue(validation.sourceEntity),
        targetEntity: this.redactDomainJsonValue(validation.targetEntity),
        label: this.redactDomainJsonValue(proposed.label),
        description: this.redactDomainJsonValue(proposed.description),
        metadata: this.redactDomainJsonValue(
          proposed.metadata as Prisma.JsonValue,
        ),
        bidirectional: proposed.bidirectional ?? false,
      },
    };
  }

  private toReviewSafeLinks(projectSlug: string | undefined, draftId: string) {
    const base = `/v1/projects/${projectSlug ?? ""}/drafts/relationships/${draftId}`;
    return {
      review: base,
      approve: `${base}/approve`,
      reject: `${base}/reject`,
      relationships: `/v1/projects/${projectSlug ?? ""}/relationships`,
    };
  }

  private relationshipDisplayName(
    source: RelationshipEntityPreview,
    label: string,
    target: RelationshipEntityPreview,
  ) {
    return `${source.name || source.slug} — ${label} — ${target.name || target.slug}`;
  }

  private getAuditMetadataRationale(
    metadata: Prisma.JsonValue,
    key: "reviewNote" | "rejectionReason",
  ): string | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, Prisma.JsonValue>)[key];
    return this.redactReviewRationale(typeof value === "string" ? value : null);
  }

  private redactReviewRationale(
    value: string | null | undefined,
  ): string | null {
    return value == null ? null : redactInfrastructureSecrets(value);
  }

  private redactSafeText(value: string | null): string | null {
    return value === null ? null : redactInfrastructureSecrets(value);
  }

  private redactDomainJsonValue(value: Prisma.JsonValue | undefined) {
    return redactInfrastructureSecrets(value);
  }

  private assertProjectActor(projectId: string, actor: ActorContext) {
    if (!actor.projectId || actor.projectId !== projectId) {
      throw new BadRequestException(
        "Draft operations require matching project actor context",
      );
    }
  }
}
