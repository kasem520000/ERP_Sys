"use client";
/**
 * PHASE-021 T2-b · the sales invoice draft form (matrix row 6 — the 020
 * OFFLINE-DRAFT pair, OD policy): `sales_invoice:create_draft` via
 * sync-core's 020 builder, validated against the FROZEN
 * `draftInvoiceCreateSchema`. Money/qty stay decimal strings end to end
 * (ADR-0009 — never float).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { draftInvoiceCreateSchema, type DraftInvoiceCreatePayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildDraftInvoiceCreate } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, lines, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface LineDraft {
  itemId: string;
  qty: string;
  unitPrice: string;
  discount: string;
  taxCodeId: string;
  description: string;
}

const EMPTY_LINE: LineDraft = { itemId: "", qty: "", unitPrice: "", discount: "", taxCodeId: "", description: "" };

interface FormValues {
  customerId: string;
  orderDate: string;
  lines: LineDraft[];
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) return { customerId: "", orderDate: "", lines: [{ ...EMPTY_LINE }] };
  const initialLines = lines(payload.lines).map((line) => ({
    itemId: uuid(line.itemId),
    qty: str(line.qty),
    unitPrice: str(line.unitPrice),
    discount: str(line.discountAmount ?? ""),
    taxCodeId: uuid(line.taxCodeId ?? ""),
    description: str(line.description ?? ""),
  }));
  return {
    customerId: uuid(payload.customerId),
    orderDate: str(payload.orderDate),
    lines: initialLines.length > 0 ? initialLines : [{ ...EMPTY_LINE }],
  };
}

export function InvoiceDraftForm({
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
      customerId: values.customerId === "" ? null : values.customerId,
      orderDate: values.orderDate,
      lines: values.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountAmount: line.discount === "" ? null : line.discount,
        taxCodeId: line.taxCodeId === "" ? null : line.taxCodeId,
        description: line.description.trim() === "" ? undefined : line.description.trim(),
      })),
    };
    let payload: DraftInvoiceCreatePayload;
    try {
      payload = draftInvoiceCreateSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildDraftInvoiceCreate(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "sales_invoice_draft",
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
          label={d.offlineFieldDate}
          value={values.orderDate}
          onValueChange={(value) => setValues((prev) => ({ ...prev, orderDate: value }))}
          placeholder="2026-11-04"
          mono
          bidiIsolate
          inputMode="numeric"
          error={errors.orderDate}
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
              value={line.qty}
              onValueChange={(value) => setLine(index, { qty: value })}
              mono
              bidiIsolate
              inputMode="decimal"
              error={errors[`lines.${index}.qty`]}
            />
            <Input
              label={d.offlineFieldUnitPrice}
              value={line.unitPrice}
              onValueChange={(value) => setLine(index, { unitPrice: value })}
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
            <Select
              label={`${d.offlineFieldTaxCode} (${d.offlineFieldOptional})`}
              value={line.taxCodeId}
              onValueChange={(value) => setLine(index, { taxCodeId: value })}
              options={[
                { value: "", label: "—" },
                ...options.taxCodes.map((code) => ({
                  value: code.id,
                  label: `${code.code} · ${locale === "ar" ? code.nameAr ?? code.name : code.name}`,
                })),
              ]}
              error={errors[`lines.${index}.taxCodeId`]}
            />
            <Input
              label={`${d.offlineFieldDescription} (${d.offlineFieldOptional})`}
              value={line.description}
              onValueChange={(value) => setLine(index, { description: value })}
              error={errors[`lines.${index}.description`]}
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
