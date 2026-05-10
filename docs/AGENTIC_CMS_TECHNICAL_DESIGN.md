# Agentic CMS Audit/Draft Technical Design

Date: 2026-05-03
Status: Phase 2 technical design, hardened against current repo state on 2026-05-09
Source plan: `.hermes/plans/2026-05-03_loreum-agentic-cms-phase-2.md`
Product spec: `docs/AGENTIC_CMS_DRAFT_LIFECYCLE_SPEC.md`
Storage research: internal planning artifact from the Phase-2 Kanban batch; not required to implement or review this repo doc.

## 1. Purpose

Implement the first vertical slice of Loreum's agent-assisted CMS foundation:

- MCP/API agent writes submit reviewable drafts, not canonical records.
- Canonical project graph mutation happens only through explicit approval/application.
- Draft submission, review, approval, application, and failures are captured in an append-only audit log.
- Users, API keys, and agents are represented as project-scoped actors with capabilities.
- Operational provenance (`human`, `agent`, `imported`, `generated`, `system`) stays in the audit/review layer and does not overload in-world lore provenance.

This design intentionally keeps Phase 2 on standard PostgreSQL + Prisma. Dolt/DoltgreSQL remains a future prototype/decision gate, not a dependency of the first slice.

## 2. Current repo observations

Original inspection baseline: `main == origin/main == 07a8b104d91afad88cf01f3af7a169f68dd2b5a3`.

Doc-hardening baseline: `main == origin/main == a12896bd095da5927c26e4c0ec4c610fffd1c79e` (`feat(lore): add canon status and search verification`). The later canon-status/search work does not change the draft/audit first-slice direction, but it adds an important vocabulary boundary: `LoreArticleCanonStatus` (`draft`, `staging`, `provisional`, `canon`) is lore/publication status for lore articles, not the operational `DraftStatus` lifecycle for reviewable proposed changes.

Relevant current code:

- Prisma schema: `apps/api/prisma/schema.prisma`
  - `Project` owns canonical graph records and currently has `apiKeys` and `pendingChanges` relations.
  - `Entity` and extension tables (`Character`, `Location`, `Organization`, `Item`) are canonical records.
  - `LoreArticle` now has `canonStatus LoreArticleCanonStatus @default(provisional)` for content canon/publication state. Do not conflate this with operational draft/proposal review states.
  - Existing MCP/review queue primitives are `ApiKey`, `PendingChange`, `ChangeOperation`, and `ChangeStatus`.
  - `ApiKeyPermission` is currently binary: `READ_ONLY | READ_WRITE`.
- API entity write path:
  - `apps/api/src/entities/entities.controller.ts` `POST /v1/projects/:projectSlug/entities` calls `EntitiesService.create(...)` directly.
  - `apps/api/src/entities/entities.service.ts` `create(...)` inserts into canonical `entity` and extension tables immediately.
- MCP write path:
  - `apps/mcp/src/tools.ts` registers `create_entity` when write tools are enabled.
  - `create_entity` currently POSTs to `/projects/:projectSlug/entities` and returns the API response, so a write-enabled MCP call is canonical today.
- Auth/API key path:
  - `apps/api/src/auth/guards/api-key-auth.guard.ts` validates project scope and blocks mutations unless API key permission is `READ_WRITE`.
  - API-key-authenticated requests are represented in `AuthUser.apiKey`, but the API key mode is not expressive enough for draft-write vs canonical-write.
- Existing tests:
  - `apps/api/src/entities/entities.spec.ts` asserts canonical creation on POST.
  - `apps/mcp/src/tools.test.ts` asserts the tool registry and wire paths; it will need expectation updates for draft-first semantics.

Important implication: Phase 2 must add a new draft/application path before changing the MCP `create_entity` path. Otherwise the existing `EntitiesService.create(...)` remains the only behavior and MCP writes still mutate canon.

## 3. First vertical slice decision

Build the first slice around `create_entity` only.

In scope:

