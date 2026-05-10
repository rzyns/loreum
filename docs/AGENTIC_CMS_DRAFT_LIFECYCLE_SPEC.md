# Agentic CMS Draft Lifecycle Product Spec

Date: 2026-05-03
Status: Draft product/domain spec, hardened against current repo state on 2026-05-09
Source plan: `.hermes/plans/2026-05-03_loreum-agentic-cms-phase-2.md`

## 1. Purpose

Loreum is becoming an agent-assisted worldbuilding CMS. The core product rule for this phase is:

> User, collaborator, import, and agent write operations may propose content, but canonical project graph mutation happens only through an explicit approval/application step governed by project-scoped capabilities and captured in an append-only audit trail.

This spec defines the product-domain model for that rule. It intentionally avoids implementation-specific schema names where a product concept is still unsettled, but it names likely API/UI/MCP implications so the first implementation slice can stay small and coherent.

## 2. Design principles

1. Drafts are not canon.
   - Drafted entities, lore articles, relationships, timeline events, and edits must be reviewable without appearing as canonical world state.
   - Read paths for the canonical project graph must not accidentally include draft content.

2. Approval is a domain event, not a side effect.
   - A proposal becomes canonical because an authorized actor approved/applied it.
   - The approval event should record who approved, what was approved, and what canonical records changed.

3. Actor/source provenance belongs in the audit layer.
   - Whether content was human-authored, agent-generated, imported, system-generated, or collaborator-suggested is operational provenance.
   - It should not overload in-world lore provenance such as “this prophecy came from an ancient tablet.”

4. In-world provenance remains a lore concept.
   - Lore-domain source fields should answer questions such as “where did this fact originate inside the fictional world?”
   - Audit/source fields should answer questions such as “how did this record enter Loreum, and under whose authority?”

5. Permissions are project-scoped.
   - A user, API key, or agent may have different capabilities in different projects.
   - Cross-project reads/writes must not be inferred from account-level identity alone.

6. Append-only evidence should survive edits and deletes.
   - The activity/audit trail should retain denormalized summaries and structured metadata even if a target record is later changed or deleted.

## 3. Product vocabulary

### 3.1 Actor

An actor is the operational principal that caused or authorized an action.

Actor types:

- `human`: an authenticated Loreum user acting through the web UI or first-party app surface.
- `agent`: an external or in-app AI assistant acting through MCP/API/tooling under a project-scoped credential or delegated session.
- `imported`: an import process bringing content from a file, backup, or external worldbuilding tool.
- `generated`: a system or AI generation process that produced candidate content without direct human keystrokes.
- `system`: Loreum platform automation, migrations, maintenance jobs, or background processes.

Notes:

- `agent` and `generated` are related but not identical. `agent` identifies the acting principal/channel; `generated` describes content/source origin. An AI agent can submit human-provided text, and an in-app system job can generate summaries.
- A draft should be able to capture both “submitted by Claude Desktop API key X” and “content source: generated.”

### 3.2 Source provenance

Operational source provenance describes how content entered the CMS pipeline.

Recommended source vocabulary:

- `manual`: direct human input through first-party UI.
- `collaborator_suggestion`: team member suggestion requiring review.
- `mcp_agent`: external MCP client/tool call.
- `in_app_ai`: Loreum-hosted AI assistant.
- `import`: import/restore/migration path.
- `system`: platform-created record or migration.

This vocabulary feeds review queue labels, filters, audit reporting, and trust policies.

### 3.3 In-world provenance

In-world provenance is domain content. It should be modeled separately from audit fields.

Examples:

- A lore article cites “The Red Archive, folio 12.”
- A character biography says the rumor came from a tavern witness.
- A historical timeline event has conflicting chronicles.

Product implication: if Loreum adds “source” or “citation” fields to entities/lore, those fields must be named and presented as lore provenance, not operational authorship.

Related vocabulary boundary: `LoreArticleCanonStatus` (`draft`, `staging`, `provisional`, `canon`) is content/lore publication status for lore articles. It is not the same as this spec’s operational draft/proposal lifecycle (`draft`, `submitted`, `approved`, `applied`, etc.). A lore article could be operationally proposed in a `submitted` draft while its proposed content-level `canonStatus` is `provisional`, for example.

