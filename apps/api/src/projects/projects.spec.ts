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

describe("Projects (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authCookie: string;
  let csrfToken: string;
  let userId: string;

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
    userId = auth.user.id;
  });

  // -------------------------------------------------------------------------
  // CREATE
  // -------------------------------------------------------------------------

  describe("POST /v1/projects", () => {
    it("creates a project and returns it", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Middle Earth", description: "Tolkien's world" })
        .expect(201);

      expect(res.body).toMatchObject({
        name: "Middle Earth",
        slug: "middle-earth",
        description: "Tolkien's world",
        ownerId: userId,
      });
      expect(res.body.id).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .send({ name: "No Auth" })
        .expect(401);
    });

    it("returns 400 for missing name", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ description: "no name" })
        .expect(400);
    });

    it("generates unique slugs for duplicate names", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Duplicate" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Duplicate" })
        .expect(201);

      expect(res.body.slug).toBe("duplicate-1");
    });
  });

  // -------------------------------------------------------------------------
  // READ
  // -------------------------------------------------------------------------

  describe("GET /v1/projects", () => {
    it("lists only the user's projects", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Project A" });
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Project B" });

      // Second user shouldn't see first user's projects
      const other = await createAuthenticatedUser(prisma, module, {
        email: "other@example.com",
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects")
        .set("Cookie", other.cookie)
        .set("x-csrf-token", other.csrfToken)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  describe("GET /v1/projects/:slug/search", () => {
    async function createProject(
      name = "Searchable Project",
      ownerId = userId,
    ) {
      return prisma.project.create({
        data: { name, slug: name.toLowerCase().replace(/\s+/g, "-"), ownerId },
      });
    }

    it("returns a stable empty shape for empty or blank queries", async () => {
      await createProject();

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=%20%20")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toEqual({ query: "", total: 0, results: [] });
    });

    it("requires auth", async () => {
      await request(app.getHttpServer())
        .get("/v1/projects/anything/search?q=test")
        .expect(401);
    });

    it("enforces project ownership and does not leak another user's content", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Private Phoenix",
          slug: "private-phoenix",
        },
      });
      const other = await createAuthenticatedUser(prisma, module, {
        email: "search-intruder@example.com",
      });

      await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=phoenix")
        .set("Cookie", other.cookie)
        .set("x-csrf-token", other.csrfToken)
        .expect(403);
    });

    it("searches entity fields case-insensitively and returns metadata", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Astra Voss",
          slug: "astra-voss",
          summary: "Pilot of the NEBULA ark",
          secrets: "forbidden nebula secret",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=nebula")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({ query: "nebula", total: 1 });
      expect(res.body.results[0]).toMatchObject({
        type: "entity",
        title: "Astra Voss",
        slug: "astra-voss",
        metadata: { entityType: "CHARACTER" },
      });
    });

    it("searches lore title/content and returns category metadata", async () => {
      const project = await createProject();
      await prisma.loreArticle.create({
        data: {
          projectId: project.id,
          title: "The Silver Gate",
          slug: "silver-gate",
          content: "A hidden concord",
          category: "myth",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=concord")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.results[0]).toMatchObject({
        type: "lore",
        title: "The Silver Gate",
        slug: "silver-gate",
        metadata: { category: "myth" },
      });
    });

    it("searches timeline fields and returns date/significance metadata", async () => {
      const project = await createProject();
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          name: "First Contact",
          description: "Comet arrival",
          date: "2300",
          sortOrder: 2,
          significance: "major",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=comet")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.results[0]).toMatchObject({
        type: "timeline",
        title: "First Contact",
        metadata: { date: "2300", significance: "major" },
      });
    });

    it("searches scenes through chapter/work project scoping", async () => {
      const project = await createProject();
      const work = await prisma.work.create({
        data: {
          projectId: project.id,
          title: "Novel",
          slug: "novel",
          chronologicalOrder: 1,
          releaseOrder: 1,
        },
      });
      const chapter = await prisma.chapter.create({
        data: { workId: work.id, title: "Chapter One", sequenceNumber: 1 },
      });
      await prisma.scene.create({
        data: {
          chapterId: chapter.id,
          title: null,
          sequenceNumber: 1,
          description: "Harbor chase",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=harbor")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.results[0]).toMatchObject({
        type: "scene",
        title: "Untitled scene",
        metadata: { chapterId: chapter.id },
      });
    });

    it("honors requested result types", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Moon Entity",
          slug: "moon-entity",
        },
      });
      await prisma.loreArticle.create({
        data: {
          projectId: project.id,
          title: "Moon Lore",
          slug: "moon-lore",
          content: "moon",
          category: "note",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=moon&types=lore")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].type).toBe("lore");
    });

    it("honors limit=1 after deterministic type ordering", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Star Entity",
          slug: "star-entity",
        },
      });
      await prisma.loreArticle.create({
        data: {
          projectId: project.id,
          title: "Star Lore",
          slug: "star-lore",
          content: "star",
          category: "note",
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=star&limit=1")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({ total: 1 });
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].type).toBe("entity");
    });

    it("caps above-max limits at 50", async () => {
      const project = await createProject();
      await prisma.entity.createMany({
        data: Array.from({ length: 55 }, (_, index) => ({
          projectId: project.id,
          type: "CHARACTER",
          name: `Limit Cap Match ${index.toString().padStart(2, "0")}`,
          slug: `limit-cap-match-${index}`,
        })),
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=limit%20cap&limit=100")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.total).toBe(50);
      expect(res.body.results).toHaveLength(50);
    });

    it("defaults invalid and partial limits to 20", async () => {
      const project = await createProject();
      await prisma.entity.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({
          projectId: project.id,
          type: "CHARACTER",
          name: `Partial Limit Match ${index.toString().padStart(2, "0")}`,
          slug: `partial-limit-match-${index}`,
        })),
      });

      for (const limit of ["10abc", "1.9", "", "0", "-1"]) {
        const res = await request(app.getHttpServer())
          .get(
            `/v1/projects/searchable-project/search?q=partial%20limit&limit=${encodeURIComponent(limit)}`,
          )
          .set("Cookie", authCookie)
          .set("x-csrf-token", csrfToken)
          .expect(200);

        expect(res.body.total).toBe(20);
        expect(res.body.results).toHaveLength(20);
      }
    });

    it("ignores mixed unknown types and returns empty results when all are unknown", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Typed Comet Entity",
          slug: "typed-comet-entity",
        },
      });

      const mixed = await request(app.getHttpServer())
        .get(
          "/v1/projects/searchable-project/search?q=typed%20comet&types=unknown,entity",
        )
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(mixed.body.results).toHaveLength(1);
      expect(mixed.body.results[0].type).toBe("entity");

      const unknown = await request(app.getHttpServer())
        .get(
          "/v1/projects/searchable-project/search?q=typed%20comet&types=unknown,nope",
        )
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);
      expect(unknown.body).toMatchObject({ total: 0, results: [] });
    });

    it("does not match entity secrets and omits null lore metadata", async () => {
      const project = await createProject();
      await prisma.entity.create({
        data: {
          projectId: project.id,
          type: "CHARACTER",
          name: "Secret Keeper",
          slug: "secret-keeper",
          secrets: "noindexphrase",
        },
      });
      await prisma.loreArticle.create({
        data: {
          projectId: project.id,
          title: "Null Category Lore",
          slug: "null-category-lore",
          content: "noindexphrase",
          category: null,
        },
      });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/searchable-project/search?q=noindexphrase")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].type).toBe("lore");
      expect(res.body.results[0].metadata).toEqual({});
    });
  });

  describe("GET /v1/projects/:slug", () => {
    it("returns a project by slug", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Test Project" });

      const res = await request(app.getHttpServer())
        .get("/v1/projects/test-project")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(200);

      expect(res.body.name).toBe("Test Project");
    });

    it("returns 404 for non-existent project", async () => {
      await request(app.getHttpServer())
        .get("/v1/projects/does-not-exist")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });

    it("returns 403 for another user's project", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Private" });

      const other = await createAuthenticatedUser(prisma, module, {
        email: "intruder@example.com",
      });

      await request(app.getHttpServer())
        .get("/v1/projects/private")
        .set("Cookie", other.cookie)
        .set("x-csrf-token", other.csrfToken)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------

  describe("PATCH /v1/projects/:slug", () => {
    it("updates project name and regenerates slug", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Old Name" });

      const res = await request(app.getHttpServer())
        .patch("/v1/projects/old-name")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "New Name" })
        .expect(200);

      expect(res.body.name).toBe("New Name");
      expect(res.body.slug).toBe("new-name");
    });

    it("updates description without changing slug", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "Stable Slug" });

      const res = await request(app.getHttpServer())
        .patch("/v1/projects/stable-slug")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ description: "Updated description" })
        .expect(200);

      expect(res.body.slug).toBe("stable-slug");
      expect(res.body.description).toBe("Updated description");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------

  describe("DELETE /v1/projects/:slug", () => {
    it("deletes a project", async () => {
      await request(app.getHttpServer())
        .post("/v1/projects")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .send({ name: "To Delete" });

      await request(app.getHttpServer())
        .delete("/v1/projects/to-delete")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(204);

      await request(app.getHttpServer())
        .get("/v1/projects/to-delete")
        .set("Cookie", authCookie)
        .set("x-csrf-token", csrfToken)
        .expect(404);
    });
  });
});
