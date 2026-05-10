import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { api, type ApiClient } from "./api.js";
import {
  registerTools,
  WRITE_TOOL_NAMES,
  type WriteToolName,
} from "./tools.js";

export type McpTransport = "stdio" | "http";

export type McpConfig = {
  transport: McpTransport;
  host: string;
  port: number;
  httpAuthToken?: string;
  readOnly: boolean;
  writeTools: readonly WriteToolName[];
};

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const DEFAULT_HTTP_WRITE_ALLOWLIST = new Set<WriteToolName>(["create_entity"]);

function httpWriteAllowlist(env: NodeJS.ProcessEnv) {
  // Full HTTP write-tool exposure is reserved for staging-only testworld smoke
  // coverage. Normal remote HTTP MCP deployments should keep the default narrow
  // allowlist and remain read-only/fail-closed unless writes are explicitly opted in.
  if (parseBoolean(env.MCP_ALLOW_ALL_WRITE_TOOLS, false)) {
    return new Set<WriteToolName>(WRITE_TOOL_NAMES);
  }

  return DEFAULT_HTTP_WRITE_ALLOWLIST;
}

function parseWriteTools(env: NodeJS.ProcessEnv, transport: McpTransport) {
  if (transport !== "http") return WRITE_TOOL_NAMES;
  if (!parseBoolean(env.MCP_ENABLE_WRITES, false)) return [];

  const allowedTools = httpWriteAllowlist(env);
  const requestedTools = (env.MCP_WRITE_TOOLS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return requestedTools.filter((name): name is WriteToolName =>
    allowedTools.has(name as WriteToolName),
  );
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const transport = (env.MCP_TRANSPORT ?? "stdio") as McpTransport;
  if (transport !== "stdio" && transport !== "http") {
    throw new Error("MCP_TRANSPORT must be either 'stdio' or 'http'");
  }

  const port = Number(env.MCP_PORT ?? "3022");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("MCP_PORT must be a valid TCP port");
  }

  const writeTools = parseWriteTools(env, transport);
  const readOnly = parseBoolean(
    env.MCP_READ_ONLY,
    transport === "http" && writeTools.length === 0,
  );

  return {
    transport,
    host: env.MCP_HOST ?? "0.0.0.0",
    port,
    httpAuthToken: env.MCP_HTTP_AUTH_TOKEN,
    readOnly,
    writeTools,
  };
}

export function createMcpServer(
  options: {
    apiClient?: ApiClient;
    readOnly?: boolean;
    writeTools?: readonly string[];
  } = {},
) {
  const server = new McpServer({
    name: "loreum",
    version: "0.1.0",
  });

  registerTools(server, options.apiClient ?? api, {
    readOnly: options.readOnly,
    writeTools: options.writeTools,
  });
  return server;
}

export function isAuthorized(req: IncomingMessage, token: string) {
  return req.headers.authorization === `Bearer ${token}`;
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

export async function startStdioServer(config = configFromEnv()) {
  const server = createMcpServer({
    readOnly: config.readOnly,
    writeTools: config.writeTools,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Loreum MCP server running on stdio");
}

export async function startHttpServer(config = configFromEnv()) {
  if (!config.httpAuthToken) {
    throw new Error("MCP_HTTP_AUTH_TOKEN is required when MCP_TRANSPORT=http");
  }

  const httpServer = createServer(async (req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        transport: "http",
        readOnly: config.readOnly,
      });
      return;
    }

    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!isAuthorized(req, config.httpAuthToken!)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
      return;
    }

    const mcpServer = createMcpServer({
      readOnly: config.readOnly,
      writeTools: config.writeTools,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
      res.on("close", () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
    } catch (error) {
      console.error("MCP HTTP request failed", error);
      await transport.close().catch(() => {});
      await mcpServer.close().catch(() => {});
      if (!res.headersSent)
        sendJson(res, 500, { error: "Internal server error" });
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, config.host, resolve);
  });

  const address = httpServer.address();
  const boundPort =
    typeof address === "object" && address ? address.port : config.port;
  console.error(
    `Loreum MCP server running on http://${config.host}:${boundPort}/mcp (readOnly=${config.readOnly})`,
  );
  return httpServer;
}

export async function startServer(config = configFromEnv()) {
  if (config.transport === "http") {
    return startHttpServer(config);
  }
  await startStdioServer(config);
  return undefined;
}
