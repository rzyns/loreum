"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Activity, ShieldAlert } from "lucide-react";
import { Button } from "@loreum/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@loreum/ui/card";
import { Skeleton } from "@loreum/ui/skeleton";
import { api } from "@/lib/api";

type ActivitySummary = {
  id: string;
  eventType: string;
  outcome: string;
  actorKind: string;
  actorLabel: string;
  sourceKind: string;
  operation: string | null;
  targetType: string | null;
  targetDisplay: string | null;
  draftId: string | null;
  batchId: string | null;
  summary: string;
  occurredAt: string;
};

type ActivityResponse = {
  items: ActivitySummary[];
  page: { limit: number; offset: number; total: number };
};

type AuditDetail = ActivitySummary & {
  oldData?: unknown;
  newData?: unknown;
  diff?: unknown;
  metadata?: unknown;
  reviewNote?: string | null;
  rejectionReason?: string | null;
  capabilityContext?: unknown;
  requestId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  schemaVersion?: number;
  streamKey?: string | null;
  streamVersion?: number | null;
  committedAt?: string;
};

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function eventLabel(eventType: string) {
  return eventType
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function stringifySafe(value: unknown) {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function metadataStringValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function reviewRationaleFor(detail: AuditDetail) {
  return {
    reviewNote:
      detail.reviewNote ?? metadataStringValue(detail.metadata, "reviewNote"),
    rejectionReason:
      detail.rejectionReason ??
      metadataStringValue(detail.metadata, "rejectionReason"),
  };
}

function RationaleList({
  items,
  emptyLabel,
}: {
  items: Array<[label: string, value?: string | null]>;
  emptyLabel: string;
}) {
  const recordedItems = items.filter(([, value]) => Boolean(value));

  if (recordedItems.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <dl className="space-y-2">
      {recordedItems.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ProjectActivityPage() {
  const params = useParams<{ slug: string }>();
  const [events, setEvents] = useState<ActivitySummary[]>([]);
  const [page, setPage] = useState<ActivityResponse["page"] | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const response = await api<ActivityResponse>(
        `/projects/${params.slug}/activity?limit=50`,
      );
      setEvents(response.items);
      setPage(response.page);
    } catch (err) {
      setEvents([]);
      setPage(null);
      setFeedError(
        err instanceof Error ? err.message : "Unable to load project activity.",
      );
    } finally {
      setLoadingFeed(false);
    }
  }, [params.slug]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const openDetail = async (event: ActivitySummary) => {
    setSelectedDetailId(event.id);
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const response = await api<AuditDetail>(
        `/projects/${params.slug}/audit/${event.id}`,
      );
      setDetail(response);
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Audit detail is restricted for this account.",
      );
    } finally {
      setLoadingDetail(false);
    }
  };

  const selectedSummary = useMemo(
    () => events.find((event) => event.id === selectedDetailId) ?? null,
    [events, selectedDetailId],
  );

  return (
    <main className="space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Operational provenance
        </p>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1>Project activity</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Safe changelog summaries of review, draft, and canonical write
              operations. World/lore provenance is separate from this
              operational audit trail.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadFeed()}>
            Refresh activity
          </Button>
        </div>
      </header>

      {feedError ? (
        <section
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {feedError}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Changelog feed
            </CardTitle>
            <CardDescription>
              Safe summaries only; request payloads and draft bodies are not
              rendered in the feed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingFeed ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))
            ) : events.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No activity has been recorded for this project yet.
              </p>
            ) : (
              events.map((event) => (
                <article
                  key={event.id}
                  className="rounded-lg border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {eventLabel(event.eventType)}
                        </span>
                        <span>{event.outcome}</span>
                        <span>{formatDate(event.occurredAt)}</span>
                      </div>
                      <h2 className="text-base font-semibold">
                        {event.summary}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Operational provenance: {event.actorKind.toLowerCase()}{" "}
                        “{event.actorLabel}” via{" "}
                        {event.sourceKind.toLowerCase()}.
                      </p>
                      {event.targetDisplay ? (
                        <p className="text-sm text-muted-foreground">
                          Target: {event.targetType ?? "item"} ·{" "}
                          {event.targetDisplay}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void openDetail(event)}
                    >
                      View audit detail
                    </Button>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit detail</CardTitle>
            <CardDescription>
              Detail access is capability-gated; unauthorized accounts keep the
              safe changelog summary but cannot inspect redacted audit payloads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedSummary ? (
              <p className="text-sm text-muted-foreground">
                Select an activity item to request audit detail.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">
                    Safe changelog summary remains visible
                  </p>
                  <p className="text-muted-foreground">
                    {selectedSummary.summary}
                  </p>
                </div>
                {loadingDetail ? (
                  <Skeleton className="h-32 w-full" />
                ) : detailError ? (
                  <div
                    role="alert"
                    className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
                  >
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Audit detail is restricted</p>
                      <p className="text-muted-foreground">{detailError}</p>
                    </div>
                  </div>
                ) : detail ? (
                  <div className="space-y-3 text-sm">
                    <dl className="grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-muted-foreground">Request</dt>
                        <dd className="font-medium">
                          {detail.requestId ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Correlation</dt>
                        <dd className="font-medium">
                          {detail.correlationId ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    {(() => {
                      const rationale = reviewRationaleFor(detail);
                      return (
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Reviewer rationale
                          </p>
                          <RationaleList
                            items={[
                              ["Approval note", rationale.reviewNote],
                              ["Rejection reason", rationale.rejectionReason],
                            ]}
                            emptyLabel="No reviewer rationale is recorded for this audit event."
                          />
                        </div>
                      );
                    })()}
                    {[
                      ["Redacted metadata", detail.metadata],
                      ["Redacted diff", detail.diff],
                      ["Redacted new data", detail.newData],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {label as string}
                        </p>
                        <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                          {stringifySafe(value)}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {page ? (
        <p className="text-xs text-muted-foreground">
          Showing {events.length} of {page.total} operational audit events.
        </p>
      ) : null}
    </main>
  );
}
