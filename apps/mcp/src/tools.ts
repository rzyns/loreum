import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ApiClient } from "./api.js";

export type { ApiClient } from "./api.js";

type ToolServer = Pick<McpServer, "registerTool" | "resource">;

export const WRITE_TOOL_NAMES = [
  "create_entity",
  "update_entity",
  "create_relationship",
  "create_lore_article",
] as const;

export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export type RegisterToolsOptions = {
  readOnly?: boolean;
  writeTools?: readonly string[];
};

function writeToolIsAllowed(
  options: RegisterToolsOptions,
  toolName: WriteToolName,
) {
  if (options.readOnly) return false;
  if (!options.writeTools) return true;
  return options.writeTools.includes(toolName);
}

export function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function optionalQuery(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  return query.toString() ? `?${query}` : "";
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

type WriteOperation = "create" | "update" | "submit_draft";
type ContentType = "entity" | "lore_article" | "relationship";
type PublicReadable = boolean | "unknown";

type WriteAffordanceLinkSet = {
  api?: string;
  admin?: string;
  public?: string;
  list?: string;
  previousAdmin?: string;
  previousPublic?: string;
  reviewQueue?: string;
  draftApi?: string;
};

type WriteAffordanceNextAction = {
  label: string;
  kind: "open" | "verify" | "link" | "search" | "review";
  href?: string;
  tool?: string;
  note?: string;
};

type WriteAffordanceResponse<T> = {
  ok: true;
  operation: WriteOperation;
  contentType: ContentType;
  displayType: string;
  projectSlug: string;
  id?: string;
  slug?: string;
  title?: string;
  draftId?: string;
  batchId?: string;
  status?: string;
  canonicalApplied?: boolean;
  proposedSlug?: string;
  record: T;
  links: WriteAffordanceLinkSet;
  visibility?: {
    projectVisibility?: string;
    publicReadable: PublicReadable;
    reason: string;
  };
  nextActions: WriteAffordanceNextAction[];
};

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike {
  return value && typeof value === "object" ? (value as RecordLike) : {};
}

function stringField(record: RecordLike, field: string) {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nestedStringField(
  record: RecordLike,
  objectField: string,
  field: string,
) {
  const nested = asRecord(record[objectField]);
  return stringField(nested, field);
}

function titleCase(value: string) {
  return value
    .split(/[_ -]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function entityDisplayType(type: string | undefined) {
  switch (type) {
    case "CHARACTER":
      return "Character";
    case "LOCATION":
      return "Location";
    case "ORGANIZATION":
      return "Organization";
    case "ITEM":
      return "Item";
    default:
      return type ? titleCase(type) : "Entity";
  }
}

const missingItemTypeSlugRouteNote =
  "The ITEM record did not include item.itemType.slug, so this envelope falls back to the project entity index instead of guessing a custom item route.";

function itemTypeSlug(record: RecordLike) {
  const item = asRecord(record.item);
  const itemType = asRecord(item.itemType);
  return stringField(itemType, "slug");
}

function entityTypeRouteSegment(type: string | undefined, record: RecordLike) {
  switch (type) {
    case "CHARACTER":
      return "characters";
    case "LOCATION":
      return "locations";
    case "ORGANIZATION":
      return "organizations";
    case "ITEM":
      return itemTypeSlug(record);
    default:
      return type ? `${type.toLowerCase().replace(/_/g, "-")}s` : undefined;
  }
}

function projectEntityIndexHref(project: string) {
  return `/projects/${project}/entities`;
}

function entityAdminHref(params: {
  project: string;
  typeSegment: string | undefined;
  encodedSlug: string | undefined;
}) {
  if (!params.typeSegment) return projectEntityIndexHref(params.project);
  if (!params.encodedSlug) {
    return `/projects/${params.project}/entities/${params.typeSegment}`;
  }
  return `/projects/${params.project}/entities/${params.typeSegment}/${params.encodedSlug}`;
}

function visibilityFor(record: RecordLike) {
  const projectVisibility = nestedStringField(record, "project", "visibility");

  if (projectVisibility === "PUBLIC" || projectVisibility === "UNLISTED") {
    return {
      projectVisibility,
      publicReadable: true as const,
      reason: `Project visibility is ${projectVisibility}, so the public world route is expected to be readable.`,
    };
  }

  if (projectVisibility === "PRIVATE") {
    return {
      projectVisibility,
      publicReadable: false as const,
      reason:
        "Project visibility is PRIVATE, so no public reader route is advertised.",
    };
  }

  return {
    publicReadable: "unknown" as const,
    reason:
      "Project visibility was not returned with the write response; verify public readability before sharing public links.",
  };
}

function maybePublicLink(
  visibility: ReturnType<typeof visibilityFor>,
  href: string,
) {
  return visibility.publicReadable === true ? href : undefined;
}

function buildEntityAffordance<T>(params: {
  operation: WriteOperation;
  projectSlug: string;
  record: T;
  previousSlug?: string;
}): WriteAffordanceResponse<T> {
  const record = asRecord(params.record);
  const type = stringField(record, "type");
  const displayType = entityDisplayType(type);
  const typeSegment = entityTypeRouteSegment(type, record);
  const slug = stringField(record, "slug");
  const id = stringField(record, "id");
  const title = stringField(record, "name") ?? stringField(record, "title");
  const project = pathSegment(params.projectSlug);
  const encodedSlug = slug ? pathSegment(slug) : undefined;
  const previousSlug = params.previousSlug;
  const encodedPreviousSlug = previousSlug
    ? pathSegment(previousSlug)
    : undefined;
  const visibility = visibilityFor(record);
  const admin = entityAdminHref({ project, typeSegment, encodedSlug });
  const publicHref = encodedSlug
    ? `/worlds/${project}/entities/${encodedSlug}`
    : undefined;
  const links: WriteAffordanceLinkSet = {
    api: encodedSlug
      ? `/projects/${project}/entities/${encodedSlug}`
      : undefined,
    admin,
    public: publicHref ? maybePublicLink(visibility, publicHref) : undefined,
    list: typeSegment
      ? `/projects/${project}/entities/${typeSegment}`
      : projectEntityIndexHref(project),
  };

  if (
    typeSegment &&
    encodedPreviousSlug &&
    encodedPreviousSlug !== encodedSlug
  ) {
    links.previousAdmin = `/projects/${project}/entities/${typeSegment}/${encodedPreviousSlug}`;
    const previousPublic = `/worlds/${project}/entities/${encodedPreviousSlug}`;
    links.previousPublic = maybePublicLink(visibility, previousPublic);
  }

  const primaryAction: WriteAffordanceNextAction = {
    label: `Open ${displayType} in project admin`,
    kind: "open",
    href: admin,
  };

  if (type === "ITEM" && !typeSegment) {
    primaryAction.note = missingItemTypeSlugRouteNote;
  }

  const nextActions: WriteAffordanceNextAction[] = [primaryAction];

  if (links.public) {
    nextActions.push({
      label: `Verify public ${displayType} page`,
      kind: "verify",
      href: links.public,
      note: `Public route is expected to work because project visibility is ${visibility.projectVisibility}.`,
    });
  } else {
    nextActions.push({
      label: `Verify ${displayType} public readability before sharing`,
      kind: "verify",
      note: visibility.reason,
    });
  }

  if (
    typeSegment &&
    encodedPreviousSlug &&
    encodedPreviousSlug !== encodedSlug
  ) {
    nextActions.push({
      label: "Review updated entity slug",
      kind: "review",
      href: admin,
      note: `Entity slug changed from ${previousSlug} to ${slug}; use the new admin URL.`,
    });
  }

  nextActions.push({
    label: "Link related lore or relationships",
    kind: "link",
    tool: "create_relationship",
  });

  return {
    ok: true,
    operation: params.operation,
    contentType: "entity",
    displayType,
    projectSlug: params.projectSlug,
    id,
    slug,
    title,
    record: params.record,
    links,
    visibility,
    nextActions,
  };
}

function buildDraftEntityAffordance<T>(params: {
  projectSlug: string;
  record: T;
}): WriteAffordanceResponse<T> {
  const record = asRecord(params.record);
  const proposedData = asRecord(record.proposedData);
  const type = stringField(proposedData, "type");
  const displayType = entityDisplayType(type);
  const title =
    stringField(record, "displayName") ??
    stringField(proposedData, "name") ??
    stringField(record, "title");
  const project = pathSegment(params.projectSlug);
  const draftId = stringField(record, "draftId");
  const batchId = stringField(record, "batchId");
  const status = stringField(record, "status");
  const canonicalApplied = record.canonicalApplied === true;
  const proposedSlug = stringField(record, "proposedSlug");
  const reviewQueue = `/projects/${project}/drafts`;
  const draftApi = draftId
    ? `/projects/${project}/drafts/entities/${pathSegment(draftId)}`
    : undefined;

  return {
    ok: true,
    operation: "submit_draft",
    contentType: "entity",
    displayType,
    projectSlug: params.projectSlug,
    draftId,
    batchId,
    status,
    canonicalApplied,
    proposedSlug,
    title,
    record: params.record,
    links: {
      reviewQueue,
      draftApi,
    },
    nextActions: [
      {
        label: `Review staged ${displayType} draft before canonical application`,
        kind: "review",
        href: reviewQueue,
        note: "This create_entity call submitted a draft only; it did not create or mutate a canonical entity.",
      },
    ],
  };
}

function buildLoreArticleAffordance<T>(params: {
  operation: WriteOperation;
  projectSlug: string;
  record: T;
}): WriteAffordanceResponse<T> {
  const record = asRecord(params.record);
  const slug = stringField(record, "slug");
  const id = stringField(record, "id");
  const title = stringField(record, "title") ?? stringField(record, "name");
  const project = pathSegment(params.projectSlug);
  const encodedSlug = slug ? pathSegment(slug) : undefined;
  const visibility = visibilityFor(record);
  const admin = encodedSlug
    ? `/projects/${project}/lore/${encodedSlug}`
    : `/projects/${project}/lore`;
  const publicHref = encodedSlug
    ? `/worlds/${project}/lore/${encodedSlug}`
    : undefined;
  const links: WriteAffordanceLinkSet = {
    api: encodedSlug ? `/projects/${project}/lore/${encodedSlug}` : undefined,
    admin,
    public: publicHref ? maybePublicLink(visibility, publicHref) : undefined,
    list: `/projects/${project}/lore`,
  };

  const nextActions: WriteAffordanceNextAction[] = [
    { label: "Open Lore article in project admin", kind: "open", href: admin },
  ];

  if (links.public) {
    nextActions.push({
      label: "Verify public Lore article page",
      kind: "verify",
      href: links.public,
      note: `Public route is expected to work because project visibility is ${visibility.projectVisibility}.`,
    });
  } else {
    nextActions.push({
      label: "Verify Lore article public readability before sharing",
      kind: "verify",
      note: visibility.reason,
    });
  }

  nextActions.push({
    label: "Check search/index consistency",
    kind: "search",
    tool: "search_project",
  });

  return {
    ok: true,
    operation: params.operation,
    contentType: "lore_article",
    displayType: "Lore article",
    projectSlug: params.projectSlug,
    id,
    slug,
    title,
    record: params.record,
    links,
    visibility,
    nextActions,
  };
}

function buildRelationshipAffordance<T>(params: {
  operation: WriteOperation;
  projectSlug: string;
  record: T;
}): WriteAffordanceResponse<T> {
  const record = asRecord(params.record);
  const id = stringField(record, "id");
  const title = stringField(record, "label") ?? stringField(record, "type");
  const project = pathSegment(params.projectSlug);
  const visibility = visibilityFor(record);
  const publicHref = `/worlds/${project}/relationships`;
  const links: WriteAffordanceLinkSet = {
    api: id
      ? `/projects/${project}/relationships/${pathSegment(id)}`
      : undefined,
    admin: `/projects/${project}/relationships`,
    public: maybePublicLink(visibility, publicHref),
    list: `/projects/${project}/relationships`,
  };

  const nextActions: WriteAffordanceNextAction[] = [
    {
      label: "Open relationships in project admin",
      kind: "open",
      href: links.admin,
      note: "Relationships currently expose list pages only; no detail route is advertised.",
    },
  ];

  for (const entityField of ["sourceEntity", "targetEntity"]) {
    const entityRecord = asRecord(record[entityField]);
    const entitySlug = stringField(entityRecord, "slug");
    if (entitySlug) {
      const encodedEntitySlug = pathSegment(entitySlug);
      const relatedTypeSegment = entityTypeRouteSegment(
        stringField(entityRecord, "type"),
        entityRecord,
      );
      nextActions.push({
        label: `Open related entity ${entitySlug}`,
        kind: "open",
        href:
          visibility.publicReadable === true
            ? `/worlds/${project}/entities/${encodedEntitySlug}`
            : entityAdminHref({
                project,
                typeSegment: relatedTypeSegment,
                encodedSlug: relatedTypeSegment ? encodedEntitySlug : undefined,
              }),
      });
    }
  }

  if (links.public) {
    nextActions.push({
      label: "Verify public relationship list",
      kind: "verify",
      href: links.public,
      note: `Public route is expected to work because project visibility is ${visibility.projectVisibility}.`,
    });
  }

  return {
    ok: true,
    operation: params.operation,
    contentType: "relationship",
    displayType: "Relationship",
    projectSlug: params.projectSlug,
    id,
    title,
    record: params.record,
    links,
    visibility,
    nextActions,
  };
}

export function registerTools(
  server: ToolServer,
  api: ApiClient,
  options: RegisterToolsOptions = {},
) {
  server.registerTool(
    "list_projects",
    {
      description: "List all projects",
      inputSchema: {},
    },
    async () => {
      const projects = await api("/projects");
      return jsonContent(projects);
    },
  );

  server.registerTool(
    "get_project",
    {
      description: "Get a project by slug",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const project = await api(`/projects/${projectSlug}`);
      return jsonContent(project);
    },
  );

  server.registerTool(
    "search_project",
    {
      description: "Search across all content in a project",
      inputSchema: {
        projectSlug: z.string(),
        query: z.string(),
        types: z
          .array(z.enum(["entity", "lore", "scene", "timeline"]))
          .optional(),
        limit: z.number().optional(),
      },
    },
    async ({ projectSlug, query, types, limit }) => {
      const params = new URLSearchParams({ q: query });
      if (types) params.set("types", types.join(","));
      if (limit) params.set("limit", String(limit));

      const results = await api(`/projects/${projectSlug}/search?${params}`);
      return jsonContent(results);
    },
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Retrieve a specific entity with relationships and linked content",
      inputSchema: {
        projectSlug: z.string(),
        entitySlug: z.string(),
        include: z
          .array(z.enum(["relationships", "lore", "timeline", "scenes"]))
          .optional(),
      },
    },
    async ({ projectSlug, entitySlug, include }) => {
      const params = include ? `?include=${include.join(",")}` : "";
      const entity = await api(
        `/projects/${projectSlug}/entities/${entitySlug}${params}`,
      );
      return jsonContent(entity);
    },
  );

  server.registerTool(
    "list_entities",
    {
      description: "List and filter entities in a project",
      inputSchema: {
        projectSlug: z.string(),
        type: z.string().optional(),
        tag: z.string().optional(),
        q: z.string().optional(),
      },
    },
    async ({ projectSlug, type, tag, q }) => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (tag) params.set("tag", tag);
      if (q) params.set("q", q);
      const query = params.toString() ? `?${params}` : "";

      const entities = await api(`/projects/${projectSlug}/entities${query}`);
      return jsonContent(entities);
    },
  );

  server.registerTool(
    "list_lore_articles",
    {
      description: "List and filter lore articles in a project",
      inputSchema: {
        projectSlug: z.string(),
        q: z.string().optional(),
        category: z.string().optional(),
        entity: z.string().optional(),
      },
    },
    async ({ projectSlug, q, category, entity }) => {
      const query = optionalQuery({ q, category, entity });
      const articles = await api(
        `/projects/${pathSegment(projectSlug)}/lore${query}`,
      );
      return jsonContent(articles);
    },
  );

  server.registerTool(
    "get_lore_article",
    {
      description: "Get a lore article by slug",
      inputSchema: { projectSlug: z.string(), articleSlug: z.string() },
    },
    async ({ projectSlug, articleSlug }) => {
      const article = await api(
        `/projects/${pathSegment(projectSlug)}/lore/${pathSegment(articleSlug)}`,
      );
      return jsonContent(article);
    },
  );

  server.registerTool(
    "list_timeline_events",
    {
      description: "List and filter timeline events in a project",
      inputSchema: {
        projectSlug: z.string(),
        entity: z.string().optional(),
        significance: z.string().optional(),
      },
    },
    async ({ projectSlug, entity, significance }) => {
      const query = optionalQuery({ entity, significance });
      const events = await api(
        `/projects/${pathSegment(projectSlug)}/timeline${query}`,
      );
      return jsonContent(events);
    },
  );

  server.registerTool(
    "get_timeline_event",
    {
      description: "Get a timeline event by ID",
      inputSchema: { projectSlug: z.string(), eventId: z.string() },
    },
    async ({ projectSlug, eventId }) => {
      const event = await api(
        `/projects/${pathSegment(projectSlug)}/timeline/${pathSegment(eventId)}`,
      );
      return jsonContent(event);
    },
  );

  server.registerTool(
    "list_relationships",
    {
      description: "List and filter relationships in a project",
      inputSchema: {
        projectSlug: z.string(),
        entity: z.string().optional(),
      },
    },
    async ({ projectSlug, entity }) => {
      const query = optionalQuery({ entity });
      const relationships = await api(
        `/projects/${pathSegment(projectSlug)}/relationships${query}`,
      );
      return jsonContent(relationships);
    },
  );

  server.registerTool(
    "get_relationship",
    {
      description: "Get a relationship by ID",
      inputSchema: { projectSlug: z.string(), relationshipId: z.string() },
    },
    async ({ projectSlug, relationshipId }) => {
      const relationship = await api(
        `/projects/${pathSegment(projectSlug)}/relationships/${pathSegment(
          relationshipId,
        )}`,
      );
      return jsonContent(relationship);
    },
  );

  server.registerTool(
    "list_tags",
    {
      description: "List tags in a project",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const tags = await api(`/projects/${pathSegment(projectSlug)}/tags`);
      return jsonContent(tags);
    },
  );

  server.registerTool(
    "get_tag",
    {
      description: "Get a tag by name",
      inputSchema: { projectSlug: z.string(), tagName: z.string() },
    },
    async ({ projectSlug, tagName }) => {
      const tag = await api(
        `/projects/${pathSegment(projectSlug)}/tags/${pathSegment(tagName)}`,
      );
      return jsonContent(tag);
    },
  );

  server.registerTool(
    "get_storyboard",
    {
      description:
        "Get the storyboard overview: all plotlines and works with chapters",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const storyboard = await api(`/projects/${projectSlug}/storyboard`);
      return jsonContent(storyboard);
    },
  );

  server.registerTool(
    "list_plotlines",
    {
      description: "List storyboard plotlines in a project",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const plotlines = await api(
        `/projects/${pathSegment(projectSlug)}/storyboard/plotlines`,
      );
      return jsonContent(plotlines);
    },
  );

  server.registerTool(
    "get_plotline",
    {
      description: "Get a storyboard plotline by slug",
      inputSchema: { projectSlug: z.string(), plotlineSlug: z.string() },
    },
    async ({ projectSlug, plotlineSlug }) => {
      const plotline = await api(
        `/projects/${pathSegment(projectSlug)}/storyboard/plotlines/${pathSegment(
          plotlineSlug,
        )}`,
      );
      return jsonContent(plotline);
    },
  );

  server.registerTool(
    "list_works",
    {
      description: "List storyboard works in a project",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const works = await api(
        `/projects/${pathSegment(projectSlug)}/storyboard/works`,
      );
      return jsonContent(works);
    },
  );

  server.registerTool(
    "get_work",
    {
      description: "Get a storyboard work by slug with chapters",
      inputSchema: { projectSlug: z.string(), workSlug: z.string() },
    },
    async ({ projectSlug, workSlug }) => {
      const work = await api(
        `/projects/${pathSegment(projectSlug)}/storyboard/works/${pathSegment(
          workSlug,
        )}`,
      );
      return jsonContent(work);
    },
  );

  server.registerTool(
    "list_scenes_by_chapter",
    {
      description: "List storyboard scenes for a chapter",
      inputSchema: { projectSlug: z.string(), chapterId: z.string() },
    },
    async ({ projectSlug, chapterId }) => {
      const query = optionalQuery({ chapterId });
      const scenes = await api(
        `/projects/${pathSegment(projectSlug)}/storyboard/scenes${query}`,
      );
      return jsonContent(scenes);
    },
  );

  server.registerTool(
    "get_entity_types",
    {
      description:
        "List all entity types and their field schemas for a project",
      inputSchema: { projectSlug: z.string() },
    },
    async ({ projectSlug }) => {
      const types = await api(`/projects/${projectSlug}/entity-types`);
      return jsonContent(types);
    },
  );

  if (writeToolIsAllowed(options, "create_entity")) {
    server.registerTool(
      "create_entity",
      {
        description:
          "Submit a staged entity draft for project review; this does not create or mutate a canonical entity until an authorized reviewer approves and applies it",
        inputSchema: {
          projectSlug: z.string(),
          type: z.enum(["CHARACTER", "LOCATION", "ORGANIZATION", "ITEM"]),
          name: z.string(),
          summary: z.string().optional(),
          description: z.string().optional(),
          backstory: z.string().optional(),
          secrets: z.string().optional(),
          notes: z.string().optional(),
          tags: z.array(z.string()).optional(),
        },
      },
      async ({ projectSlug, ...data }) => {
        const draft = await api(`/projects/${projectSlug}/drafts/entities`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        const stagedDraft = { ...asRecord(draft), proposedData: data };
        return jsonContent(
          buildDraftEntityAffordance({
            projectSlug,
            record: stagedDraft,
          }),
        );
      },
    );
  }

  if (writeToolIsAllowed(options, "update_entity")) {
    server.registerTool(
      "update_entity",
      {
        description:
          "Update an existing entity and return the record plus post-write admin/public route affordances, visibility rationale, and next actions",
        inputSchema: {
          projectSlug: z.string(),
          entitySlug: z.string(),
          updates: z.record(z.string(), z.any()),
        },
      },
      async ({ projectSlug, entitySlug, updates }) => {
        const entity = await api(
          `/projects/${projectSlug}/entities/${entitySlug}`,
          {
            method: "PATCH",
            body: JSON.stringify(updates),
          },
        );
        return jsonContent(
          buildEntityAffordance({
            operation: "update",
            projectSlug,
            record: entity,
            previousSlug: entitySlug,
          }),
        );
      },
    );
  }

  if (writeToolIsAllowed(options, "create_relationship")) {
    server.registerTool(
      "create_relationship",
      {
        description:
          "Create a relationship between two entities and return the record plus list-only admin/public affordances, visibility rationale, and next actions",
        inputSchema: {
          projectSlug: z.string(),
          sourceEntitySlug: z.string(),
          targetEntitySlug: z.string(),
          type: z.string(),
          label: z.string().optional(),
          metadata: z.record(z.string(), z.any()).optional(),
          bidirectional: z.boolean().optional(),
        },
      },
      async ({ projectSlug, ...data }) => {
        const rel = await api(`/projects/${projectSlug}/relationships`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        return jsonContent(
          buildRelationshipAffordance({
            operation: "create",
            projectSlug,
            record: rel,
          }),
        );
      },
    );
  }

  if (writeToolIsAllowed(options, "create_lore_article")) {
    server.registerTool(
      "create_lore_article",
      {
        description:
          "Create a lore article linked to entities and return the record plus post-write admin/public route affordances, visibility rationale, and next actions",
        inputSchema: {
          projectSlug: z.string(),
          title: z.string(),
          content: z.string(),
          category: z.string().optional(),
          canonStatus: z
            .enum(["draft", "staging", "provisional", "canon"])
            .optional(),
          tags: z.array(z.string()).optional(),
          entitySlugs: z.array(z.string()).optional(),
        },
      },
      async ({ projectSlug, ...data }) => {
        const article = await api(`/projects/${projectSlug}/lore`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        return jsonContent(
          buildLoreArticleAffordance({
            operation: "create",
            projectSlug,
            record: article,
          }),
        );
      },
    );
  }

  server.resource(
    "project_overview",
    "loreum://project/{projectSlug}/overview",
    async (uri) => {
      const projectSlug = uri.pathname.split("/")[1];
      const overview = await api(`/projects/${projectSlug}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(overview, null, 2),
          },
        ],
      };
    },
  );
}
