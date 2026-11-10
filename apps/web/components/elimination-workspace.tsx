"use client";

/**
 * PHASE-034 (T11) — the elimination Transaction Entry workspace
 * (PAGE_ARCHETYPES §4, the journal-workspace pattern): group + fiscal period
 * + kind picks; INTERCOMPANY reveals the member-pair uuid inputs (the group's
 * ACTIVE members list offers keyboard-fill buttons — no fabricated tenant
 * registry this phase) and the on-demand reader suggestions (endpoint 14);
 * the lines editor rides the kind's sanctioned purposes (AR_CONTROL /
 * AP_CONTROL · CONSOLIDATION_ADJUSTMENT) with the LIVE balanced DR/CR preview
 * (string-safe decimal addition via sumExact — never floats, ADR-0009).
 * Submit creates the DRAFT; the created row then carries the lifecycle:
 * approve (SoD — a SECOND user approves; the creator is blocked), post
 * (confirm dialog → the parent's consolidation books), reverse (posted rows
 * only → a NEW DRAFT counter-entry).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DatePicker,
  Dialog,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  EliminationRow,
  FiscalPeriodRow,
  GroupMemberRow,
  IntercompanySuggestionRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { compareExact, sumExact } from "../lib/exact-money";
import { formatMessage, localizedName, localizedApiError, localizedDocumentStatus } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

type EliminationKind = "INTERCOMPANY" | "INVESTMENT_EQUITY";

/** One authoring line (the member pick maps to the pair's uuid on submit). */
interface LineDraft {
  purposeKey: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  member: "A" | "B" | "";
  memoEn: string;
  memoAr: string;
}

function emptyLine(kind: EliminationKind): LineDraft {
  return {
    purposeKey: kind === "INTERCOMPANY" ? "AR_CONTROL" : "CONSOLIDATION_ADJUSTMENT",
    direction: "DEBIT",
    amount: "",
    member: "",
    memoEn: "",
    memoAr: "",
  };
}

