import { describe, expect, it, vi } from "vitest";
import { ApiKeysService } from "./api-keys.service";

describe("ApiKeysService API key modes", () => {
  it("defaults newly created API keys to draft-write mode", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "api-key-1",
      name: "Desktop MCP",
      permissions: "DRAFT_WRITE",
      expiresAt: null,
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
    });
    const service = new ApiKeysService({ apiKey: { create } } as never);

    const result = await service.create("project-1", "owner-1", {
      name: "Desktop MCP",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "project-1",
          userId: "owner-1",
          name: "Desktop MCP",
          permissions: "DRAFT_WRITE",
        }),
      }),
    );
    expect(result).toMatchObject({ permissions: "DRAFT_WRITE" });
    expect(result.key).toMatch(/^lrm_[a-f0-9]{64}$/);
  });

  it("preserves an explicit canonical-write mode for reviewed internal keys", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "api-key-1",
      name: "Internal admin",
      permissions: "CANONICAL_WRITE",
      expiresAt: null,
      createdAt: new Date("2026-05-09T00:00:00.000Z"),
    });
    const service = new ApiKeysService({ apiKey: { create } } as never);

    await service.create("project-1", "owner-1", {
      name: "Internal admin",
      permissions: "CANONICAL_WRITE",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permissions: "CANONICAL_WRITE" }),
      }),
    );
  });
});
