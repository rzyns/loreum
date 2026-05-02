import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("hashes passwords using a non-plaintext versioned format", async () => {
    const password = "correct horse battery staple";

    const hash = await service.hash(password);

    expect(hash).not.toBe(password);
    expect(hash).toMatch(/^scrypt\$v1\$/);
    expect(hash).toContain("$");
  });

  it("verifies the correct password", async () => {
    const hash = await service.hash("correct horse battery staple");

    await expect(
      service.verify("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await service.hash("correct horse battery staple");

    await expect(
      service.verify("wrong horse battery staple", hash),
    ).resolves.toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    await expect(service.verify("password", "not-a-valid-hash")).resolves.toBe(
      false,
    );
    await expect(
      service.verify("password", "scrypt$v1$bad$hash"),
    ).resolves.toBe(false);
  });
});
