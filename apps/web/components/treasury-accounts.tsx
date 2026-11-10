"use client";

/**
 * T14-UI (PHASE-008) — cash/bank/petty accounts workspace (list-search
 * archetype): the accounts table (type filter, bilingual name + GL code,
 * currency, balance, status) with the open-account form (GL account picker
 * from the CoA, branch + currency) and the close action (reason prompt —
 * the store keeps it immutable once closed). Balances are canonical
 * decimal strings (ADR-0009) rendered via the money display helper.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DocumentStatusBadge,
  Input,
  SearchInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AccountRow, BranchRow, CashAccountRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedCashAccountType,
  localizedTreasuryError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const ACCOUNT_TYPES = ["CASH", "BANK", "PETTY"] as const;

export function TreasuryAccounts({
  locale,
  initialAccounts,
  glAccounts,
  branches,
  canManage,
}: {
  locale: Locale;
  initialAccounts: readonly CashAccountRow[];
  glAccounts: readonly AccountRow[];
  branches: readonly BranchRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly CashAccountRow[]>(initialAccounts);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState("");

  // Open-account form state.
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("CASH");
  const [accountId, setAccountId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== "" && row.type !== typeFilter) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        row.name.toLowerCase().includes(needle) ||
        (row.nameAr ?? "").includes(query.trim()) ||
        row.accountCode.toLowerCase().includes(needle)
      );
    });
  }, [rows, query, typeFilter]);

  const postableAccounts = useMemo(
    () =>
      glAccounts
        .filter((account) => account.status === "ACTIVE" && account.isPostable)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [glAccounts],
  );

  const formReady =
    name.trim() !== "" && accountId !== "" && currencyCode.trim().length === 3;

  async function openAccount(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const created = await bffFetch<CashAccountRow>("treasury/cash-accounts", {
      method: "POST",
      body: {
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        type,
        accountId,
        branchId: branchId === "" ? null : branchId,
        currencyCode: currencyCode.trim().toUpperCase(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedTreasuryError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setRows((current) => [created.data, ...current]);
    setName("");
    setNameAr("");
    setAccountId("");
    setBranchId("");
    setCurrencyCode("");
    setNotice(d.treasuryAccountCreatedToast);
    router.refresh();
  }

  async function closeAccount(): Promise<void> {
    if (closeId === null) {
      return;
    }
    setError(null);
    setBusy(true);
    const closed = await bffFetch<CashAccountRow>(`treasury/cash-accounts/${closeId}/close`, {
      method: "POST",
      body: { reason: closeReason.trim() },
    });
    setBusy(false);
    if (!closed.ok) {
      setError(localizedTreasuryError(d, closed.error, closed.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((row) => (row.id === closeId ? closed.data : row)));
    setCloseId(null);
    setCloseReason("");
    setNotice(d.treasuryAccountClosedToast);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.treasuryAccountsTitle}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchInput value={query} onValueChange={setQuery} placeholder={d.accountingSearchPlaceholder} />
          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: "", label: d.kindFilterAll },
              ...ACCOUNT_TYPES.map((value) => ({
                value,
                label: localizedCashAccountType(d, value),
              })),
            ]}
            aria-label={d.treasuryAccountType}
          />
        </div>
        <DataTable
          columns={[
            {
              id: "name",
              header: activeLocaleHeader(d.colName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
              sortable: true,
              render: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "type",
              header: activeLocaleHeader(d.treasuryAccountType),
              accessor: (row) => row.type,
              render: (row) => localizedCashAccountType(d, row.type),
            },
            {
              id: "glCode",
              header: activeLocaleHeader(d.treasuryColGlCode),
              accessor: (row) => row.accountCode,
              mono: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.accountCode}</span>,
            },
            {
              id: "currency",
              header: activeLocaleHeader(d.treasuryDocCurrency),
              accessor: (row) => row.currencyCode,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>,
            },
            {
              id: "balance",
              header: activeLocaleHeader(d.treasuryAccountBalance),
              accessor: (row) => row.balance,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.balance, 2)}{" "}
                  <span className="text-xs text-muted-foreground">{row.currencyCode}</span>
                </span>
              ),
            },
            {
              id: "movements",
              header: activeLocaleHeader(d.treasuryColMovements),
              accessor: (row) => String(row.movementCount),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">{row.movementCount}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) =>
                row.status === "ACTIVE" ? (
                  <Badge tone="primary">{d.statusActive}</Badge>
                ) : (
                  <DocumentStatusBadge status="CANCELLED" label={d.statusClosed} />
                ),
            },
          ]}
          rows={[...filtered]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => router.push(`/${locale}/treasury/accounts/${row.id}`),
            },
            ...(canManage
              ? [
                  {
                    id: "close",
                    label: d.treasuryAccountCloseBtn,
                    danger: true,
                    onSelect: (row: CashAccountRow) => {
                      if (row.status !== "ACTIVE") return;
                      setCloseReason("");
                      setCloseId(row.id);
                    },
                  },
                ]
              : []),
          ]}
          empty={{ title: d.treasuryAccountsEmpty }}
        />
      </Card>

      {canManage && (
        <>
          <Card title={d.treasuryAccountOpenTitle}>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={d.treasuryAccountName} value={name} onValueChange={setName} required />
                <Input label={d.treasuryAccountNameAr} value={nameAr} onValueChange={setNameAr} />
                <Select
                  label={d.treasuryAccountType}
                  value={type}
                  onValueChange={setType}
                  options={ACCOUNT_TYPES.map((value) => ({
                    value,
                    label: localizedCashAccountType(d, value),
                  }))}
                  required
                />
                <Select
                  label={d.treasuryAccountGlAccount}
                  value={accountId}
                  onValueChange={setAccountId}
                  placeholder="—"
                  options={postableAccounts.map((account) => ({
                    value: account.id,
                    label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
                  }))}
                  required
                />
                <Select
                  label={d.treasuryAccountBranch}
                  value={branchId}
                  onValueChange={setBranchId}
                  placeholder="—"
                  options={[
                    { value: "", label: "—" },
                    ...branches.map((branch) => ({
                      value: branch.id,
                      label: `${branch.code} · ${localizedName(branch.name, branch.nameAr, locale)}`,
                    })),
                  ]}
                />
                <Input
                  label={d.treasuryAccountCurrency}
                  value={currencyCode}
                  onValueChange={setCurrencyCode}
                  placeholder="SAR"
                  mono
                  bidiIsolate
                  required
                />
              </div>
              <Button
                variant="primary"
                onClick={openAccount}
                loading={busy}
                disabled={!formReady}
                className="self-start"
              >
                {d.treasuryAccountOpenTitle}
              </Button>
            </div>
          </Card>

          {closeId !== null && (
            <Card title={d.treasuryAccountCloseBtn}>
              <div className="flex flex-col gap-3">
                <Input
                  label={d.treasuryAccountCloseReason}
                  value={closeReason}
                  onValueChange={setCloseReason}
                  required
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={closeAccount}
                    loading={busy}
                    disabled={closeReason.trim().length < 3}
                  >
                    {d.treasuryAccountCloseBtn}
                  </Button>
                  <Button variant="ghost" onClick={() => setCloseId(null)}>
                    {d.commonCancel}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
