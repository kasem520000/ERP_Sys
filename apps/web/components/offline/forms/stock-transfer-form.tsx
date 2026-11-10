"use client";
/**
 * PHASE-021 T2-b · the stock transfer draft form (matrix row 26 —
 * OFFLINE-DRAFT, SD): `stock_transfer:create_draft` (DR-P21-08) against
 * the frozen `stockTransferCreateDraftPayloadSchema`. One line per item
 * (the service's uniqueness rule) — the form REPLACES the qty when an
 * already-chosen item is picked again. Cross-field: the two warehouses
 * must differ (offlineErrSameWarehouse). No date at draft (dispatch dates
 * the legs) — no batch at draft (FEFO at dispatch).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { stockTransferCreateDraftPayloadSchema, type StockTransferCreateDraftPayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildStockTransferCreateDraft } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, lines, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface LineDraft {
  itemId: string;
  qty: string;
}

const EMPTY_LINE: LineDraft = { itemId: "", qty: "" };

interface FormValues {
  fromWarehouseId: string;
  toWarehouseId: string;
  note: string;
  noteAr: string;
  lines: LineDraft[];
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return { fromWarehouseId: "", toWarehouseId: "", note: "", noteAr: "", lines: [{ ...EMPTY_LINE }] };
  }
  const initialLines = lines(payload.lines).map((line) => ({
    itemId: uuid(line.itemId),
    qty: str(line.qty),
  }));
  return {
    fromWarehouseId: uuid(payload.fromWarehouseId),
    toWarehouseId: uuid(payload.toWarehouseId),
    note: str(payload.note ?? ""),
    noteAr: str(payload.noteAr ?? ""),
    lines: initialLines.length > 0 ? initialLines : [{ ...EMPTY_LINE }],
  };
}

export function StockTransferForm({
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

  /** One line per item (the service rule): re-picking an existing item
   * updates its qty instead of adding a duplicate line. */
  const setLine = (index: number, patch: Partial<LineDraft>): void => {
    setValues((prev) => {
      const next = prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line));
      const seen = new Set<string>();
      const deduped: LineDraft[] = [];
      for (const line of next) {
        if (line.itemId !== "" && seen.has(line.itemId)) {
          const target = deduped.find((row) => row.itemId === line.itemId);
          if (target !== undefined) {
            target.qty = line.qty !== "" ? line.qty : target.qty;
            continue;
          }
        }
        seen.add(line.itemId);
        deduped.push(line);
      }
      return { ...prev, lines: deduped.length > 0 ? deduped : [{ ...EMPTY_LINE }] };
    });
  };

  async function submit(): Promise<void> {
    setNote(null);
    const nextErrors: Record<string, string> = {};
    if (values.fromWarehouseId.trim() !== "" && values.fromWarehouseId.trim() === values.toWarehouseId.trim()) {
      nextErrors.toWarehouseId = d.offlineErrSameWarehouse;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const raw = {
      fromWarehouseId: values.fromWarehouseId.trim(),
      toWarehouseId: values.toWarehouseId.trim(),
      note: values.note.trim() === "" ? null : values.note.trim(),
      noteAr: values.noteAr.trim() === "" ? null : values.noteAr.trim(),
      lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
    };
    let payload: StockTransferCreateDraftPayload;
    try {
      payload = stockTransferCreateDraftPayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildStockTransferCreateDraft(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "stock_transfer",
        entityId: null,
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
      <p className="text-sm text-gray-600">{d.offlineNoteDraft}</p>
      <div className={FORM_GRID_CLASS}>
        <Input
          label={d.offlineFieldFromWarehouse}
          required
          value={values.fromWarehouseId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, fromWarehouseId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.fromWarehouseId}
        />
        <Input
          label={d.offlineFieldToWarehouse}
          required
          value={values.toWarehouseId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, toWarehouseId: value }))}
          hint={d.offlineErrSameWarehouse}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.toWarehouseId}
        />
        <Input
          label={`${d.offlineFieldNote} (${d.offlineFieldOptional})`}
          value={values.note}
          onValueChange={(value) => setValues((prev) => ({ ...prev, note: value }))}
          error={errors.note}
        />
        <Input
          label={`${d.offlineFieldNoteAr} (${d.offlineFieldOptional})`}
          value={values.noteAr}
          onValueChange={(value) => setValues((prev) => ({ ...prev, noteAr: value }))}
          error={errors.noteAr}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-gray-900">{d.offlineLinesTitle}</span>
        {values.lines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-3 rounded-md border border-subtle bg-surface-card p-3 sm:grid-cols-2"
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
              value={line.qty}
              onValueChange={(value) => setLine(index, { qty: value })}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.qty`]}
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
