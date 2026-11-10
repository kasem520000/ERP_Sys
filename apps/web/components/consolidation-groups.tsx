"use client";

/**
 * PHASE-034 (T11) — the consolidation groups hub surface: the group cards
 * (status badge, base currency, FX method) + the create-group dialog
 * (name/nameAr, base currency ISO3, FX translation method — the API's own
 * create contract) + the recent-runs strip (status badges; period labels
 * degrade to raw ids when the fiscal-calendar route is not granted). The hub
 * is configuration-only — money surfaces live in eliminations + runs.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  FiscalPeriodRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { LinkButton } from "./link-button";
import { activeLocaleHeader } from "./table-header";

/** The create contract's sanctioned currency set (ISO3, manual pick). */
const CURRENCY_OPTIONS = ["SAR", "USD", "EUR", "AED", "GBP", "KWD"] as const;

/** Run status → localized label (the module's own vocabulary). */
export function runStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    QUEUED: d.consolidationRunStatusQueued,
    RUNNING: d.consolidationRunStatusRunning,
    COMPLETED: d.consolidationRunStatusCompleted,
    FAILED: d.consolidationRunStatusFailed,
  };
  return map[status] ?? status;
}

export function ConsolidationGroups({
  locale,
  initialGroups,
  initialRuns,
  periods,
}: {
  locale: Locale;
  initialGroups: readonly ConsolidationGroupRow[];
  initialRuns: readonly ConsolidationRunRow[];
  periods: readonly FiscalPeriodRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [groups, setGroups] = useState<readonly ConsolidationGroupRow[]>(initialGroups);
  const [runs] = useState<readonly ConsolidationRunRow[]>(initialRuns);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [baseCurrency, setBaseCurrency] = useState<string>("SAR");
  const [fxTranslationMethod, setFxTranslationMethod] = useState<string>("CLOSING_RATE");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");

  const periodLabel = useCallback(
    (id: string): string => {
      const period = periods.find((row) => row.id === id);
      return period === undefined ? id : `${period.name} (${period.startDate} → ${period.endDate})`;
    },
    [periods],
  );

  const groupName = useCallback(
    (id: string): string => {
      const group = groups.find((entry) => entry.id === id);
      return group === undefined ? id : localizedName(group.name, group.nameAr, locale);
    },
    [groups, locale],
  );

  // After a create the group list re-fetches through the BFF (the registry
  // snapshot the server rendered stays the initial state).
  async function createGroup(): Promise<void> {
    setError(null);
    if (name.trim() === "" || nameAr.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      nameAr: nameAr.trim(),
      baseCurrency,
      fxTranslationMethod,
    };
    if (note.trim() !== "") body.note = note.trim();
    if (noteAr.trim() !== "") body.noteAr = noteAr.trim();
    const created = await bffFetch<ConsolidationGroupRow>("consolidation/groups", {
      method: "POST",
      body,
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedApiError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setName("");
    setNameAr("");
    setBaseCurrency("SAR");
    setFxTranslationMethod("CLOSING_RATE");
    setNote("");
    setNoteAr("");
    setNotice(d.consolidationGroupCreateToast);
    const refreshed = await bffFetch<readonly ConsolidationGroupRow[]>("consolidation/groups");
    if (refreshed.ok) {
      setGroups(refreshed.data);
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={`/${locale}/consolidation/eliminations`} variant="secondary">
          {d.consolidationViewEliminations}
        </LinkButton>
        <LinkButton href={`/${locale}/consolidation/runs`} variant="secondary">
          {d.consolidationViewRuns}
        </LinkButton>
        <LinkButton href={`/${locale}/consolidation/eliminations/new`} variant="primary">
          {d.consolidationNewElimination}
        </LinkButton>
      </div>
      <p className="text-sm text-gray-600">{d.consolidationHubHint}</p>

      <Card
        title={d.consolidationGroupsNav}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            {d.consolidationNewGroupButton}
          </Button>
        }
      >
        {groups.length === 0 ? (
          <p className="text-sm text-gray-600">{d.consolidationEmptyGroups}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li
                key={group.id}
                className="flex flex-col gap-2 rounded-md border border-subtle bg-surface-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/${locale}/consolidation/groups/${group.id}`}
                      className="font-medium text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                    >
                      {localizedName(group.name, group.nameAr, locale)}
                    </a>
                    <Badge tone={group.status === "ACTIVE" ? "primary" : "neutral"} bidiIsolate>
                      {group.status === "ACTIVE"
                        ? d.consolidationStatusActive
                        : d.consolidationStatusArchived}
                    </Badge>
                    <Badge tone="neutral" mono bidiIsolate>
                      {group.baseCurrency}
                    </Badge>
                  </span>
                  <span className="text-xs text-gray-600">
                    {group.fxTranslationMethod === "CLOSING_RATE"
                      ? d.consolidationFxMethodClosingRate
                      : d.consolidationFxMethodTemporary}
                  </span>
                  {group.note !== null && group.note !== "" && (
                    <span className="truncate text-xs text-gray-500">{group.note}</span>
                  )}
                </div>
                <LinkButton href={`/${locale}/consolidation/groups/${group.id}`} variant="secondary">
                  {d.commonOpen}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={d.consolidationRecentRunsCard}>
        <DataTable
          columns={[
            {
              id: "group",
              header: activeLocaleHeader(d.consolidationColGroup),
              accessor: (row) => groupName(row.groupId),
              render: (row) => <span className="truncate">{groupName(row.groupId)}</span>,
            },
            {
              id: "period",
              header: activeLocaleHeader(d.consolidationFiscalPeriod),
              accessor: (row) => periodLabel(row.fiscalPeriodId),
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {periodLabel(row.fiscalPeriodId)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "COMPLETED" ? "primary" : "neutral"}>
                  {runStatusLabel(d, row.status)}
                </Badge>
              ),
            },
            {
              id: "created",
              header: activeLocaleHeader(d.consolidationColCreated),
              accessor: (row) => row.createdAt,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          empty={{ title: d.consolidationRunsEmpty }}
        />
        <p className="mt-3 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={d.consolidationCreateGroupTitle}
        size="md"
      >
        <div className="flex flex-col gap-3">
          <Input
            id="consolidation-group-name"
            label={d.consolidationGroupName}
            value={name}
            onValueChange={setName}
            required
          />
          <Input
            id="consolidation-group-name-ar"
            label={d.consolidationGroupNameAr}
            value={nameAr}
            onValueChange={setNameAr}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              id="consolidation-group-currency"
              label={d.consolidationGroupBaseCurrency}
              value={baseCurrency}
              onValueChange={setBaseCurrency}
              options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
            />
            <Select
              id="consolidation-group-fx"
              label={d.consolidationGroupFxMethod}
              value={fxTranslationMethod}
              onValueChange={setFxTranslationMethod}
              options={[
                { value: "CLOSING_RATE", label: d.consolidationFxMethodClosingRate },
                { value: "TEMPORARY", label: d.consolidationFxMethodTemporary },
              ]}
            />
          </div>
          <Input
            id="consolidation-group-note"
            label={d.consolidationNoteEn}
            value={note}
            onValueChange={setNote}
          />
          <Input
            id="consolidation-group-note-ar"
            label={d.consolidationNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void createGroup()} loading={busy}>
              {d.commonCreate}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
