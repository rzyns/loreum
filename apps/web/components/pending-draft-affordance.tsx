"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { api } from "@/lib/api";

type ReviewQueueCountResponse = {
  page?: { total?: number };
};

interface PendingDraftAffordanceProps {
  projectSlug: string;
  surface: "entity" | "lore";
}

export function PendingDraftAffordance({
  projectSlug,
  surface,
}: PendingDraftAffordanceProps) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ReviewQueueCountResponse>(
      `/projects/${projectSlug}/drafts/entities?status=SUBMITTED&targetType=ENTITY&operation=CREATE&limit=1`,
    )
      .then((response) => {
        if (!cancelled) setPendingCount(response.page?.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  if (!pendingCount || pendingCount < 1) return null;

  const noun =
    pendingCount === 1 ? "pending suggestion" : "pending suggestions";
  const surfaceLabel = surface === "lore" ? "lore page" : "record";

  return (
    <aside className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <div className="flex gap-3">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Operational review status</p>
          <p className="text-muted-foreground">
            {pendingCount} submitted entity-create {noun} are waiting in the
            Review queue for this project. Review staged suggestions before
            treating related project changes as canonical near this{" "}
            {surfaceLabel}.
          </p>
          <Link
            href={`/projects/${projectSlug}/review`}
            className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
          >
            Open Review queue
          </Link>
        </div>
      </div>
    </aside>
  );
}
