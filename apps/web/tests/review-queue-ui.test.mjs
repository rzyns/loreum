import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const reviewPage = new URL(
  "../app/projects/[slug]/review/page.tsx",
  import.meta.url,
);
const sidebar = new URL("../components/project-sidebar.tsx", import.meta.url);
const bottomNav = new URL("../components/bottom-nav.tsx", import.meta.url);
const activityPage = new URL(
  "../app/projects/[slug]/activity/page.tsx",
  import.meta.url,
);
const pendingDraftAffordance = new URL(
  "../components/pending-draft-affordance.tsx",
  import.meta.url,
);
const projectEntityDetailPages = [
  "../app/projects/[slug]/entities/characters/[entitySlug]/page.tsx",
  "../app/projects/[slug]/entities/locations/[entitySlug]/page.tsx",
  "../app/projects/[slug]/entities/organizations/[entitySlug]/page.tsx",
  "../app/projects/[slug]/entities/[typeSlug]/[entitySlug]/page.tsx",
].map((path) => new URL(path, import.meta.url));
const projectLoreDetailPage = new URL(
  "../app/projects/[slug]/lore/[loreSlug]/page.tsx",
  import.meta.url,
);
const publicWorldEntityPage = new URL(
  "../app/worlds/[slug]/entities/[entitySlug]/page.tsx",
  import.meta.url,
);

async function source(url) {
  return readFile(url, "utf8");
}

test("review queue page uses the reviewed entity draft API contract", async () => {
  const page = await source(reviewPage);

  assert.match(page, /\/projects\/\$\{params\.slug\}\/drafts\/entities\?status=SUBMITTED/);
  assert.match(page, /\/projects\/\$\{params\.slug\}\/drafts\/entities\/\$\{selectedDraftId\}/);
  assert.match(page, /\/projects\/\$\{params\.slug\}\/drafts\/entities\/\$\{detail\.id\}\/approve/);
  assert.match(page, /\/projects\/\$\{params\.slug\}\/drafts\/entities\/\$\{detail\.id\}\/reject/);
});

test("review queue page labels staged draft data and never presents it as canonical", async () => {
  const page = await source(reviewPage);

  assert.match(page, /Review queue/);
  assert.match(page, /Staged draft/);
  assert.match(page, /not canonical content/i);
  assert.match(page, /Approve and apply/);
  assert.match(page, /Reject staged draft/);
  assert.doesNotMatch(page, /Canonical summary:\s*\{detail\.proposed\.summary\}/);
});

test("review queue action affordances are owner-capability aware before backend enforcement", async () => {
  const page = await source(reviewPage);

  assert.match(page, /project\?\.ownerId === user\?\.id/);
  assert.match(page, /canReviewActions/);
  assert.match(page, /You can inspect staged drafts, but this account is not allowed to approve or reject them/);
});

test("project navigation exposes review queue and activity entries", async () => {
  const [sidebarSource, bottomNavSource] = await Promise.all([
    source(sidebar),
    source(bottomNav),
  ]);

  assert.match(sidebarSource, /label: "Review queue"/);
  assert.match(sidebarSource, /href: "review"/);
  assert.match(sidebarSource, /label: "Activity"/);
  assert.match(sidebarSource, /href: "activity"/);
  assert.match(bottomNavSource, /label: "Review"/);
  assert.match(bottomNavSource, /href: "review"/);
  assert.match(bottomNavSource, /label: "Activity"/);
  assert.match(bottomNavSource, /href: "activity"/);
});

test("activity page consumes safe audit summaries and gates audit detail access", async () => {
  const page = await source(activityPage);

  assert.match(page, /\/projects\/\$\{params\.slug\}\/activity\?limit=50/);
  assert.match(page, /\/projects\/\$\{params\.slug\}\/audit\/\$\{event\.id\}/);
  assert.match(page, /Project activity/);
  assert.match(page, /Operational provenance/);
  assert.match(page, /World\/lore provenance is separate/i);
  assert.match(page, /View audit detail/);
  assert.match(page, /Audit detail is restricted/);
  assert.match(page, /safe changelog summary remains visible/i);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
});

test("canonical project entity and lore pages show pending draft affordances without draft content", async () => {
  const [affordance, lorePage, ...entityPages] = await Promise.all([
    source(pendingDraftAffordance),
    source(projectLoreDetailPage),
    ...projectEntityDetailPages.map(source),
  ]);

  assert.match(affordance, /\/projects\/\$\{projectSlug\}\/drafts\/entities\?status=SUBMITTED/);
  assert.match(affordance, /pending suggestions?/i);
  assert.match(affordance, /Operational review status/);
  assert.match(affordance, /Review queue/);
  assert.doesNotMatch(affordance, /proposedData|proposed\.|displaySummary|description/);

  assert.match(lorePage, /PendingDraftAffordance/);
  for (const page of entityPages) {
    assert.match(page, /PendingDraftAffordance/);
    assert.doesNotMatch(page, /drafts\/entities.*detail|proposedData|proposed\./);
  }
});

test("public canonical entity page does not fetch draft review endpoints", async () => {
  const page = await source(publicWorldEntityPage);

  assert.doesNotMatch(page, /drafts\/entities/);
  assert.doesNotMatch(page, /proposedData|proposed\./);
});
