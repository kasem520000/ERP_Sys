"use client";

/**
 * PHASE-017 T14 (9a-dist) — the commissions screen:
 *
 * - the runs list (period, basis, totals, status) + the create dialog
 *   (create = create + compute in one call — DRAFT with computed lines);
 * - the selected run's detail: the lines table (rep / base / rate /
 *   commission / payout badge; excluded note-lines explain basis
 *   mismatches) with post (the accrual point) and cancel;
 * - the per-rep rules editor: pick a rep → GET their rule → edit
 *   method/rate/basis. A flat rate replaces tier bands; leaving the rate
 *   empty with a tiered rule PRESERVES the bands (they render read-only).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CommissionRunLineRow,
  CommissionRunRow,
  CommissionRunWithLines,
  RepCommissionRuleRow,
  SalesRepRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isRecord } from "../lib/api-types";
import {
  formatMessage,
  localizedName,
  localizedCommissionBasis,
  localizedCommissionError,
  localizedCommissionStatus,
  localizedPayoutStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const RATE_RE = /^\d+(\.\d{1,4})?$/;

function isExcluded(line: CommissionRunLineRow): boolean {
  return isRecord(line.detail) && line.detail.excluded === true;
}

export function Commissions({
  locale,
  initialRuns,
  reps,
}: {
  locale: Locale;
  initialRuns: readonly CommissionRunRow[];
  reps: readonly SalesRepRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [runs, setRuns] = useState<readonly CommissionRunRow[]>(initialRuns);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [basis, setBasis] = useState<"INVOICED" | "COLLECTED">("INVOICED");

  // Detail state.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommissionRunWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Cancel dialog state.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Rules editor state.
  const [ruleRepId, setRuleRepId] = useState("");
  const [rule, setRule] = useState<RepCommissionRuleRow | null>(null);
  const [ruleMethod, setRuleMethod] = useState<"NONE" | "PERCENTAGE">("NONE");
  const [ruleRate, setRuleRate] = useState("");
  const [ruleBasis, setRuleBasis] = useState<"INVOICED" | "COLLECTED">("INVOICED");
  const [ruleLoading, setRuleLoading] = useState(false);

  const repLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const rep of reps) {
      map.set(rep.id, `${localizedName(rep.name, rep.nameAr, locale)} · ${rep.code}`);
    }
    return map;
  }, [reps, locale]);

  const periodSane = periodFrom !== "" && periodTo !== "" && periodFrom <= periodTo;
  const rateValid = ruleRate === "" || (RATE_RE.test(ruleRate) && Number(ruleRate) <= 100);
  const ruleReady = rule !== null && ruleRepId !== "" && rateValid;

  // -- runs -------------------------------------------------------------------------------

  async function createRun(): Promise<void> {
    if (!periodSane) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<CommissionRunWithLines>("sales/commission-runs", {
      method: "POST",
      body: { periodFrom, periodTo, basis },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRuns((current) => [result.data, ...current]);
    setCreateOpen(false);
    setPeriodFrom("");
    setPeriodTo("");
    setNotice(d.commissionsRunCreatedToast);
    await selectRun(result.data.id);
  }

  async function selectRun(id: string): Promise<void> {
    setSelectedId(id);
    setDetailLoading(true);
    const result = await bffFetch<CommissionRunWithLines>(`sales/commission-runs/${id}`);
    setDetailLoading(false);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDetail(result.data);
  }

  async function refreshAfterAction(id: string, toast: string): Promise<void> {
    const result = await bffFetch<CommissionRunWithLines>(`sales/commission-runs/${id}`);
    if (result.ok) {
      setDetail(result.data);
      setRuns((current) => current.map((row) => (row.id === id ? result.data : row)));
      setNotice(toast);
    }
  }

  async function postRun(): Promise<void> {
    if (selectedId === null) return;
    setBusy("post");
    setError(null);
    const result = await bffFetch<CommissionRunRow>(`sales/commission-runs/${selectedId}/post`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await refreshAfterAction(selectedId, d.commissionsRunPostedToast);
  }

  async function cancelRun(): Promise<void> {
    if (selectedId === null || cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("cancel");
    setError(null);
    const result = await bffFetch<CommissionRunRow>(`sales/commission-runs/${selectedId}/cancel`, {
      method: "POST",
      body: { reason: cancelReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
    await refreshAfterAction(selectedId, d.commissionsRunCancelledToast);
  }

  // -- per-rep rules -------------------------------------------------------------------------

  async function pickRuleRep(repId: string): Promise<void> {
    setRuleRepId(repId);
    setRule(null);
    if (repId === "") return;
    setRuleLoading(true);
    const result = await bffFetch<RepCommissionRuleRow>(`sales/reps/${repId}/commission-rule`);
    setRuleLoading(false);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRule(result.data);
    setRuleMethod(result.data.method);
    setRuleBasis(result.data.basis);
    // A tiered rule shows an empty rate (the bands carry the math); a flat
    // rule pre-fills its rate — NONE stays empty.
    setRuleRate(result.data.tiers === null ? trimRate(result.data.rate) : "");
  }

  function trimRate(rate: string): string {
    return rate === "0.0000" ? "" : rate.replace(/\.?0+$/, "");
  }

  async function saveRule(): Promise<void> {
    if (rule === null || !ruleReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("rule");
    setError(null);
    const method = ruleMethod;
    const rate = ruleRate.trim();
    // Flat rate entered → replaces tier bands; empty rate with a tiered rule
    // → the bands ride along unchanged; NONE clears everything.
    const payload =
      method === "NONE"
        ? { method, rate: null, basis: ruleBasis, tiers: null }
        : rate !== ""
          ? { method, rate, basis: ruleBasis, tiers: null }
          : { method, rate: null, basis: ruleBasis, tiers: rule.tiers };
    const result = await bffFetch<RepCommissionRuleRow>(
      `sales/reps/${ruleRepId}/commission-rule`,
      { method: "PUT", body: payload },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCommissionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRule(result.data);
    setRuleMethod(result.data.method);
    setRuleBasis(result.data.basis);
    setRuleRate(result.data.tiers === null ? trimRate(result.data.rate) : "");
    setNotice(
      formatMessage(d.commissionsRuleSavedToast, {
        rep: repLabelById.get(ruleRepId)?.split(" · ")[0] ?? ruleRepId,
      }),
    );
  }

  // -- render --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.commissionsRunsTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.commissionsNewRun}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "from",
              header: activeLocaleHeader(d.commissionsPeriodFrom),
              accessor: (row) => row.periodFrom,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.periodFrom}
                </span>
              ),
            },
            {
              id: "to",
              header: activeLocaleHeader(d.commissionsPeriodTo),
              accessor: (row) => row.periodTo,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.periodTo}
                </span>
              ),
            },
            {
              id: "basis",
              header: activeLocaleHeader(d.commissionsBasis),
              accessor: (row) => row.basis,
            },
            {
              id: "base",
              header: activeLocaleHeader(d.commissionsTotalBase),
              accessor: (row) => row.totalBase,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.totalBase, 2)}
                </span>
              ),
            },
            {
              id: "commission",
              header: activeLocaleHeader(d.commissionsTotalCommission),
              accessor: (row) => row.totalCommission,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.totalCommission, 2)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "DRAFT" ? "primary" : undefined}>
                  {localizedCommissionStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => {
                void selectRun(row.id);
              },
            },
          ]}
          empty={{ title: d.commissionsEmpty }}
        />
      </Card>

      {detail !== null && (
        <Card
          title={`${d.commissionsDetail} · ${detail.periodFrom} → ${detail.periodTo} · ${localizedCommissionBasis(d, detail.basis)}`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={detail.status === "DRAFT" ? "primary" : undefined}>
                {localizedCommissionStatus(d, detail.status)}
              </Badge>
              <span className="text-sm text-gray-600">
                {d.commissionsTotalBase}:{" "}
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(detail.totalBase, 2)}
                </span>
              </span>
              <span className="text-sm text-gray-600">
                {d.commissionsTotalCommission}:{" "}
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(detail.totalCommission, 2)}
                </span>
              </span>
            </div>

            <DataTable
              columns={[
                {
                  id: "rep",
                  header: activeLocaleHeader(d.commissionsRep),
                  accessor: (row) => `${row.repCode} ${row.repName}`,
                  sortable: true,
                },
                {
                  id: "base",
                  header: activeLocaleHeader(d.commissionsBase),
                  accessor: (row) => row.baseAmount,
                  numeric: true,
                  render: (row) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(row.baseAmount, 2)}
                    </span>
                  ),
                },
                {
                  id: "rate",
                  header: activeLocaleHeader(d.commissionsRate),
                  accessor: (row) => row.rateApplied,
                  numeric: true,
                  render: (row) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(row.rateApplied, 2)}%
                    </span>
                  ),
                },
                {
                  id: "amount",
                  header: activeLocaleHeader(d.commissionsAmount),
                  accessor: (row) => row.commissionAmount,
                  numeric: true,
                  render: (row) =>
                    isExcluded(row) ? (
                      <Badge>{d.commissionsExcluded}</Badge>
                    ) : (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.commissionAmount, 2)}
                      </span>
                    ),
                },
                {
                  id: "payout",
                  header: activeLocaleHeader(d.commissionsPayout),
                  accessor: (row) => row.payoutStatus,
                  render: (row) => (
                    <Badge tone={row.payoutStatus === "ACCRUED" ? "primary" : undefined}>
                      {localizedPayoutStatus(d, row.payoutStatus)}
                    </Badge>
                  ),
                },
              ]}
              rows={[...detail.lines]}
              rowKey={(row) => row.id}
              empty={{ title: d.commissionsNoLines }}
            />

            <div className="flex flex-wrap gap-2">
              {detail.status === "DRAFT" && (
                <>
                  <Button variant="primary" loading={busy === "post"} onClick={() => void postRun()}>
                    {d.commissionsPostRun}
                  </Button>
                  <Button variant="danger" onClick={() => setCancelOpen(true)}>
                    {d.commissionsCancelRun}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setDetail(null);
                  setSelectedId(null);
                }}
              >
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {detailLoading && selectedId !== null && detail === null && (
        <Card title={d.commissionsDetail}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      <Card title={d.commissionsRulesTitle} description={d.commissionsRulesHint}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={d.commissionsRuleRep}
              value={ruleRepId}
              onValueChange={(value) => void pickRuleRep(value)}
              placeholder="—"
              options={reps
                .filter((rep) => rep.status === "ACTIVE")
                .map((rep) => ({
                  value: rep.id,
                  label: repLabelById.get(rep.id) ?? rep.code,
                }))}
            />
          </div>

          {ruleLoading && <p className="text-sm text-gray-500">…</p>}

          {rule !== null && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Select
                  label={d.commissionsRuleMethod}
                  value={ruleMethod}
                  onValueChange={(value) => setRuleMethod(value === "PERCENTAGE" ? "PERCENTAGE" : "NONE")}
                  options={[
                    { value: "NONE", label: d.commissionsMethodNone },
                    { value: "PERCENTAGE", label: d.commissionsMethodPercentage },
                  ]}
                />
                <Input
                  label={d.commissionsRuleRate}
                  value={ruleRate}
                  onValueChange={setRuleRate}
                  hint={ruleMethod === "NONE" ? undefined : d.commissionsRuleRateHint}
                  error={ruleRate !== "" && !rateValid ? d.errorsValidation : undefined}
                  inputMode="decimal"
                  mono
                  bidiIsolate
                  disabled={ruleMethod === "NONE"}
                />
                <Select
                  label={d.commissionsRuleBasis}
                  value={ruleBasis}
                  onValueChange={(value) => setRuleBasis(value === "COLLECTED" ? "COLLECTED" : "INVOICED")}
                  options={[
                    { value: "INVOICED", label: localizedCommissionBasis(d, "INVOICED") },
                    { value: "COLLECTED", label: localizedCommissionBasis(d, "COLLECTED") },
                  ]}
                />
              </div>

              {rule.tiers !== null && rule.tiers.length > 0 && (
                <div className="rounded-md border border-subtle bg-surface-sunken p-3">
                  <p className="text-sm font-semibold text-gray-900">{d.commissionsRuleTiers}</p>
                  <p className="text-xs text-gray-600">{d.commissionsRuleTiersHint}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {rule.tiers.map((band, index) => (
                      <Badge key={`${band.upTo ?? "open"}-${index}`} tone="primary">
                        <span dir="ltr">
                          {band.upTo === null ? "∞" : `≤ ${band.upTo}`}: {band.rate}%
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Button
                  variant="primary"
                  loading={busy === "rule"}
                  disabled={!ruleReady}
                  onClick={() => void saveRule()}
                >
                  {d.commonSave}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* -- create run dialog -------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.commissionsNewRun}>
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            locale={locale}
            label={d.commissionsPeriodFrom}
            value={periodFrom}
            onSelect={setPeriodFrom}
            required
          />
          <DatePicker
            locale={locale}
            label={d.commissionsPeriodTo}
            value={periodTo}
            onSelect={setPeriodTo}
            min={periodFrom === "" ? undefined : periodFrom}
            required
          />
          <Select
            label={d.commissionsBasis}
            value={basis}
            onValueChange={(value) => setBasis(value === "COLLECTED" ? "COLLECTED" : "INVOICED")}
            options={[
              { value: "INVOICED", label: localizedCommissionBasis(d, "INVOICED") },
              { value: "COLLECTED", label: localizedCommissionBasis(d, "COLLECTED") },
            ]}
            required
          />
        </div>
        {periodFrom !== "" && periodTo !== "" && !periodSane && (
          <p className="mt-2 text-xs text-danger-700" role="alert">
            {d.errorsValidation}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!periodSane}
            onClick={() => void createRun()}
          >
            {d.commissionsNewRun}
          </Button>
        </div>
      </Dialog>

      {/* -- cancel run dialog -------------------------------------------------- */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={d.commissionsCancelRun}>
        <Input
          label={d.commissionsCancelReason}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "cancel"}
            disabled={cancelReason.trim() === ""}
            onClick={() => void cancelRun()}
          >
            {d.commissionsCancelRun}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
