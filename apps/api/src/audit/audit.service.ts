import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ActorContext } from "../auth/actor-context";
import { redactInfrastructureSecrets } from "./audit-redaction";

type AuditRecordInput = {
  projectId: string;
  eventType: string;
  actor: ActorContext;
  outcome?: "SUCCESS" | "FAILURE";
  operation?:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "LINK"
    | "UNLINK"
    | "REORDER"
    | "BULK_IMPORT";
  targetType?:
    | "ENTITY"
    | "RELATIONSHIP"
    | "LORE_ARTICLE"
    | "TIMELINE_EVENT"
    | "STORYBOARD_RECORD"
    | "PROJECT_METADATA";
  targetId?: string;
  targetModel?: string;
  targetDisplay?: string;
  draftId?: string;
  batchId?: string;
  approvalId?: string;
  summary: string;
  oldData?: unknown;
  newData?: unknown;
  diff?: unknown;
  metadata?: unknown;
  capabilityContext?: unknown;
  requestId?: string;
  correlationId?: string;
  causationId?: string;
  streamKey?: string;
  streamVersion?: number;
};

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async listProjectActivity(
    projectId: string,
    actor: ActorContext,
    filters: { limit?: string; offset?: string } = {},
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilitiesAssert(actor, ["audit:read_summary"]);

    const limit = this.parsePageNumber(filters.limit, 50, 100);
    const offset = this.parsePageNumber(
      filters.offset,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const where: Prisma.AuditEventWhereInput = { projectId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return {
      items: items.map((event) => this.toActivitySummary(event)),
      page: { limit, offset, total },
    };
  }

  async getAuditDetail(
    projectId: string,
    auditEventId: string,
    actor: ActorContext,
  ) {
    this.assertProjectActor(projectId, actor);
    this.capabilitiesAssert(actor, ["audit:read_detail"]);

    const event = await this.prisma.auditEvent.findFirst({
      where: { id: auditEventId, projectId },
    });
    if (!event) {
      return null;
    }
    return {
      ...this.toActivitySummary(event),
      oldData: redactInfrastructureSecrets(event.oldData),
      newData: redactInfrastructureSecrets(event.newData),
      diff: redactInfrastructureSecrets(event.diff),
      metadata: redactInfrastructureSecrets(event.metadata),
      capabilityContext: redactInfrastructureSecrets(event.capabilityContext),
      requestId: event.requestId,
      correlationId: event.correlationId,
      causationId: event.causationId,
      schemaVersion: event.schemaVersion,
      streamKey: event.streamKey,
      streamVersion: event.streamVersion,
      committedAt: event.committedAt,
    };
  }

  async record(
    input: AuditRecordInput,
    options?: { client?: Prisma.TransactionClient },
  ) {
    if (!input.projectId || !input.actor.projectId) {
      throw new BadRequestException("Audit events require project context");
    }
    if (input.projectId !== input.actor.projectId) {
      throw new BadRequestException(
        "Audit event project does not match actor context",
      );
    }

    const client = options?.client ?? this.prisma;

    return client.auditEvent.create({
      data: {
        projectId: input.projectId,
        eventType: input.eventType,
        outcome: input.outcome ?? "SUCCESS",
        actorKind: input.actor.kind,
        actorUserId: input.actor.userId,
        actorApiKeyId: input.actor.apiKeyId,
        actorLabel: input.actor.label,
        sourceKind: input.actor.sourceKind,
        operation: input.operation,
        targetType: input.targetType,
        targetId: input.targetId,
        targetModel: input.targetModel,
        targetDisplay: input.targetDisplay,
        draftId: input.draftId,
        batchId: input.batchId,
        approvalId: input.approvalId,
        summary: input.summary,
        oldData: this.toJsonOrUndefined(
          this.redactDomainPayload(input.oldData),
        ),
        newData: this.toJsonOrUndefined(
          this.redactDomainPayload(input.newData),
        ),
        diff: this.toJsonOrUndefined(this.redactDomainPayload(input.diff)),
        metadata: this.toJsonOrDefault(
          redactInfrastructureSecrets(input.metadata),
        ),
        capabilityContext: this.toJsonOrDefault(
          redactInfrastructureSecrets(
            input.capabilityContext ?? {
              capabilities: input.actor.capabilities,
            },
          ),
        ),
        requestId: input.requestId ?? input.actor.requestId,
        correlationId: input.correlationId ?? input.actor.correlationId,
        causationId: input.causationId,
        streamKey: input.streamKey,
        streamVersion: input.streamVersion,
      },
    });
  }

  private assertProjectActor(projectId: string, actor: ActorContext) {
    if (!actor.projectId || actor.projectId !== projectId) {
      throw new BadRequestException(
        "Audit operations require matching project actor context",
      );
    }
  }

  private capabilitiesAssert(actor: ActorContext, required: string[]) {
    const missing = required.filter(
      (capability) => !actor.capabilities.includes(capability),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing project capability: ${missing.join(", ")}`,
      );
    }
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

  private toActivitySummary(event: {
    id: string;
    eventType: string;
    outcome: string;
    actorKind: string;
    actorLabel: string;
    sourceKind: string;
    operation: string | null;
    targetType: string | null;
    targetId: string | null;
    targetModel: string | null;
    targetDisplay: string | null;
    draftId: string | null;
    batchId: string | null;
    approvalId: string | null;
    occurredAt: Date;
  }) {
    const safeTarget = this.redactSummaryText(
      event.targetDisplay ?? event.targetType?.toLowerCase() ?? "item",
    );
    return {
      id: event.id,
      eventType: event.eventType,
      outcome: event.outcome,
      actorKind: event.actorKind,
      actorLabel: this.redactSummaryText(event.actorLabel),
      sourceKind: event.sourceKind,
      operation: event.operation,
      targetType: event.targetType,
      targetId: event.targetId,
      targetModel: event.targetModel,
      targetDisplay: safeTarget,
      draftId: event.draftId,
      batchId: event.batchId,
      approvalId: event.approvalId,
      summary: this.safeSummaryFor(event, safeTarget),
      occurredAt: event.occurredAt,
    };
  }

  private safeSummaryFor(
    event: {
      eventType: string;
      outcome: string;
      actorKind: string;
      targetType: string | null;
    },
    targetDisplay: string,
  ) {
    const actor = "Actor";
    const target = this.targetNoun(event.targetType);
    const action = this.lifecycleActionFor(event.eventType);
    if (event.outcome === "FAILURE") {
      return `${actor} failed to ${action} ${target} ${targetDisplay}`;
    }
    return `${actor} ${this.pastTenseLifecycleAction(action)} ${target} ${targetDisplay}`;
  }

  private lifecycleActionFor(eventType: string) {
    if (eventType.includes("_SUBMIT") || eventType.includes("_SUBMITTED")) {
      return "propose";
    }
    if (eventType.includes("_APPLY") || eventType.includes("_APPLIED")) {
      return "apply";
    }
    if (eventType.includes("_REJECT") || eventType.includes("_REJECTED")) {
      return "reject";
    }
    return "change";
  }

  private pastTenseLifecycleAction(action: string) {
    switch (action) {
      case "propose":
        return "proposed";
      case "apply":
        return "applied";
      case "reject":
        return "rejected";
      default:
        return "changed";
    }
  }

  private targetNoun(targetType: string | null) {
    switch (targetType) {
      case "ENTITY":
        return "entity";
      case "RELATIONSHIP":
        return "relationship";
      case "LORE_ARTICLE":
        return "lore article";
      case "TIMELINE_EVENT":
        return "timeline event";
      case "STORYBOARD_RECORD":
        return "storyboard record";
      case "PROJECT_METADATA":
        return "project metadata";
      default:
        return "item";
    }
  }

  private redactSummaryText(value: string) {
    return redactInfrastructureSecrets(value);
  }

  private redactDomainPayload(value: unknown) {
    return redactInfrastructureSecrets(value, {
      redactInfrastructureKeys: false,
    });
  }

  private toJsonOrDefault(value: unknown): Prisma.InputJsonValue {
    return (value ?? {}) as Prisma.InputJsonValue;
  }

  private toJsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
    return value === undefined ? undefined : (value as Prisma.InputJsonValue);
  }
}
