export type ActorKind = "HUMAN" | "AGENT" | "IMPORTED" | "GENERATED" | "SYSTEM";

export type ContentSourceKind =
  | "MANUAL"
  | "COLLABORATOR_SUGGESTION"
  | "MCP_AGENT"
  | "IN_APP_AI"
  | "IMPORT"
  | "SYSTEM";

export type ActorContext = {
  projectId: string;
  projectSlug: string;
  kind: ActorKind;
  sourceKind: ContentSourceKind;
  userId?: string;
  apiKeyId?: string;
  label: string;
  capabilities: string[];
  requestId?: string;
  correlationId?: string;
};
