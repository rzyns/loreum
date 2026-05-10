import { ForbiddenException, Injectable } from "@nestjs/common";
import type { ActorContext } from "./actor-context";

export const OWNER_CAPABILITIES = [
  "project:read",
  "canonical:read",
  "canonical:create",
  "canonical:update",
  "canonical:delete",
  "canonical:apply_draft",
  "draft:create",
  "draft:submit",
  "draft:review",
  "draft:approve",
  "draft:self_approve",
  "draft:reject",
  "audit:read_summary",
  "audit:read_detail",
] as const;

const READ_ONLY_API_KEY_CAPABILITIES = [
  "project:read",
  "canonical:read",
  "draft:review",
  "audit:read_summary",
  "audit:read_detail",
] as const;

const DRAFT_WRITE_API_KEY_CAPABILITIES = [
  ...READ_ONLY_API_KEY_CAPABILITIES,
  "draft:create",
  "draft:submit",
] as const;

const CANONICAL_WRITE_API_KEY_CAPABILITIES = [
  ...DRAFT_WRITE_API_KEY_CAPABILITIES,
  "canonical:create",
  "canonical:update",
  "canonical:delete",
  "draft:approve",
  "draft:self_approve",
  "canonical:apply_draft",
] as const;

type ProjectRef = { id: string; slug: string; ownerId: string };
type UserRef = { id: string; email?: string | null; name?: string | null };
type ApiKeyRef = {
  id: string;
  name: string;
  userId?: string | null;
  permissions:
    | "READ_ONLY"
    | "READ_WRITE"
    | "DRAFT_WRITE"
    | "DRAFT_WRITE_SELF_APPROVE"
    | "CANONICAL_WRITE";
};

@Injectable()
export class ProjectCapabilitiesService {
  resolveHumanActor(input: {
    project: ProjectRef;
    user: UserRef;
  }): ActorContext {
    const isOwner = input.project.ownerId === input.user.id;
    if (!isOwner) {
      throw new ForbiddenException("User does not have project access");
    }

    return {
      projectId: input.project.id,
      projectSlug: input.project.slug,
      kind: "HUMAN",
      sourceKind: "MANUAL",
      userId: input.user.id,
      label: input.user.email ?? input.user.name ?? input.user.id,
      capabilities: [...OWNER_CAPABILITIES],
    };
  }

  resolveApiKeyActor(input: {
    project: ProjectRef;
    apiKey: ApiKeyRef;
  }): ActorContext {
    return {
      projectId: input.project.id,
      projectSlug: input.project.slug,
      kind: "AGENT",
      sourceKind: "MCP_AGENT",
      userId: input.apiKey.userId ?? input.project.ownerId,
      apiKeyId: input.apiKey.id,
      label: `API key: ${input.apiKey.name}`,
      capabilities: this.capabilitiesForApiKeyPermission(
        input.apiKey.permissions,
      ),
    };
  }

  capabilitiesForApiKeyPermission(
    permission: ApiKeyRef["permissions"],
  ): string[] {
    switch (permission) {
      case "READ_ONLY":
        return [...READ_ONLY_API_KEY_CAPABILITIES];
      case "DRAFT_WRITE":
        return [...DRAFT_WRITE_API_KEY_CAPABILITIES];
      case "DRAFT_WRITE_SELF_APPROVE":
        // Deprecated compatibility row value: treat as canonical-write rather
        // than preserving a separate first-class product permission mode.
        return [...CANONICAL_WRITE_API_KEY_CAPABILITIES];
      case "CANONICAL_WRITE":
      case "READ_WRITE":
        return [...CANONICAL_WRITE_API_KEY_CAPABILITIES];
    }
  }

  assertCapabilities(actor: ActorContext, required: string[]) {
    const missing = required.filter(
      (capability) => !actor.capabilities.includes(capability),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing project capability: ${missing.join(", ")}`,
      );
    }
  }

  assertCanApproveDraft(
    actor: ActorContext,
    draft: {
      submittedByUserId?: string | null;
      submittedByApiKeyId?: string | null;
    },
  ) {
    this.assertCapabilities(actor, ["draft:approve", "canonical:apply_draft"]);

    const sameApiKey = Boolean(
      actor.apiKeyId &&
      draft.submittedByApiKeyId &&
      actor.apiKeyId === draft.submittedByApiKeyId,
    );
    const sameUser = Boolean(
      actor.userId &&
      draft.submittedByUserId &&
      actor.userId === draft.submittedByUserId,
    );

    if (
      (sameApiKey || sameUser) &&
      !actor.capabilities.includes("draft:self_approve")
    ) {
      throw new ForbiddenException(
        "Self-approval requires draft:self_approve capability",
      );
    }
  }
}
