"use client";

/**
 * T14-UI (PHASE-010) — warehouse management (Settings archetype §8): the
 * tenant warehouse list (code, branch, GL inventory account, active state)
 * with create (branch-linked, optional per-warehouse GL override — the
 * G-15 distinct-accounts seam) and deactivate/reactivate. Deactivation is
 * the guard rails only — movement history is append-only and stays.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AccountRow, BranchRow, WarehouseRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedInventoryError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function InventoryWarehouses({
  locale,
  initialRows,
  branches,
  glAccounts,
  canManage,
}: {
  locale: Locale;
  initialRows: readonly WarehouseRow[];
  branches: readonly BranchRow[];
  glAccounts: readonly AccountRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly WarehouseRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Create form state.
  const [branchId, setBranchId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [inventoryAccountId, setInventoryAccountId] = useState("");
  const [note, setNote] = useState("");

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, localizedName(branch.name, branch.nameAr, locale));
    }
    return map;
  }, [branches, locale]);

  const assetAccounts = useMemo(
    () => glAccounts.filter((account) => account.type === "ASSET" && account.isPostable),
    [glAccounts],
  );

  const formReady =
    branchId !== "" && code.trim().length >= 1 && name.trim().length >= 1;

  async function createWarehouse(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy("create");
    const created = await bffFetch<WarehouseRow>("inventory/warehouses", {
      method: "POST",
      body: {
        branchId,
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        inventoryAccountId: inventoryAccountId === "" ? null : inventoryAccountId,
        note: note.trim() === "" ? null : note.trim(),
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedInventoryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setCode("");
    setName("");
    setNameAr("");
    setInventoryAccountId("");
    setNote("");
    setNotice(d.warehousesCreatedToast);
    router.refresh();
  }

  async function toggleActive(row: WarehouseRow): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(row.id);
    const result = await bffFetch<WarehouseRow>(
      `inventory/warehouses/${row.id}/${row.isActive ? "deactivate" : "reactivate"}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedInventoryError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((entry) => (entry.id === row.id ? result.data : entry)));
    setConfirmId(null);
    setNotice(row.isActive ? d.warehousesDeactivatedToast : d.warehousesReactivatedToast);
    router.refresh();
  }

  const confirmRow = rows.find((row) => row.id === confirmId);

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.warehousesTitle}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.warehousesColCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.code}</span>,
            },
            {
              id: "name",
              header: activeLocaleHeader(d.stockColItem),
              accessor: (row) => row.name,
              render: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "branch",
              header: activeLocaleHeader(d.warehousesColBranch),
              accessor: (row) => row.branchCode ?? "",
              render: (row) =>
                row.branchCode === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  branchNameById.get(row.branchId) ?? row.branchCode
                ),
            },
            {
              id: "gl",
              header: activeLocaleHeader(d.warehousesColGlAccount),
              accessor: (row) => row.inventoryAccountCode ?? "",
              mono: true,
              render: (row) =>
                row.inventoryAccountCode === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.inventoryAccountCode}</span>
                ),
            },
            {
              id: "active",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => (row.isActive ? "ACTIVE" : "INACTIVE"),
              render: (row) =>
                row.isActive ? (
                  <span className="text-xs text-success-foreground">{d.accountingStatusOpen}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{d.accountingStatusLocked}</span>
                ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={
            canManage
              ? [
                  {
                    id: "deactivate",
                    label: d.warehousesDeactivate,
                    danger: true,
                    onSelect: (row: WarehouseRow) => {
                      if (!row.isActive) return;
                      setError(null);
                      setNotice(null);
                      setConfirmId(row.id);
                    },
                  },
                  {
                    id: "reactivate",
                    label: d.warehousesReactivate,
                    onSelect: (row: WarehouseRow) => {
                      if (row.isActive) return;
                      void toggleActive(row);
                    },
                  },
                ]
              : []
          }
          empty={{ title: d.warehousesEmpty }}
        />
      </Card>

      {confirmRow !== undefined && (
        <Card title={d.warehousesDeactivateTitle}>
          <p className="text-sm text-muted-foreground">{d.warehousesDeactivateConfirm}</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              loading={busy === confirmRow.id}
              onClick={() => void toggleActive(confirmRow)}
            >
              {d.warehousesDeactivate}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              {d.commonCancel}
            </Button>
          </div>
        </Card>
      )}

      {canManage && (
        <Card title={d.warehousesCreateTitle}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label={d.warehousesBranchLabel}
              value={branchId}
              onValueChange={setBranchId}
              placeholder="—"
              options={branches.map((branch) => ({
                value: branch.id,
                label: localizedName(branch.name, branch.nameAr, locale),
              }))}
              required
            />
            <Input
              label={d.warehousesCodeLabel}
              value={code}
              onValueChange={setCode}
              hint="MAIN-WH"
              mono
              bidiIsolate
              required
            />
            <Input
              label={d.warehousesNameLabel}
              value={name}
              onValueChange={setName}
              required
            />
            <Input
              label={d.warehousesNameArLabel}
              value={nameAr}
              onValueChange={setNameAr}
            />
            <Select
              label={d.warehousesGlAccountLabel}
              value={inventoryAccountId}
              onValueChange={setInventoryAccountId}
              placeholder="—"
              options={assetAccounts.map((account) => ({
                value: account.id,
                label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
              }))}
            />
            <Input label={d.warehousesNoteLabel} value={note} onValueChange={setNote} />
          </div>
          <Button
            variant="primary"
            onClick={() => void createWarehouse()}
            loading={busy === "create"}
            disabled={!formReady}
            className="mt-3 self-start"
          >
            {d.commonCreate}
          </Button>
        </Card>
      )}
    </div>
  );
}
