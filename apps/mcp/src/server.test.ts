import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { Readable } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  configFromEnv,
  isAuthorized,
  startHttpServer,
  type McpConfig,
} from "./server.js";

test("configFromEnv defaults to stdio with read-write tools", () => {
  assert.deepEqual(configFromEnv({}), {
    transport: "stdio",
    host: "0.0.0.0",
    port: 3022,
    httpAuthToken: undefined,
    readOnly: false,
    writeTools: [
      "create_entity",
      "update_entity",
      "create_relationship",
      "create_lore_article",
    ],
  });
});

test("configFromEnv defaults HTTP mode to read-only", () => {
  assert.deepEqual(
    configFromEnv({ MCP_TRANSPORT: "http", MCP_HTTP_AUTH_TOKEN: "secret" }),
    {
      transport: "http",
      host: "0.0.0.0",
      port: 3022,
      httpAuthToken: "secret",
      readOnly: true,
      writeTools: [],
    },
  );
});

test("configFromEnv allows explicit MCP_READ_ONLY override", () => {
  assert.equal(configFromEnv({ MCP_READ_ONLY: "true" }).readOnly, true);
  assert.equal(
    configFromEnv({ MCP_TRANSPORT: "http", MCP_READ_ONLY: "false" }).readOnly,
    false,
  );
});

test("configFromEnv does not expose HTTP write tools from MCP_READ_ONLY=false alone", () => {
  assert.deepEqual(
    configFromEnv({
      MCP_TRANSPORT: "http",
      MCP_HTTP_AUTH_TOKEN: "secret",
      MCP_READ_ONLY: "false",
    }).writeTools,
    [],
  );
});

test("configFromEnv requires explicit HTTP write opt-in and allowlist", () => {
  assert.deepEqual(
    configFromEnv({
      MCP_TRANSPORT: "http",
      MCP_HTTP_AUTH_TOKEN: "secret",
      MCP_ENABLE_WRITES: "true",
      MCP_WRITE_TOOLS: "create_entity,update_entity",
    }),
    {
      transport: "http",
      host: "0.0.0.0",
      port: 3022,
      httpAuthToken: "secret",
      readOnly: false,
      writeTools: ["create_entity"],
    },
  );
});

test("configFromEnv ignores unknown HTTP write tools", () => {
  assert.deepEqual(
    configFromEnv({
      MCP_TRANSPORT: "http",
      MCP_HTTP_AUTH_TOKEN: "secret",
      MCP_ENABLE_WRITES: "true",
      MCP_WRITE_TOOLS: "delete_everything",
    }).writeTools,
    [],
  );
});

test("isAuthorized requires exact bearer token", () => {
  const req = new Readable({ read() {} }) as Parameters<typeof isAuthorized>[0];
  req.headers = { authorization: "Bearer secret" };

  assert.equal(isAuthorized(req, "secret"), true);
  assert.equal(isAuthorized(req, "wrong"), false);
});

async function listHttpToolNames(config: McpConfig) {
  const httpServer = await startHttpServer(config);
  try {
    const address = httpServer.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: { headers: { authorization: "Bearer secret" } },
      },
    );
    const client = new Client({ name: "server-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name);
    } finally {
      await client.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("HTTP mode with MCP_READ_ONLY=false alone still excludes mutation tools", async () => {
  const toolNames = await listHttpToolNames({
    ...configFromEnv({
      MCP_TRANSPORT: "http",
      MCP_HOST: "127.0.0.1",
      MCP_HTTP_AUTH_TOKEN: "secret",
      MCP_READ_ONLY: "false",
    }),
    port: 0,
  });

  assert.equal(toolNames.includes("create_entity"), false);
  assert.equal(toolNames.includes("update_entity"), false);
  assert.equal(toolNames.includes("create_relationship"), false);
  assert.equal(toolNames.includes("create_lore_article"), false);
});

test("HTTP mode exposes only explicitly allowlisted create_entity write tool", async () => {
  const toolNames = await listHttpToolNames({
    ...configFromEnv({
      MCP_TRANSPORT: "http",
      MCP_HOST: "127.0.0.1",
      MCP_HTTP_AUTH_TOKEN: "secret",
      MCP_ENABLE_WRITES: "true",
      MCP_WRITE_TOOLS: "create_entity,update_entity",
    }),
    port: 0,
  });

  assert.equal(toolNames.includes("create_entity"), true);
  assert.equal(toolNames.includes("update_entity"), false);
  assert.equal(toolNames.includes("create_relationship"), false);
  assert.equal(toolNames.includes("create_lore_article"), false);
});

test("HTTP mode exposes health, rejects unauthenticated MCP requests, and lists read-only tools", async () => {
  const httpServer = await startHttpServer({
    transport: "http",
    host: "127.0.0.1",
    port: 0,
    httpAuthToken: "secret",
    readOnly: true,
    writeTools: [],
  });

  try {
    const address = httpServer.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      transport: "http",
      readOnly: true,
    });

    const unauthenticated = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(unauthenticated.status, 401);

    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: { headers: { authorization: "Bearer secret" } },
      },
    );
    const client = new Client({ name: "server-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name);
      assert.equal(toolNames.length, 20);
      assert.equal(toolNames.includes("list_projects"), true);
      assert.equal(toolNames.includes("create_entity"), false);
      assert.equal(toolNames.includes("update_entity"), false);
      assert.equal(toolNames.includes("create_relationship"), false);
      assert.equal(toolNames.includes("create_lore_article"), false);
    } finally {
      await client.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