1. Add durable draft/proposal tables sufficient for submitted create-entity proposals.
2. Add an append-only `AuditEvent` foundation.
3. Add project-scoped actor/capability checks sufficient for:
   - API key draft submission.
   - Human owner/local test approval.
   - Self-approval denial unless explicitly allowed.
4. Add API endpoints/service methods for:
   - Submit entity draft.
   - Approve/apply entity draft synchronously.
   - Reject entity draft.
   - Read draft/review queue records for tests and minimal admin/API use.
5. Change MCP `create_entity` to submit a draft and return staged/not-canonical language.
6. Preserve canonical read paths as canonical-only.

Out of scope for the first slice:

- Remote MCP write-mode enablement.
- Deployment or homelab stack changes.
- Dolt/DoltgreSQL.
- Broad review queue UI polish beyond the current local project Review queue and Activity surfaces.
- Drafts for relationships, lore articles, timeline, storyboard, imports, or batch dependency resolution.
- Direct canonical write by trusted agents.
- Async application jobs unless synchronous application proves unworkable.

## 4. Data model

### 4.1 Enums

Add explicit vocabularies instead of overloading string fields or the existing binary API-key permission.

Recommended Prisma enums:

```prisma
enum ActorKind {
  HUMAN
  AGENT
  IMPORTED
  GENERATED
  SYSTEM
}

enum ContentSourceKind {
  MANUAL
  COLLABORATOR_SUGGESTION
  MCP_AGENT
  IN_APP_AI
  IMPORT
  SYSTEM
}

enum DraftTargetType {
  ENTITY
  RELATIONSHIP
  LORE_ARTICLE
  TIMELINE_EVENT
  STORYBOARD_RECORD
  PROJECT_METADATA
}

enum DraftOperation {
  CREATE
  UPDATE
  DELETE
  LINK
  UNLINK
  REORDER
  BULK_IMPORT
}

enum DraftStatus {
  DRAFT
  SUBMITTED
  CHANGES_REQUESTED
  APPROVED
  APPLIED
  REJECTED
  WITHDRAWN
  SUPERSEDED
  APPLICATION_FAILED
}

enum AuditOutcome {
  SUCCESS
  FAILURE
}

enum ApiKeyPermission {
  READ_ONLY
  DRAFT_WRITE
  DRAFT_WRITE_SELF_APPROVE
  CANONICAL_WRITE
}
```

Migration note: replace the current `READ_WRITE` default with `DRAFT_WRITE` for agent-safe write behavior. If compatibility is needed, migrate existing `READ_WRITE` keys according to deployment policy:

- Conservative default: `READ_WRITE -> DRAFT_WRITE`.
- Only manually reviewed/internal keys should ever become `CANONICAL_WRITE`.
- Existing remote resting state should remain read-only unless Janusz explicitly approves otherwise.

### 4.2 Project capability model

Do not try to solve full collaboration roles before the draft/audit slice lands. Add a minimal project-scoped role/capability substrate that can grow.

Recommended first schema:

```prisma
enum ProjectActorRole {
  OWNER
  REVIEWER
  CONTRIBUTOR
  VIEWER
  AGENT
}

model ProjectMembership {
  id           String             @id @default(cuid())
  projectId    String
  userId       String
  role         ProjectActorRole
  capabilities String[]           @default([])
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId])
  @@map("project_memberships")
}
```

Add `memberships ProjectMembership[]` to `Project` and `projectMemberships ProjectMembership[]` to `User`.

First-slice capability strings:

- `project:read`
- `canonical:read`
- `canonical:apply_draft`
- `draft:create`
- `draft:submit`
- `draft:review`
- `draft:approve`
- `draft:self_approve`
- `draft:reject`
- `audit:read_summary`
- `audit:read_detail`

Owner fallback: until memberships are backfilled everywhere, `Project.ownerId == user.id` should imply the owner capability bundle in the authorization service. The migration can also create explicit OWNER memberships for existing projects.

API keys should not be memberships. Treat API keys as scoped credentials that belong to a project and can submit drafts according to `ApiKeyPermission`; the acting human owner/user remains visible via `ApiKey.userId`, but `ActorKind.AGENT`/`ContentSourceKind.MCP_AGENT` should be used for MCP draft submissions.

