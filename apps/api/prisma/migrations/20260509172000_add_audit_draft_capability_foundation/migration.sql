-- Add Phase-2 audit/draft/capability foundation.

CREATE TYPE "ActorKind" AS ENUM ('HUMAN', 'AGENT', 'IMPORTED', 'GENERATED', 'SYSTEM');
CREATE TYPE "ContentSourceKind" AS ENUM ('MANUAL', 'COLLABORATOR_SUGGESTION', 'MCP_AGENT', 'IN_APP_AI', 'IMPORT', 'SYSTEM');
CREATE TYPE "DraftTargetType" AS ENUM ('ENTITY', 'RELATIONSHIP', 'LORE_ARTICLE', 'TIMELINE_EVENT', 'STORYBOARD_RECORD', 'PROJECT_METADATA');
CREATE TYPE "DraftOperation" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LINK', 'UNLINK', 'REORDER', 'BULK_IMPORT');
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED', 'APPLICATION_FAILED');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TYPE "ProjectActorRole" AS ENUM ('OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER', 'AGENT');

ALTER TYPE "ApiKeyPermission" ADD VALUE IF NOT EXISTS 'DRAFT_WRITE';
ALTER TYPE "ApiKeyPermission" ADD VALUE IF NOT EXISTS 'DRAFT_WRITE_SELF_APPROVE';
ALTER TYPE "ApiKeyPermission" ADD VALUE IF NOT EXISTS 'CANONICAL_WRITE';

ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DEFAULT 'DRAFT_WRITE';

CREATE TABLE "project_memberships" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ProjectActorRole" NOT NULL,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draft_proposals" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "targetType" "DraftTargetType" NOT NULL,
  "operation" "DraftOperation" NOT NULL,
  "targetId" TEXT,
  "status" "DraftStatus" NOT NULL DEFAULT 'SUBMITTED',
  "proposedData" JSONB NOT NULL DEFAULT '{}',
  "previousData" JSONB,
  "validation" JSONB NOT NULL DEFAULT '{}',
  "displayName" TEXT NOT NULL,
  "displaySummary" TEXT,
  "reviewNote" TEXT,
  "rejectionReason" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "submittedByKind" "ActorKind" NOT NULL,
  "submittedByUserId" TEXT,
  "submittedByApiKeyId" TEXT,
  "submittedByLabel" TEXT NOT NULL,
  "sourceKind" "ContentSourceKind" NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "appliedTargetId" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "draft_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
  "actorKind" "ActorKind" NOT NULL,
  "actorUserId" TEXT,
  "actorApiKeyId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "sourceKind" "ContentSourceKind" NOT NULL,
  "operation" "DraftOperation",
  "targetType" "DraftTargetType",
  "targetId" TEXT,
  "targetModel" TEXT,
  "targetDisplay" TEXT,
  "draftId" TEXT,
  "batchId" TEXT,
  "approvalId" TEXT,
  "summary" TEXT NOT NULL,
  "oldData" JSONB,
  "newData" JSONB,
  "diff" JSONB,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "capabilityContext" JSONB NOT NULL DEFAULT '{}',
  "requestId" TEXT,
  "correlationId" TEXT,
  "causationId" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "streamKey" TEXT,
  "streamVersion" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_memberships_projectId_userId_key" ON "project_memberships"("projectId", "userId");
CREATE INDEX "project_memberships_userId_idx" ON "project_memberships"("userId");

CREATE INDEX "draft_proposals_projectId_status_createdAt_idx" ON "draft_proposals"("projectId", "status", "createdAt");
CREATE INDEX "draft_proposals_projectId_targetType_operation_idx" ON "draft_proposals"("projectId", "targetType", "operation");
CREATE INDEX "draft_proposals_batchId_idx" ON "draft_proposals"("batchId");

CREATE INDEX "audit_events_projectId_occurredAt_idx" ON "audit_events"("projectId", "occurredAt");
CREATE INDEX "audit_events_projectId_eventType_occurredAt_idx" ON "audit_events"("projectId", "eventType", "occurredAt");
CREATE INDEX "audit_events_projectId_actorKind_occurredAt_idx" ON "audit_events"("projectId", "actorKind", "occurredAt");
CREATE INDEX "audit_events_draftId_idx" ON "audit_events"("draftId");
CREATE INDEX "audit_events_batchId_idx" ON "audit_events"("batchId");

ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_proposals" ADD CONSTRAINT "draft_proposals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_proposals" ADD CONSTRAINT "draft_proposals_submittedByApiKeyId_fkey" FOREIGN KEY ("submittedByApiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
