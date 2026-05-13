import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./tools.js";
import { registerTools } from "./tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ResourceHandler = (uri: URL) => Promise<unknown>;

function createFakeServer() {
  const registeredTools = new Map<string, ToolHandler>();
  const registeredToolSpecs = new Map<string, unknown>();
  const registeredResources = new Map<string, ResourceHandler>();

  return {
    registeredTools,
    registeredToolSpecs,
    registeredResources,
    server: {
      registerTool: ((name: string, spec: unknown, handler: ToolHandler) => {
        registeredTools.set(name, handler as ToolHandler);
        registeredToolSpecs.set(name, spec);
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

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value).flatMap(collectStrings);
}

function assertNoWorldHrefs(value: unknown) {
  assert.deepEqual(
    collectStrings(value).filter((text) => text.includes("/worlds/")),
    [],
  );
}

function assertDraftFirstDescription(description: string | undefined) {
  assert.match(description ?? "", /staged .*draft/i);
  assert.match(
    description ?? "",
    /does not create or mutate canonical content on submit/i,
  );
  assert.match(description ?? "", /approve\/apply/i);
  assert.match(description ?? "", /rejection|conflicts/i);
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
    "submit_entity_update_draft",
    "submit_relationship_draft",
    "submit_lore_article_draft",
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
        "submit_entity_update_draft",
        "submit_relationship_draft",
        "submit_lore_article_draft",
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
  assert.equal(registeredTools.has("submit_entity_update_draft"), false);
  assert.equal(registeredTools.has("submit_relationship_draft"), false);
  assert.equal(registeredTools.has("submit_lore_article_draft"), false);
});

test("create_entity submits a draft and returns staged/not-canonical wording", async () => {
  const { server, registeredTools, registeredToolSpecs } = createFakeServer();
  const draft = {
    draftId: "draft_1",
    batchId: "batch_1",
    status: "submitted",
    canonicalApplied: false,
    proposedSlug: "ari",
    displayName: "Ari",
    proposedData: {
      type: "CHARACTER",
      name: "Ari",
    },
  };
  const { api, apiCalls } = createApi(draft);

  registerTools(server, api, { writeTools: ["create_entity"] });

  const createEntity = registeredTools.get("create_entity");
  assert.ok(createEntity, "create_entity handler should be registered");
  const spec = registeredToolSpecs.get("create_entity") as {
    description?: string;
  };
  assertDraftFirstDescription(spec.description);

  const result = await createEntity({
    projectSlug: "test world",
    type: "CHARACTER",
    name: "Ari",
  });
  const envelope = parseJsonContent(result);

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/test world/drafts/entities",
      options: {
        method: "POST",
        body: JSON.stringify({ type: "CHARACTER", name: "Ari" }),
      },
    },
  ]);
  assert.deepEqual(envelope, {
    ok: true,
    operation: "submit_draft",
    contentType: "entity",
    displayType: "Character",
    projectSlug: "test world",
    draftId: "draft_1",
    batchId: "batch_1",
    status: "submitted",
    canonicalApplied: false,
    proposedSlug: "ari",
    title: "Ari",
    record: draft,
    links: {
      reviewQueue: "/projects/test%20world/drafts",
      draftApi: "/projects/test%20world/drafts/entities/draft_1",
    },
    nextActions: [
      {
        label: "Review staged Character draft before canonical application",
        kind: "review",
        href: "/projects/test%20world/drafts",
        note: "This create_entity call submitted a draft only; it did not create or mutate a canonical entity.",
      },
    ],
  });
});

test("submit_entity_update_draft submits an entity-update review draft without canonical mutation", async () => {
  const { server, registeredTools, registeredToolSpecs } = createFakeServer();
  const draft = {
    draftId: "draft_update_1",
    batchId: "batch_1",
    status: "submitted",
    canonicalApplied: false,
    displayName: "Update Crystal Key",
  };
  const { api, apiCalls } = createApi(draft);

  registerTools(server, api, { writeTools: ["submit_entity_update_draft"] });

  const submitEntityUpdateDraft = registeredTools.get(
    "submit_entity_update_draft",
  );
  assert.ok(
    submitEntityUpdateDraft,
    "submit_entity_update_draft handler should be registered",
  );
  const spec = registeredToolSpecs.get("submit_entity_update_draft") as {
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  assertDraftFirstDescription(spec.description);
  assert.ok(spec.inputSchema?.patch, "schema should expose patch");

  const envelope = parseJsonContent(
    await submitEntityUpdateDraft({
      projectSlug: "demo",
      entitySlug: "crystal-key",
      patch: { summary: "Updated summary" },
    }),
  );

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/drafts/entities/crystal-key/update",
      options: {
        method: "POST",
        body: JSON.stringify({ patch: { summary: "Updated summary" } }),
      },
    },
  ]);
  assert.equal(envelope.operation, "submit_draft");
  assert.equal(envelope.contentType, "entity");
  assert.equal(envelope.displayType, "Entity update");
  assert.equal(envelope.canonicalApplied, false);
  assert.deepEqual(envelope.links, {
    reviewQueue: "/projects/demo/drafts",
    draftApi: "/projects/demo/drafts/entities/draft_update_1",
  });
  assert.equal(
    envelope.nextActions[0].note,
    "This submit_entity_update_draft call submitted a draft only; it did not create or mutate a canonical entity.",
  );
});