### 4.3 Draft/proposal tables

Use a generic proposal table now, but constrain the first service implementation to `DraftTargetType.ENTITY` + `DraftOperation.CREATE`.

```prisma
model DraftProposal {
  id              String            @id @default(cuid())
  projectId       String
  batchId         String            @default(uuid())
  targetType      DraftTargetType
  operation       DraftOperation
  targetId        String?
  status          DraftStatus       @default(SUBMITTED)

  // Proposed normalized domain payload. For create_entity this stores the
  // CreateEntityDto-compatible payload plus the proposed slug/display summary.
  proposedData    Json              @default("{}")
  previousData    Json?
  validation      Json              @default("{}")

  displayName     String
  displaySummary  String?           @db.Text
  reviewNote      String?           @db.Text
  rejectionReason String?           @db.Text
  failureCode     String?
  failureMessage  String?           @db.Text

  submittedByKind ActorKind
  submittedByUserId String?
  submittedByApiKeyId String?
  submittedByLabel String
  sourceKind      ContentSourceKind

  reviewedByUserId String?
  reviewedAt      DateTime?
  appliedTargetId String?
  appliedAt       DateTime?

  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  project          Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  submittedByApiKey ApiKey?         @relation(fields: [submittedByApiKeyId], references: [id], onDelete: SetNull)
  auditEvents      AuditEvent[]

  @@index([projectId, status, createdAt])
  @@index([projectId, targetType, operation])
  @@index([batchId])
  @@map("draft_proposals")
}
```

Add relation fields:

- `Project.draftProposals DraftProposal[]`
- `ApiKey.draftProposals DraftProposal[]`

Why keep `PendingChange` separate initially?

- The current `PendingChange` model is under-specified for audit/source/capability semantics.
- Renaming in place may be more disruptive than adding the correct model and later migrating/deleting `PendingChange`.
- First-slice implementers can leave `PendingChange` unused/deprecated unless they decide a careful rename migration is simpler.

### 4.4 Audit event table

Use an append-only table written by application services. Do not rely on DB triggers for the first slice; service-written events can include actor/capability/request context that triggers cannot reliably know.

```prisma
model AuditEvent {
  id              String            @id @default(cuid())
  projectId       String
  eventType       String
  outcome         AuditOutcome      @default(SUCCESS)

  actorKind       ActorKind
  actorUserId     String?
  actorApiKeyId   String?
  actorLabel      String
  sourceKind      ContentSourceKind

  operation       DraftOperation?
  targetType      DraftTargetType?
  targetId        String?
  targetModel     String?
  targetDisplay   String?
  draftId         String?
  batchId         String?
  approvalId      String?

  summary         String            @db.Text
  oldData         Json?
  newData         Json?
  diff            Json?
  metadata        Json              @default("{}")
  capabilityContext Json            @default("{}")

  requestId       String?
  correlationId   String?
  causationId     String?
  schemaVersion   Int               @default(1)
  streamKey       String?
  streamVersion   Int?

  occurredAt      DateTime          @default(now())
  committedAt     DateTime          @default(now())

  project         Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  draft           DraftProposal?    @relation(fields: [draftId], references: [id], onDelete: SetNull)

  @@index([projectId, occurredAt])
  @@index([projectId, eventType, occurredAt])
  @@index([projectId, actorKind, occurredAt])
  @@index([draftId])
  @@index([batchId])
  @@map("audit_events")
}
```

Add `Project.auditEvents AuditEvent[]`.

Append-only guardrail:

- Application code must never update/delete `AuditEvent` rows in normal flows.
- Tests should verify draft/application flows create additional events rather than modifying previous events.
- A later DB-level trigger or restricted DB role can enforce immutability, but service-level discipline plus tests is enough for the first local slice.

### 4.5 Optional canonical history table

Do not include canonical history tables in the first implementation unless the audit slice is ahead of schedule. The near-term audit table records enough for the first changelog. If point-in-time canonical reconstruction becomes a requirement, add typed history tables later, beginning with `EntityHistory` keyed by `auditEventId` and `validFrom/validTo`.

