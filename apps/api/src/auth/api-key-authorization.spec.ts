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

describe("API key authorization boundary (integration)", () => {
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
    permissions: "READ_ONLY" | "READ_WRITE",
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

  it("allows a READ_WRITE API key to mutate only the project it was issued for", async () => {
    const apiKey = await createApiKey(projectASlug, "READ_WRITE");

    const createRes = await request(app.getHttpServer())
      .post(`/v1/projects/${projectASlug}/entities`)
      .set(bearer(apiKey))
      .send({ type: "CHARACTER", name: "Allowed Entity" })
      .expect(201);
    expect(createRes.body.slug).toBe("allowed-entity");

    await request(app.getHttpServer())
      .get(`/v1/projects/${projectBSlug}`)
      .set(bearer(apiKey))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/v1/projects/${projectBSlug}/entities`)
      .set(bearer(apiKey))
      .send({ type: "CHARACTER", name: "Cross Project Entity" })
      .expect(403);
  });

  it("rejects project-global account-level writes for project-scoped API keys", async () => {
    const apiKey = await createApiKey(projectASlug, "READ_WRITE");

    await request(app.getHttpServer())
      .post("/v1/projects")
      .set(bearer(apiKey))
      .send({ name: "API Key Created Project" })
      .expect(403);
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
