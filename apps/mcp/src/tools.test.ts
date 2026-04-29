import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./tools.js";
import { registerTools } from "./tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ResourceHandler = (uri: URL) => Promise<unknown>;

function createFakeServer() {
  const registeredTools = new Map<string, ToolHandler>();
  const registeredResources = new Map<string, ResourceHandler>();

  return {
    registeredTools,
    registeredResources,
    server: {
      registerTool: ((name: string, _spec: unknown, handler: ToolHandler) => {
        registeredTools.set(name, handler as ToolHandler);
        return {} as ReturnType<McpServer["registerTool"]>;
      }) as McpServer["registerTool"],
      resource: ((
        name: string,
        _template: string,
        handler: ResourceHandler,
      ) => {
        registeredResources.set(name, handler);
        return {} as ReturnType<McpServer["resource"]>;
      }) as unknown as McpServer["resource"],
    } satisfies Pick<McpServer, "registerTool" | "resource">,
  };
}

function createApi(result: unknown) {
  const apiCalls: Array<{ path: string; options?: RequestInit }> = [];
  const api: ApiClient = async <T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> => {
    apiCalls.push({ path, options });
    return result as T;
  };

  return { api, apiCalls };
}

test("registerTools registers all existing MCP tools and resources", () => {
  const { server, registeredTools, registeredResources } = createFakeServer();
  const { api } = createApi({});

  registerTools(server, api);

  assert.deepEqual(Array.from(registeredTools.keys()), [
    "search_project",
    "get_entity",
    "list_entities",
    "get_storyboard",
    "get_entity_types",
    "create_entity",
    "update_entity",
    "create_relationship",
    "create_lore_article",
  ]);
  assert.deepEqual(Array.from(registeredResources.keys()), [
    "project_overview",
  ]);
});

test("registerTools wires search_project through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { results: [{ type: "entity", slug: "ari" }] };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const searchProject = registeredTools.get("search_project");
  assert.ok(searchProject, "search_project handler should be registered");

  const result = await searchProject({
    projectSlug: "demo",
    query: "ari",
    types: ["entity", "lore"],
    limit: 7,
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/search?q=ari&types=entity%2Clore&limit=7",
      options: undefined,
    },
  ]);
  assert.deepEqual(result, {
    content: [{ type: "text", text: JSON.stringify(apiResult, null, 2) }],
  });
});

test("project_overview resource extracts the project slug from its URI", async () => {
  const { server, registeredResources } = createFakeServer();
  const apiResult = { slug: "demo", name: "Demo" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const projectOverview = registeredResources.get("project_overview");
  assert.ok(projectOverview, "project_overview resource should be registered");

  const result = await projectOverview(
    new URL("loreum://project/demo/overview"),
  );

  assert.deepEqual(apiCalls, [{ path: "/projects/demo", options: undefined }]);
  assert.deepEqual(result, {
    contents: [
      {
        uri: "loreum://project/demo/overview",
        mimeType: "application/json",
        text: JSON.stringify(apiResult, null, 2),
      },
    ],
  });
});
