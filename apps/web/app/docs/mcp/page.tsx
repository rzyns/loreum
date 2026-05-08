"use client";

import Link from "next/link";
import { Button } from "@loreum/ui/button";

export default function McpDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="mb-8">
        <Link
          href="/docs"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to docs
        </Link>
      </div>

      <h1 className="mb-4 text-3xl font-bold">MCP Server</h1>
      <p className="mb-8 text-muted-foreground">
        Connect AI assistants like Claude to your Loreum world data using the
        Model Context Protocol. Read-only access is the safe default; write
        tools require explicit server-side opt-in and a read-write project API
        key.
      </p>

      <div className="prose prose-invert max-w-none space-y-8">
        <section>
          <h2>What is MCP?</h2>
          <p className="text-muted-foreground">
            MCP (Model Context Protocol) is an open standard that lets AI
            assistants connect to external tools and data sources. Loreum&apos;s
            MCP server exposes your world data as structured tools the AI can
            call. The AI reads your characters, relationships, timeline, lore,
            and style guide. Write-capable tools are guarded separately from
            read access and should only be enabled for trusted, reviewed
            deployments.
          </p>
        </section>

        <section>
          <h2>Authentication</h2>
          <p className="text-sm text-muted-foreground">
            Generate a project-scoped API key from your project settings page.
            Each key has a name (e.g. &quot;Claude Desktop&quot;), a permission
            level (read-only or read-write), and an optional expiration date.
            The key is displayed once on creation. Copy it and add it to your
            MCP client configuration.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            You can generate multiple keys per project and revoke any key at any
            time from project settings. Read-only keys can read project data but
            cannot call mutation routes. Read-write keys are still scoped to the
            project they were issued for.
          </p>
        </section>

        <section>
          <h2>Setup for Claude Desktop</h2>
          <p className="text-sm text-muted-foreground">
            Add this to your Claude Desktop MCP configuration file:
          </p>
          <pre className="rounded-lg bg-muted p-4 text-sm">
            {`{
  "mcpServers": {
    "loreum": {
      "command": "node",
      "args": ["path/to/loreum/apps/mcp/dist/index.js"],
      "env": {
        "MCP_API_BASE_URL": "https://loreum.app/v1",
        "MCP_API_TOKEN": "your-api-key"
      }
    }
  }
}`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Replace <code className="rounded bg-muted px-1">your-api-key</code>{" "}
            with the key you generated in project settings. For local
            development, use{" "}
            <code className="rounded bg-muted px-1">
              http://localhost:3021/v1
            </code>{" "}
            as the base URL.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            For HTTP deployments, keep the server read-only unless an operator
            explicitly sets{" "}
            <code className="rounded bg-muted px-1">
              MCP_ENABLE_WRITES=true
            </code>{" "}
            and a narrow{" "}
            <code className="rounded bg-muted px-1">MCP_WRITE_TOOLS</code>{" "}
            allowlist such as{" "}
            <code className="rounded bg-muted px-1">create_entity</code>.
          </p>
        </section>

        <section>
          <h2>Read Tools</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            These tools let the AI query your world data. Available with both
            read-only and read-write API keys.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Tool</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    search_project
                  </td>
                  <td className="px-4 py-2">
                    Full-text search across entities, lore, scenes, and timeline
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">get_entity</td>
                  <td className="px-4 py-2">
                    Single entity with optional relationships, lore, scenes, and
                    timeline
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    get_entity_hub
                  </td>
                  <td className="px-4 py-2">
                    Full aggregated page for an entity with all connected
                    content
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">list_entities</td>
                  <td className="px-4 py-2">
                    List and filter entities by type, tag, or search query
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    get_storyboard
                  </td>
                  <td className="px-4 py-2">
                    Narrative structure: plotlines, works, chapters, scenes
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    get_entity_types
                  </td>
                  <td className="px-4 py-2">
                    Entity types and their field schemas
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    get_style_guide
                  </td>
                  <td className="px-4 py-2">
                    Base style guide, scene overrides, and character voice notes
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">get_timeline</td>
                  <td className="px-4 py-2">
                    Timeline events and eras for a project
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    get_lore_article
                  </td>
                  <td className="px-4 py-2">
                    Single lore article with linked entities
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    list_lore_articles
                  </td>
                  <td className="px-4 py-2">
                    List and filter lore articles by category or tag
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">
                    get_relationships
                  </td>
                  <td className="px-4 py-2">
                    Relationships for a specific entity
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Write Tools</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            These direct-write tools are hidden in read-only mode. Remote HTTP
            deployments should expose none of them by default. Enabling any
            write tool requires API-side permission and project-scope
            enforcement, <code>MCP_ENABLE_WRITES=true</code>, and a narrow{" "}
            <code>MCP_WRITE_TOOLS</code> allowlist. Start with{" "}
            <code>create_entity</code> only for disposable-project smoke tests.
            Successful writes return a typed post-write envelope that preserves
            the raw domain record under <code>record</code> and adds
            content/display type, project slug, admin/project URLs, public/world
            URL hints when visibility is proven, visibility rationale, and next
            actions. Public links are omitted when content is private or public
            readability is unknown.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Tool</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">create_entity</td>
                  <td className="px-4 py-2">
                    Create a character, location, organization, or item; returns
                    the record plus admin/public route affordances, visibility,
                    and next actions
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">update_entity</td>
                  <td className="px-4 py-2">
                    Partial update to an existing entity; returns updated route
                    affordances and notes slug changes when applicable
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">
                    create_relationship
                  </td>
                  <td className="px-4 py-2">
                    Create a relationship between two entities; returns
                    list-only relationship affordances because relationship
                    detail routes are not advertised
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">
                    create_lore_article
                  </td>
                  <td className="px-4 py-2">
                    Create a lore article linked to entities; returns the record
                    plus admin/project URL, public/world hint when proven,
                    visibility rationale, and next actions
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Review Queue</h2>
          <p className="text-sm text-muted-foreground">
            The review queue is the intended safety model for AI-proposed
            changes, but the current MCP mutation handlers are direct-write
            tools. Until review-queue-backed writes are implemented, keep remote
            MCP deployments read-only unless a trusted operator explicitly
            enables a narrow write allowlist for a disposable or staging
            project.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Once review-queue-backed writes are implemented, proposed changes
            should show the operation type, target, and diff before any canon
            data is applied.
          </p>
        </section>

        <section>
          <h2>Example Usage</h2>
          <p className="text-sm text-muted-foreground">
            Once connected, you can ask Claude things like:
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              &quot;Who are the main characters in my Star Wars project?&quot;
            </li>
            <li>&quot;What relationships does Luke Skywalker have?&quot;</li>
            <li>&quot;What factions control the Iron Citadel?&quot;</li>
            <li>
              &quot;Which lore articles mention the history of the Jedi
              Order?&quot;
            </li>
            <li>&quot;What does my style guide say about dialogue?&quot;</li>
            <li>
              &quot;Show me timeline events near the Battle of Yavin.&quot;
            </li>
            <li>&quot;Is there anything contradictory in my timeline?&quot;</li>
          </ul>
        </section>

        <section>
          <h2>Self-Hosting</h2>
          <p className="text-sm text-muted-foreground">
            The MCP server is included in the Loreum repository at{" "}
            <code className="rounded bg-muted px-1">apps/mcp/</code>. Build it
            with{" "}
            <code className="rounded bg-muted px-1">
              pnpm --filter mcp build
            </code>{" "}
            and run with{" "}
            <code className="rounded bg-muted px-1">node dist/index.js</code>.
          </p>
        </section>
      </div>

      <div className="mt-12">
        <a
          href="https://github.com/loreum-app/loreum"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline">View source on GitHub</Button>
        </a>
      </div>
    </div>
  );
}