## 4. Draftable target types

The lifecycle should be generic enough to cover any canonical project-graph content, while the first slice can support a smaller subset.

Target families:

- Entities: characters, locations, organizations, custom items.
- Relationships: graph edges between entities.
- Lore articles: wiki pages and their entity/tag links.
- Timeline events and eras.
- Storyboard records: works, chapters, scenes, plotlines, plot points.
- Style guide records.
- Project metadata where safe and reviewable.

Minimum first target: `create_entity` via MCP/API draft path.

## 5. Draft lifecycle

### 5.1 States

Recommended canonical states:

1. `draft`
   - A proposal exists but has not been submitted for review.
   - Typical for manual UI autosave or multi-step import staging.
   - May be edited by the submitter if they still have draft-edit capability.

2. `submitted`
   - Ready for review.
   - Appears in the project review queue.
   - Cannot mutate canonical content.

3. `changes_requested`
   - Reviewer has not rejected the proposal outright but requires edits.
   - Proposal remains non-canonical.
   - Submitter or authorized editor may revise and resubmit.

4. `approved`
   - An authorized actor accepted the proposal.
   - Approval has been recorded, but application may still be separate if application can fail, is async, or is batched.

5. `applied`
   - Canonical graph mutation completed.
   - The draft records the resulting canonical target ids and applied revision/version if available.

6. `rejected`
   - Proposal was declined.
   - It remains in audit/review history but never enters canonical graph.

7. `withdrawn`
   - Submitter or authorized actor removed the proposal before approval.
   - Useful for agent batches where the initiating actor cancels stale proposals.

8. `superseded`
   - Another draft replaces this one, or a newer canonical version makes this proposal stale.
   - Useful for conflict handling and imported/generated batches.

9. `application_failed`
   - Approval occurred, but canonical application failed due to validation, dependency, conflict, or system error.
   - Must preserve error details without leaking secrets.

For a small initial implementation, `submitted -> approved/applied | rejected` can be collapsed where application is synchronous, but the product model should still distinguish approval from application so it can grow into async/batch revision control.

### 5.2 Transitions

Allowed transitions:

- `draft -> submitted`
  - Actor has `draft:create` and `draft:submit` or equivalent.
  - Validates proposal shape and project context.

- `submitted -> changes_requested`
  - Reviewer has `draft:review`.
  - Requires a review note.

- `changes_requested -> submitted`
  - Submitter/editor has `draft:edit`.
  - Adds a new draft revision or updates the proposal history.

- `submitted -> rejected`
  - Reviewer has `draft:review`.
  - Requires a rejection reason for audit usefulness.

- `submitted -> approved`
  - Reviewer has `draft:approve`.
  - If reviewer is also submitter, requires `draft:self_approve`.

- `approved -> applied`
  - System or reviewer applies the proposal under `canonical:apply` semantics.
  - Performs final validation against current canonical state.

- `approved -> application_failed`
  - Application validation or write fails.
  - Error must be safe, structured, and actionable.

- `application_failed -> submitted`
  - Authorized actor revises or retries after resolving conflict.

- `draft|submitted|changes_requested -> withdrawn`
  - Submitter or moderator cancels the proposal.

- `draft|submitted|changes_requested -> superseded`
  - Replacement draft/batch becomes authoritative proposal.

Disallowed transitions:

- `draft/submitted/changes_requested/rejected/withdrawn/superseded` directly mutating canonical records.
- `rejected -> approved` without an explicit reopen/resubmit event.
- `applied -> draft/submitted` for the same draft. Follow-up changes should create a new draft/edit proposal.

### 5.3 State machine sketch

```text
            +--------------------+
            |       draft        |
            +---------+----------+
                      |
                      v
            +--------------------+
            |     submitted      |
            +--+------+-----+----+
               |      |     |
               |      |     v
               |      |  rejected
               |      |
               |      v
               | changes_requested
               |      |
               |      v
               |  submitted
               |
               v
            approved
               |
               v
            applied

Any pre-approval state may become withdrawn or superseded.
Approved may become application_failed, then return to submitted after revision/retry.
```

## 6. Proposal shapes

