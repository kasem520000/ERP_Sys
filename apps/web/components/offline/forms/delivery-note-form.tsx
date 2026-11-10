"use client";
/**
 * PHASE-021 T2-b · the delivery note form (matrix row 10 — OFFLINE-DRAFT,
 * SD-at-submit): `delivery_note:create_draft` (DR-P21-08) against the
 * frozen `deliveryNoteCreateDraftPayloadSchema`. The warehouse id has no
 * local catalog (the desktop cache v1–v5 carries no warehouse directory)
 * — the field is an honest validated UUID input with the no-catalog note.
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import {
  deliveryNoteCreateDraftPayloadSchema,
  type DeliveryNoteCreateDraftPayload,
} from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildDeliveryNoteCreateDraft } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, lines, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface LineDraft {
  itemId: string;
  qty: string;
  unitPrice: string;
  discount: string;
  batchId: string;
}

const EMPTY_LINE: LineDraft = { itemId: "", qty: "", unitPrice: "", discount: "", batchId: "" };

interface FormValues {
  customerId: string;
  warehouseId: string;
  orderId: string;
  deliveryDate: string;
  note: string;
  noteAr: string;
  lines: LineDraft[];
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return { customerId: "", warehouseId: "", orderId: "", deliveryDate: "", note: "", noteAr: "", lines: [{ ...EMPTY_LINE }] };
  }
  const initialLines = lines(payload.lines).map((line) => ({
    itemId: uuid(line.itemId),
    qty: str(line.qty),
    unitPrice: str(line.unitPrice ?? ""),
    discount: str(line.discountAmount ?? ""),
    batchId: uuid(line.batchId ?? ""),
  }));
  return {
    customerId: uuid(payload.customerId),
    warehouseId: uuid(payload.warehouseId),
    orderId: uuid(payload.orderId ?? ""),
    deliveryDate: str(payload.deliveryDate),
    note: str(payload.note ?? ""),
    noteAr: str(payload.noteAr ?? ""),
    lines: initialLines.length > 0 ? initialLines : [{ ...EMPTY_LINE }],
  };
}

export function DeliveryNoteForm({
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
      customerId: values.customerId,
      warehouseId: values.warehouseId.trim(),
      orderId: values.orderId.trim() === "" ? null : values.orderId.trim(),
      deliveryDate: values.deliveryDate,
      note: values.note.trim() === "" ? null : values.note.trim(),
      noteAr: values.noteAr.trim() === "" ? null : values.noteAr.trim(),
      lines: values.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice.trim() === "" ? null : line.unitPrice.trim(),
        discountAmount: line.discount.trim() === "" ? null : line.discount.trim(),
        batchId: line.batchId.trim() === "" ? null : line.batchId.trim(),
      })),
    };
    let payload: DeliveryNoteCreateDraftPayload;
    try {
      payload = deliveryNoteCreateDraftPayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildDeliveryNoteCreateDraft(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "delivery_note",
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
        <Select
          label={d.offlineFieldCustomer}
          required
          value={values.customerId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, customerId: value }))}
          options={[
            { value: "", label: "—" },
            ...options.partners.map((partner) => ({
              value: partner.id,
              label: locale === "ar" ? partner.nameAr ?? partner.name : partner.name,
            })),
          ]}
          error={errors.customerId}
        />
        <Input
          label={d.offlineFieldWarehouseId}
          required
          value={values.warehouseId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, warehouseId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.warehouseId}
        />
        <Input
          label={`${d.offlineFieldOrderId} (${d.offlineFieldOptional})`}
          value={values.orderId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, orderId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.orderId}
        />
        <Input
          label={d.offlineFieldDate}
          required
          value={values.deliveryDate}
          onValueChange={(value) => setValues((prev) => ({ ...prev, deliveryDate: value }))}
          placeholder="2026-11-04"
          mono
          bidiIsolate
          inputMode="numeric"
          error={errors.deliveryDate}
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
              value={line.qty}
              onValueChange={(value) => setLine(index, { qty: value })}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.qty`]}
            />
            <Input
              label={`${d.offlineFieldUnitPrice} (${d.offlineFieldOptional})`}
              value={line.unitPrice}
              onValueChange={(value) => setLine(index, { unitPrice: value })}
              hint={d.offlineFieldServerPriceHint}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.unitPrice`]}
            />
            <Input
              label={`${d.offlineFieldDiscount} (${d.offlineFieldOptional})`}
              value={line.discount}
              onValueChange={(value) => setLine(index, { discount: value })}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.discountAmount`]}
            />
            <Input
              label={`${d.offlineFieldBatchId} (${d.offlineFieldOptional})`}
              value={line.batchId}
              onValueChange={(value) => setLine(index, { batchId: value })}
              hint={d.offlineFieldNoCatalog}
              placeholder="21212121-0000-4000-8000-…"
              mono
              bidiIsolate
              error={errors[`lines.${index}.batchId`]}
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
