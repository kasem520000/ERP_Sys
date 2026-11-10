"use client";
/**
 * PHASE-021 T2-b · the partner create form (matrix row 23 — OFFLINE-DRAFT,
 * SD): `partner:create` (DR-P21-08) against the frozen
 * `partnerCreatePayloadSchema`. Contact child rows NEVER ride create —
 * they ride contact_merge (their owning surface). `code` omitted ⇒ the
 * server auto-numbers (BR-025).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { partnerCreatePayloadSchema, type PartnerCreatePayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildPartnerCreate } from "../../../lib/shell/builders";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

type Kind = PartnerCreatePayload["kind"];

interface FormValues {
  kind: Kind | "";
  code: string;
  name: string;
  nameAr: string;
  taxNumber: string;
  creditLimit: string;
  creditTermsId: string;
  priceListId: string;
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return {
      kind: "",
      code: "",
      name: "",
      nameAr: "",
      taxNumber: "",
      creditLimit: "",
      creditTermsId: "",
      priceListId: "",
    };
  }
  const kind = payload.kind;
  return {
    kind: typeof kind === "string" ? (kind as Kind) : "",
    code: str(payload.code ?? ""),
    name: str(payload.name),
    nameAr: str(payload.nameAr ?? ""),
    taxNumber: str(payload.taxNumber ?? ""),
    creditLimit: str(payload.creditLimit ?? ""),
    creditTermsId: uuid(payload.creditTermsId ?? ""),
    priceListId: uuid(payload.priceListId ?? ""),
  };
}

export function PartnerCreateForm({
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
    if (values.kind === "") {
      setErrors({ kind: d.offlineErrKind });
      return;
    }
    const raw = {
      kind: values.kind,
      code: values.code.trim() === "" ? undefined : values.code.trim(),
      name: values.name.trim(),
      nameAr: values.nameAr.trim() === "" ? null : values.nameAr.trim(),
      taxNumber: values.taxNumber.trim() === "" ? null : values.taxNumber.trim(),
      creditLimit: values.creditLimit.trim() === "" ? null : values.creditLimit.trim(),
      creditTermsId: values.creditTermsId.trim() === "" ? null : values.creditTermsId.trim(),
      priceListId: values.priceListId.trim() === "" ? null : values.priceListId.trim(),
    };
    let payload: PartnerCreatePayload;
    try {
      payload = partnerCreatePayloadSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildPartnerCreate(payload);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "partner_create",
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
          label={d.offlineFieldKind}
          required
          value={values.kind}
          onValueChange={(value) => setValues((prev) => ({ ...prev, kind: value as Kind }))}
          options={[
            { value: "", label: "—" },
            { value: "CUSTOMER", label: locale === "ar" ? "عميل" : "Customer" },
            { value: "SUPPLIER", label: locale === "ar" ? "مورّد" : "Supplier" },
            { value: "BOTH", label: locale === "ar" ? "عميل ومورّد" : "Customer & supplier" },
          ]}
          error={errors.kind}
        />
        <Input
          label={`${d.offlineFieldCode} (${d.offlineFieldOptional})`}
          value={values.code}
          onValueChange={(value) => setValues((prev) => ({ ...prev, code: value }))}
          hint={locale === "ar" ? "اتركه فارغًا ليُرقَّم تلقائيًا (BR-025)" : "Leave empty for server auto-numbering (BR-025)"}
          bidiIsolate
          error={errors.code}
        />
        <Input
          label={d.offlineFieldName}
          required
          value={values.name}
          onValueChange={(value) => setValues((prev) => ({ ...prev, name: value }))}
          error={errors.name}
        />
        <Input
          label={`${d.offlineFieldNameAr} (${d.offlineFieldOptional})`}
          value={values.nameAr}
          onValueChange={(value) => setValues((prev) => ({ ...prev, nameAr: value }))}
          error={errors.nameAr}
        />
        <Input
          label={`${d.offlineFieldTaxNumber} (${d.offlineFieldOptional})`}
          value={values.taxNumber}
          onValueChange={(value) => setValues((prev) => ({ ...prev, taxNumber: value }))}
          bidiIsolate
          error={errors.taxNumber}
        />
        <Input
          label={`${d.offlineFieldCreditLimit} (${d.offlineFieldOptional})`}
          value={values.creditLimit}
          onValueChange={(value) => setValues((prev) => ({ ...prev, creditLimit: value }))}
          mono
          bidiIsolate
          inputMode="decimal"
          error={errors.creditLimit}
        />
        <Input
          label={`${d.offlineFieldCreditTermsId} (${d.offlineFieldOptional})`}
          value={values.creditTermsId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, creditTermsId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.creditTermsId}
        />
        <Input
          label={`${d.offlineFieldPriceListId} (${d.offlineFieldOptional})`}
          value={values.priceListId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, priceListId: value }))}
          hint={d.offlineFieldNoCatalog}
          placeholder="21212121-0000-4000-8000-…"
          mono
          bidiIsolate
          error={errors.priceListId}
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