Each draft proposal should capture:

- Project scope: project id/slug.
- Target family/type: entity, relationship, lore_article, etc.
- Operation: create, update, delete, link, unlink, reorder, bulk/import.
- Target id: null for creates, canonical id for updates/deletes/links.
- Proposed payload: normalized product data, not arbitrary tool transcript.
- Previous snapshot or diff basis for updates/deletes.
- Batch/session id for related proposals from one agent/import/user session.
- Submitter actor and source provenance.
- Current state.
- Review/application metadata.
- Safe display summary for review queue and audit feed.
- Validation/conflict status.

For first-slice `create_entity`, proposed payload should include at least:

- Entity type.
- Name and derived or proposed slug.
- Summary/description/backstory/secrets/notes as applicable.
- Type-specific extension fields.
- Attributes JSON validated against project entity schema.
- Tags/link proposals only if the slice explicitly supports them; otherwise leave them out or represent as future related proposals.

## 7. Approval semantics

### 7.1 Approval vs application

Approval means an authorized actor accepts the proposal as fit to enter canon.
Application means the system successfully mutates canonical records.

In the simplest synchronous flow, a single UI action can perform both and show “approved and applied.” Internally and in audit vocabulary, keep both concepts distinct.

Reasons to separate them:

- Batch approval may need dependency ordering.
- Application may fail after approval due to conflicts or stale snapshots.
- Future Dolt/DoltgreSQL or git-like revision control may treat approval as creating/merging a changeset.
- Audit reporting should distinguish reviewer intent from system write outcome.

### 7.2 Self-approval

Self-approval is allowed only when the actor has an explicit project-scoped capability.

Rules:

- An actor who submitted a draft may approve their own draft only with `draft:self_approve` or equivalent.
- Self-approval should still create both submission and approval audit events.
- Self-approval by API key/agent should be more restrictive than self-approval by owner/admin unless Janusz later decides “trusted agents” are first-class collaborators.
- Import jobs should not self-approve by default; bulk imports need review unless run by an actor with explicit import-approval capability.

Product roles can map to default capabilities, but the capability check should be explicit so roles can evolve.

### 7.3 Batch approval

A batch groups related proposals, usually from a single agent conversation, import, or user multi-edit flow.

Batch behavior:

- Batch header shows actor/source, timestamp, counts, and summary.
- “Approve all” must apply changes in dependency order.
- Creates that other proposals depend on must resolve temporary references before relationships/lore links apply.
- Partial approval should be allowed: approve some, reject others, request changes for the batch or individual proposals.
- Batch rejection should preserve each proposal’s audit history.

## 8. Roles and capabilities

### 8.1 Product roles

Existing product docs mention owner, editor, viewer, commenter. Draft-first agentic CMS needs a more capability-centered model while preserving simple role labels.

Recommended default roles:

- `owner`
  - Full project control, membership, API keys, review, approval, self-approval, canonical edits.

- `admin` or `maintainer` (optional future role)
  - Project operations and review authority without ownership transfer/billing control.

- `editor`
  - Can create/edit canonical content through normal UI where allowed.
  - Whether editor edits are direct or draft-first is a project policy decision.
  - Can submit drafts; may review others only if granted.

- `reviewer`
  - Can approve/reject/request changes for submitted drafts.
  - May not necessarily edit canonical content directly.

- `contributor`
  - Can create and submit drafts/suggestions.
  - Cannot apply to canonical graph.

- `commenter`
  - Can comment/review conversationally but not submit canonical content unless separately granted.

- `viewer`
  - Read-only access to non-public project content according to visibility/secrets policy.

- `agent`
  - Non-human project-scoped actor. Capabilities depend on the API key/delegation grant, not a global role.

- `importer`
  - Specialized capability bundle for bulk import/restore workflows.

### 8.2 Capabilities

Use capabilities as the durable authorization vocabulary. Roles are bundles of capabilities.

Core project capabilities:

- `project:read`
- `project:manage_settings`
- `project:manage_members`
- `project:manage_api_keys`

Canonical content capabilities:

- `canonical:read`
- `canonical:create`
- `canonical:update`
- `canonical:delete`
- `canonical:apply_draft`

