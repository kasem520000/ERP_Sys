"use client";
/**
 * PHASE-021 T2-b · the cash transfer / drawer drop form (matrix row 34 —
 * OFFLINE-DRAFT, SD): `cash_transfer:create_draft` (DR-P21-08) against the
 * frozen `cashTransferCreateDraftPayloadSchema`. Cross-field rules the
 * form pre-validates (the server re-decides): distinct accounts
 * (offlineErrSameAccount), amount > 0 (offlineErrAmountPositive), and
 * 0 ≤ fee < amount (offlineErrFeeRange).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { cashTransferCreateDraftPayloadSchema, type CashTransferCreateDraftPayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildCashTransferCreateDraft } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface FormValues {
  fromAccountId: string;
  toAccountId: string;
  currencyCode: string;
  amount: string;
  feeAmount: string;
  exchangeRate: string;
  valueDate: string;
  reference: string;
  description: string;
  descriptionAr: string;
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return {
      fromAccountId: "",
      toAccountId: "",
      currencyCode: "SAR",
      amount: "",
      feeAmount: "",
      exchangeRate: "",
      valueDate: "",
      reference: "",
      description: "",
      descriptionAr: "",
    };
  }
  return {
    fromAccountId: uuid(payload.fromAccountId),
    toAccountId: uuid(payload.toAccountId),
    currencyCode: str(payload.currencyCode),
    amount: str(payload.amount),
    feeAmount: str(payload.feeAmount ?? ""),
    exchangeRate: str(payload.exchangeRate ?? ""),
    valueDate: str(payload.valueDate),
    reference: str(payload.reference ?? ""),
    description: str(payload.description ?? ""),
    descriptionAr: str(payload.descriptionAr ?? ""),
  };
}

function isPositiveDecimal(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function CashTransferForm({
  locale,
  bridge,
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
    const nextErrors: Record<string, string> = {};
    if (values.fromAccountId.trim() !== "" && values.fromAccountId.trim() === values.toAccountId.trim()) {
      nextErrors.toAccountId = d.offlineErrSameAccount;
    }
    if (values.amount.trim() !== "" && !isPositiveDecimal(values.amount.trim())) {
      nextErrors.amount = d.offlineErrAmountPositive;
    }
    if (values.feeAmount.trim() !== "") {
      const fee = Number(values.feeAmount.trim());
      const amount = Number(values.amount.trim());
      if (!(Number.isFinite(fee) && fee >= 0 && fee < amount)) {
        nextErrors.feeAmount = d.offlineErrFeeRange;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    const raw = {
      fromAccountId: values.fromAccountId.trim(),
      toAccountId: values.toAccountId.trim(),
      currencyCode: values.currencyCode.trim().toUpperCase(),
      amount: values.amount.trim(),
      feeAmount: values.feeAmount.trim() === "" ? undefined : values.feeAmount.trim(),
      exchangeRate: values.exchangeRate.trim() === "" ? null : values.exchangeRate.trim(),
      valueDate: values.valueDate.trim(),
      reference: values.reference.trim() === "" ? null : values.reference.trim(),
      description: values.description.trim() === "" ? null : values.description.trim(),
      descriptionAr: values.descriptionAr.trim() === "" ? null : values.descriptionAr.trim(),
    };
    let payload: CashTransferCreateDraftPayload;
    try {
      payload = cashTransferCreateDraftPayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildCashTransferCreateDraft(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "cash_transfer",
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
          label={d.offlineFieldFromAccount}
          required
          value={values.fromAccountId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, fromAccountId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.fromAccountId}
        />
        <Input
          label={d.offlineFieldToAccount}
          required
          value={values.toAccountId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, toAccountId: value }))}
          hint={d.offlineErrSameAccount}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.toAccountId}
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
          label={`${d.offlineFieldFee} (${d.offlineFieldOptional})`}
          value={values.feeAmount}
          onValueChange={(value) => setValues((prev) => ({ ...prev, feeAmount: value }))}
          hint={d.offlineErrFeeRange}
          mono
          bidiIsolate
          inputMode="decimal"
          error={errors.feeAmount}
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
          label={`${d.offlineFieldReference} (${d.offlineFieldOptional})`}
          value={values.reference}
          onValueChange={(value) => setValues((prev) => ({ ...prev, reference: value }))}
          bidiIsolate
          error={errors.reference}
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
