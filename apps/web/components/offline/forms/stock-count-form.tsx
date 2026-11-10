"use client";
/**
 * PHASE-021 T2-b · the stock count lines form (matrix row 11 —
 * OFFLINE-DRAFT, SD-aggregate): `stock_count:submit_lines` (DR-P21-08)
 * against the frozen `stockCountSubmitLinesPayloadSchema`. Counted
 * quantities are FACTS — a counted zero is a legitimate count (loss);
 * variance/adjustment is computed server-side only. The count session
 * picker reads the stock_counts cache filtered to DRAFT (sessions are
 * created online so the system-qty snapshot freezes server-side).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { stockCountSubmitLinesPayloadSchema, type StockCountSubmitLinesPayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildStockCountSubmitLines } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, lines, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface LineDraft {
  itemId: string;
  countedQty: string;
  batchRef: string;
}

const EMPTY_LINE: LineDraft = { itemId: "", countedQty: "", batchRef: "" };

interface FormValues {
  countId: string;
  lines: LineDraft[];
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) return { countId: "", lines: [{ ...EMPTY_LINE }] };
  const initialLines = lines(payload.lines).map((line) => ({
    itemId: uuid(line.itemId),
    countedQty: str(line.countedQty),
    batchRef: uuid(line.batchRef ?? ""),
  }));
  return {
    countId: uuid(payload.countId),
    lines: initialLines.length > 0 ? initialLines : [{ ...EMPTY_LINE }],
  };
}

export function StockCountForm({
  locale,
  bridge,
  options,
  onEnqueued,
  editing,
}: {
  locale: Locale;
  bridge: DesktopBridge;
  options: ConsoleOptions;
  onEnqueued: () => Promise<void>;
  editing?: EditingDraft | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const [values, setValues] = useState<FormValues>(() => initialValues(editing ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (index: number, patch: Partial<LineDraft>): void => {
    setValues((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  async function submit(): Promise<void> {
    setNote(null);
    const raw = {
      countId: values.countId,
      lines: values.lines.map((line) => ({
        itemId: line.itemId,
        countedQty: line.countedQty,
        batchRef: line.batchRef.trim() === "" ? null : line.batchRef.trim(),
      })),
    };
    let payload: StockCountSubmitLinesPayload;
    try {
      payload = stockCountSubmitLinesPayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildStockCountSubmitLines(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "stock_count_lines",
        entityId: values.countId,
        payload,
      });
    } catch (error) {
      setErrors({ _form: enqueueErrorMessage(error, d) });
      return;
    } finally {
      setBusy(false);
    }
    setNote(d.offlineQueuedToast);
    if (editing === null || editing === undefined) setValues(initialValues(null));
    setErrors({});
    await onEnqueued();
  }

  return (
    <form
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-gray-600">{d.offlineNoteCount}</p>
      <div className={FORM_GRID_CLASS}>
        <Select
          label={d.offlineFieldCountSession}
          required
          value={values.countId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, countId: value }))}
          options={[
            { value: "", label: "—" },
            ...options.countSessions.map((session) => ({
              value: session.id,
              label: session.docNo !== null ? `${session.docNo} · ${session.id.slice(0, 8)}…` : session.id.slice(0, 16) + "…",
            })),
          ]}
          error={errors.countId}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-gray-900">{d.offlineLinesTitle}</span>
        {values.lines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-3 rounded-md border border-subtle bg-surface-card p-3 sm:grid-cols-3"
          >
            <Select
              label={`${d.offlineFieldItem} ${index + 1}`}
              required
              value={line.itemId}
              onValueChange={(value) => setLine(index, { itemId: value })}
              options={[
                { value: "", label: "—" },
                ...options.items.map((item) => ({
                  value: item.id,
                  label: `${item.sku} · ${locale === "ar" ? item.nameAr ?? item.name : item.name}`,
                })),
              ]}
              error={errors[`lines.${index}.itemId`]}
            />
            <Input
              label={d.offlineFieldQty}
              required
              value={line.countedQty}
              onValueChange={(value) => setLine(index, { countedQty: value })}
              hint={d.offlineErrCountedQty}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.countedQty`]}
            />
            <Input
              label={`${d.offlineFieldBatchRef} (${d.offlineFieldOptional})`}
              value={line.batchRef}
              onValueChange={(value) => setLine(index, { batchRef: value })}
              hint={d.offlineFieldNoCatalog}
              placeholder="21212121-0000-4000-8000-…"
              mono
              bidiIsolate
              error={errors[`lines.${index}.batchRef`]}
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            iconStart="plus"
            onClick={() => setValues((prev) => ({ ...prev, lines: [...prev.lines, { ...EMPTY_LINE }] }))}
          >
            {d.offlineLinesAdd}
          </Button>
          {values.lines.length > 1 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setValues((prev) => ({ ...prev, lines: prev.lines.slice(0, -1) }))}
            >
              {d.offlineLinesRemove}
            </Button>
          )}
        </div>
      </div>
      {errors._form !== undefined && (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text">
          {errors._form}
        </p>
      )}
      {note !== null && (
        <p role="status" className="rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success-text">
          {note}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" loading={busy}>
          {busy ? d.offlineSubmitting : d.offlineSubmitQueue}
        </Button>
      </div>
    </form>
  );
}