Draft/review capabilities:

- `draft:create`
- `draft:edit_own`
- `draft:edit_any`
- `draft:submit`
- `draft:withdraw_own`
- `draft:withdraw_any`
- `draft:review`
- `draft:approve`
- `draft:self_approve`
- `draft:reject`
- `draft:request_changes`
- `draft:batch_approve`

Audit capabilities:

- `audit:read_summary`
- `audit:read_detail`
- `audit:export`

Agent/API capabilities:

- `api_key:create_read_only`
- `api_key:create_draft_write`
- `api_key:create_direct_write` (future/high-risk; should remain disabled until explicitly approved)
- `agent:submit_drafts`
- `agent:read_canon`

Import capabilities:

- `import:create_batch`
- `import:submit_batch`
- `import:approve_batch`

### 8.3 API key modes

For MCP/API keys, avoid a binary read-only/read-write product story. Draft-first writes are not the same as direct canonical writes.

Recommended modes:

- `READ_ONLY`: broad project-scoped data-plane reads for the key's project, including canonical/project data, draft/review queue reads, and audit/activity reads; cannot create drafts or mutate canon.
- `DRAFT_WRITE`: inherits `READ_ONLY` and can submit draft/proposal records; cannot approve/apply drafts, including its own.
- `CANONICAL_WRITE`: inherits `DRAFT_WRITE` and may directly mutate canon and approve/apply drafts, including self-authored/self-submitted drafts when self-approval capability checks apply.
- `READ_WRITE`: legacy compatibility alias for `CANONICAL_WRITE`; keep only for old rows/clients while migration proceeds.

`DRAFT_WRITE_SELF_APPROVE` is deprecated/removed from the target conceptual model. If a deployed schema still contains it, keep it only as staged compatibility and do not present it as a first-class API/UI/product option. Initial MCP write enablement should target `DRAFT_WRITE`, not `CANONICAL_WRITE`.

## 9. Audit and changelog semantics

### 9.1 Event categories

Audit should be append-only and project-scoped.

Recommended event categories:

- `draft.created`
- `draft.submitted`
- `draft.updated`
- `draft.withdrawn`
- `draft.changes_requested`
- `draft.rejected`
- `draft.approved`
- `draft.application_started`
- `draft.applied`
- `draft.application_failed`
- `canonical.created`
- `canonical.updated`
- `canonical.deleted`
- `canonical.relationship_created`
- `canonical.relationship_deleted`
- `auth.api_key_created`
- `auth.api_key_revoked`
- `project.member_added`
- `project.member_role_changed`
- `import.batch_created`
- `import.batch_submitted`
- `system.migration_applied`

### 9.2 Event fields

Each audit event should include:

- Project id.
- Actor id/type and safe display label.
- Source provenance.
- Action/event type.
- Target type/id/name where applicable.
- Draft id and batch id where applicable.
- Request/correlation id where available.
- Before/after snapshots or structured diff where safe and appropriate.
- Human-readable summary.
- Timestamp.
- Outcome: success/failure plus safe error code/message if failed.

Secrets policy:

- Do not log bearer tokens, API key plaintext, OAuth tokens, raw stack env, or other credentials.
- The `secrets` lore field is user content, not infrastructure secret material, but it is sensitive for public wiki exposure. Audit detail should respect project permissions. This batch does not create a CMS-level DLP/global canonical redaction requirement; keep operational credential redaction and review/audit hygiene separate from canonical domain content policy.

### 9.3 Changelog vs audit log

Expose two product views over the same or related event substrate:

- Changelog/activity feed:
  - Human-friendly project history.
  - “Claude Desktop proposed character Mace Windu.”
  - “Janusz approved and applied entity Mace Windu.”
  - Suitable for sidebar/dashboard/recent activity.

- Audit log:
  - More complete operational record.
  - Shows actor/source, API key label/prefix, request id, target ids, status transitions, safe error metadata.
  - Access gated by `audit:read_detail`.

## 10. UI implications

### 10.1 Review queue

Review queue should be a first-class project navigation item.

List view requirements:

- Shows pending counts and batches.
- Filters by state, actor/source, target type, operation, date, reviewer, and validation/conflict status.
- Batch headers summarize source and proposed changes.
- Individual proposals show operation, target type, display name, safe summary, and current state.

