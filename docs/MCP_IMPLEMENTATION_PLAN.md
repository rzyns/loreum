# MCP Implementation Plan

Scoped plan for completing the MCP server to a testable state. Covers API prerequisites, auth, review queue, and MCP tool expansion.

**Created:** 2026-04-24
**Updated:** 2026-05-09
**Status:** Phases 1–3 read expansion complete; write safety now follows the newer `DraftProposal`/`AuditEvent` lifecycle design for new implementation work
**Reference:** See TODO.md > Near-Term for task tracking

---

## Review Summary

### What exists today

The MCP server (`apps/mcp/src/index.ts`, with tool registration in `apps/mcp/src/tools.ts`) is a stdio server with:

- Read-only tools for project navigation, entity reads, search, lore, timeline, relationships, tags, and storyboard navigation:
  - Projects: `list_projects`, `get_project`
  - Search/entities: `search_project`, `list_entities`, `get_entity`, `get_entity_types`
  - Lore: `list_lore_articles`, `get_lore_article`
  - Timeline: `list_timeline_events`, `get_timeline_event`
  - Relationships: `list_relationships`, `get_relationship`
  - Tags: `list_tags`, `get_tag`
  - Storyboard: `get_storyboard`, `list_plotlines`, `get_plotline`, `list_works`, `get_work`, `list_scenes_by_chapter`
- 4 existing write tools: `create_entity`, `update_entity`, `create_relationship`, `create_lore_article`
- 1 resource: `project_overview`
- A simple `api()` helper that throws on HTTP errors
- Auth via `MCP_API_TOKEN` env var (API key with `lrm_` prefix, Bearer token)
- API key system with generate/list/revoke, project-scoped target permissions (`READ_ONLY`, `DRAFT_WRITE`, `CANONICAL_WRITE`), with `READ_WRITE` retained only as a legacy compatibility alias for `CANONICAL_WRITE`

### Read expansion note (2026-04-29)

The MCP read surface is now broad enough for an agent to navigate from projects into entities, lore, timelines, relationships, tags, and storyboard structures using tools backed by existing API endpoints. Storyboard scene access is intentionally limited to `list_scenes_by_chapter`, which requires a known chapter ID obtained from work/chapter structure.

Legacy note: this April plan predates the Phase-2 `DraftProposal`/`AuditEvent` design. New MCP write-safety work should route through draft proposal endpoints and should not expand the older `PendingChange` sketch unless a deliberate migration/retirement task chooses to do so.

Intentionally deferred items:

- Direct `get_scene` support.
- Direct `get_chapter` / `list_chapters` support.
- Write safety via the Phase-2 `DraftProposal`/`AuditEvent` lifecycle for MCP mutations.

MCP tool tests use fake API calls against the extracted tool-registration seam. They verify URL construction and JSON text responses without requiring a live API server, Postgres, or secrets.

### What's done

**Phase 1 (API Key Auth) — Complete:**

- `ApiKey` Prisma model with SHA-256 hashing, permissions enum, expiration, revocation
- API key service (generate, list, revoke, validate) + controller endpoints
- `ApiKeyAuthGuard` accepts both cookie JWTs and Bearer API keys
- API key management UI in project settings

**Phase 2 (Fix Broken Endpoints) — Complete:**

- `GET /projects/:slug/search` — basic Prisma-backed search across entities, lore, timeline events, and scenes (OpenSearch remains long-term)
- `GET /projects/:slug/entities/:slug` — entity hub aggregation with relationships, lore, timeline, tags
- `GET /projects/:slug/storyboard` — overview with plotlines + works/chapters/scene counts
- `get_entity_hub` tool removed from MCP (entity detail endpoint serves its purpose)

### What's remaining

**Direct chapter/scene reads are intentionally deferred:** MCP can read scenes by known chapter ID via `list_scenes_by_chapter`, but direct `get_scene`, `get_chapter`, and `list_chapters` tools are not exposed until matching API read seams are deliberately added.

**Search is basic, not full-text infrastructure:** The `search_project` tool now returns real Prisma `contains` results. OpenSearch/search-vector work remains long-term.

**Write tools and review queue:** New implementation work supersedes the older `PendingChange`-only sketch with the Phase-2 `DraftProposal`/`AuditEvent` lifecycle. MCP mutation tools should stage through draft proposal endpoints unless a future cleanup deliberately migrates or retires the legacy `PendingChange` model.

