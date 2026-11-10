"use client";

/**
 * PHASE-026 (T13-UI) — asset categories manager (PAGE_ARCHETYPES §8, the
 * settings archetype — the tax-codes combined pattern): the categories list
 * (code, bilingual name, default life, default method, purpose-key triple,
 * in-use badge, active state) plus the create form and the edit form. The
 * three purpose keys ride an "advanced" section with the register §E
 * defaults shown (BR-041: the server re-checks purpose completeness before
 * any use — the UI never decides usability). The in-use indicator is
 * computed from the register snapshot (never a fabricated count).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Badge, Button, Checkbox, DataTable, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { FixedAssetCategoryRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedDepreciationMethod,
  localizedFixedAssetsError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DEFAULT_PURPOSES = {
  asset: "FIXED_ASSET",
  accum: "ACCUM_DEPRECIATION",
  expense: "DEPRECIATION_EXPENSE",
} as const;

interface CategoryDraft {
  code: string;
  name: string;
  nameAr: string;
  life: string;
  method: string;
  purposeAsset: string;
  purposeAccum: string;
  purposeExpense: string;
}

const EMPTY_DRAFT: CategoryDraft = {
  code: "",
  name: "",
  nameAr: "",
  life: "60",
  method: "STRAIGHT_LINE",
  purposeAsset: DEFAULT_PURPOSES.asset,
  purposeAccum: DEFAULT_PURPOSES.accum,
  purposeExpense: DEFAULT_PURPOSES.expense,
};

export function FixedAssetCategories({
  locale,
  initialCategories,
  usedCategoryIds,
}: {
  locale: Locale;
  initialCategories: readonly FixedAssetCategoryRow[];
  /** Category ids referenced by register rows (the in-use indicator source). */
  usedCategoryIds: readonly string[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<readonly FixedAssetCategoryRow[]>(initialCategories);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState<CategoryDraft>(EMPTY_DRAFT);
  const [advanced, setAdvanced] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const editing = useMemo(() => rows.find((row) => row.id === editId) ?? null, [rows, editId]);
  const usedSet = useMemo(() => new Set(usedCategoryIds), [usedCategoryIds]);

  const methodOptions = [
    { value: "STRAIGHT_LINE", label: d.faMethodSl },
    { value: "DECLINING_BALANCE", label: d.faMethodDb },
    { value: "UNITS_OF_PRODUCTION", label: d.faMethodUop },
  ];

  const createReady =
    draft.code.trim() !== "" &&
    draft.name.trim() !== "" &&
    /^\d+$/.test(draft.life) &&
    Number(draft.life) >= 1 &&
    Number(draft.life) <= 1200;

  function setDraftField<K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function patchEditing(patch: Partial<FixedAssetCategoryRow>): void {
    setRows((current) =>
      current.map((row) => (row.id === editId ? { ...row, ...patch } : row)),
    );
  }

  async function createCategory(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    const body: Record<string, unknown> = {
      code: draft.code.trim(),
      name: draft.name.trim(),
      nameAr: draft.nameAr.trim() === "" ? draft.name.trim() : draft.nameAr.trim(),
      usefulLifeMonthsDefault: Number(draft.life),
      depreciationMethodDefault: draft.method,
    };
    if (advanced) {
      body.assetPurposeKey = draft.purposeAsset.trim().toUpperCase();
      body.accumDepreciationPurposeKey = draft.purposeAccum.trim().toUpperCase();
      body.expensePurposeKey = draft.purposeExpense.trim().toUpperCase();
    }
    const created = await bffFetch<FixedAssetCategoryRow>("fixed-assets/categories", {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedFixedAssetsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [...current, created.data]);
    setDraft(EMPTY_DRAFT);
    setNotice(d.faCatCreatedToast);
    router.refresh();
  }

  async function saveEdit(): Promise<void> {
    if (editing === null) {
      return;
    }
    setError(null);
    setNotice(null);
    if (editing.name.trim() === "" || editing.usefulLifeMonthsDefault < 1) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(editing.id);
    const updated = await bffFetch<FixedAssetCategoryRow>(`fixed-assets/categories/${editing.id}`, {
      method: "PATCH",
      body: {
        name: editing.name.trim(),
        nameAr: editing.nameAr.trim() === "" ? null : editing.nameAr.trim(),
        usefulLifeMonthsDefault: editing.usefulLifeMonthsDefault,
        depreciationMethodDefault: editing.depreciationMethodDefault,
        active: editing.active,
        assetPurposeKey: editing.assetPurposeKey.trim().toUpperCase(),
        accumDepreciationPurposeKey: editing.accumDepreciationPurposeKey.trim().toUpperCase(),
        expensePurposeKey: editing.expensePurposeKey.trim().toUpperCase(),
        version: editing.version,
      },
    });
    setBusy(null);
    if (!updated.ok) {
      if (updated.status === 409 && updated.error.code === "STALE_VERSION") {
        toast({ tone: "danger", title: d.commonVersionConflict });
        router.refresh();
        return;
      }
      setError(localizedFixedAssetsError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === updated.data.id ? updated.data : row)));
    setEditId(null);
    setNotice(d.faCatSavedToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.faCategoriesTitle}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.faColCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.colName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
              render: (row) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{localizedName(row.name, row.nameAr, locale)}</span>
                  {usedSet.has(row.id) && (
                    <span className="mt-1">
                      <Badge tone="neutral">{d.faCatInUseBadge}</Badge>
                    </span>
                  )}
                </span>
              ),
            },
            {
              id: "life",
              header: activeLocaleHeader(d.faCatColLife),
              accessor: (row) => String(row.usefulLifeMonthsDefault),
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.usefulLifeMonthsDefault}
                </span>
              ),
            },
            {
              id: "method",
              header: activeLocaleHeader(d.faCatColMethod),
              accessor: (row) => localizedDepreciationMethod(d, row.depreciationMethodDefault),
            },
            {
              id: "purposes",
              header: activeLocaleHeader(d.faCatPurposesTitle),
              accessor: (row) => row.assetPurposeKey,
              render: (row) => (
                <span className="font-mono text-xs text-gray-600" dir="ltr">
                  {row.assetPurposeKey} · {row.accumDepreciationPurposeKey} · {row.expensePurposeKey}
                </span>
              ),
            },
            {
              id: "active",
              header: activeLocaleHeader(d.faCatColActive),
              accessor: (row) => (row.active ? "1" : "0"),
              render: (row) =>
                row.active ? <Badge tone="primary">{d.faCatActive}</Badge> : <span className="text-gray-500">—</span>,
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "edit",
              label: d.commonEdit,
              onSelect: (row: FixedAssetCategoryRow) => setEditId(row.id === editId ? null : row.id),
            },
          ]}
          empty={{ title: d.faCategoriesEmpty }}
        />
      </Card>

      {editing !== null && (
        <Card title={d.faCatEditTitle}>
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void saveEdit();
            }}
            noValidate
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Input
                  id="fa-cat-edit-name"
                  label={d.faCatName}
                  value={editing.name}
                  onValueChange={(value) => patchEditing({ name: value })}
                  required
                />
                <Input
                  id="fa-cat-edit-name-ar"
                  label={d.faCatNameAr}
                  value={editing.nameAr}
                  onValueChange={(value) => patchEditing({ nameAr: value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Input
                  id="fa-cat-edit-life"
                  label={d.faCatLife}
                  value={String(editing.usefulLifeMonthsDefault)}
                  onValueChange={(value) =>
                    patchEditing({
                      usefulLifeMonthsDefault: /^\d{0,4}$/.test(value) ? Number(value || "0") : editing.usefulLifeMonthsDefault,
                    })
                  }
                  mono
                  bidiIsolate
                  required
                />
                <Select
                  id="fa-cat-edit-method"
                  label={d.faCatMethod}
                  value={editing.depreciationMethodDefault}
                  onValueChange={(value) => patchEditing({ depreciationMethodDefault: value })}
                  options={methodOptions}
                />
              </div>
            </div>
            <details className="rounded-md border border-subtle bg-surface-sunken p-3">
              <summary className="cursor-pointer text-sm font-medium">{d.faCatPurposesTitle}</summary>
              <p className="mt-2 text-xs text-gray-600">{d.faCatPurposesHint}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Input
                  id="fa-cat-edit-purpose-asset"
                  label={d.faCatPurposeAsset}
                  value={editing.assetPurposeKey}
                  onValueChange={(value) => patchEditing({ assetPurposeKey: value })}
                  mono
                  bidiIsolate
                />
                <Input
                  id="fa-cat-edit-purpose-accum"
                  label={d.faCatPurposeAccum}
                  value={editing.accumDepreciationPurposeKey}
                  onValueChange={(value) => patchEditing({ accumDepreciationPurposeKey: value })}
                  mono
                  bidiIsolate
                />
                <Input
                  id="fa-cat-edit-purpose-expense"
                  label={d.faCatPurposeExpense}
                  value={editing.expensePurposeKey}
                  onValueChange={(value) => patchEditing({ expensePurposeKey: value })}
                  mono
                  bidiIsolate
                />
              </div>
            </details>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-subtle pt-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editing.active}
                  onCheckedChange={(checked) => patchEditing({ active: checked === true })}
                />
                {d.faCatActive}
              </label>
              <Button variant="ghost" onClick={() => setEditId(null)}>
                {d.commonCancel}
              </Button>
              <Button type="submit" variant="primary" loading={busy === editing.id}>
                {d.commonSave}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={d.faCatNewButton}>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void createCategory();
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Input
                id="fa-cat-new-code"
                label={d.faCatCode}
                hint={d.faCatCodeHint}
                value={draft.code}
                onValueChange={(value) => setDraftField("code", value)}
                mono
                bidiIsolate
                required
              />
              <Input
                id="fa-cat-new-name"
                label={d.faCatName}
                value={draft.name}
                onValueChange={(value) => setDraftField("name", value)}
                required
              />
              <Input
                id="fa-cat-new-name-ar"
                label={d.faCatNameAr}
                value={draft.nameAr}
                onValueChange={(value) => setDraftField("nameAr", value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Input
                id="fa-cat-new-life"
                label={d.faCatLife}
                value={draft.life}
                onValueChange={(value) => setDraftField("life", value)}
                mono
                bidiIsolate
                required
              />
              <Select
                id="fa-cat-new-method"
                label={d.faCatMethod}
                value={draft.method}
                onValueChange={(value) => setDraftField("method", value)}
                options={methodOptions}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={advanced} onCheckedChange={(checked) => setAdvanced(checked === true)} />
              {d.faCatPurposesTitle}
            </label>
            {advanced ? (
              <div className="grid gap-3 rounded-md border border-subtle bg-surface-sunken p-3 sm:grid-cols-3">
                <Input
                  id="fa-cat-new-purpose-asset"
                  label={d.faCatPurposeAsset}
                  value={draft.purposeAsset}
                  onValueChange={(value) => setDraftField("purposeAsset", value)}
                  mono
                  bidiIsolate
                />
                <Input
                  id="fa-cat-new-purpose-accum"
                  label={d.faCatPurposeAccum}
                  value={draft.purposeAccum}
                  onValueChange={(value) => setDraftField("purposeAccum", value)}
                  mono
                  bidiIsolate
                />
                <Input
                  id="fa-cat-new-purpose-expense"
                  label={d.faCatPurposeExpense}
                  value={draft.purposeExpense}
                  onValueChange={(value) => setDraftField("purposeExpense", value)}
                  mono
                  bidiIsolate
                />
                <p className="text-xs text-gray-600 sm:col-span-3">{d.faCatPurposesHint}</p>
              </div>
            ) : (
              <InfoNotice>
                {DEFAULT_PURPOSES.asset} · {DEFAULT_PURPOSES.accum} · {DEFAULT_PURPOSES.expense}
              </InfoNotice>
            )}
          </div>
          <div className="flex justify-end border-t border-subtle pt-3">
            <Button type="submit" variant="primary" loading={busy === "create"} disabled={!createReady}>
              {d.commonCreate}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
