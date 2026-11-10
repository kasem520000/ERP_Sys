"use client";

/**
 * T15-UI (PHASE-009) — tax codes manager (settings archetype, combined):
 * the codes list (code, bilingual name, country, treatment badge, live
 * usage count, status) with the archive action (confirm card; blocked while
 * documents still reference the code), the create form (code, bilingual
 * name, country select seeded from the jurisdiction packs, treatment), and
 * the deterministic resolve preview — one amount + code + date + currency
 * SAR through POST tax/resolve-lines, showing treatment / rate / base /
 * tax / gross, the BR-033 boundary warning and the NOT_SUBJECT notice.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { JurisdictionPackRow, ResolveLinesResultRow, TaxCodeRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isPositiveDecimal } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedTaxError,
  localizedTaxTreatment,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Rate strings travel as canonical decimals ("15.0000") — display trimmed + %. */
function percentLabel(rate: string): string {
  const trimmed = rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${trimmed === "" ? "0" : trimmed}%`;
}

const TREATMENT_OPTIONS = [
  "STANDARD_RATED",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
  "REVERSE_CHARGE",
  "NOT_SUBJECT",
] as const;

export function TaxCodes({
  locale,
  initialCodes,
  packs,
}: {
  locale: Locale;
  initialCodes: readonly TaxCodeRow[];
  packs: readonly JurisdictionPackRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [codes, setCodes] = useState<readonly TaxCodeRow[]>(initialCodes);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  // Create form state.
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [treatment, setTreatment] = useState<string>("STANDARD_RATED");

  // Resolve-preview state (date defaults to today, amount 100.00, SAR fixed).
  const [resolveDate, setResolveDate] = useState(new Date().toISOString().slice(0, 10));
  const [resolveAmount, setResolveAmount] = useState("100.00");
  const [resolveCodeId, setResolveCodeId] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolveLinesResultRow | null>(null);

  const archiveTarget = codes.find((row) => row.id === archiveId) ?? null;
  const resolved = resolveResult !== null ? (resolveResult.lines[0] ?? null) : null;

  const activeCodes = useMemo(() => codes.filter((row) => row.status === "ACTIVE"), [codes]);

  const countryOptions = useMemo(
    () =>
      packs.map((pack) => ({
        value: pack.countryCode,
        label: `${pack.countryCode} · ${localizedName(pack.countryName, pack.countryNameAr, locale)}`,
      })),
    [packs, locale],
  );

  const codeOptions = useMemo(
    () =>
      activeCodes.map((row) => ({
        value: row.id,
        label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
      })),
    [activeCodes, locale],
  );

  const createReady =
    code.trim().length >= 1 &&
    code.trim().length <= 20 &&
    name.trim() !== "" &&
    countryCode !== "" &&
    treatment !== "";

  async function createCode(): Promise<void> {
    setError(null);
    setNotice(null);
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    const created = await bffFetch<TaxCodeRow>("tax/tax-codes", {
      method: "POST",
      body: {
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        countryCode,
        defaultTreatment: treatment,
      },
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedTaxError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setCodes((current) => [...current, created.data]);
    setCode("");
    setName("");
    setNameAr("");
    setCountryCode("");
    setTreatment("STANDARD_RATED");
    setNotice(d.taxCodesCreatedToast);
    router.refresh();
  }

  async function archiveCode(): Promise<void> {
    if (archiveId === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(archiveId);
    const archived = await bffFetch<TaxCodeRow>(`tax/tax-codes/${archiveId}/archive`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!archived.ok) {
      setError(localizedTaxError(d, archived.error, archived.retryAfterSeconds));
      return;
    }
    setCodes((current) => current.map((row) => (row.id === archiveId ? archived.data : row)));
    setArchiveId(null);
    setNotice(d.taxCodesArchivedToast);
    router.refresh();
  }

  const resolveReady =
    resolveCodeId !== "" && resolveDate !== "" && isPositiveDecimal(resolveAmount);

  async function resolveLine(): Promise<void> {
    setError(null);
    setNotice(null);
    setResolveResult(null);
    if (!resolveReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("resolve");
    const resolved = await bffFetch<ResolveLinesResultRow>("tax/resolve-lines", {
      method: "POST",
      body: {
        documentDate: resolveDate,
        lines: [{ amount: resolveAmount, taxCodeId: resolveCodeId, currencyCode: "SAR" }],
      },
    });
    setBusy(null);
    if (!resolved.ok) {
      setError(localizedTaxError(d, resolved.error, resolved.retryAfterSeconds));
      return;
    }
    setResolveResult(resolved.data);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.taxCodesTitle}>
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.taxCodesCode),
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
              render: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "country",
              header: activeLocaleHeader(d.taxCodesCountry),
              accessor: (row) => row.countryCode,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.countryCode}
                </span>
              ),
            },
            {
              id: "treatment",
              header: activeLocaleHeader(d.taxCodesTreatment),
              accessor: (row) => row.defaultTreatment,
              render: (row) => (
                <Badge tone="primary">{localizedTaxTreatment(d, row.defaultTreatment)}</Badge>
              ),
            },
            {
              id: "usage",
              header: activeLocaleHeader(d.taxCodesUsage),
              accessor: (row) => String(row.usageCount),
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.usageCount}
                </span>
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
                  <Badge tone="neutral">{d.statusArchived}</Badge>
                ),
            },
          ]}
          rows={[...codes]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "archive",
              label: d.taxCodesArchive,
              danger: true,
              onSelect: (row: TaxCodeRow) => {
                if (row.status !== "ACTIVE") {
                  return;
                }
                setArchiveId(row.id);
              },
            },
          ]}
          empty={{ title: d.taxCodesEmpty }}
        />
      </Card>

      {archiveTarget !== null && (
        <Card title={d.taxCodesArchive} description={d.taxCodesArchiveConfirm}>
          <div className="flex flex-col gap-3">
            {archiveTarget.usageCount > 0 && <InfoNotice>{d.taxCodesArchiveBlocked}</InfoNotice>}
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => void archiveCode()}
                loading={busy === archiveTarget.id}
                disabled={archiveTarget.usageCount > 0}
              >
                {d.taxCodesArchive}
              </Button>
              <Button variant="ghost" onClick={() => setArchiveId(null)}>
                {d.commonCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card title={d.taxCodesCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label={d.taxCodesCode}
            value={code}
            onValueChange={setCode}
            mono
            bidiIsolate
            required
          />
          <Input label={d.taxCodesName} value={name} onValueChange={setName} required />
          <Input label={d.taxCodesNameAr} value={nameAr} onValueChange={setNameAr} />
          <Select
            label={d.taxCodesCountry}
            value={countryCode}
            onValueChange={setCountryCode}
            placeholder="—"
            options={countryOptions}
            required
          />
          <Select
            label={d.taxCodesTreatment}
            value={treatment}
            onValueChange={setTreatment}
            options={TREATMENT_OPTIONS.map((value) => ({
              value,
              label: localizedTaxTreatment(d, value),
            }))}
            required
          />
        </div>
        <Button
          variant="primary"
          onClick={() => void createCode()}
          loading={busy === "create"}
          disabled={!createReady}
          className="mt-3 self-start"
        >
          {d.commonCreate}
        </Button>
      </Card>

      <Card title={d.taxResolveTitle}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DatePicker
            locale={locale}
            label={d.taxResolveDate}
            value={resolveDate}
            onSelect={setResolveDate}
            required
          />
          <MoneyInput
            label={d.taxResolveAmount}
            amount={resolveAmount}
            onAmountChange={setResolveAmount}
            currency="SAR"
            required
          />
          <Select
            label={d.taxResolveCode}
            value={resolveCodeId}
            onValueChange={setResolveCodeId}
            placeholder="—"
            options={codeOptions}
            required
          />
        </div>
        <Button
          variant="primary"
          onClick={() => void resolveLine()}
          loading={busy === "resolve"}
          disabled={!resolveReady}
          className="mt-3 self-start"
        >
          {d.taxResolveAction}
        </Button>

        {resolved !== null && (
          <div className="mt-4 flex flex-col gap-3">
            {resolveResult?.notSubject === true && (
              <InfoNotice>{d.taxResolveNotSubject}</InfoNotice>
            )}
            {resolveResult?.boundaryWarning != null && (
              <InfoNotice>
                {formatMessage(d.taxResolveBoundaryWarning, {
                  rate: percentLabel(resolveResult.boundaryWarning.rate),
                  date: resolveResult.boundaryWarning.effectiveFrom,
                })}
              </InfoNotice>
            )}
            <DefList
              items={[
                {
                  term: d.taxResolveCode,
                  children: (
                    <span className="font-mono text-sm" dir="ltr">
                      {resolved.code}
                    </span>
                  ),
                },
                {
                  term: d.taxResolveTreatment,
                  children: (
                    <Badge tone="primary">{localizedTaxTreatment(d, resolved.treatment)}</Badge>
                  ),
                },
                {
                  term: d.taxResolveRate,
                  children: (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {percentLabel(resolved.rate)}
                    </span>
                  ),
                },
                {
                  term: d.taxResolveBase,
                  children: (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(resolved.taxBase, 2)}{" "}
                      <span className="text-xs text-muted-foreground">SAR</span>
                    </span>
                  ),
                },
                {
                  term: d.taxResolveTax,
                  children: (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(resolved.taxAmount, 2)}{" "}
                      <span className="text-xs text-muted-foreground">SAR</span>
                    </span>
                  ),
                },
                {
                  term: d.taxResolveGross,
                  children: (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(resolved.gross, 2)}{" "}
                      <span className="text-xs text-muted-foreground">SAR</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
