const API_BASE_URL = process.env.MCP_API_BASE_URL || "http://localhost:3021/v1";

export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;

export const api: ApiClient = async <T>(
  path: string,
  options?: RequestInit,
): Promise<T> => {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // Bearer auth for MCP
      ...(process.env.MCP_API_TOKEN && {
        Authorization: `Bearer ${process.env.MCP_API_TOKEN}`,
      }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
};
