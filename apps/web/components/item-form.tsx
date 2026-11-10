"use client";

/**
 * P6-T11b — item create/edit form (Create-Edit archetype). Create POSTs
 * `items/items` (sku + kind + uom are create-immutable); edit PATCHes with
 * the row `version` (409 STALE_VERSION → localized conflict toast + server
 * refresh). Bilingual name pair with live locale-preview chip; costing is a
 * WAC-default RadioGroup; tracking checkboxes mirror the server rule —
 * expiry is disabled (and cleared) while batch tracking is off.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";

import { Badge, Button, Checkbox, Input, MoneyInput, NumberInput, RadioGroup, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemCategoryRow, ItemRow, UomRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";

export interface ItemFormProps {
  locale: Locale;
  mode: "create" | "edit";
  uoms: readonly UomRow[];
  categories: readonly ItemCategoryRow[];
  item?: ItemRow;
}

interface FormState {
  sku: string;
  name: string;
  nameAr: string;
  kind: string;
  uomId: string;
  categoryId: string;
  costingMethod: string;
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  reorderLevel: string;
  reorderQty: string;
  basePrice: string;
  status: string;
}

export function ItemForm({
  locale,
  mode,
  uoms,
  categories,
  item,
}: ItemFormProps): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = mode === "edit" && item !== undefined;

  const [form, setForm] = useState<FormState>({
    sku: item?.sku ?? "",
    name: item?.name ?? "",
    nameAr: item?.nameAr ?? "",
    kind: item?.kind ?? "STOCK",
    uomId: item?.uomId ?? "",
    categoryId: item?.categoryId ?? "",
    costingMethod: item?.costingMethod ?? "WAC",
    trackBatch: item?.trackBatch ?? false,
    trackSerial: item?.trackSerial ?? false,
    trackImei: item?.trackImei ?? false,
    hasExpiry: item?.hasExpiry ?? false,
    reorderLevel: item?.reorderLevel ?? "",
    reorderQty: item?.reorderQty ?? "",
    basePrice: item?.basePrice ?? "",
    status: item?.status ?? "ACTIVE",
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

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Expiry rides on batch tracking (TRACKING_FLAGS_INVALID server rule).
  function onBatchChange(checked: boolean): void {
    setForm((prev) => ({
      ...prev,
      trackBatch: checked,
      hasExpiry: checked ? prev.hasExpiry : false,
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (form.sku.trim() === "" || form.name.trim() === "" || form.uomId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    if (!isEdit) {
      const body: Record<string, unknown> = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        kind: form.kind,
        uomId: form.uomId,
        costingMethod: form.costingMethod,
      };
      if (form.nameAr.trim() !== "") body.nameAr = form.nameAr.trim();
      if (form.categoryId !== "") body.categoryId = form.categoryId;
      if (form.trackBatch) body.trackBatch = true;
      if (form.trackSerial) body.trackSerial = true;
      if (form.trackImei) body.trackImei = true;
      if (form.hasExpiry) body.hasExpiry = true;
      if (form.reorderLevel.trim() !== "") body.reorderLevel = form.reorderLevel.trim();
      if (form.reorderQty.trim() !== "") body.reorderQty = form.reorderQty.trim();
      if (form.basePrice.trim() !== "") body.basePrice = form.basePrice.trim();
      const created = await bffFetch<ItemRow>("items/items", {
        method: "POST",
        body,
      });
      setBusy(false);
      if (!created.ok) {
        setError(localizedMasterDataError(d, created.error, created.retryAfterSeconds));
        return;
      }
      toast({ tone: "success", title: d.itemCreatedToast, description: created.data.sku });
      router.push(`/${locale}/inventory/items/${created.data.id}`);
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      trackBatch: form.trackBatch,
      trackSerial: form.trackSerial,
      trackImei: form.trackImei,
      hasExpiry: form.hasExpiry,
      status: form.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      version: item?.version,
    };
    if (form.nameAr.trim() !== "") body.nameAr = form.nameAr.trim();
    else body.nameAr = null;
    if (form.categoryId !== "") body.categoryId = form.categoryId;
    else body.categoryId = null;
    if (form.reorderLevel.trim() !== "") body.reorderLevel = form.reorderLevel.trim();
    else body.reorderLevel = null;
    if (form.reorderQty.trim() !== "") body.reorderQty = form.reorderQty.trim();
    else body.reorderQty = null;
    if (form.basePrice.trim() !== "") body.basePrice = form.basePrice.trim();
    else body.basePrice = null;
    const updated = await bffFetch<ItemRow>(`items/items/${item?.id}`, {
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
    toast({ tone: "success", title: d.itemSavedToast });
    router.refresh();
  }

  const uomOptions = [
    ...uoms.map((uom) => ({
      value: uom.id,
      label: `${localizedName(uom.name, uom.nameAr, locale)} (${uom.code})`,
    })),
  ];
  const categoryOptions = [
    { value: "", label: "—" },
    ...categories.map((category) => ({
      value: category.id,
      label: localizedName(category.name, category.nameAr, locale),
    })),
  ];

  return (
    <Card
      title={isEdit ? d.itemFormTitleEdit : d.itemFormTitleCreate}
      ariaLabel={isEdit ? d.itemFormTitleEdit : d.itemFormTitleCreate}
      className="w-full max-w-2xl"
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="item-sku"
            label={d.itemSkuLabel}
            value={form.sku}
            onValueChange={(value) => setField("sku", value)}
            mono
            bidiIsolate
            required
            disabled={isEdit}
          />
          <Select
            id="item-kind"
            label={d.itemKindLabel}
            value={form.kind}
            onValueChange={(value) => setField("kind", value)}
            options={[
              { value: "STOCK", label: d.kindStock },
              { value: "SERVICE", label: d.kindService },
              { value: "COMPOSITE", label: d.kindComposite },
            ]}
            required
            disabled={isEdit}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Input
              id="item-name"
              label={d.itemNameLabel}
              value={form.name}
              onValueChange={(value) => setField("name", value)}
              required
            />
            <Input
              id="item-name-ar"
              label={d.itemNameArLabel}
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
            <Select
              id="item-uom"
              label={d.itemUomLabel}
              value={form.uomId}
              onValueChange={(value) => setField("uomId", value)}
              options={uomOptions}
              required
              disabled={isEdit}
            />
            <Select
              id="item-category"
              label={d.categoryLabel}
              value={form.categoryId}
              onValueChange={(value) => setField("categoryId", value)}
              options={categoryOptions}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RadioGroup
            label={d.itemCostingLabel}
            value={form.costingMethod}
            onValueChange={(value) => setField("costingMethod", value)}
            options={[
              { value: "WAC", label: d.costingWac },
              { value: "FIFO", label: d.costingFifo },
            ]}
            disabled={isEdit}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-gray-700">{d.itemTrackingLabel}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Checkbox
                label={d.itemTrackBatch}
                checked={form.trackBatch}
                onCheckedChange={(checked) => onBatchChange(checked === true)}
              />
              <Checkbox
                label={d.itemTrackSerial}
                checked={form.trackSerial}
                onCheckedChange={(checked) => setField("trackSerial", checked === true)}
              />
              <Checkbox
                label={d.itemTrackImei}
                checked={form.trackImei}
                onCheckedChange={(checked) => setField("trackImei", checked === true)}
              />
              <Checkbox
                label={d.itemHasExpiry}
                checked={form.hasExpiry}
                onCheckedChange={(checked) => setField("hasExpiry", checked === true)}
                disabled={!form.trackBatch}
              />
            </div>
          </fieldset>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput
            id="item-reorder-level"
            label={d.itemReorderLevelLabel}
            value={form.reorderLevel}
            onValueChange={(value) => setField("reorderLevel", value)}
            min={0}
          />
          <NumberInput
            id="item-reorder-qty"
            label={d.itemReorderQtyLabel}
            value={form.reorderQty}
            onValueChange={(value) => setField("reorderQty", value)}
            min={0}
          />
        </div>
        <MoneyInput
          id="item-base-price"
          label={d.itemBasePriceLabel}
          amount={form.basePrice}
          onAmountChange={(amount) => setField("basePrice", amount)}
          currency="SAR"
        />
        {isEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="item-status"
              label={d.colStatus}
              value={form.status}
              onValueChange={(value) => setField("status", value)}
              options={[
                { value: "ACTIVE", label: d.statusActive },
                { value: "INACTIVE", label: d.statusInactive },
              ]}
              disabled={item?.status === "ARCHIVED"}
            />
            <div className="flex flex-col gap-2">
              {item !== undefined && (
                <DefList
                  items={[
                    {
                      term: d.itemSkuLabel,
                      children: (
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{item.sku}</span>
                          <Badge tone={item.status === "ARCHIVED" ? "neutral" : "primary"}>
                            {item.status === "ARCHIVED" ? d.statusArchived : d.statusActive}
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
                router.push(`/${locale}/inventory/items`);
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
