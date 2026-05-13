import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { generateUniqueSlug, slugify } from "../common/utils/slug";
import { CreateEntityDto } from "./dto/create-entity.dto";
import {
  EntityUpdateDraftPatch,
  SubmitEntityUpdateDraftDto,
} from "./dto/submit-entity-update-draft.dto";

type EntityBaseField = keyof EntityUpdateDraftPatch;
type EntityBaseSnapshot = Partial<Record<EntityBaseField, string | null>>;
type EntityUpdateDiffRow = {
  field: EntityBaseField;
  label: string;
  previous: Prisma.JsonValue;
  proposed: Prisma.JsonValue;
  current?: Prisma.JsonValue;
  changed: boolean;
  conflict: boolean;
  conflictReason?: "canonical_changed" | "target_missing" | "slug_changed";
};

const ENTITY_UPDATE_BASE_FIELDS = [
  "name",
  "summary",
  "description",
  "backstory",
  "secrets",
  "notes",
  "imageUrl",
] as const satisfies readonly EntityBaseField[];

const ENTITY_UPDATE_FIELD_LABELS: Record<EntityBaseField, string> = {
  name: "Name",
  summary: "Summary",
  description: "Description",
  backstory: "Backstory",
  secrets: "Secrets",
  notes: "Notes",
  imageUrl: "Image URL",
};