Detail view requirements:

- Create proposal: render the proposed record as it would appear canonically, with clear “not yet canonical” labeling.
- Update proposal: show side-by-side diff from current canonical state or snapshot basis.
- Delete proposal: show record summary, inbound/outbound references, and consequences.
- Relationship proposal: show graph context and endpoints.
- Lore proposal: show rendered content preview and linked entities/tags.
- Audit panel: show submitter/source, timestamps, review notes, and state history.

Actions:

- Approve/apply.
- Edit before approval.
- Request changes with note.
- Reject with reason.
- Withdraw if authorized.
- Batch approve/reject where dependency checks pass.

### 10.2 Canonical pages

Canonical entity/lore/relationship views should not show draft data as if it were live.

Helpful affordances:

- Badge: “3 pending suggestions affect this entity.”
- Link to filtered review queue for related drafts.
- Optional diff preview from entity page for users with review rights.

### 10.3 Activity/audit views

Project dashboard can show recent changelog events. Project settings/admin area can expose detailed audit log.

## 11. API implications

### 11.1 Read paths

Canonical read endpoints should default to canonical-only data.

Optional draft-aware read capabilities:

- Review queue endpoints for draft proposals.
- Target-specific pending proposal endpoints.
- Preview endpoints that render proposed state without mutation.

### 11.2 Write paths

For agent/MCP and collaborator suggestion paths:

- Write-like endpoints should create draft proposals by default.
- Response should clearly say “staged/submitted,” not “created canonical entity.”
- Include draft id, batch id, state, review URL, and safe summary.

For first-party UI direct edits:

- Product decision remains open: owners/editors may continue direct canonical edits, or project policy may force draft-first for all actors.
- Regardless, canonical direct edits must produce audit events.

### 11.3 Approval/application endpoints

Approval endpoints should:

- Verify project scope.
- Verify reviewer capabilities, including self-approval rules.
- Revalidate proposal against current canonical state.
- Apply atomically where practical.
- Write audit events for approval and canonical mutation.
- Return applied target ids and revision/version identifiers where available.

### 11.4 Validation and conflicts

Draft creation validates shape enough for meaningful review, but final application must revalidate against current canonical state.

Conflict examples:

- Proposed slug now collides with a canonical entity.
- Relationship endpoint was deleted or superseded.
- Update proposal’s base snapshot is stale.
- Project schema changed since proposal submission.

Product behavior:

- Mark as conflict/application_failed or require changes.
- Do not silently rewrite canonical content.
- Provide safe, actionable error messages.

## 12. MCP implications

MCP write tools should become draft-submit tools.

Example `create_entity` result language:

```json
{
  "status": "submitted",
  "canonicalApplied": false,
  "draftId": "...",
  "batchId": "...",
  "reviewUrl": "...",
  "message": "Entity proposal staged for review; it is not canonical until approved."
}
```

Tool descriptions should explicitly state:

- The tool does not directly mutate canonical world data.
- The result is reviewable in Loreum.
- Approval requires a project actor with appropriate capability.

MCP read tools should read canonical data by default. Draft review tools can be added later for agents with review capabilities, but the first remote resting state should remain read-only unless explicitly approved.

## 13. Import/generated content implications

Imports and generation jobs should create batches.

Import behavior:

- Parse external content into normalized draft proposals.
- Show import batch summary with counts and validation issues.
- Let reviewers approve all, approve selected, or reject the batch.
- Preserve original import source metadata in audit layer, not in-world provenance unless the user maps it intentionally.

Generated content behavior:

- In-app generated summaries, consistency suggestions, and AI-written prose should enter as suggestions/drafts unless directly accepted inline by an authorized human.
- Accepted inline suggestions still need audit events.

## 14. Revision-control implications

This spec should not require Dolt/DoltgreSQL immediately. It should leave a migration path.

If Loreum later adopts git-like revision control:

- A draft batch maps naturally to a changeset/branch/PR-like proposal.
- Approval maps to merge authorization.
- Application maps to merge/write transaction.
- Audit events remain product-visible even if storage backend changes.

