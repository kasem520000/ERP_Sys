"use client";

/**
 * PHASE-052 (W-48 — T-06's web half, D-09) THE DEEP-LINK ACT SURFACE —
 * the email leg's landing page (`/{locale}/workflow/act?token=…`): the
 * signed one-time link's own preview + act. THE LAW: the link
 * AUTHORIZES, the session AUTHENTICATES — the page reads the preview
 * through the engine's own floors (a dead link previews as the typed
 * refusal, never a stale form), and the act posts through the engine's
 * own act path (the G-67 floor, the CAS single-use stamp — a replayed
 * or expired link takes the typed refusal VERBATIM in the refusal
 * panel with its FULL payload).
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Button, Input, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, DeepLinkPreview } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedWorkflowError,
  workflowDocLabel,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { TypedRefusalPanel } from "./typed-refusal-panel";
import { workflowDocDetailPath } from "./workflow-timeline";

type ActOutcome = {
  action: "approve" | "reject";
  completed: boolean;
  remaining: number;
};

export function WorkflowActSurface({
  locale,
  token,
}: {
  locale: Locale;
  token: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [preview, setPreview] = useState<DeepLinkPreview | null>(null);
  const [refusal, setRefusal] = useState<ApiErrorBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ActOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      const result = await bffFetch<DeepLinkPreview>(
        `workflow/act?token=${encodeURIComponent(token)}`,
      );
      if (cancelled) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setRefusal(result.error);
        setPreview(null);
        return;
      }
      setRefusal(null);
      setPreview(result.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(verdict: "approve" | "reject"): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<ActOutcome>("workflow/act", {
      method: "POST",
      body: { token, comment: comment.trim() === "" ? null : comment.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedWorkflowError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setOutcome(result.data);
    setComment("");
    toast({
      tone: "success",
      title: verdict === "approve" ? d.workflowActApproveDone : d.workflowActRejectDone,
    });
  }

  return (
    <Card title={d.workflowActPageTitle} description={d.workflowActPageSubtitle}>
      {loading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
      {refusal !== null ? (
        <>
          <p className="text-sm font-medium">{d.workflowActPreviewRefusal}</p>
          <div className="mt-2">
            <TypedRefusalPanel
              error={refusal}
              title={d.workflowRefusalTitle}
              detailsLabel={d.workflowRefusalDetails}
            />
          </div>
        </>
      ) : null}
      {!loading && refusal === null && preview !== null && outcome === null ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {d.workflowActStepLabel}:{" "}
              {localizedName(preview.stepName, preview.stepNameAr, locale)}
            </span>
            {preview.awaiting ? (
              <span className="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs text-warning-text">
                {formatMessage(d.workflowActAwaiting, { deadline: formatDateTime(preview.deadline, locale) })}
              </span>
            ) : (
              <span className="rounded-sm border border-subtle bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {d.workflowActNotAwaiting}
              </span>
            )}
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-gray-500">{d.workflowActDocLabel}</dt>
              <dd className="text-sm">
                {workflowDocLabel(d, preview.triggerEntity)}
                {preview.documentNo !== null ? (
                  <span className="font-mono text-xs" dir="ltr">
                    {" "}
                    · {preview.documentNo}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-gray-500">{d.workflowColAmount}</dt>
              <dd className="font-mono text-sm tabular-nums" dir="ltr">
                {preview.amountBase} {preview.currency}
              </dd>
            </div>
          </dl>
          <a className="text-xs underline" href={workflowDocDetailPath(preview.triggerEntity, preview.documentId)}>
            {d.workflowActOpenDoc}
          </a>
          <Input label={d.workflowActComment} value={comment} onValueChange={setComment} />
          {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={!preview.awaiting}
              onClick={() => {
                void submit("approve");
              }}
            >
              {d.workflowActApprove}
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={!preview.awaiting}
              onClick={() => {
                void submit("reject");
              }}
            >
              {d.workflowActReject}
            </Button>
          </div>
        </div>
      ) : null}
      {outcome !== null ? (
        <SuccessNotice>
          {outcome.completed
            ? outcome.action === "approve"
              ? `${d.workflowActApproveDone} ${d.workflowActChainCompleted}`
              : `${d.workflowActRejectDone} ${d.workflowActChainCompleted}`
            : `${outcome.action === "approve" ? d.workflowActApproveDone : d.workflowActRejectDone} ${formatMessage(d.workflowActRemaining, { count: outcome.remaining })}`}
        </SuccessNotice>
      ) : null}
    </Card>
  );
}