const ENTITY_UPDATE_NULLABLE_FIELDS = new Set<EntityBaseField>([
  "summary",
  "description",
  "backstory",
  "secrets",
  "notes",
  "imageUrl",
]);

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

  async submitEntityUpdateDraft(
    projectId: string,
    entitySlug: string,
    dto: SubmitEntityUpdateDraftDto,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:create",
      "draft:submit",
    ]);

    const entity = await this.prisma.entity.findUnique({
      where: { projectId_slug: { projectId, slug: entitySlug } },
      include: listInclude,
    });
    if (!entity) {
      throw new NotFoundException("Entity not found");
    }

    const patch = this.parseEntityUpdatePatch(dto.patch);
    const previousData = this.snapshotEntityBaseFields(
      entity,
      Object.keys(patch) as EntityBaseField[],
    );
    const diff = this.buildEntityUpdateDiff(previousData, patch);
    if (!diff.some((row) => row.changed)) {
      throw new BadRequestException(
        "Entity update draft patch must change at least one field",
      );
    }

    const proposedData = {
      entitySlug,
      patch,
    };
    const draft = await this.prisma.draftProposal.create({
      data: {
        projectId,
        targetType: "ENTITY",
        operation: "UPDATE",
        targetId: entity.id,
        status: "SUBMITTED",
        proposedData: proposedData as Prisma.InputJsonValue,
        previousData: previousData as Prisma.InputJsonValue,
        validation: { diff } as unknown as Prisma.InputJsonValue,
        displayName: `Update ${entity.name}`,
        displaySummary: `Update ${Object.keys(patch).length} base entity field${Object.keys(patch).length === 1 ? "" : "s"}`,
        submittedByKind: actor.kind,
        submittedByUserId: actor.userId,
        submittedByApiKeyId: actor.apiKeyId,
        submittedByLabel: actor.label,
        sourceKind: actor.sourceKind,
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_ENTITY_UPDATE_SUBMITTED",
      actor,
      operation: "UPDATE",
      targetType: "ENTITY",
      targetId: entity.id,
      targetModel: "Entity",
      targetDisplay: entity.name,
      draftId: draft.id,
      batchId: draft.batchId,
      summary: `Submitted entity update draft ${entity.name}`,
      oldData: previousData,
      newData: patch,
      diff,
    });

    return {
      status: "submitted",
      canonicalApplied: false,
      draftId: draft.id,
      batchId: draft.batchId,
      targetId: entity.id,
      changedFieldCount: diff.filter((row) => row.changed).length,
      displayName: draft.displayName,
    };
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
      archived?: string;
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
    const statusFilter = filters.status?.toUpperCase();
    const archivedFilter = filters.archived?.toLowerCase();
    const archivedOnly =
      archivedFilter === "only" || statusFilter === "ARCHIVED";
    const where: Prisma.DraftProposalWhereInput = {
      projectId,
      targetType: this.parseEnumFilter(
        filters.targetType,
        DraftTargetType,
        DraftTargetType.ENTITY,
      ),
      operation: filters.operation
        ? this.parseEnumFilter(
            filters.operation,
            DraftOperation,
            DraftOperation.CREATE,
          )
        : { in: [DraftOperation.CREATE, DraftOperation.UPDATE] },
    };

    if (archivedOnly) {
      where.archivedAt = { not: null };
      where.status =
        statusFilter && statusFilter !== "ARCHIVED"
          ? this.parseEnumFilter(
              filters.status,
              DraftStatus,
              DraftStatus.REJECTED,
            )
          : { in: [DraftStatus.REJECTED, DraftStatus.APPLIED] };
    } else {
      where.archivedAt = null;
      where.status = this.parseEnumFilter(
        filters.status,
        DraftStatus,
        DraftStatus.SUBMITTED,
      );
    }

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
        operation: { in: ["CREATE", "UPDATE"] },
      },
      include: {
        auditEvents: { orderBy: { occurredAt: "asc" } },
      },
    });

    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }

    const appliedCanonical = draft.appliedTargetId
      ? await this.prisma.entity.findFirst({
          where: { id: draft.appliedTargetId, projectId },
          select: { id: true, slug: true, name: true },
        })
      : null;

    return {
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed:
        draft.operation === "UPDATE"
          ? await this.toSafeEntityUpdateProposedSummary(draft)
          : this.toSafeProposedSummary(draft.proposedData),
      safeLinks: this.toReviewSafeLinks(
        actor.projectSlug,
        draft,
        appliedCanonical,
      ),
      reviewHistory: draft.auditEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorKind: event.actorKind,
        actorLabel: redactInfrastructureSecrets(event.actorLabel),
        sourceKind: event.sourceKind,
        summary: redactInfrastructureSecrets(event.summary),
        reviewNote: this.getAuditMetadataRationale(
          event.metadata,
          "reviewNote",
        ),
        rejectionReason: this.getAuditMetadataRationale(
          event.metadata,
          "rejectionReason",
        ),
        archiveReason: this.getAuditMetadataRationale(
          event.metadata,
          "archiveReason",
        ),
        unarchiveReason: this.getAuditMetadataRationale(
          event.metadata,
          "unarchiveReason",
        ),
        occurredAt: event.occurredAt,
      })),
    };
  }

  async archiveEntityDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { reason?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    this.assertHumanReviewActor(actor);

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
    if (draft.status !== "REJECTED" && draft.status !== "APPLIED") {
      throw new BadRequestException(
        "Only terminal entity drafts can be archived",
      );
    }
    if (draft.archivedAt) {
      throw new BadRequestException("Entity draft is already archived");
    }

    const archiveReason = input?.reason?.trim() || null;
    const archived = await this.prisma.$transaction(async (tx) => {
      const archivedAt = new Date();
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "ENTITY",
          operation: "CREATE",
          status: { in: ["REJECTED", "APPLIED"] },
          archivedAt: null,
        },
        data: {
          archivedAt,
          archivedByUserId: actor.userId,
          archiveReason,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("Entity draft cannot be archived");
      }

      const archived = await tx.draftProposal.findUniqueOrThrow({
        where: { id: draft.id },
      });
      await this.auditService.record(
        {
          projectId,
          eventType: "DRAFT_ENTITY_ARCHIVED",
          actor,
          operation: "CREATE",
          targetType: "ENTITY",
          draftId: draft.id,
          batchId: draft.batchId,
          targetDisplay: draft.displayName,
          summary: `Archived terminal entity draft ${draft.displayName}`,
          metadata: {
            archiveReason,
            previousArchivedAt: draft.archivedAt,
            newArchivedAt: archivedAt,
            draftStatus: draft.status,
            archiveVisibilityScope: "default_review_history_only",
          },
        },
        { client: tx },
      );
      return archived;
    });

    return {
      status: "archived",
      draftId: archived.id,
      batchId: archived.batchId,
      draftStatus: archived.status,
      archivedAt: archived.archivedAt,
      archiveReason: this.redactReviewRationale(archived.archiveReason),
    };
  }

  async unarchiveEntityDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { reason?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    this.assertHumanReviewActor(actor);

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
    if (draft.status !== "REJECTED" && draft.status !== "APPLIED") {
      throw new BadRequestException(
        "Only terminal entity drafts can be restored",
      );
    }
    if (!draft.archivedAt) {
      throw new BadRequestException("Entity draft is not archived");
    }

    const unarchiveReason = input?.reason?.trim() || null;
    const restored = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "ENTITY",
          operation: "CREATE",
          status: { in: ["REJECTED", "APPLIED"] },
          archivedAt: { not: null },
        },
        data: {
          archivedAt: null,
          archivedByUserId: null,
          archiveReason: null,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("Entity draft cannot be restored");
      }

      const restored = await tx.draftProposal.findUniqueOrThrow({
        where: { id: draft.id },
      });
      await this.auditService.record(
        {
          projectId,
          eventType: "DRAFT_ENTITY_UNARCHIVED",
          actor,
          operation: "CREATE",
          targetType: "ENTITY",
          draftId: draft.id,
          batchId: draft.batchId,
          targetDisplay: draft.displayName,
          summary: `Restored terminal entity draft ${draft.displayName}`,
          metadata: {
            unarchiveReason,
            previousArchivedAt: draft.archivedAt,
            newArchivedAt: null,
            draftStatus: draft.status,
            archiveVisibilityScope: "default_review_history_only",
          },
        },
        { client: tx },
      );
      return restored;
    });

    return {
      status: "unarchived",
      draftId: restored.id,
      batchId: restored.batchId,
      draftStatus: restored.status,
      archivedAt: restored.archivedAt,
      archiveReason: this.redactReviewRationale(restored.archiveReason),
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
        operation: { in: ["CREATE", "UPDATE"] },
      },
    });

    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }
    this.capabilities.assertCanApproveDraft(actor, draft);

    if (draft.operation === "UPDATE") {
      return this.approveAndApplyEntityUpdateDraft(
        projectId,
        draft,
        actor,
        input,
      );
    }

    if (draft.status === "APPLIED") {
      return this.toAppliedResponse(draft);
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending approval");
    }

    const proposedData = this.toCreateEntityDto(draft.proposedData);
    const reviewNote = this.redactReviewRationale(input?.reviewNote);
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
            reviewNote,
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
            metadata: { reviewNote },
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
        operation: { in: ["CREATE", "UPDATE"] },
      },
    });
    if (!draft) {
      throw new NotFoundException("Entity draft not found");
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending rejection");
    }

    const rejectionReason = this.redactReviewRationale(input?.rejectionReason);

    const rejected = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "ENTITY",
          operation: draft.operation,
          status: { in: ["SUBMITTED", "DRAFT"] },
        },
        data: {
          status: "REJECTED",
          rejectionReason,
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
          eventType:
            draft.operation === "UPDATE"
              ? "DRAFT_ENTITY_UPDATE_REJECTED"
              : "DRAFT_ENTITY_REJECTED",
          actor,
          operation: draft.operation,
          targetType: "ENTITY",
          targetId: draft.targetId ?? undefined,
          targetModel: draft.targetId ? "Entity" : undefined,
          draftId: draft.id,
          batchId: draft.batchId,
          targetDisplay: draft.displayName,
          summary:
            draft.operation === "UPDATE"
              ? `Rejected entity update draft ${draft.displayName}`
              : `Rejected entity draft ${draft.displayName}`,
          metadata: { rejectionReason },
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

  private async approveAndApplyEntityUpdateDraft(
    projectId: string,
    draft: {
      id: string;
      batchId: string;
      targetId: string | null;
      status: string;
      proposedData: Prisma.JsonValue;
      previousData: Prisma.JsonValue | null;
      reviewNote?: string | null;
      appliedTargetId: string | null;
      failureCode: string | null;
    },
    actor: ActorContext,
    input?: { reviewNote?: string },
  ) {
    if (draft.status === "APPLIED") {
      return this.toAppliedResponse(draft);
    }
    if (draft.status === "APPLICATION_FAILED") {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: draft.failureCode ?? "ENTITY_UPDATE_CONFLICT",
        message: "Entity update draft application previously failed",
      });
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException("Entity draft is not pending approval");
    }
    if (!draft.targetId) {
      throw new BadRequestException("Entity update draft is missing target");
    }
    const targetId = draft.targetId;

    const patch = this.extractEntityUpdatePatch(draft.proposedData);
    const previousData = this.extractEntityBaseSnapshot(draft.previousData);
    const reviewNote = this.redactReviewRationale(input?.reviewNote);

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "ENTITY",
          operation: "UPDATE",
          status: { in: ["SUBMITTED", "DRAFT"] },
        },
        data: {
          status: "APPROVED",
          reviewNote,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException("Entity draft is not pending approval");
      }

      const current = await tx.entity.findUnique({
        where: { id: targetId },
        include: listInclude,
      });
      if (!current) {
        const diff = this.buildEntityUpdateConflictDiff(
          previousData,
          patch,
          null,
        );
        await this.markEntityUpdateApplicationFailedWithClient(
          tx,
          projectId,
          draft,
          actor,
          input,
          diff,
        );
        return {
          conflict: true as const,
          message: "Entity update draft target no longer exists",
          diff,
        };
      }

      const conflictDiff = this.buildEntityUpdateConflictDiff(
        previousData,
        patch,
        current,
      );
      if (conflictDiff.some((row) => row.conflict)) {
        await this.markEntityUpdateApplicationFailedWithClient(
          tx,
          projectId,
          draft,
          actor,
          input,
          conflictDiff,
        );
        return {
          conflict: true as const,
          message: "Canonical entity changed since draft submission",
          diff: conflictDiff,
        };
      }

      const updateData: Prisma.EntityUpdateManyMutationInput = {};
      this.assignEntityUpdateData(updateData, patch);
      if (typeof patch.name === "string") {
        updateData.slug = await generateUniqueSlug(
          tx as unknown as PrismaService,
          "entity",
          patch.name,
          projectId,
          current.id,
        );
      }

      const updated = await tx.entity.updateMany({
        where: this.buildEntityUpdateAtomicWhere(
          projectId,
          current.id,
          previousData,
          Object.keys(patch) as EntityBaseField[],
        ),
        data: updateData,
      });
      if (updated.count !== 1) {
        const latest = await tx.entity.findUnique({
          where: { id: current.id },
          include: listInclude,
        });
        const diff = this.buildEntityUpdateConflictDiff(
          previousData,
          patch,
          latest,
        );
        await this.markEntityUpdateApplicationFailedWithClient(
          tx,
          projectId,
          draft,
          actor,
          input,
          diff,
        );
        return {
          conflict: true as const,
          message: latest
            ? "Canonical entity changed since draft submission"
            : "Entity update draft target no longer exists",
          diff,
        };
      }

      const canonical = await tx.entity.findUniqueOrThrow({
        where: { id: current.id },
        include: listInclude,
      });
      const applied = await tx.draftProposal.update({
        where: { id: draft.id },
        data: {
          status: "APPLIED",
          appliedTargetId: canonical.id,
          appliedAt: new Date(),
          validation: {
            diff: conflictDiff,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const newData = this.snapshotEntityBaseFields(
        canonical,
        Object.keys(patch) as EntityBaseField[],
      );

      await this.auditService.record(
        {
          projectId,
          eventType: "DRAFT_ENTITY_UPDATE_APPLIED",
          actor,
          operation: "UPDATE",
          targetType: "ENTITY",
          targetId: canonical.id,
          targetModel: "Entity",
          targetDisplay: canonical.name,
          draftId: draft.id,
          batchId: draft.batchId,
          approvalId: applied.id,
          summary: `Applied entity update draft ${canonical.name}`,
          oldData: previousData,
          newData,
          diff: conflictDiff,
          metadata: { reviewNote },
        },
        { client: tx },
      );

      return { conflict: false as const, applied, canonical };
    });

    if (result.conflict) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "ENTITY_UPDATE_CONFLICT",
        message: result.message,
        conflicts: this.redactEntityUpdateDiffRows(result.diff),
      });
    }

    return {
      status: "applied",
      canonicalApplied: true,
      draftId: result.applied.id,
      batchId: result.applied.batchId,
      canonical: result.canonical,
      reviewNote: this.redactReviewRationale(result.applied.reviewNote),
    };
  }

  private async markEntityUpdateApplicationFailed(
    projectId: string,
    draft: { id: string; batchId: string; targetId: string | null },
    actor: ActorContext,
    input: { reviewNote?: string } | undefined,
    diff: EntityUpdateDiffRow[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.markEntityUpdateApplicationFailedWithClient(
        tx,
        projectId,
        draft,
        actor,
        input,
        diff,
      );
    });
  }

  private async markEntityUpdateApplicationFailedWithClient(
    client: Prisma.TransactionClient,
    projectId: string,
    draft: { id: string; batchId: string; targetId: string | null },
    actor: ActorContext,
    input: { reviewNote?: string } | undefined,
    diff: EntityUpdateDiffRow[],
  ) {
    const reviewNote = this.redactReviewRationale(input?.reviewNote);

    await client.draftProposal.updateMany({
      where: {
        id: draft.id,
        projectId,
        targetType: "ENTITY",
        operation: "UPDATE",
        status: { in: ["SUBMITTED", "DRAFT", "APPROVED"] },
      },
      data: {
        status: "APPLICATION_FAILED",
        failureCode: "ENTITY_UPDATE_CONFLICT",
        failureMessage: "Canonical entity changed since draft submission",
        reviewNote,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
        validation: { diff } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.auditService.record(
      {
        projectId,
        eventType: "DRAFT_ENTITY_UPDATE_APPLICATION_FAILED",
        outcome: "FAILURE",
        actor,
        operation: "UPDATE",
        targetType: "ENTITY",
        targetId: draft.targetId ?? undefined,
        targetModel: "Entity",
        draftId: draft.id,
        batchId: draft.batchId,
        summary: "Entity update draft application failed with conflict",
        diff,
        metadata: {
          reviewNote,
          failureCode: "ENTITY_UPDATE_CONFLICT",
        },
      },
      { client },
    );
  }

  private assignEntityUpdateData(
    updateData: Prisma.EntityUpdateManyMutationInput,
    patch: EntityUpdateDraftPatch,
  ) {
    if (typeof patch.name === "string") {
      updateData.name = patch.name;
    }
    if (patch.summary !== undefined) {
      updateData.summary = patch.summary;
    }
    if (patch.description !== undefined) {
      updateData.description = patch.description;
    }
    if (patch.backstory !== undefined) {
      updateData.backstory = patch.backstory;
    }
    if (patch.secrets !== undefined) {
      updateData.secrets = patch.secrets;
    }
    if (patch.notes !== undefined) {
      updateData.notes = patch.notes;
    }
    if (patch.imageUrl !== undefined) {
      updateData.imageUrl = patch.imageUrl;
    }
  }

  private buildEntityUpdateAtomicWhere(
    projectId: string,
    targetId: string,
    previousData: EntityBaseSnapshot,
    fields: EntityBaseField[],
  ): Prisma.EntityWhereInput {
    const where: Prisma.EntityWhereInput = { id: targetId, projectId };
    for (const field of fields) {
      this.assignEntityUpdateWhere(where, field, previousData[field] ?? null);
    }
    return where;
  }

  private assignEntityUpdateWhere(
    where: Prisma.EntityWhereInput,
    field: EntityBaseField,
    value: string | null,
  ) {
    switch (field) {
      case "name":
        where.name = typeof value === "string" ? value : { equals: "" };
        return;
      case "summary":
        where.summary = value;
        return;
      case "description":
        where.description = value;
        return;
      case "backstory":
        where.backstory = value;
        return;
      case "secrets":
        where.secrets = value;
        return;
      case "notes":
        where.notes = value;
        return;
      case "imageUrl":
        where.imageUrl = value;
        return;
    }
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
    reviewNote?: string | null;
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
      reviewNote: this.redactReviewRationale(draft.reviewNote),
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
    archivedAt?: Date | null;
    archiveReason?: string | null;
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
      archive: {
        archived: Boolean(draft.archivedAt),
        archivedAt: draft.archivedAt,
        archiveReason: this.redactReviewRationale(draft.archiveReason),
      },
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private getAuditMetadataRationale(
    metadata: Prisma.JsonValue,
    key: "reviewNote" | "rejectionReason" | "archiveReason" | "unarchiveReason",
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
      operation?: string;
      targetId?: string | null;
    },
    appliedCanonical: { id: string; slug: string; name: string } | null,
  ) {
    const base = `/v1/projects/${projectSlug ?? ""}/drafts/entities/${draft.id}`;
    const proposed =
      draft.proposedData &&
      typeof draft.proposedData === "object" &&
      !Array.isArray(draft.proposedData)
        ? (draft.proposedData as Record<string, Prisma.JsonValue>)
        : {};
    const slug =
      draft.operation === "UPDATE"
        ? typeof proposed.entitySlug === "string"
          ? proposed.entitySlug
          : undefined
        : typeof proposed.slug === "string"
          ? proposed.slug
          : undefined;
    const safeSlug = slug ? this.redactSafeText(slug) : undefined;
    const canonicalSlug =
      slug && safeSlug === slug && slugify(slug) === slug ? slug : undefined;

    const appliedCanonicalSlug =
      appliedCanonical &&
      this.redactSafeText(appliedCanonical.slug) === appliedCanonical.slug &&
      slugify(appliedCanonical.slug) === appliedCanonical.slug
        ? appliedCanonical.slug
        : undefined;

    return {
      review: base,
      approve: `${base}/approve`,
      reject: `${base}/reject`,
      proposedCanonical: canonicalSlug
        ? `/v1/projects/${projectSlug ?? ""}/entities/${canonicalSlug}`
        : null,
      appliedCanonical:
        appliedCanonical && appliedCanonicalSlug
          ? {
              id: appliedCanonical.id,
              slug: appliedCanonicalSlug,
              name:
                this.redactSafeText(appliedCanonical.name) ??
                "Redacted canonical entity",
              href: `/v1/projects/${projectSlug ?? ""}/entities/${appliedCanonicalSlug}`,
            }
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
    return redactInfrastructureSecrets(value);
  }

  private parseEntityUpdatePatch(value: unknown): EntityUpdateDraftPatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(
        "Entity update draft patch must be an object",
      );
    }
    const input = value as Record<string, unknown>;
    const allowed = new Set<string>(ENTITY_UPDATE_BASE_FIELDS);
    const patch: EntityUpdateDraftPatch = {};
    for (const [rawKey, rawValue] of Object.entries(input)) {
      if (!allowed.has(rawKey)) {
        throw new BadRequestException(
          `Unsupported entity update draft field: ${rawKey}`,
        );
      }
      const field = rawKey as EntityBaseField;
      if (rawValue === null) {
        if (!ENTITY_UPDATE_NULLABLE_FIELDS.has(field)) {
          throw new BadRequestException(
            `Entity update draft field ${field} cannot be null`,
          );
        }
        patch[field] = null;
        continue;
      }
      if (typeof rawValue !== "string") {
        throw new BadRequestException(
          `Entity update draft field ${field} must be a string or null`,
        );
      }
      if (field === "name" && rawValue.trim().length === 0) {
        throw new BadRequestException(
          "Entity update draft name cannot be blank",
        );
      }
      patch[field] = rawValue;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        "Entity update draft patch must include at least one field",
      );
    }
    return patch;
  }

  private extractEntityUpdatePatch(
    value: Prisma.JsonValue,
  ): EntityUpdateDraftPatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Entity update draft payload is invalid");
    }
    return this.parseEntityUpdatePatch(
      (value as Record<string, Prisma.JsonValue>).patch,
    );
  }

  private extractEntityBaseSnapshot(
    value: Prisma.JsonValue | null,
  ): EntityBaseSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(
        "Entity update draft previousData is invalid",
      );
    }
    const snapshot: EntityBaseSnapshot = {};
    const source = value as Record<string, Prisma.JsonValue>;
    for (const field of ENTITY_UPDATE_BASE_FIELDS) {
      if (source[field] !== undefined) {
        const fieldValue = source[field];
        if (fieldValue !== null && typeof fieldValue !== "string") {
          throw new BadRequestException(
            "Entity update draft previousData is invalid",
          );
        }
        snapshot[field] = fieldValue as string | null;
      }
    }
    return snapshot;
  }

  private snapshotEntityBaseFields(
    entity: Record<string, unknown>,
    fields: EntityBaseField[],
  ): EntityBaseSnapshot {
    const snapshot: EntityBaseSnapshot = {};
    for (const field of fields) {
      const value = entity[field];
      snapshot[field] = value === undefined ? null : (value as string | null);
    }
    return snapshot;
  }

  private buildEntityUpdateDiff(
    previous: EntityBaseSnapshot,
    patch: EntityUpdateDraftPatch,
  ): EntityUpdateDiffRow[] {
    return (Object.keys(patch) as EntityBaseField[]).map((field) => {
      const prior = previous[field] ?? null;
      const proposed = patch[field] ?? null;
      return {
        field,
        label: ENTITY_UPDATE_FIELD_LABELS[field],
        previous: prior,
        proposed,
        changed: prior !== proposed,
        conflict: false,
      };
    });
  }

  private buildEntityUpdateConflictDiff(
    previous: EntityBaseSnapshot,
    patch: EntityUpdateDraftPatch,
    current: Record<string, unknown> | null,
  ): EntityUpdateDiffRow[] {
    return (Object.keys(patch) as EntityBaseField[]).map((field) => {
      const prior = previous[field] ?? null;
      const proposed = patch[field] ?? null;
      const currentValue = current
        ? ((current[field] ?? null) as string | null)
        : null;
      const conflict = !current || currentValue !== prior;
      return {
        field,
        label: ENTITY_UPDATE_FIELD_LABELS[field],
        previous: prior,
        proposed,
        current: currentValue,
        changed: prior !== proposed,
        conflict,
        ...(conflict
          ? {
              conflictReason: current
                ? ("canonical_changed" as const)
                : ("target_missing" as const),
            }
          : {}),
      };
    });
  }

  private redactEntityUpdateDiffRows(rows: EntityUpdateDiffRow[]) {
    return rows.map((row) => ({
      ...row,
      previous: this.redactJsonValue(row.previous),
      proposed: this.redactJsonValue(row.proposed),
      ...(row.current !== undefined
        ? { current: this.redactJsonValue(row.current) }
        : {}),
    }));
  }

  private async toSafeEntityUpdateProposedSummary(draft: {
    displayName: string;
    targetId: string | null;
    proposedData: Prisma.JsonValue;
    previousData: Prisma.JsonValue | null;
    validation: Prisma.JsonValue;
  }) {
    const proposed =
      draft.proposedData &&
      typeof draft.proposedData === "object" &&
      !Array.isArray(draft.proposedData)
        ? (draft.proposedData as Record<string, Prisma.JsonValue>)
        : {};
    const patch = this.extractEntityUpdatePatch(draft.proposedData);
    const previous = this.extractEntityBaseSnapshot(draft.previousData);
    const target = draft.targetId
      ? await this.prisma.entity.findUnique({
          where: { id: draft.targetId },
          select: { id: true, slug: true, type: true },
        })
      : null;
    const validation =
      draft.validation &&
      typeof draft.validation === "object" &&
      !Array.isArray(draft.validation)
        ? (draft.validation as Record<string, Prisma.JsonValue>)
        : {};
    const rawDiff = Array.isArray(validation.diff)
      ? (validation.diff as unknown as EntityUpdateDiffRow[])
      : this.buildEntityUpdateDiff(previous, patch);
    const diff = this.redactEntityUpdateDiffRows(rawDiff);
    return {
      title: this.redactSafeText(draft.displayName),
      target: {
        id: draft.targetId,
        slugAtSubmission: this.redactJsonValue(proposed.entitySlug),
        currentSlug: target?.slug ?? null,
        type: target?.type ?? null,
      },
      content: {
        changedFieldCount: diff.filter((row) => row.changed).length,
        conflictCount: diff.filter((row) => row.conflict).length,
        diff,
      },
    };
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

  private assertHumanReviewActor(actor: ActorContext) {
    if (actor.kind !== "HUMAN") {
      throw new ForbiddenException(
        "Only human project reviewers can archive drafts",
      );
    }
    this.capabilities.assertCapabilities(actor, ["draft:review"]);
  }
}
