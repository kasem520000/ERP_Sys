"use client";

/**
 * P6-T11a — partner create/edit form (Create-Edit archetype). Create POSTs
 * `partners/partners` (auto-code P-000001 when the code is empty); edit PATCHes
 * with the row `version` — 409 STALE_VERSION maps to the localized conflict
 * toast + a server refresh. Bilingual name pair carries a live locale-preview
 * chip; creditLimit is a MoneyInput (SAR, canonical decimal strings only);
 * credit-terms/price-list selects come from the server-fetched reference
 * lists. Kind changes on existing partners go through POST /kind (BR-025).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";

import { Badge, Button, Input, MoneyInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { CreditTermsRow, PartnerRow, PriceListRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";

export interface PartnerFormProps {
  locale: Locale;
  mode: "create" | "edit";
  creditTerms: readonly CreditTermsRow[];
  priceLists: readonly PriceListRow[];
  partner?: PartnerRow;
}

interface FormState {
  kind: string;
  code: string;
  name: string;
  nameAr: string;
  taxNumber: string;
  creditLimit: string;
  creditTermsId: string;
  priceListId: string;
  status: string;
}

export function PartnerForm({
  locale,
  mode,
  creditTerms,
  priceLists,
  partner,
}: PartnerFormProps): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = mode === "edit" && partner !== undefined;

  const [form, setForm] = useState<FormState>({
    kind: partner?.kind ?? "CUSTOMER",
    code: partner?.code ?? "",
    name: partner?.name ?? "",
    nameAr: partner?.nameAr ?? "",
    taxNumber: partner?.taxNumber ?? "",
    creditLimit: partner?.creditLimit ?? "",
    creditTermsId: partner?.creditTermsId ?? "",
    priceListId: partner?.priceListId ?? "",
    status: partner?.status ?? "ACTIVE",
  });
  const [initial] = useState<FormState>(form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindChangeBusy, setKindChangeBusy] = useState(false);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  // dirty-guard: native unload warning (full navigations/refreshes)
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (form.name.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    if (!isEdit) {
      const body: Record<string, unknown> = { kind: form.kind, name: form.name.trim() };
      if (form.code.trim() !== "") body.code = form.code.trim();
      if (form.nameAr.trim() !== "") body.nameAr = form.nameAr.trim();
      if (form.taxNumber.trim() !== "") body.taxNumber = form.taxNumber.trim();
      if (form.creditLimit.trim() !== "") body.creditLimit = form.creditLimit.trim();
      if (form.creditTermsId !== "") body.creditTermsId = form.creditTermsId;
      if (form.priceListId !== "") body.priceListId = form.priceListId;
      const created = await bffFetch<PartnerRow>("partners/partners", {
        method: "POST",
        body,
      });
      setBusy(false);
      if (!created.ok) {
        setError(localizedMasterDataError(d, created.error, created.retryAfterSeconds));
        return;
      }
      toast({ tone: "success", title: d.partnerCreatedToast, description: created.data.code });
      router.push(`/${locale}/partners/${created.data.id}`);
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      status: form.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      version: partner?.version,
    };
    if (form.nameAr.trim() !== "") body.nameAr = form.nameAr.trim();
    else body.nameAr = null;
    if (form.taxNumber.trim() !== "") body.taxNumber = form.taxNumber.trim();
    else body.taxNumber = null;
    if (form.creditLimit.trim() !== "") body.creditLimit = form.creditLimit.trim();
    else body.creditLimit = null;
    if (form.creditTermsId !== "") body.creditTermsId = form.creditTermsId;
    else body.creditTermsId = null;
    if (form.priceListId !== "") body.priceListId = form.priceListId;
    else body.priceListId = null;
    const updated = await bffFetch<PartnerRow>(`partners/partners/${partner?.id}`, {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (!updated.ok) {
      if (updated.status === 409 && updated.error.code === "STALE_VERSION") {
        toast({ tone: "danger", title: d.commonVersionConflict });
        router.refresh();
        return;
      }
      setError(localizedMasterDataError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.partnerSavedToast });
    router.refresh();
  }

  async function onChangeKind(): Promise<void> {
    if (partner === undefined || form.kind === partner.kind) return;
    setKindChangeBusy(true);
    const changed = await bffFetch<PartnerRow>(`partners/partners/${partner.id}/kind`, {
      method: "POST",
      body: { kind: form.kind },
    });
    setKindChangeBusy(false);
    if (!changed.ok) {
      setError(localizedMasterDataError(d, changed.error, changed.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.partnerKindChangedToast });
    router.refresh();
  }

  const creditTermsOptions = [
    { value: "", label: "—" },
    ...creditTerms.map((terms) => ({
      value: terms.id,
      label: `${localizedName(terms.name, terms.nameAr, locale)} (${terms.code} · ${terms.days})`,
    })),
  ];
  const priceListOptions = [
    { value: "", label: "—" },
    ...priceLists.map((list) => ({
      value: list.id,
      label: localizedName(list.name, list.nameAr, locale),
    })),
  ];

  return (
    <Card
      title={isEdit ? d.partnerTabOverview : d.partnerFormTitleCreate}
      ariaLabel={isEdit ? d.partnerTabOverview : d.partnerFormTitleCreate}
      className="w-full max-w-2xl"
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="partner-kind"
            label={d.partnersKindLabel}
            value={form.kind}
            onValueChange={(value) => setField("kind", value)}
            options={[
              { value: "CUSTOMER", label: d.kindCustomer },
              { value: "SUPPLIER", label: d.kindSupplier },
              { value: "BOTH", label: d.kindBoth },
            ]}
            required
            disabled={isEdit}
          />
          <Input
            id="partner-code"
            label={d.partnerCodeLabel}
            hint={isEdit ? undefined : d.partnerCodeHint}
            value={form.code}
            onValueChange={(value) => setField("code", value)}
            mono
            bidiIsolate
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Input
              id="partner-name"
              label={d.partnerNameLabel}
              value={form.name}
              onValueChange={(value) => setField("name", value)}
              required
            />
            <Input
              id="partner-name-ar"
              label={d.partnerNameArLabel}
              value={form.nameAr}
              onValueChange={(value) => setField("nameAr", value)}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span>{d.namePreviewLabel}:</span>
              <span lang="ar" dir="rtl" className="rounded-sm border border-subtle bg-surface-sunken px-1.5 py-0.5">
                {form.nameAr.trim() !== "" ? form.nameAr : form.name || "—"}
              </span>
              <span lang="en" dir="ltr" className="rounded-sm border border-subtle bg-surface-sunken px-1.5 py-0.5">
                {form.name.trim() !== "" ? form.name : "—"}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <Input
              id="partner-tax-number"
              label={d.partnerTaxNumberLabel}
              value={form.taxNumber}
              onValueChange={(value) => setField("taxNumber", value)}
              mono
              bidiIsolate
            />
            <MoneyInput
              id="partner-credit-limit"
              label={d.partnersColCreditLimit}
              amount={form.creditLimit}
              onAmountChange={(amount) => setField("creditLimit", amount)}
              currency="SAR"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="partner-credit-terms"
            label={d.partnerCreditTermsLabel}
            value={form.creditTermsId}
            onValueChange={(value) => setField("creditTermsId", value)}
            options={creditTermsOptions}
          />
          <Select
            id="partner-price-list"
            label={d.partnerPriceListLabel}
            value={form.priceListId}
            onValueChange={(value) => setField("priceListId", value)}
            options={priceListOptions}
          />
        </div>
        {isEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="partner-status"
              label={d.partnerStatusLabel}
              value={form.status}
              onValueChange={(value) => setField("status", value)}
              options={[
                { value: "ACTIVE", label: d.statusActive },
                { value: "INACTIVE", label: d.statusInactive },
              ]}
              disabled={partner?.status === "ARCHIVED"}
            />
            <div className="flex flex-col gap-2">
              {partner !== undefined && (
                <DefList
                  items={[
                    {
                      term: d.partnerCodeLabel,
                      children: (
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{partner.code}</span>
                          <Badge tone={partner.status === "ARCHIVED" ? "neutral" : "primary"}>
                            {partner.status === "ARCHIVED" ? d.statusArchived : d.statusActive}
                          </Badge>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          </div>
        )}
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
          <Button
            variant="secondary"
            onClick={() => {
              if (!dirty || window.confirm(d.commonUnsavedChanges)) {
                router.push(`/${locale}/partners`);
              }
            }}
          >
            {d.commonCancel}
          </Button>
          {isEdit && partner !== undefined && form.kind !== partner.kind && (
            <Button variant="secondary" loading={kindChangeBusy} onClick={() => void onChangeKind()}>
              {d.partnerKindChangeLabel}
            </Button>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {isEdit ? d.commonSave : d.commonCreate}
          </Button>
        </div>
      </form>
    </Card>
  );
}