/** The live balanced tie chip (the sales-ar SubledgerTieChip pattern). */
function BalancedChip({ balanced, okLabel, brokenLabel }: { balanced: boolean; okLabel: string; brokenLabel: string }): JSX.Element {
  const style = balanced
    ? "border-success-border bg-success-bg text-success-text"
    : "border-danger-border bg-danger-bg text-danger-text";
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${style}`}>
      {balanced ? okLabel : brokenLabel}
    </span>
  );
}

export function EliminationWorkspace({
  locale,
  groups,
  periods,
  initialGroupId,
  today,
}: {
  locale: Locale;
  groups: readonly ConsolidationGroupRow[];
  periods: readonly FiscalPeriodRow[];
  initialGroupId: string;
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [fiscalPeriodId, setFiscalPeriodId] = useState("");
  const [kind, setKind] = useState<string>("INTERCOMPANY");
  const [memberA, setMemberA] = useState("");
  const [memberB, setMemberB] = useState("");
  const [members, setMembers] = useState<readonly GroupMemberRow[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine("INTERCOMPANY"), emptyLine("INTERCOMPANY")]);
  const [suggestions, setSuggestions] = useState<readonly IntercompanySuggestionRow[] | null>(null);
  const [asOf, setAsOf] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<EliminationRow | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [reverseNote, setReverseNote] = useState("");

  const isIntercompany = kind === "INTERCOMPANY";
  const selectedGroup = groups.find((group) => group.id === groupId);
  const currency = selectedGroup?.baseCurrency ?? "SAR";

  const purposeOptions = useMemo(
    () =>
      isIntercompany
        ? [
            { value: "AR_CONTROL", label: d.eliminationsPurposeArControl },
            { value: "AP_CONTROL", label: d.eliminationsPurposeApControl },
          ]
        : [{ value: "CONSOLIDATION_ADJUSTMENT", label: d.eliminationsPurposeConsolidationAdjustment }],
    [isIntercompany, d],
  );

  // The selected group's members load on demand (the workspace's pair-fill
  // list + the honest uuid reference); a 403 degrades to an empty list.
  const loadMembers = useCallback(
    async (id: string): Promise<void> => {
      if (id === "") {
        setMembers([]);
        return;
      }
      const fetched = await bffFetch<readonly GroupMemberRow[]>(`consolidation/groups/${id}/members`);
      if (!fetched.ok) {
        setMembers([]);
        setMembersError(localizedApiError(d, fetched.error, fetched.retryAfterSeconds));
        return;
      }
      setMembersError(null);
      setMembers(fetched.data);
    },
    [d],
  );

  useEffect(() => {
    void loadMembers(groupId);
  }, [groupId, loadMembers]);

  function onKindChange(next: string): void {
    setKind(next);
    setLines([emptyLine(next as EliminationKind), emptyLine(next as EliminationKind)]);
    setSuggestions(null);
  }

  function setLine(index: number, patch: Partial<LineDraft>): void {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const debitTotal = useMemo(
    () => sumExact(lines.filter((line) => line.direction === "DEBIT").map((line) => line.amount)),
    [lines],
  );
  const creditTotal = useMemo(
    () => sumExact(lines.filter((line) => line.direction === "CREDIT").map((line) => line.amount)),
    [lines],
  );
  const balanced = compareExact(debitTotal, creditTotal) === 0;

  const amountValid = useCallback(
    (value: string): boolean => MONEY_RE.test(value.trim()) && compareExact(value.trim(), "0") > 0,
    [],
  );

  const canSubmit = useMemo(() => {
    if (groupId === "" || fiscalPeriodId === "" || description.trim() === "") {
      return false;
    }
    if (lines.length === 0 || !balanced) {
      return false;
    }
    if (!lines.every((line) => purposeOptions.some((option) => option.value === line.purposeKey))) {
      return false;
    }
    if (!lines.every((line) => amountValid(line.amount))) {
      return false;
    }
    if (isIntercompany) {
      const a = memberA.trim();
      const b = memberB.trim();
      if (!UUID_RE.test(a) || !UUID_RE.test(b) || a === b) {
        return false;
      }
      if (!lines.some((line) => line.member === "A") || !lines.some((line) => line.member === "B")) {
        return false;
      }
    }
    return true;
  }, [groupId, fiscalPeriodId, description, lines, balanced, purposeOptions, amountValid, isIntercompany, memberA, memberB]);

  async function loadSuggestions(): Promise<void> {
    setError(null);
    const a = memberA.trim();
    if (groupId === "" || !UUID_RE.test(a)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("suggestions");
    const fetched = await bffFetch<readonly IntercompanySuggestionRow[]>(
      `consolidation/groups/${groupId}/intercompany-suggestions?memberTenantId=${a}&asOf=${asOf}`,
    );
    setBusy(null);
    if (!fetched.ok) {
      setError(localizedApiError(d, fetched.error, fetched.retryAfterSeconds));
      return;
    }
    setSuggestions(fetched.data);
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!canSubmit) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("submit");
    const a = memberA.trim();
    const b = memberB.trim();
    const body: Record<string, unknown> = {
      groupId,
      fiscalPeriodId,
      kind,
      description: description.trim(),
      memberATenantId: isIntercompany ? a : null,
      memberBTenantId: isIntercompany ? b : null,
      lines: lines.map((line) => ({
        purposeKey: line.purposeKey,
        direction: line.direction,
        amount: line.amount.trim(),
        memberTenantId: isIntercompany
          ? line.member === "A"
            ? a
            : line.member === "B"
              ? b
              : null
          : null,
        memoEn: line.memoEn.trim() === "" ? undefined : line.memoEn.trim(),
        memoAr: line.memoAr.trim() === "" ? undefined : line.memoAr.trim(),
      })),
    };
    if (note.trim() !== "") body.note = note.trim();
    if (noteAr.trim() !== "") body.noteAr = noteAr.trim();
    const result = await bffFetch<EliminationRow>("consolidation/eliminations", {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreated(result.data);
    setNotice(d.eliminationCreatedToast);
  }

  async function approve(): Promise<void> {
    if (created === null) {
      return;
    }
    setError(null);
    setBusy("approve");
    const approved = await bffFetch<EliminationRow>(
      `consolidation/eliminations/${created.id}/approve`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!approved.ok) {
      setError(localizedApiError(d, approved.error, approved.retryAfterSeconds));
      return;
    }
    setCreated(approved.data);
    setNotice(d.eliminationsApproveToast);
  }

  async function post(): Promise<void> {
    if (created === null) {
      return;
    }
    setPostOpen(false);
    setError(null);
    setBusy("post");
    const posted = await bffFetch<EliminationRow>(`consolidation/eliminations/${created.id}/post`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!posted.ok) {
      setError(localizedApiError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setCreated(posted.data);
    setNotice(
      formatMessage(d.eliminationsPostToast, {
        no: posted.data.eliminationNo ?? posted.data.id.slice(0, 8),
        entry: posted.data.journalEntryIds[0] ?? "—",
      }),
    );
  }

  async function reverse(): Promise<void> {
    if (created === null) {
      return;
    }
    setError(null);
    setBusy("reverse");
    const body: Record<string, unknown> = {};
    if (reverseNote.trim() !== "") body.note = reverseNote.trim();
    const reversed = await bffFetch<EliminationRow>(
      `consolidation/eliminations/${created.id}/reverse`,
      { method: "POST", body },
    );
    setBusy(null);
    setReverseNote("");
    if (!reversed.ok) {
      setError(localizedApiError(d, reversed.error, reversed.retryAfterSeconds));
      return;
    }
    setCreated(reversed.data); // the NEW reversal DRAFT (approve + post it like any elimination)
    setNotice(d.eliminationsReverseToast);
  }

  function resetWorkspace(): void {
    setCreated(null);
    setDescription("");
    setNote("");
    setNoteAr("");
    setLines([emptyLine(kind as EliminationKind), emptyLine(kind as EliminationKind)]);
    setSuggestions(null);
  }

  const createdDebit =
    created === null
      ? "0"
      : sumExact(created.lines.filter((line) => line.direction === "DEBIT").map((line) => line.amount));

  const periodOptions = useMemo(
    () =>
      periods.map((period) => ({
        value: period.id,
        label: `${period.name} · ${period.startDate} → ${period.endDate}`,
      })),
    [periods],
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {membersError !== null && isIntercompany && <InfoNotice>{membersError}</InfoNotice>}

      {created !== null && (
        <Card
          title={d.eliminationCreatedCard}
          description={created.description}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={created.status === "POSTED" ? "primary" : "neutral"}>
                {localizedDocumentStatus(d, created.status)}
              </Badge>
              {created.approvedAt !== null && <Badge tone="neutral">{d.eliminationsApprovedBadge}</Badge>}
              {created.eliminationNo !== null && (
                <Badge tone="neutral" mono bidiIsolate>
                  {created.eliminationNo}
                </Badge>
              )}
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLinePurpose}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLineDirection}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.instColAmount}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLineMember}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.eliminationsLineMemoEn}
                  </th>
                </tr>
              </thead>
              <tbody>
                {created.lines.map((line, index) => (
                  <tr key={`${created.id}-${index}`} className="border-b border-subtle/60">
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.purposeKey}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {line.direction === "DEBIT" ? d.accountingColDebit : d.accountingColCredit}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amount, 2)}{" "}
                      <span className="text-xs text-gray-500">{currency}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {line.memberTenantId === null ? "—" : line.memberTenantId.slice(0, 8)}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600">{line.memoEn || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-600">{d.eliminationsSodHint}</p>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
            {created.status === "DRAFT" && (
              <>
                <Button variant="secondary" onClick={() => void approve()} loading={busy === "approve"}>
                  {d.accountingApprove}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setPostOpen(true)}
                  loading={busy === "post"}
                  disabled={created.approvedAt === null}
                >
                  {d.accountingPost}
                </Button>
              </>
            )}
            {created.status === "POSTED" && (
              <Input
                id="elimination-reverse-note-inline"
                label={d.consolidationNoteEn}
                value={reverseNote}
                onValueChange={setReverseNote}
                className="w-64"
              />
            )}
            {created.status === "POSTED" && (
              <Button variant="danger" onClick={() => void reverse()} loading={busy === "reverse"}>
                {d.eliminationsReverseAction}
              </Button>
            )}
            <Button variant="ghost" onClick={resetWorkspace}>
              {d.consolidationNewElimination}
            </Button>
          </div>
        </Card>
      )}

      {created === null && (
        <>
          <Card title={d.consolidationNewElimination}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                id="elimination-group"
                label={d.consolidationColGroup}
                value={groupId}
                onValueChange={(value) => {
                  setGroupId(value);
                  setSuggestions(null);
                }}
                options={[
                  { value: "", label: "—" },
                  ...groups
                    .filter((group) => group.status === "ACTIVE")
                    .map((group) => ({
                      value: group.id,
                      label: `${localizedName(group.name, group.nameAr, locale)} · ${group.baseCurrency}`,
                    })),
                ]}
                required
              />
              <Select
                id="elimination-period"
                label={d.consolidationFiscalPeriod}
                value={fiscalPeriodId}
                onValueChange={setFiscalPeriodId}
                options={[{ value: "", label: "—" }, ...periodOptions]}
                required
              />
              <Select
                id="elimination-kind"
                label={d.eliminationFormKind}
                value={kind}
                onValueChange={onKindChange}
                options={[
                  { value: "INTERCOMPANY", label: d.eliminationsKindIntercompany },
                  { value: "INVESTMENT_EQUITY", label: d.eliminationsKindInvestmentEquity },
                ]}
                required
              />
              <Input
                id="elimination-description"
                label={d.eliminationsColDescription}
                value={description}
                onValueChange={setDescription}
                required
              />
              <Input
                id="elimination-note"
                label={d.consolidationNoteEn}
                value={note}
                onValueChange={setNote}
              />
              <Input
                id="elimination-note-ar"
                label={d.consolidationNoteAr}
                value={noteAr}
                onValueChange={setNoteAr}
              />
            </div>
            {selectedGroup !== undefined && (
              <p className="mt-2 text-xs text-gray-600">
                {d.consolidationGroupBaseCurrency}:{" "}
                <span className="font-mono" dir="ltr">
                  {selectedGroup.baseCurrency}
                </span>
              </p>
            )}
          </Card>

          {isIntercompany && (
            <Card title={d.eliminationsLineMember}>
              <p className="text-xs text-gray-600">{d.eliminationFormMemberHint}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Input
                  id="elimination-member-a"
                  label={d.eliminationFormMemberA}
                  value={memberA}
                  onValueChange={(value) => {
                    setMemberA(value);
                    setSuggestions(null);
                  }}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  mono
                  bidiIsolate
                  required
                />
                <Input
                  id="elimination-member-b"
                  label={d.eliminationFormMemberB}
                  value={memberB}
                  onValueChange={setMemberB}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  mono
                  bidiIsolate
                  required
                />
              </div>
              {members.filter((member) => member.status === "ACTIVE").length > 0 && (
                <div className="mt-3 flex flex-col gap-2 border-t border-subtle pt-3">
                  {members
                    .filter((member) => member.status === "ACTIVE")
                    .map((member) => (
                      <span
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-subtle px-2 py-1.5"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="font-mono text-xs" dir="ltr">
                            {member.memberTenantId}
                          </span>
                          <span className="text-xs text-gray-600">
                            {d.consolidationMemberOwnershipPercent}:{" "}
                            <span className="font-mono" dir="ltr">
                              {member.ownershipPercent}%
                            </span>
                          </span>
                        </span>
                        <span className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setMemberA(member.memberTenantId)}
                            aria-label={`${d.eliminationFormMemberA}: ${member.memberTenantId}`}
                          >
                            {d.eliminationFormMemberA}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setMemberB(member.memberTenantId)}
                            aria-label={`${d.eliminationFormMemberB}: ${member.memberTenantId}`}
                          >
                            {d.eliminationFormMemberB}
                          </Button>
                        </span>
                      </span>
                    ))}
                </div>
              )}
            </Card>
          )}

          {isIntercompany && (
            <Card title={d.eliminationSuggestionsCard}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <DatePicker
                    id="elimination-suggestions-as-of"
                    locale={locale}
                    value={asOf}
                    onSelect={setAsOf}
                    label={d.eliminationSuggestionsAsOf}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void loadSuggestions()}
                  loading={busy === "suggestions"}
                  disabled={groupId === "" || !UUID_RE.test(memberA.trim())}
                >
                  {d.eliminationSuggestionsButton}
                </Button>
              </div>
              {suggestions !== null && (
                <div className="mt-3 overflow-x-auto">
                  {suggestions.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.eliminationSuggestionsEmpty}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-subtle">
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.eliminationSuggestionColPartner}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.eliminationSuggestionColAr}
                          </th>
                          <th scope="col" className="px-2 py-2 text-start font-medium">
                            {d.eliminationSuggestionColAp}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.map((row) => (
                          <tr key={row.partner_id} className="border-b border-subtle/60">
                            <td className="px-2 py-2">
                              <span className="font-mono text-xs" dir="ltr">
                                {row.partner_code}
                              </span>{" "}
                              <span className="text-xs">
                                {locale === "ar" && row.partner_name_ar !== null
                                  ? row.partner_name_ar
                                  : row.partner_name}
                              </span>
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {formatMoneyDisplay(row.ar_balance, 2)}
                            </td>
                            <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                              {formatMoneyDisplay(row.ap_balance, 2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card title={d.eliminationsLinesTitle}>
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border border-subtle p-2 lg:grid-cols-6"
                >
                  <Select
                    id={`elimination-line-purpose-${index}`}
                    label={d.eliminationsLinePurpose}
                    value={line.purposeKey}
                    onValueChange={(value) => setLine(index, { purposeKey: value })}
                    options={purposeOptions}
                  />
                  <Select
                    id={`elimination-line-direction-${index}`}
                    label={d.eliminationsLineDirection}
                    value={line.direction}
                    onValueChange={(value) =>
                      setLine(index, { direction: value as "DEBIT" | "CREDIT" })
                    }
                    options={[
                      { value: "DEBIT", label: d.accountingColDebit },
                      { value: "CREDIT", label: d.accountingColCredit },
                    ]}
                  />
                  <MoneyInput
                    id={`elimination-line-amount-${index}`}
                    label={d.instColAmount}
                    amount={line.amount}
                    onAmountChange={(value) => setLine(index, { amount: value })}
                    currency={currency}
                    minorUnits={2}
                  />
                  {isIntercompany && (
                    <Select
                      id={`elimination-line-member-${index}`}
                      label={d.eliminationsLineMember}
                      value={line.member}
                      onValueChange={(value) => setLine(index, { member: value as "A" | "B" | "" })}
                      options={[
                        { value: "", label: "—" },
                        { value: "A", label: d.eliminationFormMemberA },
                        { value: "B", label: d.eliminationFormMemberB },
                      ]}
                    />
                  )}
                  <Input
                    id={`elimination-line-memo-en-${index}`}
                    label={d.eliminationsLineMemoEn}
                    value={line.memoEn}
                    onValueChange={(value) => setLine(index, { memoEn: value })}
                  />
                  <div className="flex items-end gap-2">
                    <Input
                      id={`elimination-line-memo-ar-${index}`}
                      label={d.eliminationsLineMemoAr}
                      value={line.memoAr}
                      onValueChange={(value) => setLine(index, { memoAr: value })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                      disabled={lines.length <= 1}
                      aria-label={`${d.eliminationsRemoveLine} ${index + 1}`}
                    >
                      {d.eliminationsRemoveLine}
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, emptyLine(kind as EliminationKind)])}
                >
                  {d.eliminationsAddLine}
                </Button>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-subtle bg-surface-sunken p-3">
              <h3 className="text-sm font-semibold text-gray-900">{d.eliminationPreviewTitle}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <BalancedChip
                  balanced={balanced}
                  okLabel={d.accountingBalanced}
                  brokenLabel={d.accountingUnbalanced}
                />
                <span className="font-mono tabular-nums text-sm" dir="ltr">
                  {d.accountingColDebit}: {formatMoneyDisplay(debitTotal, 2)}{" "}
                  <span className="text-xs text-gray-500">{currency}</span>
                </span>
                <span className="font-mono tabular-nums text-sm" dir="ltr">
                  {d.accountingColCredit}: {formatMoneyDisplay(creditTotal, 2)}{" "}
                  <span className="text-xs text-gray-500">{currency}</span>
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
              <Button variant="primary" onClick={() => void submit()} loading={busy === "submit"} disabled={!canSubmit}>
                {d.eliminationSubmitButton}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
          </Card>
        </>
      )}

      <Dialog open={postOpen} onOpenChange={setPostOpen} title={d.eliminationsPostConfirmTitle} size="sm">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">
            {formatMessage(d.eliminationsPostConfirmBody, {
              amount: formatMoneyDisplay(created === null ? "0" : createdDebit, 2),
            })}
          </p>
          <InfoNotice>{d.eliminationsSodHint}</InfoNotice>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPostOpen(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void post()}>
              {d.accountingPost}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
