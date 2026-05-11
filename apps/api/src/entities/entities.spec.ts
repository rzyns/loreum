import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import * as crypto from "crypto";
import { INestApplication } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ApiKeysService } from "../api-keys/api-keys.service";
import {
  createTestApp,
  createAuthenticatedUser,
  cleanDatabase,
} from "../test/helpers";

describe("Entities (integration)", () => {
  type ApiKeyPermission =
    | "READ_ONLY"
    | "DRAFT_WRITE"
    | "DRAFT_WRITE_SELF_APPROVE"
    | "CANONICAL_WRITE"
    | "READ_WRITE";

  const projectReadPermissions: ApiKeyPermission[] = [
    "READ_ONLY",
    "DRAFT_WRITE",
    "DRAFT_WRITE_SELF_APPROVE",
    "CANONICAL_WRITE",
    "READ_WRITE",
  ];

  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authCookie: string;
  let csrfToken: string;
  let ownerId: string;
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
    ownerId = auth.user.id;

    // Create a project for entity tests
    const res = await request(app.getHttpServer())
      .post("/v1/projects")
      .set("Cookie", authCookie)
      .set("x-csrf-token", csrfToken)
      .send({ name: "Test World" });
    projectSlug = res.body.slug;
  });

  const base = () => `/v1/projects/${projectSlug}/entities`;
  const draftBase = () => `/v1/projects/${projectSlug}/drafts/entities`;

  async function createApiKey(
    permissions: ApiKeyPermission,
    name = `${permissions} test key`,
  ) {
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: projectSlug },
      select: { id: true },
    });

    if (
      permissions === "READ_WRITE" ||
      permissions === "DRAFT_WRITE_SELF_APPROVE"
    ) {
      const rawKey = `lrm_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const apiKey = await prisma.apiKey.create({
        data: {
          projectId: project.id,
          userId: ownerId,
          name,
          keyHash,
          permissions,
        },
        select: { id: true, name: true, permissions: true, createdAt: true },
      });
      return { ...apiKey, key: rawKey };
    }

    const apiKeysService = module.get(ApiKeysService);
    return apiKeysService.create(project.id, ownerId, {
      name,
      permissions,
    });
  }

  // -------------------------------------------------------------------------
  // DRAFT-FIRST CREATE
  // -------------------------------------------------------------------------

  describe("POST /drafts/entities", () => {
    it("submits an entity draft without changing canonical entity count", async () => {
      const beforeCount = await prisma.entity.count();

      const res = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Radagast",
          summary: "A staged wizard",
          character: { species: "Maia", role: "Wizard" },
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: "submitted",
        canonicalApplied: false,
        proposedSlug: "radagast",
        displayName: "Radagast",
      });
      expect(res.body.draftId).toEqual(expect.any(String));
      expect(res.body.batchId).toEqual(expect.any(String));
      expect(await prisma.entity.count()).toBe(beforeCount);

      const canonicalList = await request(app.getHttpServer())
        .get(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(canonicalList.body).toHaveLength(beforeCount);
      expect(
        canonicalList.body.map((entity: { slug: string }) => entity.slug),
      ).not.toContain(res.body.proposedSlug);
      await request(app.getHttpServer())
        .get(`${base()}/${res.body.proposedSlug}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });

    it("lists submitted reviewable drafts with safe summaries and status filters", async () => {
      const first = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Reviewable Character",
          summary: "Visible summary only",
          description: "secret pending draft body",
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Rejected Queue Location" })
        .expect(201)
        .then((submitted) =>
          request(app.getHttpServer())
            .post(`${draftBase()}/${submitted.body.draftId}/reject`)
            .set("Cookie", authCookie)
            .set("x-csrf-token", csrfToken)
            .send({ rejectionReason: "not now" })
            .expect(200),
        );

      const res = await request(app.getHttpServer())
        .get(draftBase())
        .query({ status: "SUBMITTED", limit: 10 })
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        items: [
          {
            id: first.body.draftId,
            status: "SUBMITTED",
            targetType: "ENTITY",
            operation: "CREATE",
            displayName: "Reviewable Character",
            displaySummary: "Visible summary only",
            submittedByKind: "HUMAN",
            submittedByLabel: "test@example.com",
            sourceKind: "MANUAL",
            canonicalApplied: false,
          },
        ],
        page: { limit: 10, offset: 0, total: 1 },
      });
      expect(JSON.stringify(res.body)).not.toContain(
        "secret pending draft body",
      );
    });

    it("reads draft detail with safe proposed payload summary and audit history", async () => {
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Detailed Draft",
          summary: "Draft detail summary",
          description: "unsafe full body should not leak",
          character: { species: "Maiar", role: "Reviewer target" },
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(detail.body).toMatchObject({
        id: submit.body.draftId,
        batchId: submit.body.batchId,
        status: "SUBMITTED",
        targetType: "ENTITY",
        operation: "CREATE",
        displayName: "Detailed Draft",
        displaySummary: "Draft detail summary",
        submittedByKind: "HUMAN",
        submittedByLabel: "test@example.com",
        sourceKind: "MANUAL",
        canonicalApplied: false,
        proposed: {
          type: "CHARACTER",
          name: "Detailed Draft",
          title: "Detailed Draft",
          slug: "detailed-draft",
          summary: "Draft detail summary",
          content: {
            description: "unsafe full body should not leak",
            character: { species: "Maiar", role: "Reviewer target" },
          },
        },
        reviewHistory: [
          {
            eventType: "DRAFT_ENTITY_SUBMITTED",
            actorKind: "HUMAN",
            actorLabel: "test@example.com",
          },
        ],
      });
      expect(detail.body.proposed).not.toHaveProperty("description");
      expect(detail.body.proposed).not.toHaveProperty("character");
    });

    it("returns review-safe proposed content and workflow links in draft detail", async () => {
      const rawApiKey = "lrm_live_abcdefghijklmnopqrstuvwxyz012345";
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Content Review Draft",
          summary: "Summary for reviewers",
          description: `Reviewer-visible prose with ${rawApiKey}`,
          backstory: "History reviewers need before applying canon",
          secrets: "In-world secret, not infrastructure credential",
          notes: "Production note with bearer abcdefghijklmnopqrstuvwxyz123456",
          imageUrl: "https://example.invalid/art.png",
          character: { species: "Maiar", role: "Guide" },
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(detail.body.proposed).toMatchObject({
        type: "CHARACTER",
        name: "Content Review Draft",
        title: "Content Review Draft",
        slug: "content-review-draft",
        summary: "Summary for reviewers",
        content: {
          description: "Reviewer-visible prose with [REDACTED]",
          backstory: "History reviewers need before applying canon",
          secrets: "In-world secret, not infrastructure credential",
          notes: "Production note with [REDACTED]",
          imageUrl: "https://example.invalid/art.png",
          character: { species: "Maiar", role: "Guide" },
        },
      });
      expect(detail.body.safeLinks).toMatchObject({
        review: `/v1/projects/${projectSlug}/drafts/entities/${submit.body.draftId}`,
        approve: `/v1/projects/${projectSlug}/drafts/entities/${submit.body.draftId}/approve`,
        reject: `/v1/projects/${projectSlug}/drafts/entities/${submit.body.draftId}/reject`,
        proposedCanonical: `/v1/projects/${projectSlug}/entities/content-review-draft`,
      });
      expect(JSON.stringify(detail.body)).not.toContain(rawApiKey);
    });

    it("redacts realistic secret and PII patterns from review queue summaries and proposed detail summaries", async () => {
      const openAiKey =
        "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const githubPat = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ";
      const ssn = "123-45-6789";
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb3JldW0tZHJhZnQifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const rawKey = "lrm_live_abcdefghijklmnopqrstuvwxyz012345";
      const secretSummary = `Visible prefix ${openAiKey} ${githubPat} ${ssn} suffix`;
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Redacted Draft Summary",
          summary: secretSummary,
          description: `full body must remain hidden ${rawKey} ${jwt}`,
        })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({
          id: submit.body.draftId,
          displaySummary:
            "Visible prefix [REDACTED] [REDACTED] [REDACTED] suffix",
        }),
      ]);

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(detail.body.proposed).toMatchObject({
        summary: "Visible prefix [REDACTED] [REDACTED] [REDACTED] suffix",
      });
      for (const secret of [openAiKey, githubPat, ssn, rawKey, jwt]) {
        expect(JSON.stringify(list.body)).not.toContain(secret);
        expect(JSON.stringify(detail.body)).not.toContain(secret);
      }
    });

    it("redacts infrastructure-keyed values from nested proposed draft detail", async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { slug: projectSlug },
        select: { id: true },
      });
      const rawOpaqueSecret = "opaque-value-that-would-not-match-token-regex";
      const rawSlugSecret = "lrm_live_abcdefghijklmnopqrstuvwxyz012345";
      const draft = await prisma.draftProposal.create({
        data: {
          projectId: project.id,
          targetType: "ENTITY",
          operation: "CREATE",
          status: "SUBMITTED",
          proposedData: {
            type: "CHARACTER",
            name: "Nested Secret Draft",
            slug: `nested-${rawSlugSecret}`,
            summary: "Nested secret summary",
            character: {
              species: "Human",
              role: "Scout",
              token: rawOpaqueSecret,
              api_key: rawOpaqueSecret,
            },
          },
          displayName: "Nested Secret Draft",
          displaySummary: "Nested secret summary",
          submittedByKind: "HUMAN",
          submittedByUserId: ownerId,
          submittedByLabel: "User: nested detail reviewer",
          sourceKind: "MANUAL",
        },
      });

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${draft.id}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(detail.body.proposed.content.character).toMatchObject({
        species: "Human",
        role: "Scout",
        token: "[REDACTED]",
        api_key: "[REDACTED]",
      });
      expect(detail.body.safeLinks).toMatchObject({
        proposedCanonical: null,
      });
      expect(JSON.stringify(detail.body)).not.toContain(rawOpaqueSecret);
      expect(JSON.stringify(detail.body)).not.toContain(rawSlugSecret);

      const unsafeSlugDraft = await prisma.draftProposal.create({
        data: {
          projectId: project.id,
          targetType: "ENTITY",
          operation: "CREATE",
          status: "SUBMITTED",
          proposedData: {
            type: "CHARACTER",
            name: "Unsafe Link Draft",
            slug: "unsafe/../entity?token=plain-value",
            summary: "Unsafe link summary",
          },
          displayName: "Unsafe Link Draft",
          displaySummary: "Unsafe link summary",
          submittedByKind: "HUMAN",
          submittedByUserId: ownerId,
          submittedByLabel: "User: unsafe link reviewer",
          sourceKind: "MANUAL",
        },
      });
      const unsafeSlugDetail = await request(app.getHttpServer())
        .get(`${draftBase()}/${unsafeSlugDraft.id}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(unsafeSlugDetail.body.safeLinks).toMatchObject({
        proposedCanonical: null,
      });
    });

    it("redacts secret and PII patterns from draft detail review history", async () => {
      const secretDraftName =
        "Boundary lrm_live_abcdefghijklmnopqrstuvwxyz012345";
      const secretApiKeyName = "review submitter 123-45-6789";
      const key = await createApiKey("DRAFT_WRITE", secretApiKeyName);
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Authorization", `Bearer ${key.key}`)
        .send({
          type: "CHARACTER",
          name: secretDraftName,
          summary: "Safe detail summary",
        })
        .expect(201);
      const project = await prisma.project.findUniqueOrThrow({
        where: { slug: projectSlug },
        select: { id: true },
      });
      await prisma.auditEvent.create({
        data: {
          projectId: project.id,
          eventType: "DRAFT_ENTITY_CUSTOM_AUDIT_CONTEXT",
          actorKind: "AGENT",
          actorApiKeyId: key.id,
          actorLabel: `API key: ${secretApiKeyName}`,
          sourceKind: "MCP_AGENT",
          operation: "CREATE",
          targetType: "ENTITY",
          draftId: submit.body.draftId,
          batchId: submit.body.batchId,
          summary: "Synthetic audit context with safe summary",
        },
      });

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(detail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_SUBMITTED",
            actorKind: "AGENT",
            actorLabel: "API key: project API key",
            summary: "Submitted entity draft Boundary [REDACTED]",
          }),
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_CUSTOM_AUDIT_CONTEXT",
            actorKind: "AGENT",
            actorLabel: "API key: review submitter [REDACTED]",
            summary: "Synthetic audit context with safe summary",
          }),
        ]),
      );
      expect(JSON.stringify(detail.body)).toContain("[REDACTED]");
      for (const rawValue of [secretDraftName, secretApiKeyName]) {
        expect(JSON.stringify(detail.body.reviewHistory)).not.toContain(
          rawValue,
        );
      }
      expect(detail.body.proposed).toMatchObject({
        name: "Boundary [REDACTED]",
        summary: "Safe detail summary",
      });
      expect(detail.body.proposed).not.toHaveProperty("description");
      expect(await prisma.entity.count()).toBe(0);
      await request(app.getHttpServer())
        .get(`${base()}/${submit.body.proposedSlug}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });

    it.each(projectReadPermissions)(
      "allows project-scoped %s API keys to read their review queue and draft detail",
      async (permission) => {
        const submit = await request(app.getHttpServer())
          .post(draftBase())
          .set("Cookie", authCookie)
          .set("x-csrf-token", csrfToken)
          .send({
            type: "CHARACTER",
            name: `${permission} Reviewable Draft`,
            summary: "Project-scoped read summary",
            description: "detail body stays out of safe review payload",
          })
          .expect(201);
        const key = await createApiKey(permission);

        const list = await request(app.getHttpServer())
          .get(draftBase())
          .set("Authorization", `Bearer ${key.key}`)
          .expect(200);
        expect(list.body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: submit.body.draftId,
              status: "SUBMITTED",
              displaySummary: "Project-scoped read summary",
            }),
          ]),
        );

        const detail = await request(app.getHttpServer())
          .get(`${draftBase()}/${submit.body.draftId}`)
          .set("Authorization", `Bearer ${key.key}`)
          .expect(200);
        expect(detail.body).toMatchObject({
          id: submit.body.draftId,
          displaySummary: "Project-scoped read summary",
          proposed: {
            summary: "Project-scoped read summary",
            content: {
              description: "detail body stays out of safe review payload",
            },
          },
        });
      },
    );

    it("does not leak drafts across project scope", async () => {
      const otherAuth = await createAuthenticatedUser(prisma, module, {
        email: "other@example.com",
      });
      const otherProject = await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", otherAuth.cookie)
        .set("x-csrf-token", otherAuth.csrfToken)
        .send({ name: "Other Review World" })
        .expect(201);
      const otherDraft = await request(app.getHttpServer())
        .post(`/v1/projects/${otherProject.body.slug}/drafts/entities`)
        .set("Cookie", otherAuth.cookie)
        .set("x-csrf-token", otherAuth.csrfToken)
        .send({ type: "CHARACTER", name: "Other Project Draft" })
        .expect(201);

      await request(app.getHttpServer())
        .get(`${draftBase()}/${otherDraft.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);

      const list = await request(app.getHttpServer())
        .get(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(list.body.items).toEqual([]);
    });

    it("prevents DRAFT_WRITE API keys from approving submitted drafts", async () => {
      const key = await createApiKey("DRAFT_WRITE");
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Authorization", `Bearer ${key.key}`)
        .send({ type: "CHARACTER", name: "Unapproved Agent Draft" })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Authorization", `Bearer ${key.key}`)
        .send({ reviewNote: "trying to self-approve" })
        .expect(403);

      expect(await prisma.entity.count()).toBe(0);
    });

    it.each<ApiKeyPermission>([
      "CANONICAL_WRITE",
      "READ_WRITE",
      "DRAFT_WRITE_SELF_APPROVE",
    ])(
      "lets %s approve and apply its own submitted draft",
      async (permission) => {
        const key = await createApiKey(permission);
        const submit = await request(app.getHttpServer())
          .post(draftBase())
          .set("Authorization", `Bearer ${key.key}`)
          .send({ type: "LOCATION", name: `${permission} Self Applied Draft` })
          .expect(201);

        const res = await request(app.getHttpServer())
          .post(`${draftBase()}/${submit.body.draftId}/approve`)
          .set("Authorization", `Bearer ${key.key}`)
          .send({ reviewNote: "self-approval compatibility matrix" })
          .expect(200);

        expect(res.body).toMatchObject({
          status: "applied",
          canonicalApplied: true,
          draftId: submit.body.draftId,
          canonical: { slug: submit.body.proposedSlug },
        });
      },
    );

    it("lets an authorized owner approve, apply, and audit an entity draft with durable rationale", async () => {
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Staged Valley" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: "approved for canon" })
        .expect(200);

      expect(res.body).toMatchObject({
        status: "applied",
        canonicalApplied: true,
        draftId: submit.body.draftId,
        reviewNote: "approved for canon",
        canonical: {
          type: "LOCATION",
          name: "Staged Valley",
          slug: "staged-valley",
        },
      });
      expect(await prisma.entity.count()).toBe(1);
      const canonicalList = await request(app.getHttpServer())
        .get(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(
        canonicalList.body.map((entity: { slug: string }) => entity.slug),
      ).toContain("staged-valley");
      await request(app.getHttpServer())
        .get(`${base()}/staged-valley`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      const auditEvents = await prisma.auditEvent.findMany({
        where: { draftId: submit.body.draftId },
        orderBy: { occurredAt: "asc" },
      });
      expect(auditEvents.map((event) => event.eventType)).toEqual([
        "DRAFT_ENTITY_SUBMITTED",
        "DRAFT_ENTITY_APPLIED",
      ]);
      expect(auditEvents).toHaveLength(2);
      expect(auditEvents[1]!.metadata).toMatchObject({
        reviewNote: "approved for canon",
      });

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(detail.body).toMatchObject({
        status: "APPLIED",
        reviewNote: "approved for canon",
        rejectionReason: null,
      });
      expect(detail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_APPLIED",
            reviewNote: "approved for canon",
            rejectionReason: null,
          }),
        ]),
      );
    });

    it("lets an authorized owner reject an entity draft without applying it canonically and persists rationale", async () => {
      const beforeCount = await prisma.entity.count();
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Rejected Staged Character" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/reject`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ rejectionReason: "needs more lore" })
        .expect(200);

      expect(res.body).toMatchObject({
        status: "rejected",
        canonicalApplied: false,
        draftId: submit.body.draftId,
        rejectionReason: "needs more lore",
      });
      expect(await prisma.entity.count()).toBe(beforeCount);
      const auditEvents = await prisma.auditEvent.findMany({
        where: { draftId: submit.body.draftId },
        orderBy: { occurredAt: "asc" },
      });
      expect(auditEvents.map((event) => event.eventType)).toEqual([
        "DRAFT_ENTITY_SUBMITTED",
        "DRAFT_ENTITY_REJECTED",
      ]);
      expect(auditEvents).toHaveLength(2);
      expect(auditEvents[1]!.metadata).toMatchObject({
        rejectionReason: "needs more lore",
      });

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(detail.body).toMatchObject({
        status: "REJECTED",
        reviewNote: null,
        rejectionReason: "needs more lore",
      });
      expect(detail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_REJECTED",
            reviewNote: null,
            rejectionReason: "needs more lore",
          }),
        ]),
      );
    });

    it("represents absent approval and rejection rationale as null", async () => {
      const approved = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "No Note Applied Location" })
        .expect(201);

      const applyResponse = await request(app.getHttpServer())
        .post(`${draftBase()}/${approved.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({})
        .expect(200);
      expect(applyResponse.body).toMatchObject({
        status: "applied",
        reviewNote: null,
      });

      const rejected = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "No Reason Rejected Character" })
        .expect(201);

      const rejectResponse = await request(app.getHttpServer())
        .post(`${draftBase()}/${rejected.body.draftId}/reject`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({})
        .expect(200);
      expect(rejectResponse.body).toMatchObject({
        status: "rejected",
        rejectionReason: null,
      });

      for (const draftId of [approved.body.draftId, rejected.body.draftId]) {
        const detail = await request(app.getHttpServer())
          .get(`${draftBase()}/${draftId}`)
          .set("Cookie", authCookie)
          .set("x-csrf-token", csrfToken)
          .expect(200);
        expect(detail.body.reviewNote).toBeNull();
        expect(detail.body.rejectionReason).toBeNull();
        expect(detail.body.reviewHistory).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reviewNote: null,
              rejectionReason: null,
            }),
          ]),
        );
      }
    });

    it("redacts infrastructure secrets from review rationale responses", async () => {
      const approved = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Secret Note Applied Location" })
        .expect(201);
      const secretNote =
        "approved with key lrm_1234567890abcdef1234567890abcdef";

      const applyResponse = await request(app.getHttpServer())
        .post(`${draftBase()}/${approved.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: secretNote })
        .expect(200);
      expect(applyResponse.body.reviewNote).toBe(
        "approved with key [REDACTED]",
      );

      const appliedDetail = await request(app.getHttpServer())
        .get(`${draftBase()}/${approved.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(appliedDetail.body.reviewNote).toBe(
        "approved with key [REDACTED]",
      );
      expect(appliedDetail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reviewNote: "approved with key [REDACTED]",
          }),
        ]),
      );

      const storedApproved = await prisma.draftProposal.findUniqueOrThrow({
        where: { id: approved.body.draftId },
      });
      expect(storedApproved.reviewNote).toBe(secretNote);

      const rejected = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Secret Reason Rejected Character" })
        .expect(201);
      const secretReason =
        "reject until Bearer longbearertokenvalue1234567890 is removed";

      const rejectResponse = await request(app.getHttpServer())
        .post(`${draftBase()}/${rejected.body.draftId}/reject`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ rejectionReason: secretReason })
        .expect(200);
      expect(rejectResponse.body.rejectionReason).toBe(
        "reject until [REDACTED] is removed",
      );

      const rejectedDetail = await request(app.getHttpServer())
        .get(`${draftBase()}/${rejected.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(rejectedDetail.body.rejectionReason).toBe(
        "reject until [REDACTED] is removed",
      );
      expect(rejectedDetail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rejectionReason: "reject until [REDACTED] is removed",
          }),
        ]),
      );

      const storedRejected = await prisma.draftProposal.findUniqueOrThrow({
        where: { id: rejected.body.draftId },
      });
      expect(storedRejected.rejectionReason).toBe(secretReason);
    });
    it("prevents rejection after a draft has already been applied", async () => {
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Already Applied Character" })
        .expect(201);

      const applied = await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: "approved before rejection attempt" })
        .expect(200);

      await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/reject`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ rejectionReason: "too late" })
        .expect(400);

      const draft = await prisma.draftProposal.findUniqueOrThrow({
        where: { id: submit.body.draftId },
      });
      expect(draft.status).toBe("APPLIED");
      expect(draft.appliedTargetId).toBe(applied.body.canonical.id);
      expect(await prisma.entity.count()).toBe(1);
    });

    it("returns the applied canonical entity for repeated approval retries", async () => {
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Retry Applied Location" })
        .expect(201);
      const secretNote =
        "first approval with key lrm_retry1234567890abcdef1234567890";

      const first = await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: secretNote })
        .expect(200);

      const retry = await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: "retry approval should not overwrite stored note" })
        .expect(200);

      expect(first.body.reviewNote).toBe("first approval with key [REDACTED]");
      expect(retry.body).toMatchObject({
        status: "applied",
        canonicalApplied: true,
        draftId: submit.body.draftId,
        reviewNote: "first approval with key [REDACTED]",
        canonical: {
          id: first.body.canonical.id,
          name: "Retry Applied Location",
        },
      });

      const storedDraft = await prisma.draftProposal.findUniqueOrThrow({
        where: { id: submit.body.draftId },
      });
      expect(storedDraft.reviewNote).toBe(secretNote);

      const detail = await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(detail.body.reviewNote).toBe("first approval with key [REDACTED]");
      expect(detail.body.reviewHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reviewNote: "first approval with key [REDACTED]",
          }),
        ]),
      );

      expect(await prisma.entity.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // ACTIVITY / AUDIT
  // -------------------------------------------------------------------------

  describe("GET /activity and /audit/:auditEventId", () => {
    const activityBase = () => `/v1/projects/${projectSlug}/activity`;
    const auditBase = () => `/v1/projects/${projectSlug}/audit`;

    it("lists project activity from audit events with actor/capability/lifecycle summaries", async () => {
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Activity Character",
          summary: "Public activity summary",
          description:
            "Bearer abcdefghijklmnopqrstuvwxyz123456 should not leak",
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${draftBase()}/${submit.body.draftId}/approve`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ reviewNote: "approve for activity" })
        .expect(200);

      const rejected = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "LOCATION",
          name: "Rejected Activity Location",
          summary: "Rejected activity summary",
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${draftBase()}/${rejected.body.draftId}/reject`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ rejectionReason: "not ready for canon" })
        .expect(200);

      const project = await prisma.project.findUniqueOrThrow({
        where: { slug: projectSlug },
        select: { id: true },
      });
      await prisma.auditEvent.create({
        data: {
          projectId: project.id,
          eventType: "DRAFT_ENTITY_APPLY_FAILED",
          outcome: "FAILURE",
          actorKind: "AGENT",
          actorLabel: "API key: failed apply worker",
          sourceKind: "MCP_AGENT",
          operation: "CREATE",
          targetType: "ENTITY",
          targetDisplay: "Failed Activity Entity",
          summary: "Internal failure should be replaced in activity",
        },
      });
      await prisma.auditEvent.create({
        data: {
          projectId: project.id,
          eventType: "DRAFT_ENTITY_SUBMIT_FAILED",
          outcome: "FAILURE",
          actorKind: "AGENT",
          actorLabel: "API key: failed submit worker",
          sourceKind: "MCP_AGENT",
          operation: "CREATE",
          targetType: "ENTITY",
          targetDisplay: "Failed Submit Entity",
          summary: "Internal submit failure should be replaced in activity",
        },
      });

      const res = await request(app.getHttpServer())
        .get(activityBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_APPLY_FAILED",
            summary: "Actor failed to apply entity Failed Activity Entity",
            targetDisplay: "Failed Activity Entity",
            actorKind: "AGENT",
          }),
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_SUBMIT_FAILED",
            summary: "Actor failed to propose entity Failed Submit Entity",
            targetDisplay: "Failed Submit Entity",
            actorKind: "AGENT",
          }),
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_REJECTED",
            summary: "Actor rejected entity Rejected Activity Location",
            targetDisplay: "Rejected Activity Location",
            actorKind: "HUMAN",
          }),
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_APPLIED",
            summary: "Actor applied entity Activity Character",
            targetDisplay: "Activity Character",
            actorKind: "HUMAN",
          }),
          expect.objectContaining({
            eventType: "DRAFT_ENTITY_SUBMITTED",
            summary: "Actor proposed entity Activity Character",
            targetDisplay: "Activity Character",
            actorKind: "HUMAN",
          }),
        ]),
      );
      expect(res.body.page).toMatchObject({ limit: 50, offset: 0, total: 6 });
      expect(JSON.stringify(res.body.items)).not.toContain("User ");
      expect(JSON.stringify(res.body.items)).not.toContain("Agent ");
      expect(JSON.stringify(res.body)).not.toContain(
        "abcdefghijklmnopqrstuvwxyz",
      );
      expect(JSON.stringify(res.body)).not.toContain("description");
      expect(JSON.stringify(res.body)).not.toContain("newData");
    });

    it("returns redacted audit details only to actors with audit detail capability", async () => {
      const openAiKey =
        "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const githubPat = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ";
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb3JldW0tYXVkaXQifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const ssn = "123-45-6789";
      const rawKey = "lrm_live_abcdefghijklmnopqrstuvwxyz012345";
      const project = await prisma.project.findUniqueOrThrow({
        where: { slug: projectSlug },
        select: { id: true },
      });
      const event = await prisma.auditEvent.create({
        data: {
          projectId: project.id,
          eventType: "DRAFT_ENTITY_SUBMITTED",
          actorKind: "AGENT",
          actorApiKeyId: null,
          actorLabel: "API key: detail test",
          sourceKind: "MCP_AGENT",
          operation: "CREATE",
          targetType: "ENTITY",
          targetDisplay: `Secret-Bearing Entity ${openAiKey}`,
          summary: `raw summary with ${rawKey} should be replaced`,
          newData: {
            name: "Secret-Bearing Entity",
            authorization: githubPat,
            description: "domain prose is detail-only",
          },
          metadata: {
            requestPayload: {
              api_key: rawKey,
              submitterSsn: ssn,
            },
          },
          capabilityContext: {
            token: jwt,
            capabilities: ["draft:create"],
          },
        },
      });

      const activity = await request(app.getHttpServer())
        .get(activityBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(activity.body.items).toEqual([
        expect.objectContaining({
          id: event.id,
          targetDisplay: "Secret-Bearing Entity [REDACTED]",
          summary: "Actor proposed entity Secret-Bearing Entity [REDACTED]",
        }),
      ]);

      const detail = await request(app.getHttpServer())
        .get(`${auditBase()}/${event.id}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(detail.body).toMatchObject({
        id: event.id,
        eventType: "DRAFT_ENTITY_SUBMITTED",
        summary: "Actor proposed entity Secret-Bearing Entity [REDACTED]",
        targetDisplay: "Secret-Bearing Entity [REDACTED]",
        newData: {
          name: "Secret-Bearing Entity",
          authorization: "[REDACTED]",
          description: "domain prose is detail-only",
        },
        metadata: {
          requestPayload: {
            api_key: "[REDACTED]",
            submitterSsn: "[REDACTED]",
          },
        },
        capabilityContext: {
          token: "[REDACTED]",
          capabilities: ["draft:create"],
        },
      });
      for (const secret of [openAiKey, githubPat, jwt, ssn, rawKey]) {
        expect(JSON.stringify(activity.body)).not.toContain(secret);
        expect(JSON.stringify(detail.body)).not.toContain(secret);
      }

      for (const permission of projectReadPermissions) {
        const key = await createApiKey(
          permission,
          `${permission} audit read key`,
        );

        const apiKeyActivity = await request(app.getHttpServer())
          .get(activityBase())
          .set("Authorization", `Bearer ${key.key}`)
          .expect(200);
        expect(apiKeyActivity.body.items).toEqual([
          expect.objectContaining({
            id: event.id,
            targetDisplay: "Secret-Bearing Entity [REDACTED]",
            summary: "Actor proposed entity Secret-Bearing Entity [REDACTED]",
          }),
        ]);

        const apiKeyDetailRequest = request(app.getHttpServer())
          .get(`${auditBase()}/${event.id}`)
          .set("Authorization", `Bearer ${key.key}`);
        if (permission === "READ_ONLY") {
          await apiKeyDetailRequest.expect(403);
          continue;
        }

        const apiKeyDetail = await apiKeyDetailRequest.expect(200);
        expect(apiKeyDetail.body).toMatchObject({
          id: event.id,
          newData: { authorization: "[REDACTED]" },
          metadata: { requestPayload: { api_key: "[REDACTED]" } },
          capabilityContext: { token: "[REDACTED]" },
        });
        for (const secret of [openAiKey, githubPat, jwt, ssn, rawKey]) {
          expect(JSON.stringify(apiKeyActivity.body)).not.toContain(secret);
          expect(JSON.stringify(apiKeyDetail.body)).not.toContain(secret);
        }
      }
    });

    it("does not expose audit feed or details across project scope", async () => {
      const otherAuth = await createAuthenticatedUser(prisma, module, {
        email: "activity-other@example.com",
      });
      const otherProject = await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", otherAuth.cookie)
        .set("x-csrf-token", otherAuth.csrfToken)
        .send({ name: "Other Activity World" })
        .expect(201);
      const otherSubmit = await request(app.getHttpServer())
        .post(`/v1/projects/${otherProject.body.slug}/drafts/entities`)
        .set("Cookie", otherAuth.cookie)
        .set("x-csrf-token", otherAuth.csrfToken)
        .send({ type: "CHARACTER", name: "Other Activity Draft" })
        .expect(201);
      const otherEvent = await prisma.auditEvent.findFirstOrThrow({
        where: { draftId: otherSubmit.body.draftId },
      });

      const feed = await request(app.getHttpServer())
        .get(activityBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(feed.body.items).toEqual([]);

      await request(app.getHttpServer())
        .get(`${auditBase()}/${otherEvent.id}`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });

    it("rejects API keys scoped to another project before audit or review data is read", async () => {
      const otherAuth = await createAuthenticatedUser(prisma, module, {
        email: "other-key-owner@example.com",
      });
      const otherProject = await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", otherAuth.cookie)
        .set("x-csrf-token", otherAuth.csrfToken)
        .send({ name: "Other API Key World" })
        .expect(201);
      const otherProjectRow = await prisma.project.findUniqueOrThrow({
        where: { slug: otherProject.body.slug },
        select: { id: true },
      });
      const otherKey = await module
        .get(ApiKeysService)
        .create(otherProjectRow.id, otherAuth.user.id, {
          name: "other project key",
          permissions: "CANONICAL_WRITE",
        });
      const submit = await request(app.getHttpServer())
        .post(draftBase())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Current Project Draft" })
        .expect(201);
      const auditEvent = await prisma.auditEvent.findFirstOrThrow({
        where: { draftId: submit.body.draftId },
      });

      await request(app.getHttpServer())
        .get(activityBase())
        .set("Authorization", `Bearer ${otherKey.key}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`${auditBase()}/${auditEvent.id}`)
        .set("Authorization", `Bearer ${otherKey.key}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(draftBase())
        .set("Authorization", `Bearer ${otherKey.key}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`${draftBase()}/${submit.body.draftId}`)
        .set("Authorization", `Bearer ${otherKey.key}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // CREATE
  // -------------------------------------------------------------------------

  describe("POST", () => {
    it("creates a CHARACTER entity", async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "CHARACTER",
          name: "Gandalf",
          summary: "A wizard",
          character: { species: "Maia", role: "Wizard" },
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: "Gandalf",
        slug: "gandalf",
        type: "CHARACTER",
        summary: "A wizard",
      });
      expect(res.body.character).toMatchObject({
        species: "Maia",
        role: "Wizard",
      });
    });

    it("creates a LOCATION entity", async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "LOCATION",
          name: "The Shire",
          location: { region: "Eriador" },
        })
        .expect(201);

      expect(res.body.type).toBe("LOCATION");
      expect(res.body.location.region).toBe("Eriador");
    });

    it("creates an ORGANIZATION entity", async () => {
      const res = await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({
          type: "ORGANIZATION",
          name: "The Fellowship",
          organization: { ideology: "Destroy the Ring" },
        })
        .expect(201);

      expect(res.body.organization.ideology).toBe("Destroy the Ring");
    });

    it("rejects invalid entity type", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "INVALID", name: "Bad Type" })
        .expect(400);
    });

    it("rejects missing name", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER" })
        .expect(400);
    });

    it("generates unique slugs for duplicate names", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Aragorn" });

      const res = await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Aragorn" })
        .expect(201);

      expect(res.body.slug).toBe("aragorn-1");
    });
  });

  // -------------------------------------------------------------------------
  // READ
  // -------------------------------------------------------------------------

  describe("GET (list)", () => {
    it("lists all entities in a project", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Frodo" });
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Mordor" });

      const res = await request(app.getHttpServer())
        .get(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it("filters by type", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Sam" });
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "LOCATION", name: "Rivendell" });

      const res = await request(app.getHttpServer())
        .get(base())
        .query({ type: "CHARACTER" })
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Sam");
    });

    it("searches by name", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Legolas" });
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Gimli" });

      const res = await request(app.getHttpServer())
        .get(base())
        .query({ q: "leg" })
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Legolas");
    });
  });

  describe("GET (single)", () => {
    it("returns entity with hub data", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Boromir" });

      const res = await request(app.getHttpServer())
        .get(`${base()}/boromir`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.name).toBe("Boromir");
      // Hub includes should be present (even if empty)
      expect(res.body).toHaveProperty("sourceRelationships");
      expect(res.body).toHaveProperty("targetRelationships");
      expect(res.body).toHaveProperty("entityTags");
    });

    it("returns 404 for non-existent entity", async () => {
      await request(app.getHttpServer())
        .get(`${base()}/nope`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------

  describe("PATCH", () => {
    it("updates entity fields", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Pippin", summary: "A hobbit" });

      const res = await request(app.getHttpServer())
        .patch(`${base()}/pippin`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ summary: "A Took", description: "Peregrin Took" })
        .expect(200);

      expect(res.body.summary).toBe("A Took");
      expect(res.body.description).toBe("Peregrin Took");
    });

    it("regenerates slug when name changes", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Strider" });

      const res = await request(app.getHttpServer())
        .patch(`${base()}/strider`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Aragorn" })
        .expect(200);

      expect(res.body.slug).toBe("aragorn");
    });

    it("upserts extension fields", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Elrond" });

      const res = await request(app.getHttpServer())
        .patch(`${base()}/elrond`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ character: { species: "Elf", role: "Lord of Rivendell" } })
        .expect(200);

      expect(res.body.character.species).toBe("Elf");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------

  describe("DELETE", () => {
    it("deletes an entity", async () => {
      await request(app.getHttpServer())
        .post(base())
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ type: "CHARACTER", name: "Saruman" });

      await request(app.getHttpServer())
        .delete(`${base()}/saruman`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(204);

      await request(app.getHttpServer())
        .get(`${base()}/saruman`)
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });
  });
});