**Style Guide doesn't exist yet:** The model, migration, service, controller, and schema fields (`voiceNotes`, `styleNotes`) are all long-term work. The `get_style_guide` and `set_style_guide` MCP tools cannot be built until the Style Guide feature is implemented.

---

## Implementation Order

### Phase 1: API Key Authentication — COMPLETE

**Goal:** Users can generate project-scoped API keys and use them as Bearer tokens.

**Delivered:**

- `ApiKey` Prisma model + migration (SHA-256 hash, `lrm_` prefix, permissions enum)
- API key service: generate, list, revoke, validate with `lastUsedAt` tracking
- Controller: `POST/GET/DELETE /projects/:slug/api-keys`
- `ApiKeyAuthGuard` accepts both cookie JWTs and Bearer API keys
- Management UI in project settings

### Phase 2: Fix Broken API Endpoints — COMPLETE

**Goal:** MCP read tools no longer 404.

**Delivered:**

- `GET /projects/:slug/search` — basic Prisma-backed search across entities, lore, timeline events, and scenes (OpenSearch remains long-term)
- `GET /projects/:slug/entities/:slug` — entity detail with full hub data (relationships, lore, timeline, tags)
- `GET /projects/:slug/storyboard` — overview with plotlines + works/chapters/scene counts
- Removed `get_entity_hub` MCP tool (entity detail endpoint covers it)

### Phase 3: Complete MCP Read Tools + Search

**Goal:** Broad read coverage over existing API read seams, plus working basic search.

**Scope:** MCP tools in `apps/mcp/`, plus API work for search. Direct scene/chapter APIs remain a separate follow-up unless exposed by existing endpoints.

#### 3a. Search implementation (`apps/api/`)

Implemented basic Prisma `contains` search across all content types:

- Query entities (name, summary, description), lore articles (title, content), timeline events (title, description), scenes (title, content)
- Filter by `types` array (entity, lore, timeline, scene)
- Return unified result format: `{ results: [{ type, slug, name/title, excerpt }], total }`
- Prisma `contains` is sufficient for now (OpenSearch is long-term)

#### 3b. New MCP read tools (`apps/mcp/`)

All API endpoints already exist. MCP-side only.

| Tool                     | API Endpoint                                         | Notes                                          |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------- |
| `list_projects`          | `GET /projects`                                      | List user's projects                           |
| `get_project`            | `GET /projects/:slug`                                | Project detail (replaces resource-only access) |
| `list_relationships`     | `GET /projects/:slug/relationships?entity=`          | Relationships, optionally filtered by entity   |
| `get_relationship`       | `GET /projects/:slug/relationships/:id`              | Single relationship detail                     |
| `list_timeline_events`   | `GET /projects/:slug/timeline?entity=&significance=` | Timeline events with optional filters          |
| `get_timeline_event`     | `GET /projects/:slug/timeline/:id`                   | Single event detail                            |
| `list_lore_articles`     | `GET /projects/:slug/lore?q=&category=&entity=`      | Filter lore articles                           |
| `get_lore_article`       | `GET /projects/:slug/lore/:slug`                     | Single lore article                            |
| `list_tags`              | `GET /projects/:slug/tags`                           | All tags in a project                          |
| `get_tag`                | `GET /projects/:slug/tags/:name`                     | Single tag detail                              |
| `list_plotlines`         | `GET /projects/:slug/storyboard/plotlines`           | Project plotlines                              |
| `get_plotline`           | `GET /projects/:slug/storyboard/plotlines/:slug`     | Plotline with plot points                      |
| `list_works`             | `GET /projects/:slug/storyboard/works`               | Works in a project                             |
| `get_work`               | `GET /projects/:slug/storyboard/works/:slug`         | Work with chapters and scene structure         |
| `list_scenes_by_chapter` | `GET /projects/:slug/storyboard/scenes?chapterId=`   | Scenes in a known chapter                      |

#### 3c. Quality pass

- Improve tool descriptions (clear, specific, no jargon)
- Add response shaping (strip `createdAt`/`updatedAt`/internal IDs where noisy, flatten nesting)
- Fix `api()` error handling (return structured MCP errors instead of throwing)

