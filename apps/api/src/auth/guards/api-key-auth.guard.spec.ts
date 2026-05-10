import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { ApiKeyAuthGuard } from "./api-key-auth.guard";

function contextForRequest(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

function guardWithPermission(permission: string) {
  const validate = vi.fn().mockResolvedValue({
    id: "api-key-1",
    name: "Desktop MCP",
    userId: "owner-1",
    permissions: permission,
    project: { id: "project-1", slug: "demo", ownerId: "owner-1" },
  });

  return {
    guard: new ApiKeyAuthGuard({ validate } as never),
    validate,
  };
}

describe("ApiKeyAuthGuard API key mutation modes", () => {
  it("allows DRAFT_WRITE keys to mutate draft endpoints", async () => {
    const { guard } = guardWithPermission("DRAFT_WRITE");
    const request = {
      cookies: {},
      headers: { authorization: "Bearer lrm_test" },
      method: "POST",
      path: "/projects/demo/drafts",
      params: { projectSlug: "demo" },
    };

    await expect(guard.canActivate(contextForRequest(request))).resolves.toBe(
      true,
    );
    expect(request).toMatchObject({
      user: {
        apiKey: {
          id: "api-key-1",
          projectId: "project-1",
          projectSlug: "demo",
          permissions: "DRAFT_WRITE",
        },
      },
    });
  });

  it("rejects DRAFT_WRITE keys from canonical mutations", async () => {
    const { guard } = guardWithPermission("DRAFT_WRITE");
    const request = {
      cookies: {},
      headers: { authorization: "Bearer lrm_test" },
      method: "POST",
      path: "/projects/demo/entities",
      params: { projectSlug: "demo" },
    };

    await expect(
      guard.canActivate(contextForRequest(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows CANONICAL_WRITE keys to mutate canonical endpoints", async () => {
    const { guard } = guardWithPermission("CANONICAL_WRITE");
    const request = {
      cookies: {},
      headers: { authorization: "Bearer lrm_test" },
      method: "PATCH",
      path: "/projects/demo/entities/entity-1",
      params: { projectSlug: "demo" },
    };

    await expect(guard.canActivate(contextForRequest(request))).resolves.toBe(
      true,
    );
  });

  it("treats deprecated DRAFT_WRITE_SELF_APPROVE rows as canonical-write compatibility", async () => {
    const { guard } = guardWithPermission("DRAFT_WRITE_SELF_APPROVE");
    const request = {
      cookies: {},
      headers: { authorization: "Bearer lrm_test" },
      method: "PATCH",
      path: "/projects/demo/entities/entity-1",
      params: { projectSlug: "demo" },
    };

    await expect(guard.canActivate(contextForRequest(request))).resolves.toBe(
      true,
    );
  });
});
