import { describe, expect, it } from "vitest";
import { redactInfrastructureSecrets } from "./audit-redaction";

describe("redactInfrastructureSecrets", () => {
  it("redacts credential keys and token-looking strings in infrastructure metadata", () => {
    const input = {
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      cookie: "session=secret-cookie",
      nested: {
        apiKey: "lrm_1234567890abcdef1234567890abcdef",
        api_key: "lrm_abcdef1234567890abcdef1234567890",
        password: "hunter2",
        secret: "infrastructure-secret",
        clientSecret: "oauth-secret",
        accessToken: "access-token-value",
        refreshToken: "refresh-token-value",
        note: "call me with bearer deadbeefcafebabe if this leaks",
      },
      array: ["safe", "Bearer longbearertokenvalue1234567890"],
    };

    const redacted = redactInfrastructureSecrets(input);

    expect(redacted).toMatchObject({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        api_key: "[REDACTED]",
        password: "[REDACTED]",
        secret: "[REDACTED]",
        clientSecret: "[REDACTED]",
        accessToken: "[REDACTED]",
        refreshToken: "[REDACTED]",
        note: "call me with [REDACTED] if this leaks",
      },
      array: ["safe", "[REDACTED]"],
    });
  });

  it("can preserve lore payload fields while still redacting raw keys and bearer-looking strings", () => {
    const redacted = redactInfrastructureSecrets(
      {
        secret: "The dragon hides under the glass mountain.",
        token: "Bearer of Light is a title, not an auth header.",
        password: "speak friend and enter",
        nested: {
          apiKey: "fictional key phrase",
          leakedRawKey: "lrm_1234567890abcdef1234567890abcdef",
          leakedBearer: "Bearer longbearertokenvalue1234567890",
        },
      },
      { redactInfrastructureKeys: false },
    );

    expect(redacted).toEqual({
      secret: "The dragon hides under the glass mountain.",
      token: "Bearer of Light is a title, not an auth header.",
      password: "speak friend and enter",
      nested: {
        apiKey: "fictional key phrase",
        leakedRawKey: "[REDACTED]",
        leakedBearer: "[REDACTED]",
      },
    });
  });
});
