-- Add reversible archive state for terminal draft proposals.

ALTER TABLE "draft_proposals"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "draft_proposals_projectId_archivedAt_idx" ON "draft_proposals"("projectId", "archivedAt");
