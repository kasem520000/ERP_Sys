"use client";
/**
 * PHASE-021 T2-b · the expense entry form (matrix row 25 — OFFLINE-DRAFT,
 * SD): `expense:create` (DR-P21-08) against the frozen
 * `expenseCreatePayloadSchema`. Category/till account ids have no local
 * catalog (honest UUID inputs); `receiptFileId` stays null offline — no
 * offline uploads, the receipt attaches online before submit.
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { expenseCreatePayloadSchema, type ExpenseCreatePayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildExpenseCreate } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface FormValues {
  categoryId: string;
  cashAccountId: string;
  payeeName: string;
  currencyCode: string;
  amount: string;
  exchangeRate: string;
  taxCodeId: string;
  valueDate: string;
  description: string;
  descriptionAr: string;
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return {
      categoryId: "",
      cashAccountId: "",
      payeeName: "",
      currencyCode: "SAR",
      amount: "",
      exchangeRate: "",
      taxCodeId: "",
      valueDate: "",
      description: "",
      descriptionAr: "",
    };
  }
  return {
    categoryId: uuid(payload.categoryId),
    cashAccountId: uuid(payload.cashAccountId),
    payeeName: str(payload.payeeName),
    currencyCode: str(payload.currencyCode),
    amount: str(payload.amount),
    exchangeRate: str(payload.exchangeRate ?? ""),
    taxCodeId: uuid(payload.taxCodeId ?? ""),
    valueDate: str(payload.valueDate),
    description: str(payload.description ?? ""),
    descriptionAr: str(payload.descriptionAr ?? ""),
  };
}

export function ExpenseForm({
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

  async function submit(): Promise<void> {
    setNote(null);
    const raw = {
      categoryId: values.categoryId.trim(),
      cashAccountId: values.cashAccountId.trim(),
      payeeName: values.payeeName.trim(),
      currencyCode: values.currencyCode.trim().toUpperCase(),
      amount: values.amount.trim(),
      exchangeRate: values.exchangeRate.trim() === "" ? null : values.exchangeRate.trim(),
      taxCodeId: values.taxCodeId === "" ? null : values.taxCodeId,
      receiptFileId: null, // stays null offline — no offline uploads
      valueDate: values.valueDate.trim(),
      description: values.description.trim() === "" ? null : values.description.trim(),
      descriptionAr: values.descriptionAr.trim() === "" ? null : values.descriptionAr.trim(),
    };
    let payload: ExpenseCreatePayload;
    try {
      payload = expenseCreatePayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildExpenseCreate(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "expense",
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
          label={d.offlineFieldCategoryId}
          required
          value={values.categoryId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, categoryId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.categoryId}
        />
        <Input
          label={d.offlineFieldCashAccountId}
          required
          value={values.cashAccountId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, cashAccountId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.cashAccountId}
        />
        <Input
          label={d.offlineFieldPayee}
          required
          value={values.payeeName}
          onValueChange={(value) => setValues((prev) => ({ ...prev, payeeName: value }))}
          error={errors.payeeName}
        />
        <Input
          label={d.offlineFieldCurrency}
          required
          value={values.currencyCode}
          onValueChange={(value) => setValues((prev) => ({ ...prev, currencyCode: value }))}
          hint={d.offlineErrCurrency}
          bidiIsolate
          error={errors.currencyCode}
        />
        <Input
          label={d.offlineFieldAmount}
          required
          value={values.amount}
          onValueChange={(value) => setValues((prev) => ({ ...prev, amount: value }))}
          hint={d.offlineErrAmountPositive}
          mono
          bidiIsolate
          inputMode="decimal"
          error={errors.amount}
        />
        <Input
          label={`${d.offlineFieldExchangeRate} (${d.offlineFieldOptional})`}
          value={values.exchangeRate}
          onValueChange={(value) => setValues((prev) => ({ ...prev, exchangeRate: value }))}
          mono
          bidiIsolate
          inputMode="decimal"
          error={errors.exchangeRate}
        />
        <Select
          label={`${d.offlineFieldTaxCode} (${d.offlineFieldOptional})`}
          value={values.taxCodeId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, taxCodeId: value }))}
          options={[
            { value: "", label: "—" },
            ...options.taxCodes.map((code) => ({
              value: code.id,
              label: `${code.code} · ${locale === "ar" ? code.nameAr ?? code.name : code.name}`,
            })),
          ]}
          error={errors.taxCodeId}
        />
        <Input
          label={d.offlineFieldValueDate}
          required
          value={values.valueDate}
          onValueChange={(value) => setValues((prev) => ({ ...prev, valueDate: value }))}
          placeholder="2026-11-04"
          mono
          bidiIsolate
          inputMode="numeric"
          error={errors.valueDate}
        />
        <Input
          label={`${d.offlineFieldDescription} (${d.offlineFieldOptional})`}
          value={values.description}
          onValueChange={(value) => setValues((prev) => ({ ...prev, description: value }))}
          error={errors.description}
        />
        <Input
          label={`${d.offlineFieldDescriptionAr} (${d.offlineFieldOptional})`}
          value={values.descriptionAr}
          onValueChange={(value) => setValues((prev) => ({ ...prev, descriptionAr: value }))}
          error={errors.descriptionAr}
        />
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