## 5. Service boundaries

Add new API-side modules rather than stuffing draft/audit behavior into `EntitiesService`.

Recommended files:

- `apps/api/src/audit/audit.module.ts`
- `apps/api/src/audit/audit.service.ts`
- `apps/api/src/audit/audit-redaction.ts`
- `apps/api/src/authorization/project-capabilities.service.ts` or `apps/api/src/auth/project-capabilities.service.ts`
- `apps/api/src/drafts/drafts.module.ts`
- `apps/api/src/drafts/drafts.service.ts`
- `apps/api/src/drafts/drafts.controller.ts`
- `apps/api/src/drafts/dto/submit-entity-draft.dto.ts`
- `apps/api/src/drafts/dto/review-draft.dto.ts`

### 5.1 ActorContext

Introduce a typed context instead of passing loose `user` objects through every service.

```ts
export type ActorContext = {
  projectId: string;
  projectSlug: string;
  kind: "HUMAN" | "AGENT" | "IMPORTED" | "GENERATED" | "SYSTEM";
  sourceKind:
    | "MANUAL"
    | "MCP_AGENT"
    | "IMPORT"
    | "IN_APP_AI"
    | "SYSTEM"
    | "COLLABORATOR_SUGGESTION";
  userId?: string;
  apiKeyId?: string;
  label: string;
  capabilities: string[];
  requestId?: string;
  correlationId?: string;
};
```

Controller/guard logic should build this once from `AuthUser`, project, and request metadata. This keeps audit/draft code explicit and avoids ambiguous `map[string]any` style context.

### 5.2 ProjectCapabilitiesService

Responsibilities:

- Resolve effective capabilities for a human user in a project.
- Resolve effective capabilities for an API-key actor.
- Enforce project scope.
- Require self-approval capability when reviewer and submitter are the same principal.

Initial mapping:

- Project owner human: all first-slice capabilities, including `draft:self_approve` and `canonical:apply_draft`.
- API key `READ_ONLY`: `project:read`, `canonical:read` only.
- API key `DRAFT_WRITE`: `project:read`, `canonical:read`, `draft:create`, `draft:submit`.
- API key `DRAFT_WRITE_SELF_APPROVE`: same as `DRAFT_WRITE` plus `draft:approve`, `draft:self_approve`, `canonical:apply_draft`. This mode should not be used remotely without explicit approval.
- API key `CANONICAL_WRITE`: future/high-risk compatibility path; do not use in Phase 2 unless explicitly approved.

### 5.3 AuditService

Responsibilities:

- `record(event)` writes one append-only `AuditEvent` row.
- `redact(value)` strips infrastructure secrets from `metadata`, `newData`, `oldData`, and errors before persistence.
- `safeActorLabel(actor)` records an API key name/id label but never raw key material.

Redaction must cover at minimum:

- `authorization`
- `cookie`
- `token`
- `apiKey`
- `api_key`
- `password`
- `secret`
- `clientSecret`
- `accessToken`
- `refreshToken`
- bearer-looking strings
- Loreum raw API keys beginning with `lrm_`

Important distinction: the entity DTO field named `secrets` is user lore content, not infrastructure credentials. It may be stored in `proposedData`, but detailed audit reads must remain capability-gated. Redaction should target infrastructure credential keys/patterns, not blindly delete all fictional lore content named `secrets` unless the display/audit-summary view cannot safely show it.

### 5.4 DraftsService

First-slice methods:

```ts
submitEntityCreateDraft(projectId, dto, actor): Promise<DraftSubmissionResult>
approveAndApplyDraft(projectId, draftId, actor): Promise<DraftApplicationResult>
rejectDraft(projectId, draftId, actor, reason): Promise<DraftProposal>
listDrafts(projectId, filters, actor): Promise<DraftProposal[]>
getDraft(projectId, draftId, actor): Promise<DraftProposal>
```

`submitEntityCreateDraft` transaction:

1. Require `draft:create` and `draft:submit`.
2. Validate `CreateEntityDto` shape using existing DTO/validation pipeline.
3. Generate a proposed slug using `generateUniqueSlug(...)` against canonical `entity` rows for display purposes.
4. Create `DraftProposal` with status `SUBMITTED`, target type `ENTITY`, operation `CREATE`, normalized `proposedData`, actor/source fields, display name/summary.
5. Record `draft.submitted` audit event.
6. Return staged response.
7. Must not create any `Entity`, `Character`, `Location`, `Organization`, `Item`, tag, or relationship row.

`approveAndApplyDraft` transaction:

1. Load draft with `projectId` and lock or otherwise guard against duplicate application.
2. Require `draft:approve` and `canonical:apply_draft`.
3. If the approving actor is the same principal that submitted the draft, require `draft:self_approve`.
4. Verify draft status is `SUBMITTED` or `CHANGES_REQUESTED` according to chosen first-slice rules. For a minimal slice, only allow `SUBMITTED`.
5. Revalidate `proposedData` against current canonical state.
6. Recompute or confirm slug; if collision exists, either choose the next unique slug and record it, or mark `APPLICATION_FAILED`. For first slice, prefer recompute unique slug to preserve current create semantics, but record final slug in the result/audit event.
7. Call the existing canonical creation logic inside the same transaction or extract a lower-level `EntitiesService.createCanonical(...)` method that receives a Prisma transaction client.
8. Record `draft.approved`, `canonical.created`, and `draft.applied` audit events.
9. Update draft status to `APPLIED`, set `reviewedByUserId`, `reviewedAt`, `appliedTargetId`, `appliedAt`.
10. Return applied target id/slug plus audit event ids if convenient.

Failure path:

- If application fails after approval intent, record `draft.application_failed` with safe error code/message and leave no partial canonical entity. Use a transaction to keep canonical writes and draft status coherent.

## 6. API design

### 6.1 Preserve canonical entity endpoint semantics where possible

The current web/UI integration tests expect `POST /v1/projects/:projectSlug/entities` to create canonical entities. The product decision for first-party UI direct edits is still open. To minimize breakage, do not immediately repurpose this endpoint for all callers.

Recommended Phase 2 API split:

- `POST /v1/projects/:projectSlug/drafts/entities`
  - Submit an entity-create draft.
  - Used by MCP `create_entity` and any future collaborator/agent suggestion UI.
  - Response clearly says submitted/not canonical.
- `GET /v1/projects/:projectSlug/drafts`
  - List review queue entries.
- `GET /v1/projects/:projectSlug/drafts/:draftId`
  - Get review detail.
- `POST /v1/projects/:projectSlug/drafts/:draftId/approve`
  - Synchronously approve and apply in first slice.
- `POST /v1/projects/:projectSlug/drafts/:draftId/reject`
  - Reject with reason.

Keep `POST /v1/projects/:projectSlug/entities` as the existing canonical create endpoint for the moment, but tighten authorization:

- Human owner/editor direct canonical creation may continue if product policy allows.
- API-key actors must not use this endpoint unless permission is `CANONICAL_WRITE`; `DRAFT_WRITE` keys must be rejected or directed to draft endpoints.
- Audit events should be added for direct canonical creation, but that can be a follow-up if T5/T6 need to stay small. If implemented in this phase, it belongs with T5 audit foundation.

Alternative if the implementer chooses to make all POST entity writes draft-first now:

- Update existing entity tests and web assumptions explicitly.
- Add a separate internal/admin canonical endpoint or service-only path for approval application.
- Document that this is a broader product choice and not merely an MCP behavior change.

### 6.2 Draft submission response shape

API and MCP should share the same core result shape.

```json
{
  "status": "submitted",
  "canonicalApplied": false,
  "draftId": "...",
  "batchId": "...",
  "targetType": "ENTITY",
  "operation": "CREATE",
  "displayName": "Mace Windu",
  "proposedSlug": "mace-windu",
  "reviewUrl": "/projects/demo/review/drafts/...",
  "message": "Entity proposal submitted for review; it is not canonical until approved."
}
```

