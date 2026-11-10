"use client";
/**
 * PHASE-021 T2-b · the partner contact edit form (matrix row 21 — the ONLY
 * FIELD_LEVEL_MERGE row): `partner:contact_merge` via sync-core's 020
 * builder, validated against the frozen `partnerContactMergeSchema`. Only
 * the whitelisted NON-CONSTRAINED contact fields ride the payload — empty
 * fields are NOT sent (an empty string would overwrite server-side data);
 * at least one field is required (the form-level cross-check).
 * The draft rides PENDING_MERGE (matrix row 21's state machine).
 */
import { useState } from "react";
import type { JSX } from "react";
import { ZodError } from "zod";

import { Button, Input, Select } from "@erp/ui";
import { generateUuidV7 } from "@erp/domain-core";
import { partnerContactMergeSchema, type PartnerContactMergePayload } from "@erp/contracts";

import { getDictionary, type Locale } from "../../../i18n/dictionaries";
import type { DesktopBridge } from "../../../lib/shell/bridge";
import { buildPartnerContactMerge } from "../../../lib/shell/builders";
import type { PartnerContactMergeFields } from "@erp/sync-core";
import { enqueueDraftCommand } from "../../../lib/shell/store-client";
import { enqueueErrorMessage, FORM_GRID_CLASS, mapZodIssues } from "./form-kit";
import { editingPayload, str, uuid, type ConsoleOptions, type EditingDraft } from "./options";

interface FormValues {
  partnerId: string;
  phone: string;
  phone2: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  contactPerson: string;
}

function initialValues(editing: EditingDraft | null): FormValues {
  const payload = editingPayload(editing);
  if (payload === null) {
    return {
      partnerId: "",
      phone: "",
      phone2: "",
      email: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      contactPerson: "",
    };
  }
  return {
    partnerId: uuid(payload.partnerId),
    phone: str(payload.phone ?? ""),
    phone2: str(payload.phone2 ?? ""),
    email: str(payload.email ?? ""),
    addressLine1: str(payload.addressLine1 ?? ""),
    addressLine2: str(payload.addressLine2 ?? ""),
    city: str(payload.city ?? ""),
    contactPerson: str(payload.contactPerson ?? ""),
  };
}

const CONTACT_KEYS: readonly (keyof Omit<FormValues, "partnerId">)[] = [
  "phone",
  "phone2",
  "email",
  "addressLine1",
  "addressLine2",
  "city",
  "contactPerson",
];

export function PartnerContactForm({
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
    // Only non-empty fields ride the payload — empty means "not edited",
    // never "overwrite with empty" (FIELD_LEVEL_MERGE semantics).
    const fields: PartnerContactMergeFields = {};
    if (values.phone.trim() !== "") fields.phone = values.phone.trim();
    if (values.phone2.trim() !== "") fields.phone2 = values.phone2.trim();
    if (values.email.trim() !== "") fields.email = values.email.trim();
    if (values.addressLine1.trim() !== "") fields.addressLine1 = values.addressLine1.trim();
    if (values.addressLine2.trim() !== "") fields.addressLine2 = values.addressLine2.trim();
    if (values.city.trim() !== "") fields.city = values.city.trim();
    if (values.contactPerson.trim() !== "") fields.contactPerson = values.contactPerson.trim();
    if (Object.keys(fields).length === 0) {
      setErrors({ _form: d.offlineErrContactOneField });
      return;
    }
    const raw = { partnerId: values.partnerId, ...fields };
    let payload: PartnerContactMergePayload;
    try {
      payload = partnerContactMergeSchema.parse(raw);
    } catch (error) {
      if (error instanceof ZodError) {
        setErrors(mapZodIssues(error.issues, d));
        return;
      }
      throw error;
    }
    const command = buildPartnerContactMerge(values.partnerId, fields);
    setBusy(true);
    try {
      await enqueueDraftCommand(bridge, command, {
        localId: editing?.draft.localId ?? generateUuidV7(),
        docType: "partner_contact_merge",
        entityId: values.partnerId,
        payload,
        initialStatus: "PENDING_MERGE",
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
      <p className="text-sm text-gray-600">{d.offlineNoteMerge}</p>
      <div className={FORM_GRID_CLASS}>
        <Select
          label={d.offlineFieldPartnerId}
          required
          value={values.partnerId}
          onValueChange={(value) => setValues((prev) => ({ ...prev, partnerId: value }))}
          options={[
            { value: "", label: "—" },
            ...options.partners.map((partner) => ({
              value: partner.id,
              label: `${partner.code} · ${locale === "ar" ? partner.nameAr ?? partner.name : partner.name}`,
            })),
          ]}
          error={errors.partnerId}
        />
        <Input
          label={`${d.offlineFieldPhone} (${d.offlineFieldOptional})`}
          value={values.phone}
          onValueChange={(value) => setValues((prev) => ({ ...prev, phone: value }))}
          bidiIsolate
          error={errors.phone}
        />
        <Input
          label={`${d.offlineFieldPhone2} (${d.offlineFieldOptional})`}
          value={values.phone2}
          onValueChange={(value) => setValues((prev) => ({ ...prev, phone2: value }))}
          bidiIsolate
          error={errors.phone2}
        />
        <Input
          label={`${d.offlineFieldEmail} (${d.offlineFieldOptional})`}
          value={values.email}
          onValueChange={(value) => setValues((prev) => ({ ...prev, email: value }))}
          bidiIsolate
          error={errors.email}
        />
        <Input
          label={`${d.offlineFieldAddress1} (${d.offlineFieldOptional})`}
          value={values.addressLine1}
          onValueChange={(value) => setValues((prev) => ({ ...prev, addressLine1: value }))}
          error={errors.addressLine1}
        />
        <Input
          label={`${d.offlineFieldAddress2} (${d.offlineFieldOptional})`}
          value={values.addressLine2}
          onValueChange={(value) => setValues((prev) => ({ ...prev, addressLine2: value }))}
          error={errors.addressLine2}
        />
        <Input
          label={`${d.offlineFieldCity} (${d.offlineFieldOptional})`}
          value={values.city}
          onValueChange={(value) => setValues((prev) => ({ ...prev, city: value }))}
          error={errors.city}
        />
        <Input
          label={`${d.offlineFieldContactPerson} (${d.offlineFieldOptional})`}
          value={values.contactPerson}
          onValueChange={(value) => setValues((prev) => ({ ...prev, contactPerson: value }))}
          error={errors.contactPerson}
        />
      </div>
      {CONTACT_KEYS.length === 0 && <p>{d.offlineErrContactOneField}</p>}
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