Near-term design should therefore avoid baking “pending row” concepts too deeply into UI language. Use product terms like draft/proposal/review queue/changeset where possible.

## 15. Acceptance criteria

A product/domain design satisfies this spec when:

1. Draft lifecycle states and transitions are documented, including submitted, approved, rejected, applied, and a path for changes/conflicts.
2. Canonical graph mutation is impossible from agent/MCP draft-write paths without an approval/application step.
3. Self-approval is explicitly permission-gated and distinguishable from ordinary approval.
4. Project-scoped roles/capabilities are defined at product level and include agent/API-key cases.
5. Actor/source vocabulary separates `human`, `agent`, `imported`, `generated`, and `system` concepts without overloading in-world lore provenance.
6. In-world provenance remains a separate lore-domain concept.
7. Audit/changelog requirements include append-only events, safe actor/source metadata, review events, application events, and operational credential redaction without implying CMS-level DLP or global canonical content scanning.
8. UI implications include review queue list/detail/batch flows and canonical-page pending suggestion affordances.
9. API/MCP implications clearly distinguish staged draft responses from canonical creation/update responses.
10. First implementation slice can be tested locally without pushing, deploying, enabling remote MCP writes, or calling remote mutating MCP tools.

## 16. Recommended first implementation slice

Small valuable slice: audit-backed draft-first `create_entity` path for local API/MCP, without remote write deployment.

### Scope

- Add a draft/proposal model sufficient for `create_entity` proposals.
- Add an append-only audit/activity event foundation for draft submission and application/rejection events.
- Change or add the local `create_entity` write path so MCP/API draft-write calls create a submitted draft/proposal, not a canonical entity.
- Add approval/apply service method or endpoint for authorized local test actors.
- Return clear staged/not-canonical responses from MCP `create_entity`.

### Out of scope

- Remote MCP write enablement.
- Deployment or homelab stack edits.
- Dolt/DoltgreSQL integration.
- Full review queue UI polish.
- Every target type beyond entity creation.
- Direct-write trusted agent mode.

### Tests/gates

Minimum tests should prove:

- A draft-write `create_entity` call creates a proposal/draft row and audit event.
- The canonical `entities` table is not mutated by the draft-write call.
- The response says staged/submitted and does not claim canonical creation.
- Approval by an actor without capability fails.
- Self-approval without explicit self-approval capability fails.
- Approval by an authorized actor applies the entity canonically and writes audit events.
- Project scope is enforced; an actor/API key cannot submit or approve drafts in another project.
- Missing actor/project context fails safely and produces no canonical mutation.
- Secrets/tokens are not logged in audit metadata or test output.

## 17. Open questions

1. Should first-party owner/editor UI edits remain direct canonical edits for now, or should all content edits become draft-first under a project policy?
2. Should `editor` include review/approval by default, or should review be a separate `reviewer` capability?
3. Are trusted agents allowed to self-approve in Phase 2, or should self-approval initially be human-only?
4. Should collaborator suggestions and MCP suggestions share one draft/proposal model from day one?
5. Should application be synchronous for first slice, or should it create an async job/event even now?
6. How much draft history is retained for edited proposals: mutable proposal payload with audit trail, or immutable proposal revisions?
7. What is the minimum UI needed for the first slice: API-only approval, basic admin review page, or full review queue?
8. Should rejected/withdrawn drafts be restorable/reopenable, or should a new draft always be created?
9. Pending drafts stay non-public until applied; review previews and public wiki visibility should respect project permissions and public-field policy without adding CMS-level DLP/global canonical redaction in this batch.
10. Settled Phase-2 API-key modes are `READ_ONLY`, `DRAFT_WRITE`, and `CANONICAL_WRITE`; `READ_WRITE` is a legacy alias for `CANONICAL_WRITE`, and `DRAFT_WRITE_SELF_APPROVE` is deprecated/compatibility-only if retained in schema.
11. What rate limits or batch limits should prevent an agent from flooding the review queue?
12. Should draft previews be queryable by agents with review capability, or only visible to humans in web UI initially?
13. Should audit detail be a Pro/collaboration feature while minimal security audit remains available for all projects?
14. How should future revision-control storage map to current proposal ids and audit event ids?
