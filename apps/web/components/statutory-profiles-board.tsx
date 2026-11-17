"use client";

/**
 * PHASE-046 (W-5, T-10 — D-16) — the statutory compliance board
 * (PAGE_ARCHETYPES §2 List+Search, the hr-leave-board pattern): THREE
 * TABS — contribution profiles / PIT brackets / EOSB tiers — every row
 * with its verification badge (VERIFIED / REQUIRES_VERIFICATION /
 * RETIRED), the effective-dates window, and the citation the badge rests
 * on. THE VERIFY ACT: the button renders only when the session holds
 * payroll.statutory.verify (the runtime check — the key is owner-only by
 * seed, the act unblocks legal postings); the citation body
 * {sourceName, sourceRef?} is mandatory (the 0089 VERIFIED⟺source law —
 * a bare assertion never flips a row). Reads are read-only (BR-086's
 * read family); the jurisdiction filter narrows client-side (the lists
 * are the tenant's own small sets).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  Tabs,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EosbRuleManagementRow,
  PitBracketManagementRow,
  StatutoryProfileManagementRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type StatutoryStatus = "REQUIRES_VERIFICATION" | "VERIFIED" | "RETIRED";

function statusBadge(
  d: ReturnType<typeof getDictionary>,
  status: StatutoryStatus,
): JSX.Element {
  if (status === "VERIFIED") {
    return <Badge tone="primary">{d.payStatutoryStatusVerified}</Badge>;
  }
  if (status === "REQUIRES_VERIFICATION") {
    return <Badge>{d.payStatutoryStatusRequiresVerification}</Badge>;
  }
  return <Badge>{d.payStatutoryStatusRetired}</Badge>;
}

function appliesToLabel(
  d: ReturnType<typeof getDictionary>,
  appliesTo: string,
): string {
  if (appliesTo === "CITIZEN") return d.payStatutoryAppliesCitizen;
  if (appliesTo === "NON_CITIZEN") return d.payStatutoryAppliesNonCitizen;
  return d.payStatutoryAppliesAll;
}

export function StatutoryProfilesBoard({
  locale,
  initialProfiles,
  initialBrackets,
  initialRules,
  canVerify,
}: {
  locale: Locale;
  initialProfiles: readonly StatutoryProfileManagementRow[];
  initialBrackets: readonly PitBracketManagementRow[];
  initialRules: readonly EosbRuleManagementRow[];
  /** The session's payroll.statutory.verify — the verify button's gate. */
  canVerify: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState("profiles");
  const [profiles, setProfiles] = useState<readonly StatutoryProfileManagementRow[]>(initialProfiles);
  const [brackets] = useState<readonly PitBracketManagementRow[]>(initialBrackets);
  const [rules] = useState<readonly EosbRuleManagementRow[]>(initialRules);
  const [jurisdiction, setJurisdiction] = useState("");
  const [sort, setSort] = useState<DataTableSort[]>([]);

  // The verify dialog (one row at a time; the citation is mandatory).
  const [verifyRow, setVerifyRow] = useState<StatutoryProfileManagementRow | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const jurisdictions = useMemo(() => {
    const set = new Set<string>();
    for (const row of profiles) set.add(row.jurisdictionCode);
    for (const row of brackets) set.add(row.jurisdictionCode);
    for (const row of rules) set.add(row.jurisdictionCode);
    return [...set].sort();
  }, [profiles, brackets, rules]);

  const shownProfiles = useMemo(
    () => (jurisdiction === "" ? profiles : profiles.filter((row) => row.jurisdictionCode === jurisdiction)),
    [profiles, jurisdiction],
  );
  const shownBrackets = useMemo(
    () => (jurisdiction === "" ? brackets : brackets.filter((row) => row.jurisdictionCode === jurisdiction)),
    [brackets, jurisdiction],
  );
  const shownRules = useMemo(
    () => (jurisdiction === "" ? rules : rules.filter((row) => row.jurisdictionCode === jurisdiction)),
    [rules, jurisdiction],
  );

  const unverifiedVisible =
    tab === "profiles"
      ? shownProfiles.some((row) => row.status === "REQUIRES_VERIFICATION")
      : tab === "brackets"
        ? shownBrackets.some((row) => row.status === "REQUIRES_VERIFICATION")
        : shownRules.some((row) => row.status === "REQUIRES_VERIFICATION");

  async function confirmVerify(): Promise<void> {
    if (verifyRow === null) return;
    if (sourceName.trim() === "") {
      setVerifyError(d.payStatutoryVerifySourceName);
      return;
    }
    setVerifyBusy(true);
    setVerifyError(null);
    const result = await bffFetch("payroll/statutory/profiles/" + verifyRow.id + "/verify", {
      method: "POST",
      body: {
        sourceName: sourceName.trim(),
        sourceRef: sourceRef.trim() === "" ? undefined : sourceRef.trim(),
      },
    });
    setVerifyBusy(false);
    if (!result.ok) {
      setVerifyError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const flipped = verifyRow;
    setProfiles((rows) =>
      rows.map((row) =>
        row.id === flipped.id
          ? {
              ...row,
              status: "VERIFIED" as const,
              sourceName: sourceName.trim(),
              sourceRef: sourceRef.trim() === "" ? null : sourceRef.trim(),
              verifiedAt: new Date().toISOString(),
            }
          : row,
      ),
    );
    setVerifyRow(null);
    setSourceName("");
    setSourceRef("");
    toast({ tone: "success", title: d.payStatutoryVerifyToast });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{d.payStatutorySubtitle}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={jurisdiction}
          onValueChange={(value) => setJurisdiction(value ?? "")}
          options={[
            { value: "", label: d.payStatutoryAppliesAll },
            ...jurisdictions.map((code) => ({ value: code, label: code })),
          ]}
        />
      </div>

      {unverifiedVisible ? (
        <InfoNotice>{d.payStatutoryBlockedHint}</InfoNotice>
      ) : null}
      {!canVerify && unverifiedVisible ? (
        <InfoNotice>{d.payStatutoryVerifyNoPermission}</InfoNotice>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "profiles", label: d.payStatutoryTabProfiles },
          { value: "brackets", label: d.payStatutoryTabBrackets },
          { value: "eosb", label: d.payStatutoryTabEosb },
        ]}
      >
        <div data-slot="profiles">
          <Card>
            {shownProfiles.length === 0 ? (
              <InfoNotice>{d.payStatutoryEmpty}</InfoNotice>
            ) : (
              <DataTable
                rows={[...shownProfiles]}
                rowKey={(row) => row.id}
                sort={sort}
                onSortChange={setSort}
                columns={[
                  {
                    id: "jurisdiction",
                    header: activeLocaleHeader(d.payStatutoryJurisdiction),
                    accessor: (row) => row.jurisdictionCode,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.jurisdictionCode}
                      </span>
                    ),
                  },
                  {
                    id: "code",
                    header: activeLocaleHeader(d.payStatutoryCode),
                    accessor: (row) => row.code,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.code}
                      </span>
                    ),
                  },
                  {
                    id: "name",
                    header: activeLocaleHeader(d.payStatutoryName),
                    accessor: (row) => localizedName(row.name, row.nameAr, locale),
                  },
                  {
                    id: "employeeRate",
                    header: activeLocaleHeader(d.payStatutoryEmployeeRate),
                    accessor: (row) => row.employeeRate,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.employeeRate}
                      </span>
                    ),
                  },
                  {
                    id: "employerRate",
                    header: activeLocaleHeader(d.payStatutoryEmployerRate),
                    accessor: (row) => row.employerRate,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.employerRate}
                      </span>
                    ),
                  },
                  {
                    id: "base",
                    header: activeLocaleHeader(d.payStatutoryBaseMin),
                    accessor: (row) => row.baseMin ?? "",
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {(row.baseMin ?? "—") + " … " + (row.baseMax ?? "∞")}
                      </span>
                    ),
                  },
                  {
                    id: "appliesTo",
                    header: activeLocaleHeader(d.payStatutoryAppliesTo),
                    accessor: (row) => row.appliesTo,
                    render: (row) => appliesToLabel(d, row.appliesTo),
                  },
                  {
                    id: "effective",
                    header: activeLocaleHeader(d.payStatutoryEffectiveFrom),
                    accessor: (row) => row.effectiveFrom,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.effectiveFrom} → {row.effectiveTo ?? d.payStatutoryEffectiveOpen}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.payStatutoryStatus),
                    accessor: (row) => row.status,
                    render: (row) => statusBadge(d, row.status),
                  },
                  {
                    id: "source",
                    header: activeLocaleHeader(d.payStatutorySource),
                    accessor: (row) => row.sourceName ?? "",
                    render: (row) =>
                      row.sourceName === null ? (
                        <span>—</span>
                      ) : (
                        <span className="text-sm">
                          {row.sourceName}
                          {row.sourceRef !== null ? (
                            <span className="font-mono text-xs" dir="ltr">
                              {" · " + row.sourceRef}
                            </span>
                          ) : null}
                        </span>
                      ),
                  },
                  {
                    id: "actions",
                    header: activeLocaleHeader(d.payStatutoryVerify),
                    accessor: (row) => row.status,
                    render: (row) =>
                      row.status === "REQUIRES_VERIFICATION" && canVerify ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setVerifyRow(row);
                            setVerifyError(null);
                          }}
                        >
                          {d.payStatutoryVerify}
                        </Button>
                      ) : (
                        <span>—</span>
                      ),
                  },
                ]}
              />
            )}
          </Card>
        </div>

        <div data-slot="brackets">
          <Card>
            {shownBrackets.length === 0 ? (
              <InfoNotice>{d.payStatutoryEmpty}</InfoNotice>
            ) : (
              <DataTable
                rows={[...shownBrackets]}
                rowKey={(row) => row.id}
                sort={sort}
                onSortChange={setSort}
                columns={[
                  {
                    id: "jurisdiction",
                    header: activeLocaleHeader(d.payStatutoryJurisdiction),
                    accessor: (row) => row.jurisdictionCode,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.jurisdictionCode}
                      </span>
                    ),
                  },
                  {
                    id: "code",
                    header: activeLocaleHeader(d.payStatutoryCode),
                    accessor: (row) => row.code,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.code}
                      </span>
                    ),
                  },
                  {
                    id: "floor",
                    header: activeLocaleHeader(d.payStatutoryBracketFloor),
                    accessor: (row) => row.floor,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.floor}
                      </span>
                    ),
                  },
                  {
                    id: "ceiling",
                    header: activeLocaleHeader(d.payStatutoryBracketCeiling),
                    accessor: (row) => row.ceiling ?? "",
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.ceiling ?? d.payStatutoryBracketCeilingOpen}
                      </span>
                    ),
                  },
                  {
                    id: "rate",
                    header: activeLocaleHeader(d.payStatutoryBracketRate),
                    accessor: (row) => row.rate,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.rate}
                      </span>
                    ),
                  },
                  {
                    id: "personal",
                    header: activeLocaleHeader(d.payStatutoryBracketPersonalAllowance),
                    accessor: (row) => row.personalAllowanceDefault,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.personalAllowanceDefault}
                      </span>
                    ),
                  },
                  {
                    id: "dependent",
                    header: activeLocaleHeader(d.payStatutoryBracketDependentAllowance),
                    accessor: (row) => row.perDependentAllowance,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.perDependentAllowance}
                      </span>
                    ),
                  },
                  {
                    id: "effective",
                    header: activeLocaleHeader(d.payStatutoryEffectiveFrom),
                    accessor: (row) => row.effectiveFrom,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.effectiveFrom} → {row.effectiveTo ?? d.payStatutoryEffectiveOpen}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.payStatutoryStatus),
                    accessor: (row) => row.status,
                    render: (row) => statusBadge(d, row.status),
                  },
                ]}
              />
            )}
          </Card>
        </div>

        <div data-slot="eosb">
          <Card>
            {shownRules.length === 0 ? (
              <InfoNotice>{d.payStatutoryEmpty}</InfoNotice>
            ) : (
              <DataTable
                rows={[...shownRules]}
                rowKey={(row) => row.id}
                sort={sort}
                onSortChange={setSort}
                columns={[
                  {
                    id: "jurisdiction",
                    header: activeLocaleHeader(d.payStatutoryJurisdiction),
                    accessor: (row) => row.jurisdictionCode,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.jurisdictionCode}
                      </span>
                    ),
                  },
                  {
                    id: "fromYears",
                    header: activeLocaleHeader(d.payStatutoryEosbFromYears),
                    accessor: (row) => row.fromYears,
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.fromYears}
                      </span>
                    ),
                  },
                  {
                    id: "toYears",
                    header: activeLocaleHeader(d.payStatutoryEosbToYears),
                    accessor: (row) => row.toYears ?? "",
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.toYears ?? d.payStatutoryEosbToYearsOpen}
                      </span>
                    ),
                  },
                  {
                    id: "daysPerYear",
                    header: activeLocaleHeader(d.payStatutoryEosbDaysPerYear),
                    accessor: (row) => row.daysPerYear,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.daysPerYear}
                      </span>
                    ),
                  },
                  {
                    id: "contractType",
                    header: activeLocaleHeader(d.payStatutoryEosbContractType),
                    accessor: (row) => row.contractType ?? "",
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.contractType ?? d.payStatutoryEosbContractAll}
                      </span>
                    ),
                  },
                  {
                    id: "effective",
                    header: activeLocaleHeader(d.payStatutoryEffectiveFrom),
                    accessor: (row) => row.effectiveFrom,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.effectiveFrom} → {row.effectiveTo ?? d.payStatutoryEffectiveOpen}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.payStatutoryStatus),
                    accessor: (row) => row.status,
                    render: (row) => statusBadge(d, row.status),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      </Tabs>

      <Dialog
        open={verifyRow !== null}
        onOpenChange={(open) => {
          if (!open) setVerifyRow(null);
        }}
        title={d.payStatutoryVerifyTitle}
        description={
          verifyRow === null ? undefined : (
            <span className="font-mono text-sm" dir="ltr">
              {verifyRow.jurisdictionCode} / {verifyRow.code}
            </span>
          )
        }
      >
        <div className="space-y-3">
          <Input
            id="verify-source-name"
            label={d.payStatutoryVerifySourceName}
            value={sourceName}
            onValueChange={setSourceName}
            required
          />
          <Input
            id="verify-source-ref"
            label={d.payStatutoryVerifySourceRef}
            hint={d.payStatutoryVerifySourceRefHint}
            value={sourceRef}
            onValueChange={setSourceRef}
          />
          {verifyError !== null ? <ErrorNotice>{verifyError}</ErrorNotice> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVerifyRow(null)}>
              {d.commonCancel}
            </Button>
            <Button onClick={() => void confirmVerify()} loading={verifyBusy}>
              {d.payStatutoryVerifyConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