Do not return language like `created entity` from draft paths.

### 6.3 Approval response shape

```json
{
  "status": "applied",
  "canonicalApplied": true,
  "draftId": "...",
  "targetType": "ENTITY",
  "targetId": "...",
  "targetSlug": "mace-windu",
  "auditEventIds": ["..."],
  "message": "Draft approved and applied to the canonical project graph."
}
```

### 6.4 Canonical reads remain canonical-only

No changes to existing canonical reads by default:

- `GET /v1/projects/:projectSlug/entities`
- `GET /v1/projects/:projectSlug/entities/:slug`
- MCP `list_entities`
- MCP `get_entity`

Tests must prove a submitted draft does not appear in these reads before approval/application.

## 7. MCP behavior

Change only local code; do not enable remote write mode or call remote mutation tools.

`apps/mcp/src/tools.ts` changes:

- Update `create_entity` description to say it submits a draft/proposal and does not directly mutate canonical world data.
- Change handler from:
  - `POST /projects/:projectSlug/entities`
- To:
  - `POST /projects/:projectSlug/drafts/entities`
- Return staged JSON as text via existing `jsonContent(...)`.

Recommended tool description:

> Submit a proposed entity for review in a project. This does not directly mutate canonical world data; the proposal becomes canonical only after an authorized Loreum actor approves/applies it.

Keep write-tool gating behavior:

- In `readOnly` mode, omit all mutation/draft-submit tools.
- When writeTools allowlist contains `create_entity`, register the draft-submit tool.
- The server's remote resting state remains read-only until a later approval gate.

Update `apps/mcp/src/tools.test.ts`:

- Registry tests should still see `create_entity` when write enabled.
- Handler test for `create_entity` should expect path `/projects/demo/drafts/entities` and staged response language.
- Add a negative semantic test that the tool description includes `does not directly mutate canonical` or equivalent wording.

## 8. Migration and backfill strategy

### 8.1 Schema migration order

1. Add new enums and tables: `ProjectMembership`, `DraftProposal`, `AuditEvent`.
2. Add relation fields to `Project`, `User`, and `ApiKey`.
3. Extend `ApiKeyPermission` carefully.
4. Generate Prisma client.
5. Backfill owner memberships.
6. Migrate API key permission values.
7. Leave `PendingChange` in place but unused/deprecated.

### 8.2 Backfill details

Owner memberships:

- For every project, create `ProjectMembership(projectId, ownerId, role=OWNER, capabilities=[owner bundle])` if absent.
- Keep owner fallback in code so partially migrated local/dev DBs do not break.

API keys:

- `READ_ONLY` stays `READ_ONLY`.
- Existing `READ_WRITE` should become `DRAFT_WRITE` in the conservative default migration.
- If Prisma enum migration requires staged changes, use a temporary SQL cast or add new enum values before dropping/renaming old values.

Pending changes:

- Do not delete `pending_changes` in the first migration.
- Optionally add a code comment/schema comment noting it is legacy and not the Phase 2 audit substrate.
- Later cleanup can migrate legacy rows to `DraftProposal`/`AuditEvent` once product semantics are confirmed.

### 8.3 Deployment posture

This task's safety constraints remain binding:

- No push.
- No deploy.
- No homelab stack edits.
- No remote MCP write enablement.
- No remote mutating MCP calls.
- No secrets in logs or handoffs.

### 8.4 Current local review/activity UI surface

As of the `kanban/wmcp-reviewqueue-2026-05-09` local batch, the first product-visible UI slice exists for project-scoped review and operational audit visibility:

- `/projects/:slug/review` lists submitted entity-create drafts, fetches explicit draft detail, labels proposed values as staged/non-canonical, and offers approve/reject actions only to the project owner UI while backend capabilities remain authoritative.
- `/projects/:slug/activity` lists safe activity summaries from project audit events and fetches redacted audit detail only through the gated audit-detail endpoint.
- Canonical project entity and lore detail pages may render a pending-draft affordance that links to the Review queue, but they must not fetch draft detail or render proposed draft content.

