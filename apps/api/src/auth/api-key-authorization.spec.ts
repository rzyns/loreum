import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import {
  createTestApp,
  createAuthenticatedUser,
  cleanDatabase,
} from "../test/helpers";

describe.sequential("API key authorization boundary (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authCookie: string;
  let csrfToken: string;
  let projectASlug: string;
  let projectBSlug: string;

  beforeAll(async () => {
    ({ app, prisma, module } = await createTestApp());
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const auth = await createAuthenticatedUser(prisma, module);
    authCookie = auth.cookie;
    csrfToken = auth.csrfToken;

    projectASlug = await createProject("Project Alpha");
    projectBSlug = await createProject("Project Beta");
  });

  async function createProject(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/v1/projects")
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name })
      .expect(201);

    return res.body.slug;
  }

  async function createApiKey(
    projectSlug: string,
    permissions: "READ_ONLY" | "DRAFT_WRITE" | "CANONICAL_WRITE",
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/api-keys`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name: `${permissions} test key`, permissions })
      .expect(201);

    expect(res.body.key).toEqual(expect.any(String));
    return res.body.key;
  }

  function bearer(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  it("allows a READ_ONLY API key to read its project but rejects representative mutations", async () => {
    const apiKey = await createApiKey(projectASlug, "READ_ONLY");

    const readRes = await request(app.getHttpServer())
      .get(`/v1/projects/${projectASlug}`)
      .set(bearer(apiKey))
      .expect(200);
    expect(readRes.body.slug).toBe(projectASlug);

    await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/entities`)
      .set(bearer(apiKey))
      .send({ type: "CHARACTER", name: "Forbidden Entity" })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/v1/projects/${projectASlug}`)
      .set(bearer(apiKey))
      .send({ description: "should not change" })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/v1/projects/${projectASlug}`)
      .set(bearer(apiKey))
      .expect(403);
  });

  it("enforces draft-write and canonical-write tiers inside project scope", async () => {
    const draftWriteKey = await createApiKey(projectASlug, "DRAFT_WRITE");

    const draftRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/drafts/entities`)
      .set(bearer(draftWriteKey))
      .send({ type: "CHARACTER", name: "Draft Write Proposal" })
      .expect(201);

    expect(draftRes.body).toMatchObject({
      canonicalApplied: false,
      proposedSlug: "draft-write-proposal",
    });

    await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/entities`)
      .set(bearer(draftWriteKey))
      .send({ type: "CHARACTER", name: "Forbidden Canonical Entity" })
      .expect(403);

    const canonicalWriteKey = await createApiKey(
      projectASlug,
      "CANONICAL_WRITE",
    );
    const canonicalCreateRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/entities`)
      .set(bearer(canonicalWriteKey))
      .send({ type: "CHARACTER", name: "Canonical Write Entity" })
      .expect(201);
    expect(canonicalCreateRes.body.slug).toBe("canonical-write-entity");

    await request(app.getHttpServer())
      .get(`/v1/projects/${projectBSlug}`)
      .set(bearer(canonicalWriteKey))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/v1/projects/${projectBSlug}/entities`)
      .set(bearer(canonicalWriteKey))
      .send({ type: "CHARACTER", name: "Cross Project Entity" })
      .expect(403);
  });

  it("filters account-level project lists to the API key scoped project", async () => {
    const apiKey = await createApiKey(projectASlug, "READ_ONLY");

    const res = await request(app.getHttpServer())
      .get("/v1/projects")
      .set(bearer(apiKey))
      .expect(200);

    expect(res.body.map((project: { slug: string }) => project.slug)).toEqual([
      projectASlug,
    ]);
    expect(
      res.body.map((project: { slug: string }) => project.slug),
    ).not.toContain(projectBSlug);
  });

  it("rejects project-global account-level writes for project-scoped API keys", async () => {
    const apiKey = await createApiKey(projectASlug, "CANONICAL_WRITE");

    await request(app.getHttpServer())
      .post("/v1/projects")
      .set(bearer(apiKey))
      .send({ name: "API Key Created Project" })
      .expect(403);
  });

  it("rejects deprecated or legacy compatibility modes for newly created API keys", async () => {
    for (const permissions of ["READ_WRITE", "DRAFT_WRITE_SELF_APPROVE"]) {
      await request(app.getHttpServer())
        .post(`/v1/projects/${projectASlug}/api-keys`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: `${permissions} rejected key`, permissions })
        .expect(400);
    }
  });

  it("preserves JWT-cookie session project lists", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/projects")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.map((project: { slug: string }) => project.slug)).toEqual(
      expect.arrayContaining([projectASlug, projectBSlug]),
    );
  });

  it("preserves JWT-cookie session writes", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/entities`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ type: "CHARACTER", name: "Session Entity" })
      .expect(201);

    expect(res.body.slug).toBe("session-entity");
  });
});
