"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@loreum/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@loreum/ui/card";
import { Skeleton } from "@loreum/ui/skeleton";
import { Textarea } from "@loreum/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Project } from "@loreum/types";

type DraftStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "APPLIED" | "REJECTED";

interface ReviewQueueSummary {
  id: string;
  status: DraftStatus;
  targetType: string;
  operation: string;
  displayName: string;
  displaySummary: string | null;
  submittedByKind: string;
  submittedByLabel: string;
  sourceKind: string;
  canonicalApplied: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReviewQueueResponse {
  items: ReviewQueueSummary[];
  page: { limit: number; offset: number; total: number };
}

interface ReviewHistoryEvent {
  id: string;
  eventType: string;
  actorKind: string;
  actorLabel: string;
  sourceKind: string;
  summary: string;
  occurredAt: string;
}

interface ReviewQueueDetail extends ReviewQueueSummary {
  batchId: string;
  proposed: {
    type?: string;
    name?: string;
    slug?: string;
    summary?: string | null;
  };
  reviewHistory: ReviewHistoryEvent[];
}

interface ActionResult {
  status: "applied" | "rejected";
  canonicalApplied: boolean;
  draftId: string;
  batchId: string;
  canonical?: { id: string; slug: string; name: string };
  rejectionReason?: string | null;
}

export default function ReviewQueuePage() {
  const params = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [queue, setQueue] = useState<ReviewQueueSummary[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewQueueDetail | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  const canReviewActions = project?.ownerId === user?.id;

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const [projectResponse, reviewQueue] = await Promise.all([
        api<Project>(`/projects/${params.slug}`),
        api<ReviewQueueResponse>(
          `/projects/${params.slug}/drafts/entities?status=SUBMITTED&targetType=ENTITY&operation=CREATE`,
        ),
      ]);
      setProject(projectResponse);
      setQueue(reviewQueue.items);
      setSelectedDraftId((current) =>
        current && reviewQueue.items.some((item) => item.id === current)
          ? current
          : (reviewQueue.items[0]?.id ?? null),
      );
    } catch (err) {
      setQueue([]);
      setSelectedDraftId(null);
      setQueueError(
        err instanceof Error ? err.message : "Unable to load review queue.",
      );
    } finally {
      setLoadingQueue(false);
    }
  }, [params.slug]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedDraftId) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    setDetailError(null);
    setActionError(null);
    setActionResult(null);
    api<ReviewQueueDetail>(
      `/projects/${params.slug}/drafts/entities/${selectedDraftId}`,
    )
      .then((draft) => {
        setDetail(draft);
        setReviewNote("");
        setRejectionReason("");
      })
      .catch((err) => {
        setDetail(null);
        setDetailError(
          err instanceof Error ? err.message : "Unable to load draft detail.",
        );
      })
      .finally(() => setLoadingDetail(false));
  }, [params.slug, selectedDraftId]);

  const orderedQueue = useMemo(
    () =>
      [...queue].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [queue],
  );

  const finishAction = async (result: ActionResult) => {
    setActionResult(result);
    await loadQueue();
    setSelectedDraftId((current) => (current === detail?.id ? null : current));
    setDetail(null);
  };

  const approveDraft = async () => {
    if (!detail || acting || !canReviewActions) return;

    setActing("approve");
    setActionError(null);
    setActionResult(null);
    try {
      const result = await api<ActionResult>(
        `/projects/${params.slug}/drafts/entities/${detail.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ reviewNote: reviewNote.trim() || undefined }),
        },
      );
      await finishAction(result);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Draft action failed.",
      );
    } finally {
      setActing(null);
    }
  };

  const rejectDraft = async () => {
    if (!detail || acting || !canReviewActions) return;

    setActing("reject");
    setActionError(null);
    setActionResult(null);
    try {
      const result = await api<ActionResult>(
        `/projects/${params.slug}/drafts/entities/${detail.id}/reject`,
        {
          method: "POST",
          body: JSON.stringify({
            rejectionReason: rejectionReason.trim() || undefined,
          }),
        },
      );
      await finishAction(result);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Draft action failed.",
      );
    } finally {
      setActing(null);
    }
  };

  return (
    <main className="space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          Staged draft review
        </p>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1>Review queue</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review submitted entity-create drafts before they become canonical
              world content. Proposed values below are staged draft data, not
              canonical content.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadQueue()}>
            Refresh queue
          </Button>
        </div>
      </header>

      {queueError ? (
        <section
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {queueError}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.6fr)]">
        <section aria-label="Submitted drafts" className="space-y-3">
          {loadingQueue ? <QueueSkeleton /> : null}
          {!loadingQueue && orderedQueue.length === 0 && !queueError ? (
            <Card>
              <CardHeader>
                <CardTitle>No submitted drafts</CardTitle>
                <CardDescription>
                  New entity proposals submitted for review will appear here.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {orderedQueue.map((draft) => (
            <button
              key={draft.id}
              type="button"
              onClick={() => setSelectedDraftId(draft.id)}
              className={`w-full rounded-xl text-left outline-none ring-1 ring-foreground/10 transition hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring ${
                selectedDraftId === draft.id ? "bg-muted" : "bg-card"
              }`}
            >
              <article className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-medium">
                      {draft.displayName}
                    </h2>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {formatOperation(draft.operation)}{" "}
                      {formatTarget(draft.targetType)}
                    </p>
                  </div>
                  <StatusPill status={draft.status} />
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {draft.displaySummary || "No staged summary provided."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Submitted by {draft.submittedByLabel} ·{" "}
                  {formatDate(draft.createdAt)}
                </p>
              </article>
            </button>
          ))}
        </section>

        <section aria-label="Draft detail" className="min-h-[24rem]">
          {loadingDetail ? <DetailSkeleton /> : null}
          {!loadingDetail && detailError ? (
            <Card role="alert">
              <CardHeader>
                <CardTitle>Unable to load draft detail</CardTitle>
                <CardDescription>{detailError}</CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {!loadingDetail && !detail && !detailError ? (
            <Card>
              <CardHeader>
                <CardTitle>Select a staged draft</CardTitle>
                <CardDescription>
                  Choose a submitted draft to inspect safe proposed content,
                  audit context, and available review actions.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {!loadingDetail && detail ? (
            <Card>
              <CardHeader>
                <CardTitle>{detail.displayName}</CardTitle>
                <CardDescription>
                  Staged draft · {formatOperation(detail.operation)}{" "}
                  {formatTarget(detail.targetType)} · batch {detail.batchId}
                </CardDescription>
                <CardAction>
                  <StatusPill status={detail.status} />
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="rounded-lg border bg-muted/40 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    Staged draft preview — not canonical content
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <Field
                      label="Type"
                      value={formatTarget(detail.proposed.type)}
                    />
                    <Field label="Proposed slug" value={detail.proposed.slug} />
                    <Field label="Proposed name" value={detail.proposed.name} />
                    <Field
                      label="Proposed summary"
                      value={
                        detail.proposed.summary || "No staged summary provided."
                      }
                    />
                  </dl>
                </section>

                <section className="grid gap-3 text-sm sm:grid-cols-3">
                  <Field label="Actor/source" value={detail.submittedByLabel} />
                  <Field label="Actor kind" value={detail.submittedByKind} />
                  <Field label="Source kind" value={detail.sourceKind} />
                  <Field
                    label="Submitted"
                    value={formatDate(detail.createdAt)}
                  />
                  <Field label="Updated" value={formatDate(detail.updatedAt)} />
                  <Field
                    label="Canonical applied"
                    value={detail.canonicalApplied ? "Yes" : "No"}
                  />
                </section>

                <section className="space-y-3">
                  <h2 className="text-base font-medium">
                    Review history and context
                  </h2>
                  {detail.reviewHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No audit context is attached to this draft yet.
                    </p>
                  ) : (
                    <ol className="space-y-3 border-l pl-4">
                      {detail.reviewHistory.map((event) => (
                        <li key={event.id} className="space-y-1 text-sm">
                          <div className="font-medium">
                            {formatEvent(event.eventType)}
                          </div>
                          <p className="text-muted-foreground">
                            {event.summary}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {event.actorLabel} · {event.actorKind} ·{" "}
                            {formatDate(event.occurredAt)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                {actionResult ? (
                  <section
                    role="status"
                    className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm"
                  >
                    {actionResult.canonicalApplied
                      ? `Draft applied to canonical entity ${actionResult.canonical?.name ?? actionResult.draftId}.`
                      : "Draft rejected without changing canonical content."}
                  </section>
                ) : null}
                {actionError ? (
                  <section
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {actionError}
                  </section>
                ) : null}

                {canReviewActions && detail.status === "SUBMITTED" ? (
                  <section className="space-y-4 rounded-lg border p-4">
                    <h2 className="text-base font-medium">Review actions</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label
                          htmlFor="review-note"
                          className="text-sm font-medium"
                        >
                          Approval note (optional)
                        </label>
                        <Textarea
                          id="review-note"
                          value={reviewNote}
                          onChange={(event) =>
                            setReviewNote(event.target.value)
                          }
                          placeholder="Why this staged draft is ready to become canonical…"
                        />
                        <Button
                          onClick={() => void approveDraft()}
                          disabled={Boolean(acting)}
                        >
                          {acting === "approve" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Approve and apply
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="rejection-reason"
                          className="text-sm font-medium"
                        >
                          Rejection reason (optional)
                        </label>
                        <Textarea
                          id="rejection-reason"
                          value={rejectionReason}
                          onChange={(event) =>
                            setRejectionReason(event.target.value)
                          }
                          placeholder="What should be changed before resubmission…"
                        />
                        <Button
                          variant="destructive"
                          onClick={() => void rejectDraft()}
                          disabled={Boolean(acting)}
                        >
                          {acting === "reject" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Reject staged draft
                        </Button>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                    {
                      "You can inspect staged drafts, but this account is not allowed to approve or reject them."
                    }{" "}
                    The backend remains authoritative for every review action.
                  </section>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading review queue">
      {[0, 1, 2].map((item) => (
        <Card key={item}>
          <CardContent className="space-y-3 pt-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <Card aria-label="Loading draft detail">
      <CardContent className="space-y-4 pt-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm">{value || "—"}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: DraftStatus }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {status.toLowerCase()}
    </span>
  );
}

function formatOperation(value?: string) {
  return value ? value.toLowerCase() : "unknown operation";
}

function formatTarget(value?: string) {
  return value ? value.toLowerCase().replaceAll("_", " ") : "unknown target";
}

function formatEvent(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
