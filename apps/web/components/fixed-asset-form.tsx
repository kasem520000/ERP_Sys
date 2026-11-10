"use client";

/**
 * PHASE-026 (T13-UI) — asset create/edit form (PAGE_ARCHETYPES §3, the
 * partner-form pattern): create POSTs `fixed-assets/assets` (auto-code when
 * empty); edit PATCHes the mutable set (name/nameAr/branch/custodian/notes)
 * with the row `version` — 409 STALE_VERSION maps to the localized conflict
 * toast + a server refresh. The basis fields (cost/salvage/life/method/
 * category/acquisition/opening-accumulated) are read-only in edit mode
 * (faFormImmutableHint) — corrections are reversal-only. Category selection
 * defaults life/method (UoP reveals the estimated-unions field); the
 * category-usable check is the server's alone (BR-041 — the hint says so).
 * All money inputs are canonical decimal strings (MoneyInput, ADR-0009).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Button, Input, MoneyInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  FixedAssetCategoryRow,
  FixedAssetListRow,
  TenantUserRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { compareExact, isPositiveDecimal, isZeroExact } from "../lib/exact-money";
import { localizedName, localizedDepreciationMethod, localizedFixedAssetsError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";

export interface FixedAssetFormProps {
  locale: Locale;
  mode: "create" | "edit";
  categories: readonly FixedAssetCategoryRow[];
  branches: readonly BranchRow[];
  users: readonly TenantUserRow[];
  baseCurrency: string;
  today: string;
  asset?: FixedAssetListRow;
}

interface FormState {
  code: string;
  categoryId: string;
  name: string;
  nameAr: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  openingAccumulated: string;
  usefulLifeMonths: string;
  depreciationMethod: string;
  totalEstimatedUnits: string;
  branchId: string;
  custodianUserId: string;
  note: string;
  noteAr: string;
}

export function FixedAssetForm({
  locale,
  mode,
  categories,
  branches,
  users,
  baseCurrency,
  today,
  asset,
}: FixedAssetFormProps): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = mode === "edit" && asset !== undefined;
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [form, setForm] = useState<FormState>({
    code: asset?.code ?? "",
    categoryId: asset?.categoryId ?? "",
    name: asset?.name ?? "",
    nameAr: asset?.nameAr ?? "",
    acquisitionDate: asset?.acquisitionDate ?? today,
    cost: asset?.cost ?? "",
    salvageValue: asset?.salvageValue ?? "",
    openingAccumulated: asset?.openingAccumulated ?? "",
    usefulLifeMonths: asset === undefined ? "" : String(asset.usefulLifeMonths),
    depreciationMethod: asset?.depreciationMethod ?? "STRAIGHT_LINE",
    totalEstimatedUnits: asset?.totalEstimatedUnits ?? "",
    branchId: asset?.branchId ?? branches.find((branch) => branch.isActive)?.id ?? "",
    custodianUserId: asset?.custodianUserId ?? "",
    note: asset?.note ?? "",
    noteAr: asset?.noteAr ?? "",
  });
  const [initial] = useState<FormState>(form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const methodOptions = [
    { value: "STRAIGHT_LINE", label: localizedDepreciationMethod(d, "STRAIGHT_LINE") },
    { value: "DECLINING_BALANCE", label: localizedDepreciationMethod(d, "DECLINING_BALANCE") },
    { value: "UNITS_OF_PRODUCTION", label: localizedDepreciationMethod(d, "UNITS_OF_PRODUCTION") },
  ];

  // The category select lists ACTIVE categories (plus the asset's own on
  // edit — an inactive current category stays visible, read-only anyway).
  const categoryOptions = useMemo(() => {
    const list = categories.filter(
      (category) => category.active || (isEdit && asset !== undefined && category.id === asset.categoryId),
    );
    return list.map((category) => ({
      value: category.id,
      label: `${category.code} · ${localizedName(category.name, category.nameAr, locale)}`,
    }));
  }, [categories, isEdit, asset, locale]);

  const isUop = form.depreciationMethod === "UNITS_OF_PRODUCTION";

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Category pick defaults life + method (create mode only — the register §D). */
  function onCategoryPick(nextId: string): void {
    const category = categories.find((row) => row.id === nextId);
    if (category === undefined) {
      setField("categoryId", nextId);
      return;
    }
    setForm((prev) => ({
      ...prev,
      categoryId: nextId,
      usefulLifeMonths: isEdit ? prev.usefulLifeMonths : String(category.usefulLifeMonthsDefault),
      depreciationMethod: isEdit ? prev.depreciationMethod : category.depreciationMethodDefault,
    }));
  }

  const createValidations = (): string | null => {
    if (form.categoryId === "") return d.errorsValidation;
    if (form.name.trim() === "") return d.errorsValidation;
    if (form.branchId === "") return d.errorsValidation;
    if (!isPositiveDecimal(form.cost)) return d.faErrInvalidAmount;
    if (form.salvageValue !== "" && !isPositiveDecimal(form.salvageValue)) return d.faErrInvalidAmount;
    if (form.salvageValue !== "" && compareExact(form.salvageValue, form.cost) > 0) {
      return d.faErrInvalidAmount;
    }
    if (
      form.openingAccumulated !== "" &&
      (!isPositiveDecimal(form.openingAccumulated) ||
        compareExact(form.openingAccumulated, form.cost) > 0)
    ) {
      return d.faErrInvalidAmount;
    }
    if (!/^\d+$/.test(form.usefulLifeMonths) || Number(form.usefulLifeMonths) < 1) {
      return d.faErrInvalidAmount;
    }
    if (isUop && !isPositiveDecimal(form.totalEstimatedUnits)) return d.faErrUopUnitsRequired;
    return null;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!isEdit) {
      const invalid = createValidations();
      if (invalid !== null) {
        setError(invalid);
        return;
      }
      setBusy(true);
      const body: Record<string, unknown> = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        nameAr: form.nameAr.trim() === "" ? form.name.trim() : form.nameAr.trim(),
        acquisitionDate: form.acquisitionDate,
        cost: form.cost,
        salvageValue: isZeroExact(form.salvageValue) ? "0" : form.salvageValue,
        openingAccumulated: isZeroExact(form.openingAccumulated) ? "0" : form.openingAccumulated,
        usefulLifeMonths: Number(form.usefulLifeMonths),
        depreciationMethod: form.depreciationMethod,
        branchId: form.branchId,
      };
      if (form.code.trim() !== "") body.code = form.code.trim();
      if (isUop) body.totalEstimatedUnits = form.totalEstimatedUnits;
      if (form.custodianUserId !== "") body.custodianUserId = form.custodianUserId;
      if (form.note.trim() !== "") body.note = form.note.trim();
      if (form.noteAr.trim() !== "") body.noteAr = form.noteAr.trim();
      const created = await bffFetch<FixedAssetListRow>("fixed-assets/assets", {
        method: "POST",
        body,
      });
      setBusy(false);
      if (!created.ok) {
        setError(localizedFixedAssetsError(d, created.error, created.retryAfterSeconds));
        return;
      }
      toast({ tone: "success", title: d.faFormCreatedToast, description: created.data.code });
      router.push(`/${locale}/fixed-assets/${created.data.id}`);
      return;
    }
    if (asset === undefined) {
      return;
    }
    if (form.name.trim() === "" || form.branchId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const updated = await bffFetch<FixedAssetListRow>(`fixed-assets/assets/${asset.id}`, {
      method: "PATCH",
      body: {
        name: form.name.trim(),
        nameAr: form.nameAr.trim() === "" ? null : form.nameAr.trim(),
        branchId: form.branchId,
        custodianUserId: form.custodianUserId === "" ? null : form.custodianUserId,
        note: form.note.trim() === "" ? null : form.note.trim(),
        noteAr: form.noteAr.trim() === "" ? null : form.noteAr.trim(),
        version: asset.version,
      },
    });
    setBusy(false);
    if (!updated.ok) {
      if (updated.status === 409 && updated.error.code === "STALE_VERSION") {
        toast({ tone: "danger", title: d.commonVersionConflict });
        router.refresh();
        return;
      }
      setError(localizedFixedAssetsError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.faFormSavedToast });
    router.push(`/${locale}/fixed-assets/${asset.id}`);
  }

  return (
    <Card
      title={isEdit ? d.faFormTitleEdit : d.faFormTitleCreate}
      ariaLabel={isEdit ? d.faFormTitleEdit : d.faFormTitleCreate}
      className="w-full max-w-3xl"
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="fa-form-category"
            label={d.faFormCategory}
            hint={isEdit ? undefined : d.faFormCategoryHint}
            value={form.categoryId}
            onValueChange={onCategoryPick}
            options={categoryOptions}
            disabled={isEdit}
            required
          />
          <Input
            id="fa-form-code"
            label={d.faFormCode}
            hint={isEdit ? undefined : d.faFormCodeHint}
            value={form.code}
            onValueChange={(value) => setField("code", value)}
            mono
            bidiIsolate
            readOnly={isEdit}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Input
              id="fa-form-name"
              label={d.faFormName}
              value={form.name}
              onValueChange={(value) => setField("name", value)}
              required
            />
            <Input
              id="fa-form-name-ar"
              label={d.faFormNameAr}
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
          <div className="flex flex-col gap-1">
            <Input
              id="fa-form-acquisition"
              label={d.faFormAcquisitionDate}
              value={form.acquisitionDate}
              onValueChange={(value) => setField("acquisitionDate", value)}
              mono
              bidiIsolate
              required
              readOnly={isEdit}
            />
            <Input
              id="fa-form-life"
              label={d.faFormLife}
              value={form.usefulLifeMonths}
              onValueChange={(value) => setField("usefulLifeMonths", value)}
              mono
              bidiIsolate
              required
              readOnly={isEdit}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <MoneyInput
              id="fa-form-cost"
              label={d.faFormCost}
              amount={form.cost}
              onAmountChange={(amount) => setField("cost", amount)}
              currency={currency}
              required
              readOnly={isEdit}
            />
            <MoneyInput
              id="fa-form-salvage"
              label={d.faFormSalvage}
              hint={d.faFormSalvageHint}
              amount={form.salvageValue}
              onAmountChange={(amount) => setField("salvageValue", amount)}
              currency={currency}
              readOnly={isEdit}
            />
            <MoneyInput
              id="fa-form-opening"
              label={d.faFormOpeningAccumulated}
              hint={isEdit ? undefined : d.faFormOpeningHint}
              amount={form.openingAccumulated}
              onAmountChange={(amount) => setField("openingAccumulated", amount)}
              currency={currency}
              readOnly={isEdit}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Select
              id="fa-form-method"
              label={d.faFormMethod}
              value={form.depreciationMethod}
              onValueChange={(value) => setField("depreciationMethod", value)}
              options={methodOptions}
              disabled={isEdit}
              required
            />
            {isUop ? (
              <Input
                id="fa-form-units"
                label={d.faFormUnitsTotal}
                hint={isEdit ? undefined : d.faFormUnitsHint}
                value={form.totalEstimatedUnits}
                onValueChange={(value) => setField("totalEstimatedUnits", value)}
                mono
                bidiIsolate
                required
                readOnly={isEdit}
              />
            ) : null}
            <Select
              id="fa-form-branch"
              label={d.faFormBranch}
              value={form.branchId}
              onValueChange={(value) => setField("branchId", value)}
              options={branches
                .filter((branch) => branch.isActive || branch.id === form.branchId)
                .map((branch) => ({
                  value: branch.id,
                  label: localizedName(branch.name, branch.nameAr, locale),
                }))}
              required
            />
            <Select
              id="fa-form-custodian"
              label={d.faFormCustodian}
              value={form.custodianUserId}
              onValueChange={(value) => setField("custodianUserId", value)}
              options={[
                { value: "", label: "—" },
                ...users.map((user) => ({ value: user.userId, label: user.fullName })),
              ]}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="fa-form-note"
            label={d.faFormNote}
            value={form.note}
            onValueChange={(value) => setField("note", value)}
          />
          <Input
            id="fa-form-note-ar"
            label={d.faFormNoteAr}
            value={form.noteAr}
            onValueChange={(value) => setField("noteAr", value)}
          />
        </div>
        {isEdit && <InfoNotice>{d.faFormImmutableHint}</InfoNotice>}
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
          <Button
            variant="secondary"
            onClick={() => {
              if (!dirty || window.confirm(d.commonUnsavedChanges)) {
                router.push(`/${locale}/fixed-assets`);
              }
            }}
          >
            {d.commonCancel}
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {isEdit ? d.commonSave : d.commonCreate}
          </Button>
        </div>
      </form>
    </Card>
  );
}
