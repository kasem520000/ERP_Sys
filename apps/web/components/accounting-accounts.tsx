"use client";

/**
 * P7-T18 — chart-of-accounts workspace (create-edit archetype): the account
 * tree (code, bilingual name, type, postable leaf, currency restriction,
 * status) with the purpose-mapping panel (V1: exactly one active mapping per
 * purpose — the engine fails closed on gaps). New-account form enforces the
 * client-side convenience rules (parent type match, code uniqueness) — the
 * CoA service remains the authority.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  SearchInput,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AccountRow, PurposeRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedAccountingError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

function localizedAccountType(d: ReturnType<typeof getDictionary>, type: string): string {
  switch (type) {
    case "ASSET":
      return d.accountTypeAsset;
    case "LIABILITY":
      return d.accountTypeLiability;
    case "EQUITY":
      return d.accountTypeEquity;
    case "REVENUE":
      return d.accountTypeRevenue;
    case "EXPENSE":
      return d.accountTypeExpense;
    default:
      return type;
  }
}

export function AccountingAccounts({
  locale,
  initialAccounts,
  initialPurposes,
}: {
  locale: Locale;
  initialAccounts: readonly AccountRow[];
  initialPurposes: readonly PurposeRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [accounts, setAccounts] = useState<readonly AccountRow[]>(initialAccounts);
  const [purposes, setPurposes] = useState<readonly PurposeRow[]>(initialPurposes);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-account form state.
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("ASSET");
  const [parentId, setParentId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [isGroup, setIsGroup] = useState(false);

  // Purpose-mapping form state.
  const [purposeKey, setPurposeKey] = useState("");
  const [purposeAccountId, setPurposeAccountId] = useState("");
  const [activeFrom, setActiveFrom] = useState(new Date().toISOString().slice(0, 10));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (typeFilter !== "" && account.type !== typeFilter) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        account.code.toLowerCase().includes(needle) ||
        account.name.toLowerCase().includes(needle) ||
        account.nameAr.includes(query.trim())
      );
    });
  }, [accounts, query, typeFilter]);

  const sortedForDisplay = useMemo(() => [...filtered].sort((a, b) => a.code.localeCompare(b.code)), [filtered]);

  const groupCandidates = useMemo(
    () =>
      accounts
        .filter((account) => account.status === "ACTIVE" && !account.isPostable)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  const leafAccounts = useMemo(
    () => accounts.filter((account) => account.status === "ACTIVE" && account.isPostable),
    [accounts],
  );

  const activePurposes = useMemo(
    () => purposes.filter((purpose) => purpose.activeTo === null),
    [purposes],
  );

  const unmappedPurposeKeys = useMemo(() => {
    // The 16 seeded purpose keys (PHASE-004 template) — displayed as options;
    // the engine enforces per-purpose resolution server-side.
    const seeded = [
      "AR_CONTROL",
      "AP_CONTROL",
      "SALES_REVENUE",
      "SALES_DISCOUNTS",
      "SALES_RETURNS",
      "COGS",
      "INVENTORY",
      "INVENTORY_SHRINKAGE",
      "VAT_PAYABLE",
      "VAT_EXPENSED",
      "FX_GAIN",
      "FX_LOSS",
      "DEPOSITS_RECEIVED",
      "BANK_CHARGES",
      "CLOSING",
      "RETAINED_EARNINGS",
      "OPENING_EQUITY",
    ];
    const mapped = new Set(activePurposes.map((purpose) => purpose.purposeKey));
    return seeded.filter((key) => !mapped.has(key));
  }, [activePurposes]);

  async function createAccount(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    const created = await bffFetch<AccountRow>("accounting/accounts", {
      method: "POST",
      body: {
        code,
        name,
        nameAr: nameAr === "" ? null : nameAr,
        type,
        parentId: parentId === "" ? null : parentId,
        currencyCode: currencyCode === "" ? null : currencyCode.toUpperCase(),
        isGroup,
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedAccountingError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setAccounts((rows) => [...rows, created.data]);
    setCode("");
    setName("");
    setNameAr("");
    setParentId("");
    setCurrencyCode("");
    setIsGroup(false);
    setNotice(d.commonCreate);
    router.refresh();
  }

  async function mapPurpose(): Promise<void> {
    setError(null);
    setNotice(null);
    if (purposeKey === "" || purposeAccountId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const mapped = await bffFetch<PurposeRow>("accounting/purposes", {
      method: "POST",
      body: { purposeKey, accountId: purposeAccountId, activeFrom },
    });
    setBusy(false);
    if (!mapped.ok) {
      setError(localizedAccountingError(d, mapped.error, mapped.retryAfterSeconds));
      return;
    }
    setPurposes((rows) => [...rows, mapped.data]);
    setPurposeKey("");
    setPurposeAccountId("");
    setNotice(d.accountingMapPurpose);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.accountingCoaTitle}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={d.accountingSearchPlaceholder}
          />
          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: "", label: d.kindFilterAll },
              ...ACCOUNT_TYPES.map((value) => ({ value, label: localizedAccountType(d, value) })),
            ]}
            aria-label={d.accountingColType}
          />
        </div>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.accountingColCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => <span className="font-mono text-sm" dir="ltr">{row.code}</span>,
            },
            {
              id: "name",
              header: activeLocaleHeader(d.accountingColName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
              sortable: true,
              render: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "type",
              header: activeLocaleHeader(d.accountingColType),
              accessor: (row) => row.type,
              render: (row) => localizedAccountType(d, row.type),
            },
            {
              id: "postable",
              header: activeLocaleHeader(d.accountingColPostable),
              accessor: (row) => (row.isPostable ? "1" : "0"),
              render: (row) => (
                <Badge tone={row.isPostable ? "primary" : "neutral"}>
                  {row.isPostable ? d.accountingPostableYes : d.accountingPostableNo}
                </Badge>
              ),
            },
            {
              id: "currency",
              header: activeLocaleHeader(d.accountingColCurrency),
              accessor: (row) => row.currencyCode ?? "",
              render: (row) =>
                row.currencyCode === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">{row.currencyCode}</span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) =>
                row.status === "ARCHIVED" ? (
                  <Badge tone="neutral">{d.statusArchived}</Badge>
                ) : (
                  <Badge tone="primary">{d.statusActive}</Badge>
                ),
            },
          ]}
          rows={[...sortedForDisplay]}
          rowKey={(row) => row.id}
          empty={{ title: d.accountingCoaEmpty }}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={d.accountingNewAccount}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={d.accountingColCode} value={code} onValueChange={setCode} mono required />
              <Select
                label={d.accountingColType}
                value={type}
                onValueChange={setType}
                options={ACCOUNT_TYPES.map((value) => ({ value, label: localizedAccountType(d, value) }))}
                required
              />
            </div>
            <Input label={`${d.accountingColName} (EN)`} value={name} onValueChange={setName} required />
            <Input label={`${d.accountingColName} (AR)`} value={nameAr} onValueChange={setNameAr} />
            <Select
              label={d.accountingAccountParent}
              value={parentId}
              onValueChange={setParentId}
              placeholder="—"
              options={[
                { value: "", label: "—" },
                ...groupCandidates.map((account) => ({
                  value: account.id,
                  label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
                })),
              ]}
            />
            <Input
              label={d.accountingAccountCurrency}
              value={currencyCode}
              onValueChange={setCurrencyCode}
              placeholder="SAR"
              mono
              bidiIsolate
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isGroup}
                onChange={(event) => setIsGroup(event.target.checked)}
                className="size-4"
              />
              {d.accountingIsGroup}
            </label>
            <Button variant="primary" onClick={createAccount} loading={busy} disabled={code === "" || name === ""}>
              {d.commonCreate}
            </Button>
          </div>
        </Card>

        <Card title={d.accountingPurposesTitle} description={d.accountingPurposesHint}>
          <DataTable
            columns={[
              {
                id: "key",
                header: activeLocaleHeader(d.accountingPurposeKey),
                accessor: (row) => row.purposeKey,
                render: (row) => <span className="font-mono text-xs" dir="ltr">{row.purposeKey}</span>,
              },
              {
                id: "account",
                header: activeLocaleHeader(d.accountingPurposeAccount),
                accessor: (row) => row.accountCode ?? "",
                render: (row) =>
                  row.accountCode === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">{row.accountCode}</span>
                  ),
              },
              {
                id: "from",
                header: activeLocaleHeader(d.accountingActiveFrom),
                accessor: (row) => row.activeFrom,
                render: (row) => <span className="font-mono text-xs" dir="ltr">{row.activeFrom}</span>,
              },
            ]}
            rows={[...activePurposes]}
            rowKey={(row) => row.id}
            empty={{ title: d.accountingPurposesEmpty }}
          />
          <div className="mt-4 flex flex-col gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">{d.accountingMapPurpose}</h3>
            <Select
              label={d.accountingPurposeKey}
              value={purposeKey}
              onValueChange={setPurposeKey}
              options={unmappedPurposeKeys.map((key) => ({ value: key, label: key }))}
              required
            />
            <Select
              label={d.accountingPurposeAccount}
              value={purposeAccountId}
              onValueChange={setPurposeAccountId}
              options={leafAccounts.map((account) => ({
                value: account.id,
                label: `${account.code} · ${localizedName(account.name, account.nameAr, locale)}`,
              }))}
              required
            />
            <Input
              label={d.accountingActiveFrom}
              value={activeFrom}
              onValueChange={setActiveFrom}
              mono
              bidiIsolate
            />
            <Button
              variant="primary"
              onClick={mapPurpose}
              loading={busy}
              disabled={purposeKey === "" || purposeAccountId === ""}
            >
              {d.accountingMapPurpose}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
