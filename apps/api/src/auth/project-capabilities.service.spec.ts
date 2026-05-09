import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import {
  ProjectCapabilitiesService,
  OWNER_CAPABILITIES,
} from "./project-capabilities.service";

describe("ProjectCapabilitiesService", () => {
  const service = new ProjectCapabilitiesService();

  it("grants owner fallback capabilities for Project.ownerId", () => {
    const actor = service.resolveHumanActor({
      project: { id: "project-1", slug: "demo", ownerId: "owner-1" },
      user: { id: "owner-1", email: "owner@example.com" },
    });

    expect(actor).toMatchObject({
      projectId: "project-1",
      projectSlug: "demo",
      kind: "HUMAN",
      sourceKind: "MANUAL",
      userId: "owner-1",
      label: "owner@example.com",
    });
    expect(actor.capabilities).toEqual(
      expect.arrayContaining([...OWNER_CAPABILITIES]),
    );
    expect(actor.capabilities).toEqual(
      expect.arrayContaining([
        "draft:approve",
        "draft:self_approve",
        "canonical:apply_draft",
        "audit:read_detail",
      ]),
    );
  });

  it("resolves DRAFT_WRITE API keys to draft submission capabilities without approval/application", () => {
    const actor = service.resolveApiKeyActor({
      project: { id: "project-1", slug: "demo", ownerId: "owner-1" },
      apiKey: {
        id: "api-key-1",
        name: "Desktop MCP",
        permissions: "DRAFT_WRITE",
        userId: "owner-1",
      },
    });

    expect(actor).toMatchObject({
      projectId: "project-1",
      projectSlug: "demo",
      kind: "AGENT",
      sourceKind: "MCP_AGENT",
      userId: "owner-1",
      apiKeyId: "api-key-1",
      label: "API key: Desktop MCP",
    });
    expect(actor.capabilities).toEqual(
      expect.arrayContaining([
        "project:read",
        "canonical:read",
        "draft:create",
        "draft:submit",
      ]),
    );
    expect(actor.capabilities).not.toContain("draft:approve");
    expect(actor.capabilities).not.toContain("canonical:apply_draft");
  });

  it("requires draft:self_approve when reviewer and submitter are the same API key", () => {
    const actor = service.resolveApiKeyActor({
      project: { id: "project-1", slug: "demo", ownerId: "owner-1" },
      apiKey: {
        id: "api-key-1",
        name: "Desktop MCP",
        permissions: "DRAFT_WRITE",
        userId: "owner-1",
      },
    });

    expect(() =>
      service.assertCanApproveDraft(actor, {
        submittedByUserId: "owner-1",
        submittedByApiKeyId: "api-key-1",
      }),
    ).toThrow(ForbiddenException);
  });
});
