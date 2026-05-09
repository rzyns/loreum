const REDACTED = "[REDACTED]";

const INFRASTRUCTURE_SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "apikey",
  "api_key",
  "password",
  "secret",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
]);

const LOREUM_RAW_KEY_PATTERN = /lrm_[a-zA-Z0-9_-]{16,}/g;
const BEARER_LOOKING_PATTERN = /\bbearer\s+[A-Za-z0-9._~+\-/]{16,}\b/gi;

type RedactionOptions = {
  /**
   * Redact values solely because their object key is an infrastructure secret name.
   * Disable for domain/lore payloads so narrative fields named "secret" or
   * "token" are preserved while raw key/token patterns are still stripped.
   */
  redactInfrastructureKeys?: boolean;
};

function normalizeKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function isInfrastructureSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (key === "api_key") {
    return true;
  }
  return INFRASTRUCTURE_SECRET_KEYS.has(normalized);
}

function redactString(value: string): string {
  return value
    .replace(BEARER_LOOKING_PATTERN, REDACTED)
    .replace(LOREUM_RAW_KEY_PATTERN, REDACTED);
}

export function redactInfrastructureSecrets<T>(
  value: T,
  options: RedactionOptions = {},
): T {
  return redactValue(value, undefined, {
    redactInfrastructureKeys: options.redactInfrastructureKeys ?? true,
  }) as T;
}

function redactValue(
  value: unknown,
  key: string | undefined,
  options: Required<RedactionOptions>,
): unknown {
  if (
    options.redactInfrastructureKeys &&
    key &&
    isInfrastructureSecretKey(key)
  ) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, undefined, options));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([entryKey, entryValue]) => [
          entryKey,
          redactValue(entryValue, entryKey, options),
        ],
      ),
    );
  }

  return value;
}
