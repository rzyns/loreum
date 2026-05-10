import { describe, expect, it } from "vitest";
import { redactInfrastructureSecrets } from "./audit-redaction";

describe("redactInfrastructureSecrets", () => {
  const syntheticSecretPatterns = [
    {
      name: "loreum raw API key",
      value: "lrm_live_abcdefghijklmnopqrstuvwxyz012345",
    },
    {
      name: "OpenAI project API key",
      value:
        "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    },
    {
      name: "GitHub fine-grained personal access token",
      value: "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II00JJ",
    },
    {
      name: "JWT access token",
      value:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsb3JldW0tdXNlciJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    },
    { name: "US SSN-style PII", value: "123-45-6789" },
  ];

  it.each(syntheticSecretPatterns)(
    "redacts realistic synthetic $name payloads by value pattern",
    ({ value }) => {
      const redacted = redactInfrastructureSecrets({
        summary: `before ${value} after`,
      });

      expect(redacted.summary).toBe("before [REDACTED] after");
    },
  );

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