test("submit_relationship_draft submits a relationship review draft without canonical mutation", async () => {
  const { server, registeredTools, registeredToolSpecs } = createFakeServer();
  const draft = {
    draftId: "draft_rel_1",
    batchId: "batch_1",
    status: "submitted",
    canonicalApplied: false,
    displayName: "Ari -> Bri",
  };
  const { api, apiCalls } = createApi(draft);

  registerTools(server, api, { writeTools: ["submit_relationship_draft"] });

  const submitRelationshipDraft = registeredTools.get(
    "submit_relationship_draft",
  );
  assert.ok(
    submitRelationshipDraft,
    "submit_relationship_draft handler should be registered",
  );
  const spec = registeredToolSpecs.get("submit_relationship_draft") as {
    description?: string;
  };
  assertDraftFirstDescription(spec.description);

  const envelope = parseJsonContent(
    await submitRelationshipDraft({
      projectSlug: "demo",
      sourceEntitySlug: "ari",
      targetEntitySlug: "bri",
      type: "ally",
      description: "Trusted companion",
    }),
  );

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/drafts/relationships",
      options: {
        method: "POST",
        body: JSON.stringify({
          sourceEntitySlug: "ari",
          targetEntitySlug: "bri",
          type: "ally",
          description: "Trusted companion",
        }),
      },
    },
  ]);
  assert.equal(envelope.operation, "submit_draft");
  assert.equal(envelope.contentType, "relationship");
  assert.equal(envelope.canonicalApplied, false);
  assert.deepEqual(envelope.links, {
    reviewQueue: "/projects/demo/drafts",
    draftApi: "/projects/demo/drafts/relationships/draft_rel_1",
  });
  assertNoWorldHrefs(envelope.links);
  assertNoWorldHrefs(envelope.nextActions);
});

test("submit_lore_article_draft submits a lore article review draft without canonical mutation", async () => {
  const { server, registeredTools, registeredToolSpecs } = createFakeServer();
  const draft = {
    draftId: "draft_lore_1",
    batchId: "batch_1",
    status: "submitted",
    canonicalApplied: false,
    displayName: "Founding",
  };
  const { api, apiCalls } = createApi(draft);

  registerTools(server, api, { writeTools: ["submit_lore_article_draft"] });

  const submitLoreArticleDraft = registeredTools.get(
    "submit_lore_article_draft",
  );
  assert.ok(
    submitLoreArticleDraft,
    "submit_lore_article_draft handler should be registered",
  );
  const spec = registeredToolSpecs.get("submit_lore_article_draft") as {
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  assertDraftFirstDescription(spec.description);
  assert.ok(spec.inputSchema?.canonStatus, "schema should expose canonStatus");

  const envelope = parseJsonContent(
    await submitLoreArticleDraft({
      projectSlug: "demo",
      title: "Founding",
      content: "Once...",
      canonStatus: "draft",
    }),
  );

  assert.deepEqual(apiCalls, [
    {
      path: "/projects/demo/drafts/lore-articles",
      options: {
        method: "POST",
        body: JSON.stringify({
          title: "Founding",
          content: "Once...",
          canonStatus: "draft",
        }),
      },
    },
  ]);
  assert.equal(envelope.operation, "submit_draft");
  assert.equal(envelope.contentType, "lore_article");
  assert.equal(envelope.displayType, "Lore article");
  assert.equal(envelope.canonicalApplied, false);
  assert.deepEqual(envelope.links, {
    reviewQueue: "/projects/demo/drafts",
    draftApi: "/projects/demo/drafts/lore-articles/draft_lore_1",
  });
  assertNoWorldHrefs(envelope.links);
  assertNoWorldHrefs(envelope.nextActions);
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
