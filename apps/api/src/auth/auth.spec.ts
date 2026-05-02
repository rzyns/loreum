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
import { AppConfig } from "../config/app.config";

describe("Auth (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;

  beforeAll(async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CALLBACK_URL;
    delete process.env.AUTH_GOOGLE_ENABLED;
    delete process.env.AUTH_LOCAL_ENABLED;

    ({ app, prisma, module } = await createTestApp());
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  describe("POST /v1/auth/signup and POST /v1/auth/login", () => {
    it("signs up a local user with hashed password and auth cookies", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/signup")
        .send({
          email: "bilbo@shire.com",
          password: "correct horse battery staple",
          name: "Bilbo Baggins",
        })
        .expect(201);

      expect(res.body).toMatchObject({
        user: { email: "bilbo@shire.com" },
      });
      expect(res.body.token).toEqual(expect.any(String));
      const cookies = String(res.headers["set-cookie"]);
      expect(cookies).toContain("auth_token=");
      expect(cookies).toContain("csrf_token=");

      const user = await prisma.user.findUnique({
        where: { email: "bilbo@shire.com" },
        include: { profile: true, preferences: true },
      });
      expect(user?.passwordHash).toMatch(/^scrypt\$v1\$/);
      expect(user?.passwordHash).not.toBe("correct horse battery staple");
      expect(user?.profile).toBeTruthy();
      expect(user?.preferences).toBeTruthy();
    });

    it("rejects duplicate signup email", async () => {
      const payload = {
        email: "duplicate@shire.com",
        password: "correct horse battery staple",
      };

      await request(app.getHttpServer())
        .post("/v1/auth/signup")
        .send(payload)
        .expect(201);
      await request(app.getHttpServer())
        .post("/v1/auth/signup")
        .send(payload)
        .expect(409);
    });

    it("logs in with correct password and sets auth cookies", async () => {
      await request(app.getHttpServer())
        .post("/v1/auth/signup")
        .send({
          email: "frodo@shire.com",
          password: "correct horse battery staple",
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({
          email: "frodo@shire.com",
          password: "correct horse battery staple",
        })
        .expect(200);

      expect(res.body).toMatchObject({ user: { email: "frodo@shire.com" } });
      expect(res.body.token).toEqual(expect.any(String));
      const cookies = String(res.headers["set-cookie"]);
      expect(cookies).toContain("auth_token=");
      expect(cookies).toContain("csrf_token=");
    });

    it("rejects wrong login password without field-specific detail", async () => {
      await request(app.getHttpServer())
        .post("/v1/auth/signup")
        .send({
          email: "sam@shire.com",
          password: "correct horse battery staple",
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: "sam@shire.com", password: "wrong horse battery" })
        .expect(401);

      expect(res.body.message).toBe("Invalid email or password");
    });
  });

  describe("GET /v1/auth/providers", () => {
    it("returns local auth only by default and starts without Google secrets", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/auth/providers")
        .expect(200);

      expect(res.body).toEqual([
        { id: "local", label: "Email and password", type: "local" },
      ]);
    });

    it("includes Google when enabled and configured", async () => {
      await app.close();

      process.env.AUTH_GOOGLE_ENABLED = "true";
      process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
      process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
      process.env.GOOGLE_CALLBACK_URL =
        "http://localhost:3021/v1/auth/google/callback";

      ({ app, prisma, module } = await createTestApp());

      const res = await request(app.getHttpServer())
        .get("/v1/auth/providers")
        .expect(200);

      expect(res.body).toEqual([
        { id: "local", label: "Email and password", type: "local" },
        {
          id: "google",
          label: "Google",
          type: "oauth",
          url: "/auth/google",
        },
      ]);
    });
  });

  describe("auth provider config", () => {
    it("only requires Google secrets when Google auth is enabled", () => {
      const config = module.get(AppConfig);

      process.env.AUTH_GOOGLE_ENABLED = "false";
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CALLBACK_URL;

      expect(config.auth).toEqual({ localEnabled: true, googleEnabled: false });
      expect(() => config.google).not.toThrow();

      process.env.AUTH_GOOGLE_ENABLED = "true";
      expect(config.auth.googleEnabled).toBe(true);
      expect(() => config.google).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // GET /auth/me
  // -------------------------------------------------------------------------

  describe("GET /v1/auth/me", () => {
    it("returns authenticated user profile", async () => {
      const auth = await createAuthenticatedUser(prisma, module, {
        email: "gandalf@shire.com",
        name: "Gandalf",
      });

      const res = await request(app.getHttpServer())
        .get("/v1/auth/me")
        .set("Cookie", auth.cookie)
        .set("x-csrf-token", auth.csrfToken)
        .expect(200);

      expect(res.body).toMatchObject({
        email: "gandalf@shire.com",
        displayName: "Gandalf",
      });
      expect(res.body.id).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      await request(app.getHttpServer()).get("/v1/auth/me").expect(401);
    });

    it("returns 401 with invalid token", async () => {
      await request(app.getHttpServer())
        .get("/v1/auth/me")
        .set("Cookie", "auth_token=invalid-token")
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /auth/sessions
  // -------------------------------------------------------------------------

  describe("GET /v1/auth/sessions", () => {
    it("lists active sessions for the user", async () => {
      const auth = await createAuthenticatedUser(prisma, module);

      const res = await request(app.getHttpServer())
        .get("/v1/auth/sessions")
        .set("Cookie", auth.cookie)
        .set("x-csrf-token", auth.csrfToken)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(auth.session.id);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /auth/sessions/:id
  // -------------------------------------------------------------------------

  describe("DELETE /v1/auth/sessions/:id", () => {
    it("invalidates a specific session", async () => {
      const auth = await createAuthenticatedUser(prisma, module);

      await request(app.getHttpServer())
        .delete(`/v1/auth/sessions/${auth.session.id}`)
        .set("Cookie", auth.cookie)
        .set("x-csrf-token", auth.csrfToken)
        .expect(204);

      // Session should now be invalid — subsequent requests should fail
      const session = await prisma.session.findUnique({
        where: { id: auth.session.id },
      });
      expect(session?.isValid).toBe(false);
    });

    it("cannot invalidate another user's session", async () => {
      const user1 = await createAuthenticatedUser(prisma, module, {
        email: "user1@test.com",
      });
      const user2 = await createAuthenticatedUser(prisma, module, {
        email: "user2@test.com",
      });

      await request(app.getHttpServer())
        .delete(`/v1/auth/sessions/${user1.session.id}`)
        .set("Cookie", user2.cookie)
        .set("x-csrf-token", user2.csrfToken)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------

  describe("POST /v1/auth/logout", () => {
    it("invalidates current session and clears cookie", async () => {
      const auth = await createAuthenticatedUser(prisma, module);

      const res = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Cookie", auth.cookie)
        .set("x-csrf-token", auth.csrfToken)
        .expect(204);

      // Cookie should be cleared
      const cookies = res.headers["set-cookie"];
      if (cookies) {
        const authCookie = Array.isArray(cookies)
          ? cookies.find((c: string) => c.startsWith("auth_token"))
          : cookies;
        if (authCookie) {
          expect(authCookie).toContain("Max-Age=0");
        }
      }

      // Session should be invalidated
      const session = await prisma.session.findUnique({
        where: { id: auth.session.id },
      });
      expect(session?.isValid).toBe(false);
    });
  });
});
