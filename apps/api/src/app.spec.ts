import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppController } from "./app.controller";
import { PrismaService } from "./prisma/prisma.service";

describe("AppController (integration)", () => {
  let app: INestApplication;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /v1/health", () => {
    it("returns the current health contract with database check status", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/health")
        .expect(200);

      expect(res.body).toEqual({
        status: "healthy",
        checks: {
          database: "ok",
        },
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
