-- Add a conservative canon/canonicality status for lore articles.
-- Existing rows are marked provisional locally by the column default; do not run this
-- against live data without a separate review-gated migration/backfill decision.
CREATE TYPE "LoreArticleCanonStatus" AS ENUM ('draft', 'staging', 'provisional', 'canon');

ALTER TABLE "lore_articles"
  ADD COLUMN "canonStatus" "LoreArticleCanonStatus" NOT NULL DEFAULT 'provisional';
