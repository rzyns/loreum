import { NextRequest } from "next/server";

const DEFAULT_API_INTERNAL_URL = "http://localhost:3021/v1";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function getApiBaseUrl(): URL {
  const raw = process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;

  return new URL(raw.endsWith("/") ? raw : `${raw}/`);
}

async function proxy(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { path = [] } = await context.params;
  const upstreamUrl = new URL(
    path.map(encodeURIComponent).join("/"),
    getApiBaseUrl(),
  );
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    duplex: "half",
    redirect: "manual",
  } as RequestInit & { duplex: "half" });

  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(header);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
