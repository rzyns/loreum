import { BadRequestException, Injectable } from "@nestjs/common";
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
