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
import { generateUniqueSlug } from "../common/utils/slug";
import { PrismaService } from "../prisma/prisma.service";
import { CreateLoreArticleDto } from "./dto/create-lore-article.dto";

const LORE_ARTICLE_DRAFT_LIST_STATUSES = [
  "SUBMITTED",
  "REJECTED",
  "APPLIED",
] as const;

const loreArticleInclude = {
  entities: {
    include: {
      entity: {
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
        },
      },
    },
  },
  loreArticleTags: {
    include: {
      tag: { select: { id: true, name: true, color: true } },
    },
  },
} as const;

type LoreArticleDraftListStatus =
  (typeof LORE_ARTICLE_DRAFT_LIST_STATUSES)[number];

type ProposedLoreArticleCreate = {
  title: string;
  content: string;
  category?: string;
  canonStatus?: "draft" | "staging" | "provisional" | "canon";
  entitySlugs?: string[];
  tags?: string[];
};

type EntityPreview = {
  id: string;
  name: string;
  slug: string;
  type: string;
};

type TagPreview = {
  id: string;
  name: string;
  color: string | null;
};

@Injectable()
export class LoreArticleDraftsService {
  constructor(
    private prisma: PrismaService,
    private capabilities: ProjectCapabilitiesService,
    private auditService: AuditService,
  ) {}

  async submitLoreArticleDraft(
    projectId: string,
    dto: CreateLoreArticleDto,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, [
      "draft:create",
      "draft:submit",
    ]);

    const proposedData = this.normalizeLoreArticleCreateInput(dto);
    const validation = await this.resolveValidationPreview(
      this.prisma,
      projectId,
      proposedData,
    );
    const displaySummary = this.toContentPreview(proposedData.content, 180);

    const draft = await this.prisma.draftProposal.create({
      data: {
        projectId,
        targetType: "LORE_ARTICLE",
        operation: "CREATE",
        status: "SUBMITTED",
        proposedData: proposedData as unknown as Prisma.InputJsonValue,
        validation: validation as unknown as Prisma.InputJsonValue,
        displayName: proposedData.title,
        displaySummary,
        submittedByKind: actor.kind,
        submittedByUserId: actor.userId,
        submittedByApiKeyId: actor.apiKeyId,
        submittedByLabel: actor.label,
        sourceKind: actor.sourceKind,
      },
    });

    await this.auditService.record({
      projectId,
      eventType: "DRAFT_LORE_ARTICLE_SUBMITTED",
      actor,
      operation: "CREATE",
      targetType: "LORE_ARTICLE",
      draftId: draft.id,
      batchId: draft.batchId,
      targetDisplay: draft.displayName,
      summary: `Submitted lore article draft ${draft.displayName}`,
      newData: proposedData,
      metadata: {
        entitySlugs: proposedData.entitySlugs ?? [],
        tags: proposedData.tags ?? [],
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

  async listLoreArticleDrafts(
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
        targetType: "LORE_ARTICLE",
        operation: "CREATE",
        status: safeStatus,
      },
      orderBy: { createdAt: "asc" },
    });

    return drafts.map((draft) => ({
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed: this.toSafeLoreArticlePreview(draft),
      safeLinks: this.toReviewSafeLinks(actor.projectSlug, draft.id),
    }));
  }