The surface is intentionally limited to the already-implemented entity-create draft workflow. Relationship, lore, timeline, storyboard, import, and richer collaborator review flows remain later phases.

## 9. Testing strategy

Use strict TDD for implementation cards.

### 9.1 T5 audit foundation tests

Suggested first failing tests before implementation:

- `AuditService` records `draft.submitted` with actor/source/project/draft metadata.
- `AuditService` redacts infrastructure secret-like metadata before persistence.
- Missing project context rejects audit/draft writes and creates no canonical mutation.
- Audit events are append-only in normal flows: review/application creates new rows rather than mutating prior audit rows.
- Owner capability resolution grants `draft:approve`, `draft:self_approve`, `canonical:apply_draft` for `Project.ownerId`.
- API key `DRAFT_WRITE` grants draft submit capabilities but not approval/application.

Target commands:

- `pnpm --filter api db:generate` after Prisma changes.
- `pnpm --filter api check-types`.
- `pnpm --filter api test` or targeted `pnpm --filter api test -- src/audit src/drafts` if full tests are too slow, with rationale.

### 9.2 T6 draft-first create_entity tests

Suggested first failing integration tests:

1. API draft endpoint:
   - `POST /v1/projects/:projectSlug/drafts/entities` returns `201` with `status: submitted`, `canonicalApplied: false`, `draftId`, `batchId`, `proposedSlug`.
   - The canonical `entities` table count remains unchanged.
   - `GET /entities` does not include the submitted draft.
   - `AuditEvent` includes `draft.submitted`.
2. Approval path:
   - Approval by API key with `DRAFT_WRITE` fails.
   - Self-approval by API key without `DRAFT_WRITE_SELF_APPROVE` fails.
   - Approval by project owner applies canonical entity and records `draft.approved`, `canonical.created`, `draft.applied`.
   - After approval, canonical reads include the entity.
3. Project scope:
   - An API key for project A cannot submit drafts to project B.
   - An actor without project access cannot approve project drafts.
4. Secret safety:
   - Authorization/token-like metadata is redacted from `AuditEvent.metadata` and failure records.
   - Test output must not print raw API keys or tokens.
5. MCP wiring:
   - `create_entity` calls `/projects/:projectSlug/drafts/entities`.
   - MCP response says staged/submitted and not canonical.
   - Read-only MCP mode still omits `create_entity`.

Target commands:

- `pnpm --filter api db:generate` after Prisma changes.
- `pnpm --filter api check-types`.
- `pnpm --filter api test` or targeted tests with rationale.
- `pnpm --filter mcp check-types`.
- `pnpm --filter mcp test`.
- `pnpm --filter mcp build` if MCP source changed.
- `git diff --check`.
- Secret-like scan over changed files only.

### 9.3 Integration card T7 expectations

T7 should verify the combined behavior after T5/T6:

- Both branches/slices agree on model names and enum values.
- Prisma client generation succeeds after merged schema changes.
- API and MCP tests pass in the integrated worktree.
- No test accidentally depends on remote MCP write mode.
- No canonical entity is created by draft submission alone.
- Approval/application is atomic: failed application leaves no partial canonical graph mutation.
- Audit events contain actor/source/capability context and redacted metadata.

## 10. Acceptance criteria for downstream implementation cards

### 10.1 T5 `t_b2ac6f63` audit log foundation slice

Current card is valid but should be interpreted concretely as:

- Add `AuditEvent` schema/table, `AuditService`, redaction helper, and capability-resolution foundation.
- Add or prepare `ProjectMembership`/capability model if not implemented by T6 first.
- Record at least `draft.submitted` in tests, plus unit coverage for planned event types used by T6.
- Include negative tests for missing project/actor context and infrastructure secret redaction.
- Do not implement broad revision control, Dolt, or canonical history unless trivial and explicitly justified.
- No push/deploy/remote write calls.

### 10.2 T6 `t_3f751818` draft-first create_entity path

Current card is valid but should be interpreted concretely as:

