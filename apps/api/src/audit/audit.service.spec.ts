import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AuditService } from "./audit.service";
import type { ActorContext } from "../auth/actor-context";

describe("AuditService", () => {
  it("records a redacted draft.submitted audit event with actor/source/project/draft metadata", async () => {
    const create = vi.fn().mockResolvedValue({ id: "audit-1" });
    const service = new AuditService({ auditEvent: { create } } as never);
    const actor: ActorContext = {
      projectId: "project-1",
      projectSlug: "demo",
      kind: "AGENT",
      sourceKind: "MCP_AGENT",
      userId: "owner-1",
      apiKeyId: "api-key-1",
      label: "API key: desktop agent",
      capabilities: ["draft:create", "draft:submit"],
      requestId: "req-1",
      correlationId: "corr-1",
    };

    await service.record({
      projectId: "project-1",
      eventType: "draft.submitted",
      actor,
      operation: "CREATE",
      targetType: "ENTITY",
      draftId: "draft-1",
      batchId: "batch-1",
      targetDisplay: "Mace Windu",
      summary: "API key: desktop agent submitted entity draft Mace Windu",
      metadata: {
        authorization: "Bearer raw-token-value",
        apiKey: "lrm_1234567890abcdef1234567890abcdef",
        safe: "kept",
      },
      newData: {
        name: "Mace Windu",
        secret: "fictional lore secret should remain in detailed data",
        token: "Bearer of Light should remain prose",
        leakedRawKey: "lrm_1234567890abcdef1234567890abcdef",
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        eventType: "draft.submitted",
        actorKind: "AGENT",
        actorUserId: "owner-1",
        actorApiKeyId: "api-key-1",
        actorLabel: "API key: desktop agent",
        sourceKind: "MCP_AGENT",
        operation: "CREATE",
        targetType: "ENTITY",
        draftId: "draft-1",
        batchId: "batch-1",
        targetDisplay: "Mace Windu",
        requestId: "req-1",
        correlationId: "corr-1",
        summary: "API key: desktop agent submitted entity draft Mace Windu",
        metadata: {
          authorization: "[REDACTED]",
          apiKey: "[REDACTED]",
          safe: "kept",
        },
        newData: {
          name: "Mace Windu",
          secret: "fictional lore secret should remain in detailed data",
          token: "Bearer of Light should remain prose",
          leakedRawKey: "[REDACTED]",
        },
        capabilityContext: {
          capabilities: ["draft:create", "draft:submit"],
        },
      }),
    });
  });

  it("rejects audit writes without project context before persisting", async () => {
    const create = vi.fn();
    const service = new AuditService({ auditEvent: { create } } as never);

    await expect(
      service.record({
        projectId: "",
        eventType: "draft.submitted",
        actor: {
          projectId: "",
          projectSlug: "",
          kind: "AGENT",
          sourceKind: "MCP_AGENT",
          label: "agent",
          capabilities: [],
        },
        summary: "invalid",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });
});