  async getLoreArticleDraftDetail(
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
        targetType: "LORE_ARTICLE",
        operation: "CREATE",
      },
      include: {
        auditEvents: { orderBy: { occurredAt: "asc" } },
      },
    });

    if (!draft) {
      throw new NotFoundException("Lore article draft not found");
    }

    return {
      ...this.toReviewSummary(draft),
      batchId: draft.batchId,
      proposed: this.toSafeLoreArticlePreview(draft),
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

  async rejectLoreArticleDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { rejectionReason?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilities.assertCapabilities(actor, ["draft:reject"]);

    const draft = await this.findLoreArticleDraft(projectId, draftId);
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException(
        "Lore article draft is not pending rejection",
      );
    }

    const rejected = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.draftProposal.updateMany({
        where: {
          id: draft.id,
          projectId,
          targetType: "LORE_ARTICLE",
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
          "Lore article draft is not pending rejection",
        );
      }

      const rejected = await tx.draftProposal.findUniqueOrThrow({
        where: { id: draft.id },
      });

      await this.auditService.record(
        {
          projectId,
          eventType: "DRAFT_LORE_ARTICLE_REJECTED",
          actor,
          operation: "CREATE",
          targetType: "LORE_ARTICLE",
          draftId: draft.id,
          batchId: draft.batchId,
          targetDisplay: draft.displayName,
          summary: `Rejected lore article draft ${draft.displayName}`,
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

  async approveAndApplyLoreArticleDraft(
    projectId: string,
    draftId: string,
    actor: ActorContext,
    input?: { reviewNote?: string },
  ) {
    this.assertProjectActor(projectId, actor);
    const draft = await this.findLoreArticleDraft(projectId, draftId);
    this.capabilities.assertCanApproveDraft(actor, draft);

    if (draft.status === "APPLIED") {
      return this.toAppliedResponse(draft);
    }
    if (draft.status !== "SUBMITTED" && draft.status !== "DRAFT") {
      throw new BadRequestException(
        "Lore article draft is not pending approval",
      );
    }

    const proposedData = this.toProposedLoreArticleCreate(draft.proposedData);
    const { applied, canonical } = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.draftProposal.updateMany({
          where: {
            id: draft.id,
            projectId,
            targetType: "LORE_ARTICLE",
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
            "Lore article draft is not pending approval",
          );
        }

        const slug = await generateUniqueSlug(
          tx as unknown as PrismaService,
          "loreArticle",
          proposedData.title,
          projectId,
        );
        const { entityIds, tagIds } = await this.resolveCanonicalReferences(
          tx,
          projectId,
          proposedData,
        );
        const canonical = await tx.loreArticle.create({
          data: {
            projectId,
            title: proposedData.title,
            slug,
            content: proposedData.content,
            category: proposedData.category,
            ...(proposedData.canonStatus !== undefined
              ? { canonStatus: proposedData.canonStatus }
              : {}),
            entities: {
              create: entityIds.map((entityId) => ({ entityId })),
            },
            loreArticleTags: {
              create: tagIds.map((tagId) => ({ tagId })),
            },
          },
          include: loreArticleInclude,
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
            eventType: "DRAFT_LORE_ARTICLE_APPLIED",
            actor,
            operation: "CREATE",
            targetType: "LORE_ARTICLE",
            targetId: canonical.id,
            targetModel: "LoreArticle",
            targetDisplay: canonical.title,
            draftId: draft.id,
            batchId: draft.batchId,
            approvalId: applied.id,
            summary: `Applied lore article draft ${draft.displayName}`,
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
  ): LoreArticleDraftListStatus {
    if (status === undefined || status === "") {
      return "SUBMITTED";
    }
    if (
      LORE_ARTICLE_DRAFT_LIST_STATUSES.includes(
        status as LoreArticleDraftListStatus,
      )
    ) {
      return status as LoreArticleDraftListStatus;
    }
    throw new BadRequestException(
      `Lore article draft status must be one of: ${LORE_ARTICLE_DRAFT_LIST_STATUSES.join(", ")}`,
    );
  }

  private async findLoreArticleDraft(projectId: string, draftId: string) {
    const draft = await this.prisma.draftProposal.findFirst({
      where: {
        id: draftId,
        projectId,
        targetType: "LORE_ARTICLE",
        operation: "CREATE",
      },
    });
    if (!draft) {
      throw new NotFoundException("Lore article draft not found");
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
        "Lore article draft is missing applied target",
      );
    }

    const canonical = await this.prisma.loreArticle.findUniqueOrThrow({
      where: { id: draft.appliedTargetId },
      include: loreArticleInclude,
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

  private normalizeLoreArticleCreateInput(
    dto: CreateLoreArticleDto,
  ): ProposedLoreArticleCreate {
    return {
      title: dto.title,
      content: dto.content,
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.canonStatus !== undefined && { canonStatus: dto.canonStatus }),
      ...(dto.entitySlugs !== undefined && { entitySlugs: dto.entitySlugs }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
    };
  }

  private toProposedLoreArticleCreate(
    value: Prisma.JsonValue,
  ): ProposedLoreArticleCreate {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Lore article draft payload is invalid");
    }
    const proposed = value as Record<string, Prisma.JsonValue>;
    if (
      typeof proposed.title !== "string" ||
      typeof proposed.content !== "string"
    ) {
      throw new BadRequestException("Lore article draft payload is invalid");
    }
    return {
      title: proposed.title,
      content: proposed.content,
      ...(typeof proposed.category === "string" && {
        category: proposed.category,
      }),
      ...(this.isLoreArticleCanonStatus(proposed.canonStatus) && {
        canonStatus: proposed.canonStatus,
      }),
      ...(this.isStringArray(proposed.entitySlugs) && {
        entitySlugs: proposed.entitySlugs,
      }),
      ...(this.isStringArray(proposed.tags) && { tags: proposed.tags }),
    };
  }

  private async resolveValidationPreview(
    client: Prisma.TransactionClient | PrismaService,
    projectId: string,
    proposed: ProposedLoreArticleCreate,
  ) {
    const [entities, tags] = await Promise.all([
      this.findEntitiesBySlugs(client, projectId, proposed.entitySlugs ?? []),
      this.findTagsByNames(client, projectId, proposed.tags ?? []),
    ]);
    return { entities, tags };
  }

  private async resolveCanonicalReferences(
    client: Prisma.TransactionClient,
    projectId: string,
    proposed: ProposedLoreArticleCreate,
  ) {
    const [entities, tags] = await Promise.all([
      this.findEntitiesBySlugs(client, projectId, proposed.entitySlugs ?? []),
      this.findTagsByNames(client, projectId, proposed.tags ?? []),
    ]);
    return {
      entityIds: entities.map((entity) => entity.id),
      tagIds: tags.map((tag) => tag.id),
    };
  }

  private async findEntitiesBySlugs(
    client: Prisma.TransactionClient | PrismaService,
    projectId: string,
    slugs: string[],
  ): Promise<EntityPreview[]> {
    if (slugs.length === 0) return [];
    const entities = await client.entity.findMany({
      where: { projectId, slug: { in: slugs } },
      select: { id: true, name: true, slug: true, type: true },
    });
    const found = new Set(entities.map((entity) => entity.slug));
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new NotFoundException(`Entity not found: ${missing.join(", ")}`);
    }
    return slugs.map(
      (slug) => entities.find((entity) => entity.slug === slug)!,
    );
  }

  private async findTagsByNames(
    client: Prisma.TransactionClient | PrismaService,
    projectId: string,
    names: string[],
  ): Promise<TagPreview[]> {
    if (names.length === 0) return [];
    const tags = await client.tag.findMany({
      where: { projectId, name: { in: names } },
      select: { id: true, name: true, color: true },
    });
    const found = new Set(tags.map((tag) => tag.name));
    const missing = names.filter((name) => !found.has(name));
    if (missing.length > 0) {
      throw new NotFoundException(`Tag not found: ${missing.join(", ")}`);
    }
    return names.map((name) => tags.find((tag) => tag.name === name)!);
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

  private toSafeLoreArticlePreview(draft: {
    proposedData: Prisma.JsonValue;
    validation: Prisma.JsonValue;
    displayName: string;
    displaySummary: string | null;
  }) {
    const proposed = this.toProposedLoreArticleCreate(draft.proposedData);
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
        title: this.redactDomainJsonValue(proposed.title),
        contentPreview: this.toContentPreview(proposed.content, 240),
        category: this.redactDomainJsonValue(proposed.category),
        canonStatus: proposed.canonStatus ?? "provisional",
        entitySlugs: proposed.entitySlugs ?? [],
        tags: proposed.tags ?? [],
        entities: this.redactDomainJsonValue(validation.entities),
        tagDetails: this.redactDomainJsonValue(validation.tags),
      },
    };
  }

  private toReviewSafeLinks(projectSlug: string | undefined, draftId: string) {
    const base = `/v1/projects/${projectSlug ?? ""}/drafts/lore-articles/${draftId}`;
    return {
      review: base,
      approve: `${base}/approve`,
      reject: `${base}/reject`,
      loreArticles: `/v1/projects/${projectSlug ?? ""}/lore`,
    };
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

  private toContentPreview(value: string, maxLength: number) {
    const redacted = redactInfrastructureSecrets(value);
    if (redacted.length <= maxLength) return redacted;
    return `${redacted.slice(0, maxLength - 1)}…`;
  }

  private isStringArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  }

  private isLoreArticleCanonStatus(
    value: unknown,
  ): value is "draft" | "staging" | "provisional" | "canon" {
    return (
      value === "draft" ||
      value === "staging" ||
      value === "provisional" ||
      value === "canon"
    );
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
