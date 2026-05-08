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

function expectJsonContent(result: unknown, value: unknown) {
  assert.deepEqual(result, {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  });
}

function parseJsonContent(result: unknown) {
  assert.ok(result && typeof result === "object", "result should be object");
  const content = (result as { content?: Array<{ text?: string }> }).content;
  assert.ok(Array.isArray(content), "result should have content array");
  const text = content[0]?.text;
  if (typeof text !== "string") {
    assert.fail("first content item should contain JSON text");
  }
  return JSON.parse(text);
}

test("registerTools registers all existing MCP tools and resources", () => {
  const { server, registeredTools, registeredResources } = createFakeServer();
  const { api } = createApi({});

  registerTools(server, api);

  assert.deepEqual(Array.from(registeredTools.keys()), [
    "list_projects",
    "get_project",
    "search_project",
    "get_entity",
    "list_entities",
    "list_lore_articles",
    "get_lore_article",
    "list_timeline_events",
    "get_timeline_event",
    "list_relationships",
    "get_relationship",
    "list_tags",
    "get_tag",
    "get_storyboard",
    "list_plotlines",
    "get_plotline",
    "list_works",
    "get_work",
    "list_scenes_by_chapter",
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

test("registerTools omits mutation tools in read-only mode", () => {
  const { server, registeredTools, registeredResources } = createFakeServer();
  const { api } = createApi({});

  registerTools(server, api, { readOnly: true });

  assert.deepEqual(Array.from(registeredTools.keys()), [
    "list_projects",
    "get_project",
    "search_project",
    "get_entity",
    "list_entities",
    "list_lore_articles",
    "get_lore_article",
    "list_timeline_events",
    "get_timeline_event",
    "list_relationships",
    "get_relationship",
    "list_tags",
    "get_tag",
    "get_storyboard",
    "list_plotlines",
    "get_plotline",
    "list_works",
    "get_work",
    "list_scenes_by_chapter",
    "get_entity_types",
  ]);
  assert.deepEqual(Array.from(registeredResources.keys()), [
    "project_overview",
  ]);
});

test("registerTools exposes only explicitly allowlisted mutation tools", () => {
  const { server, registeredTools } = createFakeServer();
  const { api } = createApi({});

  registerTools(server, api, {
    readOnly: false,
    writeTools: ["create_entity"],
  });

  assert.deepEqual(
    Array.from(registeredTools.keys()).filter((name) =>
      [
        "create_entity",
        "update_entity",
        "create_relationship",
        "create_lore_article",
      ].includes(name),
    ),
    ["create_entity"],
  );
});

test("registerTools ignores unknown write-tool allowlist entries", () => {
  const { server, registeredTools } = createFakeServer();
  const { api } = createApi({});

  registerTools(server, api, {
    readOnly: false,
    writeTools: ["create_entity", "delete_everything"],
  });

  assert.equal(registeredTools.has("create_entity"), true);
  assert.equal(registeredTools.has("delete_everything"), false);
  assert.equal(registeredTools.has("update_entity"), false);
  assert.equal(registeredTools.has("create_relationship"), false);
  assert.equal(registeredTools.has("create_lore_article"), false);
});

test("create_entity returns post-write affordance envelope with typed entity admin and public route hints", async () => {
  const { server, registeredTools } = createFakeServer();
  const record = {
    id: "ent_1",
    type: "CHARACTER",
    slug: "ari",
    name: "Ari",
    project: { visibility: "PUBLIC" },
  };
  const { api, apiCalls } = createApi(record);

  registerTools(server, api, { writeTools: ["create_entity"] });

  const createEntity = registeredTools.get("create_entity");
  assert.ok(createEntity, "create_entity handler should be registered");

  const result = await createEntity({
    projectSlug: "test world",
    type: "CHARACTER",
    name: "Ari",
  });
  const envelope = parseJsonContent(result);

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/test world/entities",
      options: {
        method: "POST",
        body: JSON.stringify({ type: "CHARACTER", name: "Ari" }),
      },
    },
  ]);
  assert.deepEqual(envelope, {
    ok: true,
    operation: "create",
    contentType: "entity",
    displayType: "Character",
    projectSlug: "test world",
    id: "ent_1",
    slug: "ari",
    title: "Ari",
    record,
    links: {
      api: "/projects/test%20world/entities/ari",
      admin: "/projects/test%20world/entities/characters/ari",
      public: "/worlds/test%20world/entities/ari",
      list: "/projects/test%20world/entities/characters",
    },
    visibility: {
      projectVisibility: "PUBLIC",
      publicReadable: true,
      reason:
        "Project visibility is PUBLIC, so the public world route is expected to be readable.",
    },
    nextActions: [
      {
        label: "Open Character in project admin",
        kind: "open",
        href: "/projects/test%20world/entities/characters/ari",
      },
      {
        label: "Verify public Character page",
        kind: "verify",
        href: "/worlds/test%20world/entities/ari",
        note: "Public route is expected to work because project visibility is PUBLIC.",
      },
      {
        label: "Link related lore or relationships",
        kind: "link",
        tool: "create_relationship",
      },
    ],
  });
});

test("update_entity returns new entity affordances and records previous route when slug changes", async () => {
  const { server, registeredTools } = createFakeServer();
  const record = {
    id: "ent_2",
    type: "ITEM",
    slug: "crystal-key",
    name: "Crystal Key",
  };
  const { api } = createApi(record);

  registerTools(server, api, { writeTools: ["update_entity"] });

  const updateEntity = registeredTools.get("update_entity");
  assert.ok(updateEntity, "update_entity handler should be registered");

  const envelope = parseJsonContent(
    await updateEntity({
      projectSlug: "demo",
      entitySlug: "old-key",
      updates: { name: "Crystal Key" },
    }),
  );

  assert.equal(envelope.operation, "update");
  assert.equal(envelope.displayType, "Item");
  assert.equal(envelope.slug, "crystal-key");
  assert.equal(
    envelope.links.admin,
    "/projects/demo/entities/items/crystal-key",
  );
  assert.equal(
    envelope.links.previousAdmin,
    "/projects/demo/entities/items/old-key",
  );
  assert.equal(envelope.links.public, undefined);
  assert.deepEqual(envelope.visibility, {
    publicReadable: "unknown",
    reason:
      "Project visibility was not returned with the write response; verify public readability before sharing public links.",
  });
  assert.ok(
    envelope.nextActions.some((action: { note?: string }) =>
      action.note?.includes("slug changed"),
    ),
  );
});

test("create_relationship returns list-only affordances without implying a detail route", async () => {
  const { server, registeredTools } = createFakeServer();
  const record = {
    id: "rel_1",
    type: "ally",
    label: "Ally",
    sourceEntity: { slug: "ari", name: "Ari" },
    targetEntity: { slug: "bri", name: "Bri" },
    project: { visibility: "PRIVATE" },
  };
  const { api } = createApi(record);

  registerTools(server, api, { writeTools: ["create_relationship"] });

  const createRelationship = registeredTools.get("create_relationship");
  assert.ok(
    createRelationship,
    "create_relationship handler should be registered",
  );

  const envelope = parseJsonContent(
    await createRelationship({
      projectSlug: "demo",
      sourceEntitySlug: "ari",
      targetEntitySlug: "bri",
      type: "ally",
    }),
  );

  assert.equal(envelope.contentType, "relationship");
  assert.equal(envelope.id, "rel_1");
  assert.equal(envelope.links.admin, "/projects/demo/relationships");
  assert.equal(envelope.links.public, undefined);
  assert.equal(envelope.links.detail, undefined);
  assert.equal(envelope.visibility.publicReadable, false);
  assert.equal(
    envelope.visibility.reason,
    "Project visibility is PRIVATE, so no public reader route is advertised.",
  );
  assert.ok(
    envelope.nextActions.some(
      (action: { note?: string }) =>
        action.note ===
        "Relationships currently expose list pages only; no detail route is advertised.",
    ),
  );
});

test("create_lore_article returns lore affordance envelope with public visibility unknown when not proven", async () => {
  const { server, registeredTools } = createFakeServer();
  const record = { id: "lore_1", slug: "founding", title: "Founding" };
  const { api } = createApi(record);

  registerTools(server, api, { writeTools: ["create_lore_article"] });

  const createLoreArticle = registeredTools.get("create_lore_article");
  assert.ok(
    createLoreArticle,
    "create_lore_article handler should be registered",
  );

  const envelope = parseJsonContent(
    await createLoreArticle({
      projectSlug: "demo",
      title: "Founding",
      content: "Once...",
    }),
  );

  assert.deepEqual(envelope.links, {
    api: "/projects/demo/lore/founding",
    admin: "/projects/demo/lore/founding",
    list: "/projects/demo/lore",
  });
  assert.equal(envelope.contentType, "lore_article");
  assert.equal(envelope.displayType, "Lore article");
  assert.equal(envelope.visibility.publicReadable, "unknown");
  assert.equal(envelope.visibility.projectVisibility, undefined);
  assert.ok(
    envelope.nextActions.some(
      (action: { label?: string; kind?: string }) =>
        action.label === "Open Lore article in project admin" &&
        action.kind === "open",
    ),
  );
});

test("registerTools wires list_projects through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ slug: "demo", name: "Demo" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listProjects = registeredTools.get("list_projects");
  assert.ok(listProjects, "list_projects handler should be registered");

  const result = await listProjects({});

  assert.deepEqual(apiCalls, [{ path: "/projects", options: undefined }]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_project through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { slug: "demo", name: "Demo" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getProject = registeredTools.get("get_project");
  assert.ok(getProject, "get_project handler should be registered");

  const result = await getProject({ projectSlug: "demo" });

  assert.deepEqual(apiCalls, [{ path: "/projects/demo", options: undefined }]);
  expectJsonContent(result, apiResult);
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
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_lore_articles with only provided encoded query params", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ slug: "founding", title: "Founding" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listLoreArticles = registeredTools.get("list_lore_articles");
  assert.ok(
    listLoreArticles,
    "list_lore_articles handler should be registered",
  );

  const result = await listLoreArticles({
    projectSlug: "demo",
    q: "ancient war",
    category: "myths & legends",
    entity: "high-king",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/lore?q=ancient+war&category=myths+%26+legends&entity=high-king",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_lore_articles without omitted query params", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult: unknown[] = [];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listLoreArticles = registeredTools.get("list_lore_articles");
  assert.ok(
    listLoreArticles,
    "list_lore_articles handler should be registered",
  );

  const result = await listLoreArticles({
    projectSlug: "demo",
    category: "history",
  });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/lore?category=history", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_lore_article through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { slug: "founding", title: "Founding" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getLoreArticle = registeredTools.get("get_lore_article");
  assert.ok(getLoreArticle, "get_lore_article handler should be registered");

  const result = await getLoreArticle({
    projectSlug: "demo",
    articleSlug: "founding",
  });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/lore/founding", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools URL-encodes get_lore_article path segments", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { slug: "founding/myth", title: "Founding Myth" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getLoreArticle = registeredTools.get("get_lore_article");
  assert.ok(getLoreArticle, "get_lore_article handler should be registered");

  const result = await getLoreArticle({
    projectSlug: "demo world",
    articleSlug: "founding/myth",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo%20world/lore/founding%2Fmyth",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_timeline_events with optional query params", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ id: "evt_1", title: "Coronation" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listTimelineEvents = registeredTools.get("list_timeline_events");
  assert.ok(
    listTimelineEvents,
    "list_timeline_events handler should be registered",
  );

  const result = await listTimelineEvents({
    projectSlug: "demo",
    entity: "high king",
    significance: "major/minor",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/timeline?entity=high+king&significance=major%2Fminor",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_timeline_event through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { id: "evt_1", title: "Coronation" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getTimelineEvent = registeredTools.get("get_timeline_event");
  assert.ok(
    getTimelineEvent,
    "get_timeline_event handler should be registered",
  );

  const result = await getTimelineEvent({
    projectSlug: "demo",
    eventId: "evt_1",
  });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/timeline/evt_1", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_relationships with optional entity query param", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ id: "rel_1", type: "ally" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listRelationships = registeredTools.get("list_relationships");
  assert.ok(
    listRelationships,
    "list_relationships handler should be registered",
  );

  const result = await listRelationships({
    projectSlug: "demo",
    entity: "ari & bri",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/relationships?entity=ari+%26+bri",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_relationship through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { id: "rel_1", type: "ally" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getRelationship = registeredTools.get("get_relationship");
  assert.ok(getRelationship, "get_relationship handler should be registered");

  const result = await getRelationship({
    projectSlug: "demo",
    relationshipId: "rel_1",
  });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/relationships/rel_1", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_tags through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ name: "magic" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listTags = registeredTools.get("list_tags");
  assert.ok(listTags, "list_tags handler should be registered");

  const result = await listTags({ projectSlug: "demo" });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/tags", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_tag with URL-encoded path segments", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { name: "magic/fire" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getTag = registeredTools.get("get_tag");
  assert.ok(getTag, "get_tag handler should be registered");

  const result = await getTag({
    projectSlug: "demo world",
    tagName: "magic/fire",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo%20world/tags/magic%2Ffire",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_plotlines through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ slug: "main", title: "Main Plot" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listPlotlines = registeredTools.get("list_plotlines");
  assert.ok(listPlotlines, "list_plotlines handler should be registered");

  const result = await listPlotlines({ projectSlug: "demo" });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/storyboard/plotlines", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_plotline with URL-encoded path segments", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { slug: "main/arc", title: "Main Arc" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getPlotline = registeredTools.get("get_plotline");
  assert.ok(getPlotline, "get_plotline handler should be registered");

  const result = await getPlotline({
    projectSlug: "demo world",
    plotlineSlug: "main/arc",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo%20world/storyboard/plotlines/main%2Farc",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_works through injectable API client", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ slug: "book-one", title: "Book One" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listWorks = registeredTools.get("list_works");
  assert.ok(listWorks, "list_works handler should be registered");

  const result = await listWorks({ projectSlug: "demo" });

  assert.deepEqual(apiCalls, [
    { path: "/projects/demo/storyboard/works", options: undefined },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires get_work with URL-encoded path segments", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = { slug: "book/one", title: "Book One" };
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const getWork = registeredTools.get("get_work");
  assert.ok(getWork, "get_work handler should be registered");

  const result = await getWork({
    projectSlug: "demo world",
    workSlug: "book/one",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo%20world/storyboard/works/book%2Fone",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
});

test("registerTools wires list_scenes_by_chapter with required encoded chapterId query", async () => {
  const { server, registeredTools } = createFakeServer();
  const apiResult = [{ id: "scene_1", title: "Opening" }];
  const { api, apiCalls } = createApi(apiResult);

  registerTools(server, api);

  const listScenesByChapter = registeredTools.get("list_scenes_by_chapter");
  assert.ok(
    listScenesByChapter,
    "list_scenes_by_chapter handler should be registered",
  );

  const result = await listScenesByChapter({
    projectSlug: "demo world",
    chapterId: "chapter/one & two",
  });

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo%20world/storyboard/scenes?chapterId=chapter%2Fone+%26+two",
      options: undefined,
    },
  ]);
  expectJsonContent(result, apiResult);
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
