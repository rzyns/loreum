"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, ExternalLink, X } from "lucide-react";
import { Button, buttonVariants } from "@loreum/ui/button";
import type { WriteSuccessAffordance } from "@/lib/write-affordances";

interface WriteSuccessCardProps {
  affordance: WriteSuccessAffordance | null;
  onDismiss?: () => void;
}

function operationLabel(
  operation: WriteSuccessAffordance["operation"],
): string {
  if (operation === "update") return "Updated";
  if (operation === "delete") return "Deleted";
  return "Created";
}

export function WriteSuccessCard({
  affordance,
  onDismiss,
}: WriteSuccessCardProps) {
  const [copied, setCopied] = useState(false);

  if (!affordance) return null;

  const canCopyPublicLink = Boolean(affordance.publicHref);
  const successText = `${operationLabel(affordance.operation)} ${affordance.displayType}: ${affordance.title}`;

  const copyPublicLink = async () => {
    if (!affordance.publicHref) return;
    await navigator.clipboard.writeText(
      new URL(affordance.publicHref, window.location.origin).toString(),
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      aria-label="Write success next steps"
      aria-live="polite"
      role="status"
      className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 flex-none text-emerald-600"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-foreground">{successText}</p>
            <p className="mt-1 text-muted-foreground">
              Use the admin link to continue editing. Public link actions only
              appear when the write response marks them valid or unknown.
            </p>
            {!affordance.publicHref && affordance.visibilityReason && (
              <p className="mt-1 text-xs text-muted-foreground">
                Public link hidden: {affordance.visibilityReason}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {affordance.adminHref && (
            <Link
              href={affordance.adminHref}
              aria-label={`${affordance.adminLabel}: ${affordance.title}`}
              className={`${buttonVariants({ size: "sm" })} no-underline`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {affordance.adminLabel}
            </Link>
          )}
          {canCopyPublicLink && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyPublicLink}
              aria-label={`${affordance.publicLabel ?? "Copy public link"}: ${affordance.title}`}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {copied
                ? "Copied public link"
                : (affordance.publicLabel ?? "Copy public link")}
            </Button>
          )}
          {onDismiss && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onDismiss}
              aria-label="Dismiss write success message"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
