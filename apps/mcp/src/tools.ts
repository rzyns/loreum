import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ApiClient } from "./api.js";

export type { ApiClient } from "./api.js";

type ToolServer = Pick<McpServer, "registerTool" | "resource">;

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

export function registerTools(server: ToolServer, api: ApiClient) {
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

  server.registerTool(
    "create_entity",
    {
      description: "Create a new entity in a project",
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
      const entity = await api(`/projects/${projectSlug}/entities`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return jsonContent(entity);
    },
  );

  server.registerTool(
    "update_entity",
    {
      description: "Update an existing entity",
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
      return jsonContent(entity);
    },
  );

  server.registerTool(
    "create_relationship",
    {
      description: "Create a relationship between two entities",
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
      return jsonContent(rel);
    },
  );

  server.registerTool(
    "create_lore_article",
    {
      description: "Create a lore article linked to entities",
      inputSchema: {
        projectSlug: z.string(),
        title: z.string(),
        content: z.string(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        entitySlugs: z.array(z.string()).optional(),
      },
    },
    async ({ projectSlug, ...data }) => {
      const article = await api(`/projects/${projectSlug}/lore`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return jsonContent(article);
    },
  );

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
