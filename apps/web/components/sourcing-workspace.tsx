"use client";

/**
 * WEB-038 (PHASE-038) — the RFQ negotiation workspace (/purchasing/rfq;
 * transaction-entry archetype, matrix §3.16): three tabs over the
 * purchasing sourcing routes —
 *
 * 1. RFQs (H-11/P-01): the round registry with the create/edit dialogs
 *    (branch, mode, dueAt, invited suppliers, multi-line demand) and the
 *    status lifecycle DRAFT → issue → (quotes) → award → close, with
 *    cancel on the live rounds. The edit dialog prefills from the
 *    detail-with-lines (PATCH replaces the lines wholesale).
 * 2. Quotes (P-02/P-05): the selected RFQ's quotes plus the back-office
 *    quote entry and the portal invite minting — the minted token is the
 *    shown-once secret (the API stores the sha256 hash only and never
 *    re-renders it, the enrollment-secret discipline).
 * 3. Comparison & award (P-08; BR-062/BR-063): the FROZEN snapshot with
 *    per-line offers + weighted scores, checkbox winners per line, the
 *    award (the server groups POs per supplier or draws a blanket
 *    release) and the generated-docs trail. A PREPARED comparison can be
 *    cancelled; AWARDED evidence never cancels (INV-003).
 *
 * Writes gate in-screen on purchasing.rfqs.manage / purchasing.rfqs.award
 * (session-derived flags the page passes); every API failure renders
 * localized through the sourcing error family.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  NumberInput,
  Select,
  Tabs,
  useToast,
} from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  ApiResult,
  BranchRow,
  ComparisonOffer,
  ComparisonSnapshot,
  ItemRow,
  PartnerRow,
  QuoteComparisonRow,
  RfqRow,
  RfqWithLines,
  SupplierQuoteRow,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type WorkspaceTab = "rfqs" | "quotes" | "comparison";
type RfqMode = RfqRow["mode"];

/** RFQ lifecycle tones (the neutral/primary Badge vocabulary). */
const RFQ_TONES: Record<RfqRow["status"], "primary" | "neutral"> = {
  DRAFT: "neutral",
  ISSUED: "primary",
  QUOTED: "primary",
  AWARDED: "primary",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

interface DraftRfqLine {
  itemId: string;
  qty: string;
  targetPrice: string;
}

/** The create/edit RFQ form draft (all inputs are strings). */
interface RfqDraft {
  branchId: string;
  title: string;
  titleAr: string;
  mode: RfqMode;
  currencyCode: string;
  /** datetime-local shaped "YYYY-MM-DDTHH:mm" ("" = none). */
  dueAt: string;
  invited: string[];
  lines: DraftRfqLine[];
}

interface QuoteDraftLine {
  rfqLineId: string;
  qty: string;
  unitPrice: string;
}

/** The back-office quote-entry draft. */
interface QuoteDraft {
  supplierId: string;
  quoteRef: string;
  currencyCode: string;
  leadTimeDays: string;
  /** Canonical YYYY-MM-DD ("" = none). */
  validUntil: string;
  lines: QuoteDraftLine[];
}

function emptyRfqDraft(): RfqDraft {
  return {
    branchId: "",
    title: "",
    titleAr: "",
    mode: "OPEN",
    currencyCode: "SAR",
    dueAt: "",
    invited: [],
    lines: [{ itemId: "", qty: "", targetPrice: "" }],
  };
}

function emptyQuoteDraft(): QuoteDraft {
  return {
    supplierId: "",
    quoteRef: "",
    currencyCode: "",
    leadTimeDays: "",
    validUntil: "",
    lines: [{ rfqLineId: "", qty: "", unitPrice: "" }],
  };
}

/** ISO timestamp → "YYYY-MM-DDTHH:mm" (local time) for the split pickers. */
function isoToDatetimeLocal(iso: string | null): string {
  if (iso === null) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local) → full ISO wire format; empty/invalid → null. */
function datetimeLocalToIso(value: string): string | null {
  if (value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/** The portal-invite default expiry: now + 7 days, datetime-local shaped. */
function defaultInviteExpiry(): string {
  return isoToDatetimeLocal(new Date(Date.now() + 7 * 86_400_000).toISOString());
}

/**
 * Stable sourcing error family → honest messages (localizedApiError covers
 * the generic families; the *_NOT_FOUND not-founds render identically).
 */
function sourcingError(
  d: Dictionary,
  failure: { error: ApiErrorBody; retryAfterSeconds?: number },
): string {
  switch (failure.error.code) {
    case "RFQ_NOT_FOUND":
    case "SUPPLIER_QUOTE_NOT_FOUND":
    case "COMPARISON_NOT_FOUND":
    case "BLANKET_ORDER_NOT_FOUND":
    case "SUPPLIER_RATING_NOT_FOUND":
    case "CAPEX_REQUEST_NOT_FOUND":
      return d.errorsNotFound;
    case "RFQ_STATE":
    case "COMPARISON_STATE":
    case "BLANKET_STATE":
    case "CAPEX_STATE":
    case "QUOTE_LINE_INVALID":
    case "AWARD_DECISION_INVALID":
    case "BLANKET_RELEASE_LINE_INVALID":
      return d.sourcingErrState;
    case "THREE_BID_RULE_VIOLATED":
      return d.sourcingErrThreeBid;
    case "BLANKET_OVER_RELEASE":
      return d.sourcingErrOverRelease;
    case "RFQ_DUE_PASSED":
      return d.sourcingErrDuePassed;
    case "SUPPLIER_NOT_INVITED":
      return d.sourcingErrNotInvited;
    case "QUOTE_CURRENCY_MISMATCH":
      return d.sourcingErrCurrencyMismatch;
    case "NO_QUOTES_TO_COMPARE":
      return d.sourcingErrNoQuotes;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function rfqStatusLabel(d: Dictionary, status: RfqRow["status"]): string {
  const map: Record<RfqRow["status"], string> = {
    DRAFT: d.sourcingStatusRfqDraft,
    ISSUED: d.sourcingStatusRfqIssued,
    QUOTED: d.sourcingStatusRfqQuoted,
    AWARDED: d.sourcingStatusRfqAwarded,
    CLOSED: d.sourcingStatusRfqClosed,
    CANCELLED: d.sourcingStatusRfqCancelled,
  };
  return map[status];
}

function quoteStatusLabel(d: Dictionary, status: SupplierQuoteRow["status"]): string {
  return status === "SUBMITTED" ? d.sourcingStatusQuoteSubmitted : d.sourcingStatusQuoteWithdrawn;
}

function comparisonStatusLabel(d: Dictionary, status: QuoteComparisonRow["status"]): string {
  const map: Record<QuoteComparisonRow["status"], string> = {
    PREPARED: d.sourcingStatusComparisonPrepared,
    AWARDED: d.sourcingStatusComparisonAwarded,
    CANCELLED: d.sourcingStatusComparisonCancelled,
  };
  return map[status];
}

function docKindLabel(d: Dictionary, kind: string): string {
  if (kind === "PURCHASE_ORDER") {
    return d.sourcingDocKindPo;
  }
  if (kind === "BLANKET_RELEASE") {
    return d.sourcingDocKindRelease;
  }
  return kind;
}

/** The created RFQ wire body — empty optionals become explicit nulls. */
function rfqCreateBody(draft: RfqDraft): Record<string, unknown> {
  const trimOrNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    branchId: draft.branchId,
    title: draft.title.trim(),
    titleAr: trimOrNull(draft.titleAr),
    mode: draft.mode,
    currencyCode: draft.currencyCode.trim().toUpperCase(),
    dueAt: datetimeLocalToIso(draft.dueAt),
    invitedSuppliers: draft.invited,
    lines: draft.lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      targetPrice: line.targetPrice.trim() === "" ? null : line.targetPrice.trim(),
      note: null,
    })),
    note: null,
    noteAr: null,
  };
}

/** The edited RFQ wire body (PATCH is partial — branch/currency are immutable). */
function rfqEditBody(draft: RfqDraft): Record<string, unknown> {
  const body = rfqCreateBody(draft);
  delete body.branchId;
  delete body.currencyCode;
  return body;
}

export function SourcingWorkspace({
  locale,
  initialRfqs,
  partners,
  items,
  branches,
  canManage,
  canAward,
}: {
  locale: Locale;
  initialRfqs: readonly RfqRow[];
  partners: readonly PartnerRow[];
  items: readonly ItemRow[];
  branches: readonly BranchRow[];
  canManage: boolean;
  canAward: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<WorkspaceTab>("rfqs");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [rfqs, setRfqs] = useState<readonly RfqRow[]>(initialRfqs);

  // -- rfqs tab: create / edit dialogs ------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RfqDraft>(emptyRfqDraft);
  const [editTarget, setEditTarget] = useState<RfqRow | null>(null);
  const [editDraft, setEditDraft] = useState<RfqDraft>(emptyRfqDraft);

  // -- quotes + comparison tabs: the shared selected round ------------------------
  const [selectedId, setSelectedId] = useState("");
  const [selectedRfq, setSelectedRfq] = useState<RfqWithLines | null>(null);
  const [quotes, setQuotes] = useState<readonly SupplierQuoteRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft>(emptyQuoteDraft);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSupplierId, setInviteSupplierId] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string>(defaultInviteExpiry);
  const [minted, setMinted] = useState<{ token: string; supplierId: string; expiresAt: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const [comparison, setComparison] = useState<QuoteComparisonRow | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [winners, setWinners] = useState<
    Record<string, { quoteId: string; supplierId: string; unitPrice: string }>
  >({});

  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} — ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const branchOptions = useMemo(() => {
    const options = branches.map((branch) => ({
      value: branch.id,
      label: localizedName(branch.name, branch.nameAr, locale),
    }));
    // Rows referencing unreadable branches stay selectable with the honest
    // raw id (the zatca-devices fallback).
    for (const rfq of rfqs) {
      if (options.some((option) => option.value === rfq.branchId)) {
        continue;
      }
      options.push({ value: rfq.branchId, label: rfq.branchId });
    }
    return options;
  }, [branches, rfqs, locale]);

  const suppliersOnly = useMemo(
    () => partners.filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH"),
    [partners],
  );

  const selectedRow = useMemo(
    () => rfqs.find((row) => row.id === selectedId) ?? null,
    [rfqs, selectedId],
  );
  const selectedQuotesLive =
    selectedRow !== null && (selectedRow.status === "ISSUED" || selectedRow.status === "QUOTED");

  /** The FROZEN snapshot, narrowed defensively (the matrix is evidence). */
  const snapshot = useMemo<ComparisonSnapshot | null>(() => {
    if (comparison === null) {
      return null;
    }
    const raw = comparison.snapshot;
    if (!isRecord(raw) || !Array.isArray(raw.lines)) {
      return null;
    }
    return raw as unknown as ComparisonSnapshot;
  }, [comparison]);

  function supplierLabel(supplierId: string): string {
    return supplierNameById.get(supplierId) ?? supplierId;
  }

  function rfqLabel(row: RfqRow): string {
    return `${row.rfqNo ?? row.id.slice(0, 8)} — ${localizedName(row.title, row.titleAr, locale)}`;
  }

  async function call<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(sourcingError(d, result));
      return undefined;
    }
    return result.data;
  }

  /** Re-pull the registry — lifecycle moves happen server-side. */
  async function refreshRfqs(): Promise<void> {
    const fresh = await bffFetch<readonly RfqRow[]>("purchasing/rfqs?limit=200");
    if (fresh.ok) {
      setRfqs(fresh.data);
    }
    router.refresh();
  }

  /** Select a round for the quotes/comparison tabs (the detail carries the lines). */
  async function selectRfq(id: string): Promise<void> {
    setSelectedId(id);
    setSelectedRfq(null);
    setQuotes([]);
    setComparison(null);
    setWinners({});
    setMinted(null);
    setTokenCopied(false);
    if (id === "") {
      return;
    }
    const detail = await bffFetch<RfqWithLines>(`purchasing/rfqs/${id}`);
    if (!detail.ok) {
      setError(sourcingError(d, detail));
      return;
    }
    setSelectedRfq(detail.data);
    setQuotesLoading(true);
    const loaded = await bffFetch<readonly SupplierQuoteRow[]>(`purchasing/rfqs/${id}/quotes`);
    setQuotesLoading(false);
    if (loaded.ok) {
      setQuotes(loaded.data);
    } else {
      setError(sourcingError(d, loaded));
    }
  }

  async function loadComparison(id: string): Promise<void> {
    setComparison(null);
    setWinners({});
    setComparisonLoading(true);
    const loaded = await bffFetch<QuoteComparisonRow>(`purchasing/rfqs/${id}/comparison`);
    setComparisonLoading(false);
    if (!loaded.ok) {
      // No live matrix yet is the honest idle state, not an error.
      if (loaded.error.code !== "COMPARISON_NOT_FOUND") {
        setError(sourcingError(d, loaded));
      }
      return;
    }
    setComparison(loaded.data);
  }

  // -- rfqs tab actions -------------------------------------------------------------

  function rfqDraftReady(draft: RfqDraft, withBranch: boolean): boolean {
    return (
      (!withBranch || draft.branchId !== "") &&
      draft.title.trim() !== "" &&
      CURRENCY_RE.test(draft.currencyCode.trim().toUpperCase()) &&
      (draft.dueAt === "" || datetimeLocalToIso(draft.dueAt) !== null) &&
      draft.lines.length > 0 &&
      draft.lines.every((line) => line.itemId !== "" && QTY_RE.test(line.qty))
    );
  }

  async function createRfq(): Promise<void> {
    if (!rfqDraftReady(createDraft, true)) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<RfqRow>("rfq-create", () =>
      bffFetch<RfqRow>("purchasing/rfqs", { method: "POST", body: rfqCreateBody(createDraft) }),
    );
    if (created !== undefined) {
      setCreateOpen(false);
      setCreateDraft(emptyRfqDraft());
      setRfqs((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.sourcingToastCreated });
      router.refresh();
    }
  }

  async function openEdit(row: RfqRow): Promise<void> {
    setEditTarget(row);
    setEditDraft({
      branchId: row.branchId,
      title: row.title,
      titleAr: row.titleAr ?? "",
      mode: row.mode,
      currencyCode: row.currencyCode,
      dueAt: isoToDatetimeLocal(row.dueAt),
      invited: [...row.invitedSuppliers],
      lines: [{ itemId: "", qty: "", targetPrice: "" }],
    });
    // The PATCH replaces the lines wholesale — prefill from the detail.
    const detail = await bffFetch<RfqWithLines>(`purchasing/rfqs/${row.id}`);
    if (!detail.ok) {
      setError(sourcingError(d, detail));
      return;
    }
    setEditDraft((draft) => ({
      ...draft,
      dueAt: isoToDatetimeLocal(detail.data.dueAt),
      invited: [...detail.data.invitedSuppliers],
      lines: detail.data.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        targetPrice: line.targetPrice ?? "",
      })),
    }));
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null) {
      return;
    }
    if (!rfqDraftReady(editDraft, false)) {
      setError(d.errorsValidation);
      return;
    }
    const updated = await call<RfqRow>("rfq-edit", () =>
      bffFetch<RfqRow>(`purchasing/rfqs/${editTarget.id}`, {
        method: "PATCH",
        body: rfqEditBody(editDraft),
      }),
    );
    if (updated !== undefined) {
      setEditTarget(null);
      setRfqs((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  async function rfqAction(row: RfqRow, action: "issue" | "close" | "cancel"): Promise<void> {
    const updated = await call<RfqRow>(`${action}-${row.id}`, () =>
      bffFetch<RfqRow>(`purchasing/rfqs/${row.id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? { reason: "UI cancel" } : {},
      }),
    );
    if (updated !== undefined) {
      setRfqs((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast({ tone: "success", title: d.sourcingToastDone });
      router.refresh();
    }
  }

  // -- quotes tab actions -------------------------------------------------------------

  async function submitQuote(): Promise<void> {
    if (selectedId === "") {
      return;
    }
    const currency =
      quoteDraft.currencyCode.trim() === ""
        ? selectedRfq?.currencyCode ?? ""
        : quoteDraft.currencyCode.trim().toUpperCase();
    if (
      quoteDraft.supplierId === "" ||
      !CURRENCY_RE.test(currency) ||
      quoteDraft.lines.length === 0 ||
      quoteDraft.lines.some(
        (line) => line.rfqLineId === "" || !QTY_RE.test(line.qty) || !PRICE_RE.test(line.unitPrice),
      )
    ) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<SupplierQuoteRow>("quote-create", () =>
      bffFetch<SupplierQuoteRow>(`purchasing/rfqs/${selectedId}/quotes`, {
        method: "POST",
        body: {
          supplierId: quoteDraft.supplierId,
          quoteRef: quoteDraft.quoteRef.trim() === "" ? null : quoteDraft.quoteRef.trim(),
          currencyCode: currency,
          leadTimeDays:
            quoteDraft.leadTimeDays.trim() === "" ? null : Number(quoteDraft.leadTimeDays),
          validUntil: quoteDraft.validUntil === "" ? null : quoteDraft.validUntil,
          lines: quoteDraft.lines.map((line) => ({
            rfqLineId: line.rfqLineId,
            qty: line.qty,
            unitPrice: line.unitPrice,
            leadTimeDays: null,
            note: null,
          })),
        },
      }),
    );
    if (created !== undefined) {
      setQuoteOpen(false);
      setQuoteDraft(emptyQuoteDraft());
      setQuotes((rows) => [...rows, created]);
      toast({ tone: "success", title: d.sourcingToastCreated });
      void refreshRfqs();
    }
  }

  async function mintInvite(): Promise<void> {
    if (selectedId === "" || inviteSupplierId === "") {
      setError(d.errorsValidation);
      return;
    }
    const expiresIso = datetimeLocalToIso(inviteExpiresAt);
    if (expiresIso === null) {
      setError(d.errorsValidation);
      return;
    }
    const result = await call<{ token: string; expiresAt: string }>("invite-mint", () =>
      bffFetch<{ token: string; expiresAt: string }>(`purchasing/rfqs/${selectedId}/portal-invites`, {
        method: "POST",
        body: { supplierId: inviteSupplierId, expiresAt: expiresIso },
      }),
    );
    if (result !== undefined) {
      setInviteOpen(false);
      setInviteSupplierId("");
      setTokenCopied(false);
      setMinted({ token: result.token, supplierId: inviteSupplierId, expiresAt: result.expiresAt });
      toast({ tone: "success", title: d.sourcingToastDone });
    }
  }

  async function copyToken(): Promise<void> {
    if (minted === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(minted.token);
      setTokenCopied(true);
      toast({ tone: "success", title: d.sourcingToastCopied });
    } catch {
      setError(d.errorsGeneric);
    }
  }

  // -- comparison tab actions -----------------------------------------------------------

  function pickWinner(rfqLineId: string, offer: ComparisonOffer): void {
    setWinners((prev) => {
      const next = { ...prev };
      if (next[rfqLineId]?.quoteId === offer.quoteId) {
        delete next[rfqLineId];
      } else {
        next[rfqLineId] = {
          quoteId: offer.quoteId,
          supplierId: offer.supplierId,
          unitPrice: offer.unitPrice,
        };
      }
      return next;
    });
  }

  async function prepareComparison(): Promise<void> {
    if (selectedId === "") {
      return;
    }
    const prepared = await call<QuoteComparisonRow>("comparison-prepare", () =>
      bffFetch<QuoteComparisonRow>(`purchasing/rfqs/${selectedId}/comparison`, {
        method: "POST",
        body: {},
      }),
    );
    if (prepared !== undefined) {
      setComparison(prepared);
      setWinners({});
      toast({ tone: "success", title: d.sourcingToastDone });
    }
  }

  async function cancelComparison(): Promise<void> {
    if (comparison === null) {
      return;
    }
    const done = await call<QuoteComparisonRow>("comparison-cancel", () =>
      bffFetch<QuoteComparisonRow>(`purchasing/comparisons/${comparison.id}/cancel`, {
        method: "POST",
        body: {},
      }),
    );
    if (done !== undefined) {
      setComparison(null);
      setWinners({});
      toast({ tone: "success", title: d.sourcingToastDone });
    }
  }

  async function award(): Promise<void> {
    if (comparison === null || snapshot === null) {
      return;
    }
    const decisions = snapshot.lines
      .filter((line) => winners[line.rfqLineId] !== undefined)
      .map((line) => ({
        rfqLineId: line.rfqLineId,
        quoteId: winners[line.rfqLineId]!.quoteId,
        supplierId: winners[line.rfqLineId]!.supplierId,
        qty: line.qty,
        unitPrice: winners[line.rfqLineId]!.unitPrice,
      }));
    if (decisions.length === 0) {
      setError(d.errorsValidation);
      return;
    }
    const awarded = await call<QuoteComparisonRow>("comparison-award", () =>
      bffFetch<QuoteComparisonRow>(`purchasing/comparisons/${comparison.id}/award`, {
        method: "POST",
        body: { decisions, note: null, noteAr: null },
      }),
    );
    if (awarded !== undefined) {
      setComparison(awarded);
      setWinners({});
      toast({ tone: "success", title: d.sourcingToastDone });
      void refreshRfqs();
    }
  }

  /** Splits the datetime-local draft value into its date/time input parts. */
  function dueAtParts(value: string): { date: string; time: string } {
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }

  // -- render -----------------------------------------------------------------------

  const rfqDialogBody = (
    draft: RfqDraft,
    setDraft: (next: RfqDraft) => void,
    isEdit: boolean,
  ): JSX.Element => {
    const due = dueAtParts(draft.dueAt);
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!isEdit && (
            <Select
              label={d.sourcingFormBranch}
              value={draft.branchId}
              onValueChange={(value) => setDraft({ ...draft, branchId: value })}
              options={[{ value: "", label: d.sourcingFormBranch }, ...branchOptions]}
            />
          )}
          <Input
            label={d.sourcingFormTitle}
            value={draft.title}
            onValueChange={(value) => setDraft({ ...draft, title: value })}
            error={draft.title.trim() === "" ? d.errorsValidation : undefined}
            required
          />
          <Input
            label={`${d.sourcingFormTitleAr} (${d.sourcingFormOptional})`}
            value={draft.titleAr}
            onValueChange={(value) => setDraft({ ...draft, titleAr: value })}
          />
          <Select
            label={d.sourcingFormMode}
            value={draft.mode}
            onValueChange={(value) => setDraft({ ...draft, mode: value as RfqMode })}
            options={[
              { value: "OPEN", label: d.sourcingModeOpen },
              { value: "INVITED", label: d.sourcingModeInvited },
            ]}
          />
          <Input
            label={d.sourcingFormCurrency}
            value={draft.currencyCode}
            onValueChange={(value) => setDraft({ ...draft, currencyCode: value.toUpperCase() })}
            mono
            error={!CURRENCY_RE.test(draft.currencyCode.trim()) ? d.errorsValidation : undefined}
            required
          />
          <div className="grid gap-2">
            <DatePicker
              label={`${d.sourcingFormDue} (${d.sourcingFormOptional})`}
              value={due.date === "" ? undefined : due.date}
              onSelect={(iso) =>
                setDraft({ ...draft, dueAt: `${iso}T${due.time === "" ? "00:00" : due.time}` })
              }
              locale={locale}
            />
            <Input
              label={d.sourcingFormDue}
              value={due.time}
              onValueChange={(value) =>
                setDraft({ ...draft, dueAt: `${due.date}T${value.replace(/[^\d:]/g, "")}` })
              }
              placeholder="HH:mm"
              mono
            />
          </div>
        </div>
        {draft.mode === "INVITED" && (
          <div className="rounded-md border border-subtle p-3">
            <p className="mb-2 text-sm font-medium text-gray-800">{d.sourcingFormInvitedSuppliers}</p>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {suppliersOnly.map((supplier) => (
                <Checkbox
                  key={supplier.id}
                  label={supplierLabel(supplier.id)}
                  checked={draft.invited.includes(supplier.id)}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      invited:
                        checked === true
                          ? [...draft.invited, supplier.id]
                          : draft.invited.filter((id) => id !== supplier.id),
                    })
                  }
                />
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3">
          {draft.lines.map((line, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Select
                label={index === 0 ? d.purchasingItem : undefined}
                value={line.itemId}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    lines: draft.lines.map((r, i) => (i === index ? { ...r, itemId: value } : r)),
                  })
                }
                options={[
                  { value: "", label: d.purchasingItem },
                  ...items.map((item) => ({
                    value: item.id,
                    label: itemNameById.get(item.id) ?? item.sku,
                  })),
                ]}
              />
              <Input
                label={index === 0 ? d.purchasingQty : undefined}
                value={line.qty}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    lines: draft.lines.map((r, i) => (i === index ? { ...r, qty: value } : r)),
                  })
                }
                inputMode="decimal"
              />
              <Input
                label={index === 0 ? `${d.sourcingFormTargetPrice} (${d.sourcingFormOptional})` : undefined}
                value={line.targetPrice}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    lines: draft.lines.map((r, i) => (i === index ? { ...r, targetPrice: value } : r)),
                  })
                }
                inputMode="decimal"
              />
              <div className="flex items-end">
                {draft.lines.length > 1 && (
                  <Button
                    variant="secondary"
                    onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}
                  >
                    {d.purchasingRemoveLine}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setDraft({ ...draft, lines: [...draft.lines, { itemId: "", qty: "", targetPrice: "" }] })}
          >
            {d.purchasingAddLine}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs
        items={[
          { value: "rfqs", label: d.sourcingRfqsTab },
          { value: "quotes", label: d.sourcingQuotesTab },
          { value: "comparison", label: d.sourcingComparisonTab },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as WorkspaceTab)}
      >
        {tab === "rfqs" && (
          <div className="flex flex-col gap-4">
            {canManage && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    setCreateDraft(emptyRfqDraft());
                    setCreateOpen(true);
                  }}
                >
                  {d.sourcingActionCreate}
                </Button>
              </div>
            )}
            <Card title={d.sourcingRfqsTab}>
              <DataTable
                columns={[
                  {
                    id: "rfqNo",
                    header: activeLocaleHeader(d.sourcingColRfqNo),
                    accessor: (row: RfqRow) => row.rfqNo ?? "—",
                    mono: true,
                    render: (row: RfqRow) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.rfqNo ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "title",
                    header: activeLocaleHeader(d.sourcingColTitle),
                    accessor: (row: RfqRow) => localizedName(row.title, row.titleAr, locale),
                  },
                  {
                    id: "mode",
                    header: activeLocaleHeader(d.sourcingColMode),
                    accessor: (row: RfqRow) => row.mode,
                    render: (row: RfqRow) =>
                      row.mode === "OPEN" ? d.sourcingModeOpen : d.sourcingModeInvited,
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.sourcingColStatus),
                    accessor: (row: RfqRow) => row.status,
                    render: (row: RfqRow) => (
                      <Badge tone={RFQ_TONES[row.status]}>{rfqStatusLabel(d, row.status)}</Badge>
                    ),
                  },
                  {
                    id: "dueAt",
                    header: activeLocaleHeader(d.sourcingColDue),
                    accessor: (row: RfqRow) => row.dueAt ?? "",
                    render: (row: RfqRow) =>
                      row.dueAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatDateTime(row.dueAt, locale)
                      ),
                  },
                  {
                    id: "invited",
                    header: activeLocaleHeader(d.sourcingColQuotes),
                    accessor: (row: RfqRow) => String(row.invitedSuppliers.length),
                    numeric: true,
                    render: (row: RfqRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.invitedSuppliers.length}
                      </span>
                    ),
                  },
                ]}
                rows={[...rfqs]}
                rowKey={(row) => row.id}
                rowActions={
                  canManage
                    ? [
                        {
                          id: "view-quotes",
                          label: d.sourcingActionViewQuotes,
                          onSelect: (row: RfqRow) => {
                            setTab("quotes");
                            void selectRfq(row.id);
                          },
                        },
                        {
                          id: "edit",
                          label: d.commonEdit,
                          onSelect: (row: RfqRow) => {
                            if (row.status === "DRAFT") {
                              void openEdit(row);
                            }
                          },
                        },
                        {
                          id: "issue",
                          label: d.sourcingActionIssue,
                          onSelect: (row: RfqRow) => {
                            if (row.status !== "DRAFT") {
                              return;
                            }
                            if (window.confirm(d.sourcingConfirmIssue)) {
                              void rfqAction(row, "issue");
                            }
                          },
                        },
                        {
                          id: "cancel",
                          label: d.sourcingActionCancel,
                          onSelect: (row: RfqRow) => {
                            if (row.status !== "ISSUED" && row.status !== "QUOTED") {
                              return;
                            }
                            if (window.confirm(d.sourcingConfirmCancel)) {
                              void rfqAction(row, "cancel");
                            }
                          },
                        },
                        {
                          id: "close",
                          label: d.sourcingActionClose,
                          onSelect: (row: RfqRow) => {
                            if (row.status !== "AWARDED") {
                              return;
                            }
                            if (window.confirm(d.sourcingConfirmClose)) {
                              void rfqAction(row, "close");
                            }
                          },
                        },
                      ]
                    : [
                        {
                          id: "view-quotes",
                          label: d.sourcingActionViewQuotes,
                          onSelect: (row: RfqRow) => {
                            setTab("quotes");
                            void selectRfq(row.id);
                          },
                        },
                      ]
                }
                empty={{ title: d.sourcingRfqsEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "quotes" && (
          <div className="flex flex-col gap-4">
            <div className="w-80">
              <Select
                label={d.sourcingRfqsTab}
                value={selectedId}
                onValueChange={(value) => void selectRfq(value)}
                options={[
                  { value: "", label: d.sourcingQuotesPickFirst },
                  ...rfqs.map((row) => ({ value: row.id, label: rfqLabel(row) })),
                ]}
              />
            </div>

            {selectedId === "" ? (
              <p className="text-sm text-gray-600">{d.sourcingQuotesPickFirst}</p>
            ) : (
              <>
                {minted !== null && (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
                  >
                    <p className="font-semibold">{d.sourcingInviteTokenTitle}</p>
                    <p>{d.sourcingInviteTokenOnce}</p>
                    <p className="text-xs">
                      {d.purchasingSupplier}: {supplierLabel(minted.supplierId)} ·{" "}
                      {d.sourcingColExpires}: {formatDateTime(minted.expiresAt, locale)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        dir="ltr"
                        className="max-w-full overflow-x-auto rounded border border-warning-border bg-surface-card px-2 py-1 font-mono text-xs text-gray-900"
                      >
                        {minted.token}
                      </code>
                      <Button variant="secondary" size="sm" onClick={() => void copyToken()}>
                        {tokenCopied ? d.sourcingActionCopyDone : d.sourcingActionCopy}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setMinted(null);
                          setTokenCopied(false);
                        }}
                      >
                        {d.sourcingActionDismiss}
                      </Button>
                    </div>
                  </div>
                )}

                <Card
                  title={formatMessage(d.sourcingQuotesFor, {
                    no: selectedRow?.rfqNo ?? selectedId.slice(0, 8),
                  })}
                  actions={
                    canManage && selectedQuotesLive ? (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setQuoteDraft(emptyQuoteDraft());
                            setQuoteOpen(true);
                          }}
                        >
                          {d.sourcingActionCreate}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setInviteSupplierId("");
                            setInviteExpiresAt(defaultInviteExpiry());
                            setInviteOpen(true);
                          }}
                        >
                          {d.sourcingActionMintInvite}
                        </Button>
                      </div>
                    ) : undefined
                  }
                >
                  {quotesLoading ? (
                    <p className="text-sm text-gray-600">{d.loading}</p>
                  ) : (
                    <DataTable
                      columns={[
                        {
                          id: "supplier",
                          header: activeLocaleHeader(d.purchasingSupplier),
                          accessor: (row: SupplierQuoteRow) => supplierLabel(row.supplierId),
                        },
                        {
                          id: "quoteRef",
                          header: activeLocaleHeader(d.sourcingColQuoteRef),
                          accessor: (row: SupplierQuoteRow) => row.quoteRef ?? "—",
                          mono: true,
                          render: (row: SupplierQuoteRow) => (
                            <span className="font-mono text-sm" dir="ltr">
                              {row.quoteRef ?? "—"}
                            </span>
                          ),
                        },
                        {
                          id: "status",
                          header: activeLocaleHeader(d.sourcingColStatus),
                          accessor: (row: SupplierQuoteRow) => row.status,
                          render: (row: SupplierQuoteRow) => (
                            <Badge tone={row.status === "SUBMITTED" ? "primary" : "neutral"}>
                              {quoteStatusLabel(d, row.status)}
                            </Badge>
                          ),
                        },
                        {
                          id: "via",
                          header: activeLocaleHeader(d.sourcingColSubmittedVia),
                          accessor: (row: SupplierQuoteRow) => row.submittedVia,
                          render: (row: SupplierQuoteRow) =>
                            row.submittedVia === "PORTAL"
                              ? d.sourcingViaPortal
                              : d.sourcingViaBackOffice,
                        },
                        {
                          id: "submitted",
                          header: activeLocaleHeader(d.sourcingColSubmitted),
                          accessor: (row: SupplierQuoteRow) => row.submittedAt,
                          sortable: true,
                          render: (row: SupplierQuoteRow) => (
                            <span className="font-mono text-xs" dir="ltr">
                              {formatDateTime(row.submittedAt, locale)}
                            </span>
                          ),
                        },
                        {
                          id: "leadTime",
                          header: activeLocaleHeader(d.sourcingColLeadTime),
                          accessor: (row: SupplierQuoteRow) => String(row.leadTimeDays ?? -1),
                          numeric: true,
                          render: (row: SupplierQuoteRow) => (
                            <span className="font-mono tabular-nums" dir="ltr">
                              {row.leadTimeDays === null
                                ? "—"
                                : formatMessage(d.sourcingLeadTimeDays, { days: row.leadTimeDays })}
                            </span>
                          ),
                        },
                      ]}
                      rows={[...quotes]}
                      rowKey={(row) => row.id}
                      empty={{ title: d.sourcingQuotesEmpty }}
                    />
                  )}
                </Card>
              </>
            )}
          </div>
        )}

        {tab === "comparison" && (
          <div className="flex flex-col gap-4">
            <div className="w-80">
              <Select
                label={d.sourcingRfqsTab}
                value={selectedId}
                onValueChange={(value) => {
                  void selectRfq(value);
                  if (value !== "") {
                    void loadComparison(value);
                  }
                }}
                options={[
                  { value: "", label: d.sourcingQuotesPickFirst },
                  ...rfqs.map((row) => ({ value: row.id, label: rfqLabel(row) })),
                ]}
              />
            </div>

            {selectedId === "" ? (
              <p className="text-sm text-gray-600">{d.sourcingQuotesPickFirst}</p>
            ) : comparisonLoading ? (
              <p className="text-sm text-gray-600">{d.loading}</p>
            ) : snapshot === null || comparison === null ? (
              <Card title={d.sourcingComparisonTab}>
                <div className="flex flex-col gap-3">
                  <InfoNotice>{d.sourcingComparisonNone}</InfoNotice>
                  {canManage && selectedQuotesLive && (
                    <Button
                      variant="primary"
                      className="self-start"
                      loading={busy === "comparison-prepare"}
                      onClick={() => void prepareComparison()}
                    >
                      {d.sourcingActionCompare}
                    </Button>
                  )}
                  {canManage && <InfoNotice>{d.sourcingComparisonPrepareHint}</InfoNotice>}
                </div>
              </Card>
            ) : (
              <Card
                title={`${d.sourcingComparisonTab} · ${comparisonStatusLabel(d, comparison.status)}`}
                description={`${d.sourcingComparisonPreparedAt} ${formatDateTime(snapshot.preparedAt, locale)}`}
                actions={
                  canManage && comparison.status === "PREPARED" ? (
                    <Button
                      variant="secondary"
                      loading={busy === "comparison-cancel"}
                      onClick={() => void cancelComparison()}
                    >
                      {d.sourcingActionCancelComparison}
                    </Button>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-4">
                  {canAward && comparison.status === "PREPARED" && (
                    <InfoNotice>{d.sourcingComparisonAwardHint}</InfoNotice>
                  )}
                  {snapshot.lines.map((line) => (
                    <div key={line.rfqLineId} className="rounded-md border border-subtle p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="font-semibold text-gray-900">
                          {d.sourcingColLine} {line.lineNo}
                        </span>
                        <span>{itemNameById.get(line.itemId) ?? line.itemId}</span>
                        <span className="font-mono text-xs" dir="ltr">
                          {d.purchasingQty}: {line.qty}
                        </span>
                        {line.targetPrice !== null && (
                          <span className="font-mono text-xs" dir="ltr">
                            {d.sourcingFormTargetPrice}: {line.targetPrice} {snapshot.currency}
                          </span>
                        )}
                      </div>
                      <DataTable
                        columns={[
                          {
                            id: "supplier",
                            header: activeLocaleHeader(d.sourcingColOfferSupplier),
                            accessor: (offer: ComparisonOffer) => supplierLabel(offer.supplierId),
                          },
                          {
                            id: "unitPrice",
                            header: activeLocaleHeader(d.sourcingColOfferPrice),
                            accessor: (offer: ComparisonOffer) => offer.unitPrice,
                            numeric: true,
                            render: (offer: ComparisonOffer) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {offer.unitPrice} {snapshot.currency}
                              </span>
                            ),
                          },
                          {
                            id: "lineTotal",
                            header: activeLocaleHeader(d.sourcingColLineTotal),
                            accessor: (offer: ComparisonOffer) => offer.lineTotal,
                            numeric: true,
                            render: (offer: ComparisonOffer) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {offer.lineTotal} {snapshot.currency}
                              </span>
                            ),
                          },
                          {
                            id: "leadTime",
                            header: activeLocaleHeader(d.sourcingColLeadTime),
                            accessor: (offer: ComparisonOffer) => String(offer.leadTimeDays ?? -1),
                            numeric: true,
                            render: (offer: ComparisonOffer) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {offer.leadTimeDays === null
                                  ? "—"
                                  : formatMessage(d.sourcingLeadTimeDays, { days: offer.leadTimeDays })}
                              </span>
                            ),
                          },
                          {
                            id: "weighted",
                            header: activeLocaleHeader(d.sourcingColWeighted),
                            accessor: (offer: ComparisonOffer) => offer.weightedScore,
                            numeric: true,
                            render: (offer: ComparisonOffer) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {offer.weightedScore}
                              </span>
                            ),
                          },
                          {
                            id: "winner",
                            header: activeLocaleHeader(d.sourcingColWinner),
                            accessor: (offer: ComparisonOffer) =>
                              winners[line.rfqLineId]?.quoteId === offer.quoteId ? "1" : "0",
                            render: (offer: ComparisonOffer) => (
                              <Checkbox
                                checked={winners[line.rfqLineId]?.quoteId === offer.quoteId}
                                onCheckedChange={() => pickWinner(line.rfqLineId, offer)}
                                disabled={comparison.status !== "PREPARED" || !canAward}
                              />
                            ),
                          },
                        ]}
                        rows={[...line.offers]}
                        rowKey={(offer: ComparisonOffer) => offer.quoteId}
                        empty={{ title: d.sourcingQuotesEmpty }}
                      />
                    </div>
                  ))}
                  {comparison.status === "PREPARED" && canAward && (
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        loading={busy === "comparison-award"}
                        onClick={() => {
                          if (window.confirm(d.sourcingConfirmAward)) {
                            void award();
                          }
                        }}
                      >
                        {d.sourcingActionAward}
                      </Button>
                    </div>
                  )}
                  {comparison.status === "AWARDED" && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {d.sourcingComparisonAwardedDocs}
                      </p>
                      {(comparison.generatedDocs ?? []).map((doc) => (
                        <div
                          key={`${doc.kind}-${doc.id}`}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-subtle px-2 py-1 text-sm"
                        >
                          <Badge tone="primary">{docKindLabel(d, doc.kind)}</Badge>
                          <span className="font-mono text-xs" dir="ltr">
                            {doc.documentNo ?? doc.id.slice(0, 8)}
                          </span>
                          <span>{supplierLabel(doc.supplierId)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}
      </Tabs>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`${d.sourcingActionCreate} — ${d.sourcingRfqsTab}`}
        size="lg"
      >
        {rfqDialogBody(createDraft, setCreateDraft, false)}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "rfq-create"} onClick={() => void createRfq()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
          }
        }}
        title={`${d.commonEdit} — ${editTarget?.rfqNo ?? ""}`}
        size="lg"
      >
        {editTarget !== null && rfqDialogBody(editDraft, setEditDraft, true)}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "rfq-edit"} onClick={() => void saveEdit()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen} title={d.sourcingQuoteFormTitle} size="lg">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.purchasingSupplier}
              value={quoteDraft.supplierId}
              onValueChange={(value) => setQuoteDraft({ ...quoteDraft, supplierId: value })}
              options={[
                { value: "", label: d.purchasingSelectSupplier },
                ...suppliersOnly.map((s) => ({
                  value: s.id,
                  label: supplierNameById.get(s.id) ?? s.code,
                })),
              ]}
            />
            <Input
              label={`${d.sourcingFormQuoteRef} (${d.sourcingFormOptional})`}
              value={quoteDraft.quoteRef}
              onValueChange={(value) => setQuoteDraft({ ...quoteDraft, quoteRef: value })}
            />
            <Input
              label={`${d.sourcingFormCurrency} (${selectedRfq?.currencyCode ?? ""})`}
              value={quoteDraft.currencyCode}
              onValueChange={(value) => setQuoteDraft({ ...quoteDraft, currencyCode: value.toUpperCase() })}
              mono
              hint={d.sourcingFormOptional}
            />
            <NumberInput
              label={`${d.sourcingFormLeadTime} (${d.sourcingFormOptional})`}
              value={quoteDraft.leadTimeDays}
              onValueChange={(value) => setQuoteDraft({ ...quoteDraft, leadTimeDays: value })}
              min={0}
              max={3650}
              step={1}
            />
            <DatePicker
              label={`${d.sourcingFormValidUntil} (${d.sourcingFormOptional})`}
              value={quoteDraft.validUntil === "" ? undefined : quoteDraft.validUntil}
              onSelect={(iso) => setQuoteDraft({ ...quoteDraft, validUntil: iso })}
              locale={locale}
            />
          </div>
          <div className="space-y-3">
            {quoteDraft.lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Select
                  label={index === 0 ? d.sourcingFormRfqLine : undefined}
                  value={line.rfqLineId}
                  onValueChange={(value) =>
                    setQuoteDraft({
                      ...quoteDraft,
                      lines: quoteDraft.lines.map((r, i) =>
                        i === index ? { ...r, rfqLineId: value } : r,
                      ),
                    })
                  }
                  options={[
                    { value: "", label: d.sourcingFormRfqLine },
                    ...(selectedRfq?.lines ?? []).map((rfqLine) => ({
                      value: rfqLine.id,
                      label: `${d.sourcingColLine} ${rfqLine.lineNo} — ${itemNameById.get(rfqLine.itemId) ?? rfqLine.itemId}`,
                    })),
                  ]}
                />
                <Input
                  label={index === 0 ? d.purchasingQty : undefined}
                  value={line.qty}
                  onValueChange={(value) =>
                    setQuoteDraft({
                      ...quoteDraft,
                      lines: quoteDraft.lines.map((r, i) => (i === index ? { ...r, qty: value } : r)),
                    })
                  }
                  inputMode="decimal"
                />
                <Input
                  label={index === 0 ? d.purchasingUnitPrice : undefined}
                  value={line.unitPrice}
                  onValueChange={(value) =>
                    setQuoteDraft({
                      ...quoteDraft,
                      lines: quoteDraft.lines.map((r, i) => (i === index ? { ...r, unitPrice: value } : r)),
                    })
                  }
                  inputMode="decimal"
                />
                <div className="flex items-end">
                  {quoteDraft.lines.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setQuoteDraft({
                          ...quoteDraft,
                          lines: quoteDraft.lines.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {d.purchasingRemoveLine}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setQuoteDraft({
                  ...quoteDraft,
                  lines: [...quoteDraft.lines, { rfqLineId: "", qty: "", unitPrice: "" }],
                })
              }
            >
              {d.purchasingAddLine}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setQuoteOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "quote-create"} onClick={() => void submitQuote()}>
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title={d.sourcingInviteTitle} size="md">
        <div className="flex flex-col gap-4">
          <InfoNotice>{d.sourcingInviteExpiresHint}</InfoNotice>
          <Select
            label={d.purchasingSupplier}
            value={inviteSupplierId}
            onValueChange={setInviteSupplierId}
            options={[
              { value: "", label: d.purchasingSelectSupplier },
              ...suppliersOnly.map((s) => ({
                value: s.id,
                label: supplierNameById.get(s.id) ?? s.code,
              })),
            ]}
          />
          {(() => {
            const due = dueAtParts(inviteExpiresAt);
            return (
              <div className="grid gap-2 sm:grid-cols-2">
                <DatePicker
                  label={d.sourcingFormExpiresAt}
                  value={due.date === "" ? undefined : due.date}
                  onSelect={(iso) => setInviteExpiresAt(`${iso}T${due.time === "" ? "23:59" : due.time}`)}
                  locale={locale}
                  required
                />
                <Input
                  label={d.sourcingFormExpiresAt}
                  value={due.time}
                  onValueChange={(value) =>
                    setInviteExpiresAt(`${due.date}T${value.replace(/[^\d:]/g, "")}`)
                  }
                  placeholder="HH:mm"
                  mono
                />
              </div>
            );
          })()}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setInviteOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "invite-mint"} onClick={() => void mintInvite()}>
            {d.sourcingActionMintInvite}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
