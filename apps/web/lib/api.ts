const API_URL = "/v1";

function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("csrf_token="));
  return match?.split("=").slice(1).join("=");
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const csrfToken = getCsrfToken();

  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken && { "x-csrf-token": csrfToken }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body || `API error ${res.status}`;

    try {
      const parsed = JSON.parse(body) as { message?: string | string[] };
      if (Array.isArray(parsed.message)) {
        message = parsed.message.join("; ");
      } else if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      // Keep the raw response body when the API did not return JSON.
    }

    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