**Test gate:** From Claude Desktop, an AI can navigate from projects → entities → relationships → lore → timeline → storyboard scenes without hitting any dead ends. Search returns real results.

### Phase 4: Review Queue (API + MCP + UI)

**Goal:** All MCP write operations stage changes as `DraftProposal` records, with `AuditEvent` history, instead of writing directly. Users review and approve/apply or reject from the API/UI.

**Scope:** API-side service + controller, MCP tool handler updates, web UI.

#### API work (`apps/api/`)

1. Draft proposal service:
   - Create `DraftProposal` rows with actor/source metadata, batch grouping, operation, target type, proposed data, and display fields
   - `listByProject(projectId, { status?, batchId? })`
   - `approveAndApply(id)` — apply `proposedData` to the canonical target under the draft lifecycle, set status APPLIED, and write audit history
   - `reject(id)` — reject only pre-approval draft states and write audit history
   - `batchApproveAndApply(batchId)` — approve/apply all eligible submitted drafts in batch, in dependency order (creates before relationships)
   - Snapshot `previousData` on update/delete for diff display

2. Draft proposal controller:
   - `GET /projects/:slug/drafts/entities?status=&batchId=` (or the generic draft-list endpoint chosen by the draft lifecycle API)
   - `POST /projects/:slug/drafts/entities/:id/approve`
   - `POST /projects/:slug/drafts/entities/:id/reject`
   - Batch approval remains a follow-up once dependency ordering is designed

#### MCP work (`apps/mcp/`)

3. Update existing write tools (`create_entity`, `update_entity`, `create_relationship`, `create_lore_article`) to:
   - Call a draft proposal endpoint instead of the direct CRUD endpoint
   - Return confirmation that the change was staged, not applied
   - Include `batchId` (generated per MCP session or conversation)

4. Update `api()` helper to return structured MCP errors instead of throwing (if not done in Phase 3)

#### Web UI work (`apps/web/`)

5. Review queue page: list pending changes grouped by batch
6. Per-change accept/reject buttons
7. Batch accept/reject buttons
8. Diff view for updates (before/after)
9. Preview for creates
10. Sidebar badge showing pending count

**Test gate:** From Claude Desktop, create an entity via MCP. Verify it appears in the review queue (not in the entity list). Accept it from the web UI. Verify it now appears in the entity list.

### Phase 5: Expand MCP Write Tools (blocked on Phase 4)

**Goal:** Add the remaining mutation tools, all routing through `DraftProposal` staging.

| Tool                    | API Endpoint             | Notes |
| ----------------------- | ------------------------ | ----- |
| `update_lore_article`   | Staged via DraftProposal |       |
| `delete_entity`         | Staged via DraftProposal |       |
| `delete_relationship`   | Staged via DraftProposal |       |
| `delete_lore_article`   | Staged via DraftProposal |       |
| `create_timeline_event` | Staged via DraftProposal |       |
| `update_timeline_event` | Staged via DraftProposal |       |
| `delete_timeline_event` | Staged via DraftProposal |       |
| `create_scene`          | Staged via DraftProposal |       |
| `update_scene`          | Staged via DraftProposal |       |
| `create_plot_point`     | Staged via DraftProposal |       |
| `update_plot_point`     | Staged via DraftProposal |       |

---

## Out of Scope

These are explicitly deferred and should not be built during this work:

- **Style Guide MCP tools** (`get_style_guide`, `set_style_guide`) — blocked on Style Guide model/migration/service/controller which is long-term work
- **Streamable HTTP transport** — stdio is sufficient for testing; HTTP transport is a follow-up
- **OAuth2 discovery endpoint** — depends on HTTP transport
- **Redis rate limiting** — not needed until remote HTTP transport exists
- **Permission-scoped tool filtering** — nice-to-have after auth works, not required for testability

---

## Architecture Boundaries

- The MCP server is an HTTP client to the API. It does NOT import services or access the database directly.
- API endpoint work (search, hub, storyboard, auth, review queue) happens in `apps/api/`.
- MCP tool work (handlers, response shaping, error handling) happens in `apps/mcp/`.
- Review queue UI work happens in `apps/web/`.
- The MCP server contains no business logic. If a handler needs an if/else that makes a domain decision, it belongs in the API.
