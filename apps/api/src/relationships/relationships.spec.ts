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

describe("Relationships (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authCookie: string;
  let csrfToken: string;
  let projectSlug: string;

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

    const proj = await request(app.getHttpServer())
      .post("/v1/projects")
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name: "Rel World" });
    projectSlug = proj.body.slug;

    // Create two entities to relate
    await request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/entities`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ type: "CHARACTER", name: "Gandalf" });
    await request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/entities`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ type: "CHARACTER", name: "Frodo" });
  });

  const base = () => `/v1/projects/${projectSlug}/relationships`;
  const draftBase = () => `/v1/projects/${projectSlug}/drafts/relationships`;

  async function createApiKey(
    permissions: "READ_ONLY" | "DRAFT_WRITE" | "CANONICAL_WRITE",
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/api-keys`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name: `${permissions} relationship key`, permissions })
      .expect(201);

    expect(res.body.key).toEqual(expect.any(String));
    return res.body.key;
  }

  function bearer(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  it("creates a relationship between entities", async () => {
    const res = await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Mentor",
        description: "Guides Frodo",
      })
      .expect(201);

    expect(res.body).toMatchObject({ label: "Mentor" });
    expect(res.body.id).toBeDefined();
  });

  it("lets a draft-write API key stage a relationship draft without canonical write and exposes safe preview", async () => {
    const draftWriteKey = await createApiKey("DRAFT_WRITE");

    const submitted = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        type: "Mentor",
        description: "Guides Frodo with sk-proj-abcdefghijklmnopqrstuvwxyz",
        metadata: { api_key: "lrm_1234567890abcdefghijklmnop" },
        bidirectional: true,
      })
      .expect(201);

    expect(submitted.body).toMatchObject({
      status: "submitted",
      canonicalApplied: false,
      displayName: "Gandalf — Mentor — Frodo",
    });
    expect(submitted.body.draftId).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post(base())
      .set(bearer(draftWriteKey))
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Forbidden Canonical Relationship",
      })
      .expect(403);

    await expect(prisma.relationship.count()).resolves.toBe(0);

    const detail = await request(app.getHttpServer())
      .get(`${draftBase()}/${submitted.body.draftId}`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(200);

    expect(detail.body).toMatchObject({
      targetType: "RELATIONSHIP",
      operation: "CREATE",
      canonicalApplied: false,
      proposed: {
        title: "Gandalf — Mentor — Frodo",
        content: {
          sourceEntity: { slug: "gandalf", name: "Gandalf" },
          targetEntity: { slug: "frodo", name: "Frodo" },
          label: "Mentor",
          description: "Guides Frodo with [REDACTED]",
          metadata: { api_key: "[REDACTED]" },
          bidirectional: true,
        },
      },
      safeLinks: {
        review: `${draftBase()}/${submitted.body.draftId}`,
        approve: `${draftBase()}/${submitted.body.draftId}/approve`,
        reject: `${draftBase()}/${submitted.body.draftId}/reject`,
        relationships: base(),
      },
    });
  });

  it("rejects or applies staged relationship drafts without duplicate canonical relationships", async () => {
    const draftWriteKey = await createApiKey("DRAFT_WRITE");

    const rejectedDraft = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Rejected Mentor",
      })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post(`${draftBase()}/${rejectedDraft.body.draftId}/reject`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ rejectionReason: "contains lrm_1234567890abcdefghijklmnop" })
      .expect(200);

    expect(rejected.body).toMatchObject({
      status: "rejected",
      canonicalApplied: false,
      rejectionReason: "contains [REDACTED]",
    });
    await expect(prisma.relationship.count()).resolves.toBe(0);

    const approvedDraft = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Applied Mentor",
        description: "Approved path",
      })
      .expect(201);

    const applied = await request(app.getHttpServer())
      .post(`${draftBase()}/${approvedDraft.body.draftId}/approve`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ reviewNote: "approved with sk-proj-abcdefghijklmnopqrstuvwxyz" })
      .expect(200);

    expect(applied.body).toMatchObject({
      status: "applied",
      canonicalApplied: true,
      reviewNote: "approved with [REDACTED]",
      canonical: { label: "Applied Mentor" },
    });
    await expect(prisma.relationship.count()).resolves.toBe(1);

    const appliedAgain = await request(app.getHttpServer())
      .post(`${draftBase()}/${approvedDraft.body.draftId}/approve`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ reviewNote: "second apply should not duplicate" })
      .expect(200);

    expect(appliedAgain.body).toMatchObject({
      status: "applied",
      canonicalApplied: true,
      canonical: { id: applied.body.canonical.id, label: "Applied Mentor" },
    });
    await expect(prisma.relationship.count()).resolves.toBe(1);

    await expect(
      prisma.auditEvent.findMany({
        where: { draftId: approvedDraft.body.draftId },
        orderBy: { occurredAt: "asc" },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "DRAFT_RELATIONSHIP_SUBMITTED" }),
        expect.objectContaining({ eventType: "DRAFT_RELATIONSHIP_APPLIED" }),
      ]),
    );
  });

  it("lists relationships for a project", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Mentor",
      });

    const res = await request(app.getHttpServer())
      .get(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("deletes a relationship", async () => {
    const created = await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        sourceEntitySlug: "gandalf",
        targetEntitySlug: "frodo",
        label: "Mentor",
      });

    await request(app.getHttpServer())
      .delete(`${base()}/${created.body.id}`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(204);
  });
});
