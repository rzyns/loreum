import type { Entity, LoreArticleSummary, Relationship } from "@loreum/types";

export type WriteVisibility = {
  projectVisibility?: "PRIVATE" | "UNLISTED" | "PUBLIC";
  publicReadable: boolean | "unknown";
  reason?: string;
};

export type WriteAffordanceResponse<T> = {
  ok: true;
  operation: "create" | "update" | "delete";
  contentType: string;
  displayType: string;
  projectSlug: string;
  id?: string;
  slug?: string;
  title?: string;
  record: T;
  links?: {
    api?: string;
    admin?: string;
    public?: string;
    list?: string;
    search?: string;
  };
  visibility?: WriteVisibility;
  nextActions?: Array<{
    label: string;
    kind: "open" | "verify" | "link" | "search" | "review" | string;
    href?: string;
    tool?: string;
    note?: string;
  }>;
};

export type WriteSuccessAffordance = {
  operation: "create" | "update" | "delete";
  displayType: string;
  title: string;
  adminHref?: string;
  adminLabel: string;
  publicHref?: string;
  publicReadable: boolean | "unknown";
  publicLabel?: string;
  visibilityReason?: string;
};

export type WriteResult<T> = {
  record: T;
  affordance: WriteSuccessAffordance;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isWriteAffordanceResponse<T>(
  value: unknown,
): value is WriteAffordanceResponse<T> {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.operation === "string" &&
    typeof value.displayType === "string" &&
    isRecord(value.record)
  );
}

function entityTypeSegment(
  entity: Entity,
  fallbackTypeSlug?: string,
): string | undefined {
  if (entity.type === "CHARACTER") return "characters";
  if (entity.type === "LOCATION") return "locations";
  if (entity.type === "ORGANIZATION") return "organizations";
  if (entity.type === "ITEM")
    return entity.item?.itemType?.slug ?? fallbackTypeSlug;
  return fallbackTypeSlug;
}

function entityDisplayType(entity: Entity): string {
  if (entity.type === "CHARACTER") return "Character";
  if (entity.type === "LOCATION") return "Location";
  if (entity.type === "ORGANIZATION") return "Organization";
  if (entity.type === "ITEM") return entity.item?.itemType?.name ?? "Item";
  return "Entity";
}

export function normalizeWriteResult<T>(
  value: T | WriteAffordanceResponse<T>,
  fallback: (record: T) => WriteSuccessAffordance,
): WriteResult<T> {
  if (!isWriteAffordanceResponse<T>(value)) {
    const record = value as T;
    return { record, affordance: fallback(record) };
  }

  const title = value.title ?? value.slug ?? value.id ?? "Untitled";
  const publicReadable = value.visibility?.publicReadable ?? false;
  const publicHref =
    value.links?.public &&
    (publicReadable === true || publicReadable === "unknown")
      ? value.links.public
      : undefined;

  return {
    record: value.record,
    affordance: {
      operation: value.operation,
      displayType: value.displayType,
      title,
      adminHref: value.links?.admin,
      adminLabel: `Open admin ${value.displayType.toLowerCase()}`,
      publicHref,
      publicReadable,
      publicLabel:
        publicReadable === "unknown"
          ? "Copy public link (visibility unknown)"
          : "Copy public link",
      visibilityReason: value.visibility?.reason,
    },
  };
}

export function entityCreateFallbackAffordance(
  projectSlug: string,
  entity: Entity,
  fallbackTypeSlug?: string,
): WriteSuccessAffordance {
  const typeSegment = entityTypeSegment(entity, fallbackTypeSlug);
  const adminHref = typeSegment
    ? `/projects/${projectSlug}/entities/${typeSegment}/${entity.slug}`
    : `/projects/${projectSlug}`;

  return {
    operation: "create",
    displayType: entityDisplayType(entity),
    title: entity.name,
    adminHref,
    adminLabel: typeSegment ? "Open admin entity" : "Open project",
    publicReadable: false,
    visibilityReason:
      "The API response did not include a post-write visibility envelope, so the UI is not constructing public links optimistically.",
  };
}

export function loreCreateFallbackAffordance(
  projectSlug: string,
  article: LoreArticleSummary,
): WriteSuccessAffordance {
  return {
    operation: "create",
    displayType: "Lore article",
    title: article.title,
    adminHref: `/projects/${projectSlug}/lore/${article.slug}`,
    adminLabel: "Open admin lore article",
    publicReadable: false,
    visibilityReason:
      "The API response did not include a post-write visibility envelope, so the UI is not constructing public links optimistically.",
  };
}

export function relationshipCreateFallbackAffordance(
  projectSlug: string,
  relationship: Relationship,
): WriteSuccessAffordance {
  return {
    operation: "create",
    displayType: "Relationship",
    title: relationship.label,
    adminHref: `/projects/${projectSlug}/relationships`,
    adminLabel: "Open admin relationships list",
    publicReadable: false,
    visibilityReason:
      "The API response did not include a post-write visibility envelope, so the UI is not constructing public links optimistically.",
  };
}
