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

describe("Lore (integration)", () => {
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
      .send({ name: "Lore World" });
    projectSlug = proj.body.slug;
  });

  const base = () => `/v1/projects/${projectSlug}/lore`;
  const draftBase = () => `/v1/projects/${projectSlug}/drafts/lore-articles`;

  async function createApiKey(
    permissions: "READ_ONLY" | "DRAFT_WRITE" | "CANONICAL_WRITE",
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/api-keys`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name: `${permissions} lore key`, permissions })
      .expect(201);

    expect(res.body.key).toEqual(expect.any(String));
    return res.body.key;
  }

  function bearer(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}` };
  }

  async function createEntity(name: string) {
    return request(app.getHttpServer())
      .post(`/v1/projects/${projectSlug}/entities`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ type: "LOCATION", name })
      .expect(201);
  }

  it("lets a draft-write API key stage a lore article draft with bounded redacted preview and no canonical rows", async () => {
    const draftWriteKey = await createApiKey("DRAFT_WRITE");
    await createEntity("Vault of Keys");
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: projectSlug },
      select: { id: true },
    });
    await prisma.tag.create({
      data: { projectId: project.id, name: "secrets", color: "#111111" },
    });

    const longSecretContent = `prefix sk-proj-1234567890abcdefghijklmnop ${"A".repeat(240)} ${"B".repeat(240)}`;
    const submitted = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({
        title: "Vault Protocol",
        content: longSecretContent,
        category: "rituals",
        canonStatus: "staging",
        entitySlugs: ["vault-of-keys"],
        tags: ["secrets"],
      })
      .expect(201);

    expect(submitted.body).toMatchObject({
      status: "submitted",
      canonicalApplied: false,
      displayName: "Vault Protocol",
    });
    expect(submitted.body.draftId).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post(base())
      .set(bearer(draftWriteKey))
      .send({ title: "Forbidden Canonical Lore", content: "Nope" })
      .expect(403);
    await expect(prisma.loreArticle.count()).resolves.toBe(0);
    await expect(prisma.loreArticleEntity.count()).resolves.toBe(0);
    await expect(prisma.loreArticleTag.count()).resolves.toBe(0);

    const detail = await request(app.getHttpServer())
      .get(`${draftBase()}/${submitted.body.draftId}`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(200);

    expect(detail.body).toMatchObject({
      targetType: "LORE_ARTICLE",
      operation: "CREATE",
      canonicalApplied: false,
      proposed: {
        title: "Vault Protocol",
        summary: expect.stringContaining("[REDACTED]"),
        content: {
          title: "Vault Protocol",
          category: "rituals",
          canonStatus: "staging",
          entitySlugs: ["vault-of-keys"],
          tags: ["secrets"],
        },
      },
      safeLinks: {
        review: `${draftBase()}/${submitted.body.draftId}`,
        approve: `${draftBase()}/${submitted.body.draftId}/approve`,
        reject: `${draftBase()}/${submitted.body.draftId}/reject`,
        loreArticles: base(),
      },
    });
    expect(detail.body.proposed.content.contentPreview).toContain("[REDACTED]");
    expect(
      detail.body.proposed.content.contentPreview.length,
    ).toBeLessThanOrEqual(260);
    expect(JSON.stringify(detail.body)).not.toContain("sk-pro");
    expect(detail.body).not.toHaveProperty("proposedData");
  });

  it("lets reviewers discover, reject, and approve lore article drafts while applying references at approval time", async () => {
    const draftWriteKey = await createApiKey("DRAFT_WRITE");
    const reviewerKey = await createApiKey("READ_ONLY");
    await createEntity("Moon Library");
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: projectSlug },
      select: { id: true },
    });
    await prisma.tag.create({
      data: { projectId: project.id, name: "myths", color: "#333333" },
    });

    const rejectedDraft = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({ title: "Bad Lore", content: "bad" })
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
    await expect(prisma.loreArticle.count()).resolves.toBe(0);

    const submitted = await request(app.getHttpServer())
      .post(draftBase())
      .set(bearer(draftWriteKey))
      .send({
        title: "Moon Archive",
        content:
          "A safe myth with sk-proj-1234567890abcdefghijklmnop in draft text.",
        category: "archives",
        entitySlugs: ["moon-library"],
        tags: ["myths"],
      })
      .expect(201);

    const defaultList = await request(app.getHttpServer())
      .get(draftBase())
      .set(bearer(reviewerKey))
      .expect(200);
    expect(defaultList.body).toHaveLength(1);
    expect(defaultList.body[0]).toMatchObject({
      id: submitted.body.draftId,
      status: "SUBMITTED",
      displayName: "Moon Archive",
      proposed: {
        content: {
          contentPreview: "A safe myth with [REDACTED] in draft text.",
        },
      },
    });
    expect(JSON.stringify(defaultList.body)).not.toContain("sk-pro");

    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Moon Archive", content: "canonical collision" })
      .expect(201);

    const applied = await request(app.getHttpServer())
      .post(`${draftBase()}/${submitted.body.draftId}/approve`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ reviewNote: "approved with sk-proj-1234567890abcdefghijklmnop" })
      .expect(200);

    expect(applied.body).toMatchObject({
      status: "applied",
      canonicalApplied: true,
      reviewNote: "approved with [REDACTED]",
      canonical: {
        title: "Moon Archive",
        slug: "moon-archive-1",
        category: "archives",
        canonStatus: "provisional",
      },
    });
    await expect(prisma.loreArticle.count()).resolves.toBe(2);
    await expect(prisma.loreArticleEntity.count()).resolves.toBe(1);
    await expect(prisma.loreArticleTag.count()).resolves.toBe(1);

    const appliedAgain = await request(app.getHttpServer())
      .post(`${draftBase()}/${submitted.body.draftId}/approve`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ reviewNote: "second apply should not duplicate" })
      .expect(200);
    expect(appliedAgain.body).toMatchObject({
      status: "applied",
      canonicalApplied: true,
      canonical: { id: applied.body.canonical.id, slug: "moon-archive-1" },
    });
    await expect(prisma.loreArticle.count()).resolves.toBe(2);

    const appliedList = await request(app.getHttpServer())
      .get(`${draftBase()}?status=APPLIED`)
      .set(bearer(reviewerKey))
      .expect(200);
    expect(appliedList.body.map((draft: { id: string }) => draft.id)).toEqual([
      submitted.body.draftId,
    ]);

    await expect(
      prisma.auditEvent.findMany({
        where: { draftId: submitted.body.draftId },
        orderBy: { occurredAt: "asc" },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "DRAFT_LORE_ARTICLE_SUBMITTED" }),
        expect.objectContaining({ eventType: "DRAFT_LORE_ARTICLE_APPLIED" }),
      ]),
    );
  });

  it("creates a lore article with a conservative provisional canon status by default", async () => {
    const res = await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "The One Ring",
        content: "Forged by Sauron in the fires of Mount Doom.",
        category: "artifacts",
      })
      .expect(201);

    expect(res.body).toMatchObject({
      title: "The One Ring",
      slug: "the-one-ring",
      category: "artifacts",
      canonStatus: "provisional",
    });
  });

  it("creates and updates a lore article with an explicit canon status", async () => {
    const created = await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Founding Myth",
        content: "In the beginning...",
        canonStatus: "draft",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: "Founding Myth",
      slug: "founding-myth",
      canonStatus: "draft",
    });

    const updated = await request(app.getHttpServer())
      .patch(`${base()}/founding-myth`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ canonStatus: "canon" })
      .expect(200);

    expect(updated.body.canonStatus).toBe("canon");
  });

  it("rejects unknown lore article canon statuses", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({
        title: "Rumor Ledger",
        content: "Contradictory notes.",
        canonStatus: "rumored",
      })
      .expect(400);
  });

  it("lists lore articles", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Article A", content: "Content A" });
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Article B", content: "Content B" });

    const res = await request(app.getHttpServer())
      .get(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(200);

    expect(res.body).toHaveLength(2);
  });

  it("gets a lore article by slug", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "History of Gondor", content: "Long ago..." });

    const res = await request(app.getHttpServer())
      .get(`${base()}/history-of-gondor`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(200);

    expect(res.body.title).toBe("History of Gondor");
  });

  it("updates a lore article", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Draft Article", content: "v1" });

    const res = await request(app.getHttpServer())
      .patch(`${base()}/draft-article`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ content: "v2 revised" })
      .expect(200);

    expect(res.body.content).toBe("v2 revised");
  });

  it("deletes a lore article", async () => {
    await request(app.getHttpServer())
      .post(base())
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ title: "Temp", content: "delete me" });

    await request(app.getHttpServer())
      .delete(`${base()}/temp`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(204);

    await request(app.getHttpServer())
      .get(`${base()}/temp`)
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .expect(404);
  });
});