- Add `DraftProposal` model/service/controller if not already included in T5.
- Add `POST /v1/projects/:projectSlug/drafts/entities` and approval/reject endpoints.
- Change MCP `create_entity` to call the draft endpoint and update wording/tests.
- Keep canonical reads canonical-only.
- Keep existing canonical `EntitiesService.create(...)` as an internal/application path or direct UI path; do not let MCP draft submission call it before approval.
- Prove RED before implementation and GREEN after.
- No push/deploy/remote write calls.

### 10.3 T7 `t_319d5a7e` integration/gates

Current card is valid. Add these checks explicitly during integration:

- Inspect generated Prisma enum migration for `READ_WRITE -> DRAFT_WRITE` behavior.
- Ensure old `PendingChange` references are either untouched/deprecated or deliberately migrated; do not leave two active review queues with conflicting semantics.
- Confirm MCP read-only mode still omits write/draft tools.
- Run changed-file secret-like scan and record that no raw tokens/API keys were printed.

### 10.4 T10 `t_4847b767` roadmap synthesis

Current card is valid. It should treat Dolt/DoltgreSQL as deferred unless T5-T7 reveal that Prisma/Postgres cannot satisfy audit/review needs. The near-term roadmap should build from Postgres audit/drafts first.

## 11. Risks and tradeoffs

### 11.1 Generic draft table vs typed draft tables

Recommendation: generic `DraftProposal` now, typed application code per target type.

Why:

- One review queue for entities, lore, relationships, imports, and future batches.
- First slice remains concrete by only implementing entity-create application.
- Avoids prematurely designing many target-specific draft tables.

Risk:

- Too much arbitrary JSON can rot. Mitigation: normalize/validate `proposedData` with DTOs and keep target-specific application methods typed.

### 11.2 API key permission enum vs granular capability arrays

Recommendation: named API key modes in Phase 2, project membership capabilities for humans.

Why:

- API key UX benefits from simple modes: read-only, draft-write, self-approve, canonical-write.
- Human collaboration roles need flexible capabilities long term.

Risk:

- Two authorization surfaces. Mitigation: resolve both into one `ActorContext.capabilities` set before service code sees them.

### 11.3 Keep canonical POST entity endpoint vs repurpose it

Recommendation: add draft endpoints and leave canonical endpoint intact for now, while tightening API-key access.

Why:

- Minimizes breaking existing web/UI tests.
- Makes MCP draft-first behavior explicit.
- Leaves the open product question about first-party UI direct edits unresolved.

Risk:

- Two write paths exist. Mitigation: only project owners/humans or future `CANONICAL_WRITE` actors can use direct canonical writes; all MCP draft writes use `/drafts/entities`.

### 11.4 Service-written audit vs DB triggers

Recommendation: service-written audit events first.

Why:

- Captures actor/source/capability/request context.
- Easier to test locally.
- Sufficient for first product-visible changelog.

Risk:

- A future developer can forget to call `AuditService`. Mitigation: explicit tests on write services and later DB-level immutability/trigger coverage if needed.

## 12. Open questions for later phases

Do not block T5/T6 on these unless implementation forces a choice:

1. Should all first-party UI edits become draft-first, or only agent/collaborator/import writes?
2. Should trusted agent self-approval be allowed in production, or remain local/test-only until a security review?
3. Should draft application pick a new unique slug on collision or mark the draft conflicted?
4. How much draft revision history should be first-class beyond append-only audit events?
5. Should review queue UI ship before remote write mode is ever enabled?
6. Should `PendingChange` be renamed/migrated in the same PR, or retired in a follow-up cleanup?
7. What rate limits/batch limits should prevent agent review-queue flooding?

## 13. Summary implementation sequence

1. T5: schema + audit/capability foundation with TDD.
2. T6: draft proposal create/approve path + MCP `create_entity` draft wiring with TDD.
3. T7: integrate branches, generate Prisma, run API/MCP gates, scan for secrets, verify no remote side effects.
4. T8: independent review of no-canonical-mutation guarantees and audit completeness.
5. T9: explicit human approval gate before any remote write-mode/deploy decision.
