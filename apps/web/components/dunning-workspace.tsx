"use client";

/**
 * WEB-039 (PHASE-039) — the collections workspace (/sales/dunning;
 * transaction-entry archetype, matrix §3.2): five tabs over the 0056
 * dunning routes —
 *
 * 1. Letters: the register with the manual sweep runner (BR-065 fires one
 *    step per run) and the late-fee pair — charge rides the letter's
 *    invoice (one fee per invoice, L1-12), waive stamps the waiver trio.
 * 2. Policies: the ladder registry (mini-ladder chips + the late-fee
 *    summary) with activate/archive and the create dialog (the step
 *    builder enforces monotonic day thresholds client-side).
 * 3. Actions: the collection-action log + the create dialog (a
 *    PROMISE_TO_PAY requires its promised date).
 * 4. Credit reviews: the due workset (class badge) + the record-review
 *    dialog (A–D, next date, note).
 * 5. Agencies: the register + create + the shown-once portal token (the
 *    038 enrollment-secret discipline) + suspend/activate + the referral
 *    table with refer/settle/post-commission (G-39)/close.
 *
 * Writes gate in-screen on sales.dunning.manage / sales.late-fees.manage /
 * sales.collection-agencies.manage (session-derived flags the page passes);
 * every API failure renders localized through the dunning error family.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX, ReactNode } from "react";

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
  CollectionActionRow,
  CollectionAgencyRow,
  CollectionReferralRow,
  CreditReviewRow,
  DunningLetterRow,
  DunningPolicyRow,
  DunningStep,
  DunningSweepResult,
  PartnerRow,
  SalesInvoiceRow,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type WorkspaceTab = "letters" | "policies" | "actions" | "reviews" | "agencies";

/** Letter/policy/referral lifecycle tones (the neutral/primary vocabulary). */
const LETTER_TONES: Record<DunningLetterRow["status"], "primary" | "neutral"> = {
  QUEUED: "neutral",
  SENT: "primary",
  FAILED: "neutral",
};

const REFERRAL_TONES: Record<CollectionReferralRow["status"], "primary" | "neutral"> = {
  REFERRED: "primary",
  ACKNOWLEDGED: "primary",
  PARTIAL: "primary",
  SETTLED: "primary",
  COMMISSION_POSTED: "neutral",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Free-typed money (≤ 4dp) — normalized to the canonical 4dp wire form. */
const MONEY_INPUT_RE = /^\d+(\.\d{1,4})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;

const ACTION_TYPES: readonly CollectionActionRow["actionType"][] = [
  "CALL",
  "EMAIL",
  "PROMISE_TO_PAY",
  "DISPUTE",
  "FIELD_VISIT",
  "PAYMENT_PLAN",
  "WRITE_OFF_REQUEST",
  "AGENCY_REFERRAL",
  "OTHER",
];

const ACTION_OUTCOMES: readonly CollectionActionRow["outcome"][] = [
  "PENDING",
  "PROMISED",
  "BROKEN",
  "PAID",
  "ESCALATED",
  "NO_ANSWER",
  "OTHER",
];

const CHANNELS: readonly DunningStep["channel"][] = ["EMAIL", "WHATSAPP", "SMS"];

/** One draft ladder step (all inputs are strings). */
interface DraftStep {
  daysOverdue: string;
  channel: DunningStep["channel"];
  templateKey: string;
  escalate: boolean;
  referToAgency: boolean;
}

/** The create-policy draft. */
interface PolicyDraft {
  name: string;
  nameAr: string;
  isDefault: boolean;
  steps: DraftStep[];
  lateFeeMode: DunningPolicyRow["lateFeeMode"];
  lateFeeRatePct: string;
  lateFeeGraceDays: string;
  lateFeeMaxAmount: string;
  lateFeeSource: string;
}

/** The log-action draft. */
interface ActionDraft {
  partnerId: string;
  invoiceId: string;
  actionType: CollectionActionRow["actionType"];
  actionDate: string;
  outcome: CollectionActionRow["outcome"];
  promisedDate: string;
  followUpDate: string;
  amount: string;
  note: string;
}

/** The create-agency draft. */
interface AgencyDraft {
  partnerId: string;
  contactName: string;
  email: string;
  phone: string;
  commissionMode: CollectionAgencyRow["commissionMode"];
  commissionPct: string;
  flatFee: string;
}

/** The refer dialog draft. */
interface ReferralDraft {
  agencyId: string;
  partnerId: string;
  invoiceId: string;
  referredAmount: string;
  referralDate: string;
}

function emptyPolicyDraft(): PolicyDraft {
  return {
    name: "",
    nameAr: "",
    isDefault: false,
    steps: [{ daysOverdue: "7", channel: "EMAIL", templateKey: "dunning.reminder.1", escalate: false, referToAgency: false }],
    lateFeeMode: "DISABLED",
    lateFeeRatePct: "",
    lateFeeGraceDays: "0",
    lateFeeMaxAmount: "",
    lateFeeSource: "",
  };
}

function emptyActionDraft(today: string): ActionDraft {
  return {
    partnerId: "",
    invoiceId: "",
    actionType: "CALL",
    actionDate: today,
    outcome: "PENDING",
    promisedDate: "",
    followUpDate: "",
    amount: "",
    note: "",
  };
}

function emptyAgencyDraft(): AgencyDraft {
  return {
    partnerId: "",
    contactName: "",
    email: "",
    phone: "",
    commissionMode: "PCT_OF_COLLECTED",
    commissionPct: "",
    flatFee: "",
  };
}

function emptyReferralDraft(today: string): ReferralDraft {
  return { agencyId: "", partnerId: "", invoiceId: "", referredAmount: "", referralDate: today };
}

/** Free-typed money → canonical 4dp wire string (null = invalid/empty). */
function toMoney4(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (!MONEY_INPUT_RE.test(trimmed)) {
    return null;
  }
  const separator = trimmed.indexOf(".");
  if (separator === -1) {
    return `${trimmed}.0000`;
  }
  const whole = trimmed.slice(0, separator);
  const frac = trimmed.slice(separator + 1);
  return `${whole}.${frac.padEnd(4, "0")}`;
}

/**
 * Stable dunning error family → honest messages (localizedApiError covers
 * the generic families; the *_NOT_FOUND not-founds render identically).
 */
function dunningError(
  d: Dictionary,
  failure: { error: ApiErrorBody; retryAfterSeconds?: number },
): string {
  switch (failure.error.code) {
    case "DUNNING_POLICY_NOT_FOUND":
    case "COLLECTION_AGENCY_NOT_FOUND":
    case "REFERRAL_NOT_FOUND":
      return d.errorsNotFound;
    case "DUNNING_POLICY_STEPS_INVALID":
      return d.dunningErrSteps;
    case "LATE_FEE_CONFIG_INVALID":
      return d.dunningErrLateFee;
    case "LATE_FEE_ALREADY_CHARGED":
      return d.dunningErrFeeAlreadyCharged;
    case "LATE_FEE_NOT_WAIVABLE":
      return d.dunningErrFeeNotWaivable;
    case "CREDIT_REVIEW_INVALID":
      return d.dunningErrReview;
    case "REFERRAL_STATE_INVALID":
      return d.dunningErrReferralState;
    case "COMMISSION_ACCOUNT_UNMAPPED":
      return d.dunningErrCommissionUnmapped;
    case "SALES_DOCUMENT_STATE":
      return d.returnsErrState;
    default:
      return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }
}

function letterStatusLabel(d: Dictionary, status: DunningLetterRow["status"]): string {
  const map: Record<DunningLetterRow["status"], string> = {
    QUEUED: d.dunningLetterQueued,
    SENT: d.dunningLetterSent,
    FAILED: d.dunningLetterFailed,
  };
  return map[status];
}

function channelLabel(d: Dictionary, channel: string): string {
  const map: Record<string, string> = {
    EMAIL: d.dunningChannelEmail,
    WHATSAPP: d.dunningChannelWhatsapp,
    SMS: d.dunningChannelSms,
  };
  return map[channel] ?? channel;
}

function policyStatusLabel(d: Dictionary, status: string): string {
  const map: Record<string, string> = {
    DRAFT: d.dunningPolicyDraft,
    ACTIVE: d.dunningPolicyActive,
    ARCHIVED: d.dunningPolicyArchived,
  };
  return map[status] ?? status;
}

function feeModeLabel(d: Dictionary, mode: string): string {
  const map: Record<string, string> = {
    DISABLED: d.dunningFeeModeDisabled,
    CONTRACT_RATE: d.dunningFeeModeContractRate,
    STATUTORY_CAP: d.dunningFeeModeStatutoryCap,
  };
  return map[mode] ?? mode;
}

function actionTypeLabel(d: Dictionary, actionType: string): string {
  const map: Record<string, string> = {
    CALL: d.dunningActionTypeCall,
    EMAIL: d.dunningActionTypeEmail,
    PROMISE_TO_PAY: d.dunningActionTypePromiseToPay,
    DISPUTE: d.dunningActionTypeDispute,
    FIELD_VISIT: d.dunningActionTypeFieldVisit,
    PAYMENT_PLAN: d.dunningActionTypePaymentPlan,
    WRITE_OFF_REQUEST: d.dunningActionTypeWriteOffRequest,
    AGENCY_REFERRAL: d.dunningActionTypeAgencyReferral,
    OTHER: d.dunningActionTypeOther,
  };
  return map[actionType] ?? actionType;
}

function outcomeLabel(d: Dictionary, outcome: string): string {
  const map: Record<string, string> = {
    PENDING: d.dunningOutcomePending,
    PROMISED: d.dunningOutcomePromised,
    BROKEN: d.dunningOutcomeBroken,
    PAID: d.dunningOutcomePaid,
    ESCALATED: d.dunningOutcomeEscalated,
    NO_ANSWER: d.dunningOutcomeNoAnswer,
    OTHER: d.dunningOutcomeOther,
  };
  return map[outcome] ?? outcome;
}

function referralStatusLabel(d: Dictionary, status: CollectionReferralRow["status"]): string {
  const map: Record<CollectionReferralRow["status"], string> = {
    REFERRED: d.dunningReferralReferred,
    ACKNOWLEDGED: d.dunningReferralAcknowledged,
    PARTIAL: d.dunningReferralPartial,
    SETTLED: d.dunningReferralSettled,
    COMMISSION_POSTED: d.dunningReferralCommissionPosted,
    CLOSED: d.dunningReferralClosed,
    CANCELLED: d.dunningReferralCancelled,
  };
  return map[status];
}

function commissionModeLabel(d: Dictionary, mode: string): string {
  return mode === "PCT_OF_COLLECTED"
    ? d.dunningCommissionPctOfCollected
    : d.dunningCommissionFlatFee;
}

/** Narrows the JSONB steps defensively (the ladder is validated server-side). */
function dunningStepsOf(policy: DunningPolicyRow): DunningStep[] {
  const steps: DunningStep[] = [];
  if (!Array.isArray(policy.steps)) {
    return steps;
  }
  for (const raw of policy.steps) {
    if (!isRecord(raw)) {
      continue;
    }
    const channel = raw.channel;
    if (
      typeof raw.stepNo !== "number" ||
      typeof raw.daysOverdue !== "number" ||
      (channel !== "EMAIL" && channel !== "WHATSAPP" && channel !== "SMS") ||
      typeof raw.templateKey !== "string"
    ) {
      continue;
    }
    steps.push({
      stepNo: raw.stepNo,
      daysOverdue: raw.daysOverdue,
      channel,
      templateKey: raw.templateKey,
      escalate: raw.escalate === true,
      referToAgency: raw.referToAgency === true,
    });
  }
  return steps;
}

/** The late-fee summary chips under a policy (composed from templates). */
function lateFeeSummary(d: Dictionary, policy: DunningPolicyRow): ReactNode {
  if (policy.lateFeeMode === "DISABLED") {
    return <span className="text-sm text-gray-600">{feeModeLabel(d, "DISABLED")}</span>;
  }
  const parts: string[] = [feeModeLabel(d, policy.lateFeeMode)];
  if (policy.lateFeeRatePct !== null) {
    parts.push(formatMessage(d.dunningLateFeeRateLabel, { rate: policy.lateFeeRatePct }));
  }
  if (policy.lateFeeGraceDays > 0) {
    parts.push(formatMessage(d.dunningLateFeeGraceLabel, { days: policy.lateFeeGraceDays }));
  }
  if (policy.lateFeeMaxAmount !== null) {
    parts.push(formatMessage(d.dunningLateFeeMaxLabel, { amount: policy.lateFeeMaxAmount }));
  }
  return (
    <span className="font-mono text-xs text-gray-700" dir="ltr">
      {parts.join(" · ")}
    </span>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DunningWorkspace({
  locale,
  initialLetters,
  initialPolicies,
  initialActions,
  initialReviews,
  initialAgencies,
  initialReferrals,
  partners,
  invoices,
  canDun,
  canFees,
  canAgencies,
}: {
  locale: Locale;
  initialLetters: readonly DunningLetterRow[];
  initialPolicies: readonly DunningPolicyRow[];
  initialActions: readonly CollectionActionRow[];
  initialReviews: readonly CreditReviewRow[];
  initialAgencies: readonly CollectionAgencyRow[];
  initialReferrals: readonly CollectionReferralRow[];
  partners: readonly PartnerRow[];
  invoices: readonly SalesInvoiceRow[];
  canDun: boolean;
  canFees: boolean;
  canAgencies: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<WorkspaceTab>("letters");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [letters, setLetters] = useState<readonly DunningLetterRow[]>(initialLetters);
  const [policies, setPolicies] = useState<readonly DunningPolicyRow[]>(initialPolicies);
  const [actions, setActions] = useState<readonly CollectionActionRow[]>(initialActions);
  const [reviews, setReviews] = useState<readonly CreditReviewRow[]>(initialReviews);
  const [agencies, setAgencies] = useState<readonly CollectionAgencyRow[]>(initialAgencies);
  const [referrals, setReferrals] = useState<readonly CollectionReferralRow[]>(initialReferrals);

  // -- letters tab: the sweep + the fee pair --------------------------------------
  const [sweepAsOf, setSweepAsOf] = useState("");
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [waiveTarget, setWaiveTarget] = useState<DunningLetterRow | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  // -- policies tab -----------------------------------------------------------------
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(emptyPolicyDraft);

  // -- actions tab --------------------------------------------------------------------
  const [actionOpen, setActionOpen] = useState(false);
  const [actionDraft, setActionDraft] = useState<ActionDraft>(() => emptyActionDraft(todayIso()));

  // -- reviews tab ----------------------------------------------------------------------
  const [reviewTarget, setReviewTarget] = useState<CreditReviewRow | null>(null);
  const [reviewClass, setReviewClass] = useState("");
  const [reviewNextAt, setReviewNextAt] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  // -- agencies tab ------------------------------------------------------------------------
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [agencyDraft, setAgencyDraft] = useState<AgencyDraft>(emptyAgencyDraft);
  /** The shown-once minted token (the 038 enrollment-secret discipline). */
  const [mintedToken, setMintedToken] = useState<{ token: string; agencyId: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [referDraft, setReferDraft] = useState<ReferralDraft>(() => emptyReferralDraft(todayIso()));
  const [settleTarget, setSettleTarget] = useState<CollectionReferralRow | null>(null);
  const [settleAmount, setSettleAmount] = useState("");

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const invoiceLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const invoice of invoices) {
      const partner = partnerNameById.get(invoice.customerId) ?? invoice.customerId.slice(0, 8);
      map.set(
        invoice.id,
        `${invoice.invoiceNo ?? invoice.id.slice(0, 8)} — ${partner} · ${invoice.invoiceDate}`,
      );
    }
    return map;
  }, [invoices, partnerNameById]);

  const customersOnly = useMemo(
    () => partners.filter((p) => p.kind === "CUSTOMER" || p.kind === "BOTH"),
    [partners],
  );

  const activeAgencies = useMemo(
    () => agencies.filter((agency) => agency.status === "ACTIVE"),
    [agencies],
  );

  function partnerLabel(partnerId: string): string {
    return partnerNameById.get(partnerId) ?? partnerId;
  }

  function invoiceLabel(invoiceId: string): string {
    return invoiceLabelById.get(invoiceId) ?? invoiceId.slice(0, 8);
  }

  function agencyLabel(agencyId: string): string {
    const agency = agencies.find((row) => row.id === agencyId);
    if (agency === undefined) {
      return agencyId.slice(0, 8);
    }
    return partnerLabel(agency.partnerId);
  }

  async function call<T>(key: string, fn: () => Promise<ApiResult<T>>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) {
      setError(dunningError(d, result));
      return undefined;
    }
    return result.data;
  }

  async function refreshLetters(): Promise<void> {
    const fresh = await bffFetch<readonly DunningLetterRow[]>("sales/dunning/letters?limit=200");
    if (fresh.ok) {
      setLetters(fresh.data);
    }
    router.refresh();
  }

  async function refreshReviews(): Promise<void> {
    const fresh = await bffFetch<readonly CreditReviewRow[]>("sales/credit-reviews?due=1");
    if (fresh.ok) {
      setReviews(fresh.data);
    }
    router.refresh();
  }

  // -- letters tab actions ---------------------------------------------------------

  async function runSweep(): Promise<void> {
    const body = sweepAsOf === "" ? {} : { asOf: sweepAsOf };
    const result = await call<DunningSweepResult>("sweep", () =>
      bffFetch<DunningSweepResult>("sales/dunning/run", { method: "POST", body }),
    );
    if (result !== undefined) {
      setSweepResult(
        formatMessage(d.dunningSweepResult, {
          letters: result.lettersFired,
          escalated: result.escalated,
          scanned: result.scanned,
        }),
      );
      toast({ tone: "success", title: d.dunningToastSweepDone });
      void refreshLetters();
    }
  }

  async function chargeFee(letter: DunningLetterRow): Promise<void> {
    const result = await call<unknown>(`charge-${letter.id}`, () =>
      bffFetch<unknown>("sales/dunning/charge-fee", {
        method: "POST",
        body: { invoiceId: letter.invoiceId },
      }),
    );
    if (result !== undefined) {
      toast({ tone: "success", title: d.dunningToastDone });
      void refreshLetters();
    }
  }

  async function submitWaive(): Promise<void> {
    // The API's waiveFeeSchema requires a 3–500 char reason.
    const reason = waiveReason.trim();
    if (waiveTarget === null || reason.length < 3) {
      setError(d.errorsValidation);
      return;
    }
    const id = waiveTarget.id;
    const result = await call<DunningLetterRow>(`waive-${id}`, () =>
      bffFetch<DunningLetterRow>(`sales/dunning/letters/${id}/waive-fee`, {
        method: "POST",
        body: { reason },
      }),
    );
    if (result !== undefined) {
      setWaiveTarget(null);
      setWaiveReason("");
      setLetters((rows) => rows.map((row) => (row.id === result.id ? result : row)));
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  // -- policies tab actions -----------------------------------------------------------

  function policyReady(): boolean {
    const days = policyDraft.steps.map((step) => Number(step.daysOverdue));
    const graceDays = Number(policyDraft.lateFeeGraceDays);
    return (
      policyDraft.name.trim() !== "" &&
      policyDraft.steps.length > 0 &&
      days.every((value) => Number.isInteger(value) && value >= 1) &&
      days.every((value, index) => index === 0 || value > days[index - 1]!) &&
      policyDraft.steps.every((step) => step.templateKey.trim() !== "") &&
      Number.isInteger(graceDays) &&
      graceDays >= 0 &&
      (policyDraft.lateFeeMode === "DISABLED" ||
        (PCT_RE.test(policyDraft.lateFeeRatePct.trim()) &&
          (policyDraft.lateFeeMode !== "STATUTORY_CAP" ||
            policyDraft.lateFeeSource.trim().length >= 3))) &&
      (policyDraft.lateFeeMaxAmount.trim() === "" ||
        MONEY_INPUT_RE.test(policyDraft.lateFeeMaxAmount.trim()))
    );
  }

  async function createPolicy(): Promise<void> {
    if (!policyReady()) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<DunningPolicyRow>("policy-create", () =>
      bffFetch<DunningPolicyRow>("sales/dunning/policies", {
        method: "POST",
        body: {
          name: policyDraft.name.trim(),
          nameAr: policyDraft.nameAr.trim() === "" ? null : policyDraft.nameAr.trim(),
          partnerTierIds: [],
          isDefault: policyDraft.isDefault,
          steps: policyDraft.steps.map((step, index) => ({
            stepNo: index + 1,
            daysOverdue: Number(step.daysOverdue),
            channel: step.channel,
            templateKey: step.templateKey.trim(),
            escalate: step.escalate,
            referToAgency: step.referToAgency,
          })),
          lateFeeMode: policyDraft.lateFeeMode,
          lateFeeRatePct:
            policyDraft.lateFeeMode === "DISABLED" ? null : policyDraft.lateFeeRatePct.trim(),
          lateFeeGraceDays: Number(policyDraft.lateFeeGraceDays || "0"),
          lateFeeMaxAmount: toMoney4(policyDraft.lateFeeMaxAmount),
          lateFeeSource:
            policyDraft.lateFeeMode === "STATUTORY_CAP" && policyDraft.lateFeeSource.trim() !== ""
              ? policyDraft.lateFeeSource.trim()
              : null,
          note: null,
        },
      }),
    );
    if (created !== undefined) {
      setPolicyOpen(false);
      setPolicyDraft(emptyPolicyDraft());
      setPolicies((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  async function policyAction(
    policy: DunningPolicyRow,
    action: "activate" | "archive",
  ): Promise<void> {
    const updated = await call<DunningPolicyRow>(`${action}-${policy.id}`, () =>
      bffFetch<DunningPolicyRow>(`sales/dunning/policies/${policy.id}/${action}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setPolicies((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  // -- actions tab actions --------------------------------------------------------------

  function actionReady(): boolean {
    const amount4 = toMoney4(actionDraft.amount);
    return (
      actionDraft.partnerId !== "" &&
      DATE_RE.test(actionDraft.actionDate) &&
      (actionDraft.actionType !== "PROMISE_TO_PAY" || DATE_RE.test(actionDraft.promisedDate)) &&
      (actionDraft.promisedDate === "" || DATE_RE.test(actionDraft.promisedDate)) &&
      (actionDraft.followUpDate === "" || DATE_RE.test(actionDraft.followUpDate)) &&
      (actionDraft.amount.trim() === "" || amount4 !== null)
    );
  }

  async function createAction(): Promise<void> {
    if (!actionReady()) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<CollectionActionRow>("action-create", () =>
      bffFetch<CollectionActionRow>("sales/dunning/actions", {
        method: "POST",
        body: {
          partnerId: actionDraft.partnerId,
          invoiceId: actionDraft.invoiceId === "" ? null : actionDraft.invoiceId,
          actionType: actionDraft.actionType,
          actionDate: actionDraft.actionDate,
          outcome: actionDraft.outcome,
          promisedDate: actionDraft.promisedDate === "" ? null : actionDraft.promisedDate,
          followUpDate: actionDraft.followUpDate === "" ? null : actionDraft.followUpDate,
          amount: toMoney4(actionDraft.amount),
          note: actionDraft.note.trim() === "" ? null : actionDraft.note.trim(),
        },
      }),
    );
    if (created !== undefined) {
      setActionOpen(false);
      setActionDraft(emptyActionDraft(todayIso()));
      setActions((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  // -- reviews tab actions -----------------------------------------------------------------

  async function submitReview(): Promise<void> {
    if (reviewTarget === null) {
      return;
    }
    const partnerId = reviewTarget.partnerId;
    const result = await call<unknown>(`review-${partnerId}`, () =>
      bffFetch<unknown>(`sales/credit-reviews/${partnerId}`, {
        method: "POST",
        body: {
          scoreClass: reviewClass === "" ? null : reviewClass,
          nextReviewAt: reviewNextAt === "" ? null : reviewNextAt,
          note: reviewNote.trim() === "" ? null : reviewNote.trim(),
        },
      }),
    );
    if (result !== undefined) {
      setReviewTarget(null);
      setReviewClass("");
      setReviewNextAt("");
      setReviewNote("");
      toast({ tone: "success", title: d.dunningToastDone });
      void refreshReviews();
    }
  }

  // -- agencies tab actions ---------------------------------------------------------------------

  function agencyReady(): boolean {
    return (
      agencyDraft.partnerId !== "" &&
      ((agencyDraft.commissionMode === "PCT_OF_COLLECTED" && PCT_RE.test(agencyDraft.commissionPct.trim())) ||
        (agencyDraft.commissionMode === "FLAT_FEE" && toMoney4(agencyDraft.flatFee) !== null))
    );
  }

  async function createAgency(): Promise<void> {
    if (!agencyReady()) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<CollectionAgencyRow>("agency-create", () =>
      bffFetch<CollectionAgencyRow>("sales/collection-agencies", {
        method: "POST",
        body: {
          partnerId: agencyDraft.partnerId,
          contactName: agencyDraft.contactName.trim() === "" ? null : agencyDraft.contactName.trim(),
          email: agencyDraft.email.trim() === "" ? null : agencyDraft.email.trim(),
          phone: agencyDraft.phone.trim() === "" ? null : agencyDraft.phone.trim(),
          commissionMode: agencyDraft.commissionMode,
          commissionPct:
            agencyDraft.commissionMode === "PCT_OF_COLLECTED"
              ? agencyDraft.commissionPct.trim()
              : null,
          flatFee:
            agencyDraft.commissionMode === "FLAT_FEE" ? toMoney4(agencyDraft.flatFee) : null,
        },
      }),
    );
    if (created !== undefined) {
      setAgencyOpen(false);
      setAgencyDraft(emptyAgencyDraft());
      setAgencies((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  async function issueToken(agency: CollectionAgencyRow): Promise<void> {
    const result = await call<{ token: string }>(`token-${agency.id}`, () =>
      bffFetch<{ token: string }>(`sales/collection-agencies/${agency.id}/issue-token`, {
        method: "POST",
        body: {},
      }),
    );
    if (result !== undefined) {
      setTokenCopied(false);
      setMintedToken({ token: result.token, agencyId: agency.id });
      toast({ tone: "success", title: d.dunningToastDone });
      void refreshAgencies();
    }
  }

  async function copyToken(): Promise<void> {
    if (mintedToken === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(mintedToken.token);
      setTokenCopied(true);
      toast({ tone: "success", title: d.sourcingToastCopied });
    } catch {
      setError(d.errorsGeneric);
    }
  }

  async function refreshAgencies(): Promise<void> {
    const [freshAgencies, freshReferrals] = await Promise.all([
      bffFetch<readonly CollectionAgencyRow[]>("sales/collection-agencies"),
      bffFetch<readonly CollectionReferralRow[]>("sales/collection-referrals"),
    ]);
    if (freshAgencies.ok) {
      setAgencies(freshAgencies.data);
    }
    if (freshReferrals.ok) {
      setReferrals(freshReferrals.data);
    }
    router.refresh();
  }

  async function agencyStatusAction(
    agency: CollectionAgencyRow,
    action: "suspend" | "activate",
  ): Promise<void> {
    const updated = await call<CollectionAgencyRow>(`${action}-${agency.id}`, () =>
      bffFetch<CollectionAgencyRow>(`sales/collection-agencies/${agency.id}/${action}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setAgencies((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  function referReady(): boolean {
    return (
      referDraft.agencyId !== "" &&
      referDraft.partnerId !== "" &&
      toMoney4(referDraft.referredAmount) !== null &&
      DATE_RE.test(referDraft.referralDate)
    );
  }

  async function submitRefer(): Promise<void> {
    if (!referReady()) {
      setError(d.errorsValidation);
      return;
    }
    const created = await call<CollectionReferralRow>("refer-create", () =>
      bffFetch<CollectionReferralRow>("sales/collection-referrals", {
        method: "POST",
        body: {
          agencyId: referDraft.agencyId,
          partnerId: referDraft.partnerId,
          invoiceId: referDraft.invoiceId === "" ? null : referDraft.invoiceId,
          referredAmount: toMoney4(referDraft.referredAmount),
          referralDate: referDraft.referralDate,
        },
      }),
    );
    if (created !== undefined) {
      setReferOpen(false);
      setReferDraft(emptyReferralDraft(todayIso()));
      setReferrals((rows) => [created, ...rows]);
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  async function submitSettle(): Promise<void> {
    if (settleTarget === null) {
      return;
    }
    const amount = toMoney4(settleAmount);
    if (amount === null) {
      setError(d.errorsValidation);
      return;
    }
    const id = settleTarget.id;
    const updated = await call<CollectionReferralRow>(`settle-${id}`, () =>
      bffFetch<CollectionReferralRow>(`sales/collection-referrals/${id}/settle`, {
        method: "POST",
        body: { settledAmount: amount },
      }),
    );
    if (updated !== undefined) {
      setSettleTarget(null);
      setSettleAmount("");
      setReferrals((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  async function referralAction(
    referral: CollectionReferralRow,
    action: "post-commission" | "close",
  ): Promise<void> {
    const updated = await call<CollectionReferralRow>(`${action}-${referral.id}`, () =>
      bffFetch<CollectionReferralRow>(`sales/collection-referrals/${referral.id}/${action}`, {
        method: "POST",
        body: {},
      }),
    );
    if (updated !== undefined) {
      setReferrals((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      toast({ tone: "success", title: d.dunningToastDone });
      router.refresh();
    }
  }

  // -- render -------------------------------------------------------------------------------------

  const tabItems = [
    { value: "letters", label: d.dunningTabLetters },
    { value: "policies", label: d.dunningTabPolicies },
    { value: "actions", label: d.dunningTabActions },
    { value: "reviews", label: d.dunningTabReviews },
    ...(canAgencies ? [{ value: "agencies", label: d.dunningTabAgencies }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs
        items={tabItems}
        value={tab}
        onValueChange={(value) => setTab(value as WorkspaceTab)}
      >
        {tab === "letters" && (
          <div className="flex flex-col gap-4">
            <Card title={d.dunningActionRunSweep}>
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.dunningSweepHint}</InfoNotice>
                {sweepResult !== null && <InfoNotice>{sweepResult}</InfoNotice>}
                {canDun && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-56">
                      <DatePicker
                        label={`${d.dunningSweepAsOfLabel} (${d.sourcingFormOptional})`}
                        value={sweepAsOf === "" ? undefined : sweepAsOf}
                        onSelect={(iso) => setSweepAsOf(iso)}
                        locale={locale}
                      />
                    </div>
                    <Button
                      variant="primary"
                      loading={busy === "sweep"}
                      onClick={() => void runSweep()}
                    >
                      {d.dunningActionRunSweep}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
            <Card title={d.dunningTabLetters}>
              <DataTable
                columns={[
                  {
                    id: "step",
                    header: activeLocaleHeader(d.dunningColStep),
                    accessor: (row: DunningLetterRow) => String(row.stepNo),
                    numeric: true,
                    render: (row: DunningLetterRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.stepNo}
                      </span>
                    ),
                  },
                  {
                    id: "days",
                    header: activeLocaleHeader(d.dunningColDays),
                    accessor: (row: DunningLetterRow) => String(row.daysOverdue),
                    numeric: true,
                    sortable: true,
                    render: (row: DunningLetterRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMessage(d.dunningDaysValue, { days: row.daysOverdue })}
                      </span>
                    ),
                  },
                  {
                    id: "channel",
                    header: activeLocaleHeader(d.dunningColChannel),
                    accessor: (row: DunningLetterRow) => row.channel,
                    render: (row: DunningLetterRow) => channelLabel(d, row.channel),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.returnsColStatus),
                    accessor: (row: DunningLetterRow) => row.status,
                    render: (row: DunningLetterRow) => (
                      <Badge tone={LETTER_TONES[row.status]}>
                        {letterStatusLabel(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "partner",
                    header: activeLocaleHeader(d.dunningColPartner),
                    accessor: (row: DunningLetterRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "invoice",
                    header: activeLocaleHeader(d.dunningColInvoice),
                    accessor: (row: DunningLetterRow) => invoiceLabel(row.invoiceId),
                    render: (row: DunningLetterRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {invoiceLabel(row.invoiceId)}
                      </span>
                    ),
                  },
                  {
                    id: "letterDate",
                    header: activeLocaleHeader(d.dunningColLetterDate),
                    accessor: (row: DunningLetterRow) => row.letterDate,
                    sortable: true,
                    render: (row: DunningLetterRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.letterDate}
                      </span>
                    ),
                  },
                  {
                    id: "sentAt",
                    header: activeLocaleHeader(d.dunningColSent),
                    accessor: (row: DunningLetterRow) => row.sentAt ?? "",
                    render: (row: DunningLetterRow) =>
                      row.sentAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {formatDateTime(row.sentAt, locale)}
                        </span>
                      ),
                  },
                  {
                    id: "fee",
                    header: activeLocaleHeader(d.dunningColFee),
                    accessor: (row: DunningLetterRow) => row.feeAmount ?? "",
                    numeric: true,
                    render: (row: DunningLetterRow) =>
                      row.feeAmount === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {row.feeAmount}
                        </span>
                      ),
                  },
                  {
                    id: "feeInvoice",
                    header: activeLocaleHeader(d.dunningColFeeInvoice),
                    accessor: (row: DunningLetterRow) => row.feeInvoiceId ?? "",
                    render: (row: DunningLetterRow) =>
                      row.feeInvoiceId === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        // The fee invoice is accounting evidence — the raw
                        // id is the honest link until a doc-no lookup rides
                        // the letter row (the referral commissionEntryNo rule).
                        <span className="font-mono text-xs" dir="ltr">
                          {row.feeInvoiceId.slice(0, 8)}
                        </span>
                      ),
                  },
                  {
                    id: "waiver",
                    header: activeLocaleHeader(d.dunningColWaiver),
                    accessor: (row: DunningLetterRow) => row.feeWaivedAt ?? "",
                    render: (row: DunningLetterRow) =>
                      row.feeWaivedAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span title={row.feeWaiverReason ?? undefined}>
                          <Badge tone="neutral">{d.dunningFeeWaived}</Badge>
                        </span>
                      ),
                  },
                ]}
                rows={[...letters]}
                rowKey={(row) => row.id}
                rowActions={
                  canFees
                    ? [
                        {
                          id: "charge-fee",
                          label: d.dunningActionChargeFee,
                          onSelect: (row: DunningLetterRow) => {
                            if (row.feeAmount !== null) {
                              return;
                            }
                            if (window.confirm(d.dunningConfirmCharge)) {
                              void chargeFee(row);
                            }
                          },
                        },
                        {
                          id: "waive-fee",
                          label: d.dunningActionWaiveFee,
                          onSelect: (row: DunningLetterRow) => {
                            if (row.feeAmount === null || row.feeWaivedAt !== null) {
                              return;
                            }
                            setError(null);
                            setWaiveReason("");
                            setWaiveTarget(row);
                          },
                        },
                      ]
                    : undefined
                }
                empty={{ title: d.dunningLettersEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "policies" && (
          <div className="flex flex-col gap-4">
            {canDun && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    setPolicyDraft(emptyPolicyDraft());
                    setPolicyOpen(true);
                  }}
                >
                  {d.dunningActionCreatePolicy}
                </Button>
              </div>
            )}
            {policies.length === 0 ? (
              <Card title={d.dunningTabPolicies}>
                <p className="text-sm text-gray-600">{d.dunningPoliciesEmpty}</p>
              </Card>
            ) : (
              policies.map((policy) => {
                const steps = dunningStepsOf(policy);
                return (
                  <Card
                    key={policy.id}
                    title={localizedName(policy.name, policy.nameAr, locale)}
                    actions={
                      canDun ? (
                        <div className="flex gap-2">
                          {policy.status !== "ACTIVE" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy === `activate-${policy.id}`}
                              onClick={() => {
                                if (window.confirm(d.dunningConfirmActivate)) {
                                  void policyAction(policy, "activate");
                                }
                              }}
                            >
                              {d.dunningActionActivate}
                            </Button>
                          )}
                          {policy.status !== "ARCHIVED" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy === `archive-${policy.id}`}
                              onClick={() => {
                                if (window.confirm(d.dunningConfirmArchive)) {
                                  void policyAction(policy, "archive");
                                }
                              }}
                            >
                              {d.dunningActionArchive}
                            </Button>
                          )}
                        </div>
                      ) : undefined
                    }
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={policy.status === "ACTIVE" ? "primary" : "neutral"}>
                          {policyStatusLabel(d, policy.status)}
                        </Badge>
                        {policy.isDefault && <Badge tone="primary">{d.dunningDefaultBadge}</Badge>}
                      </div>
                      <div>
                        <p className="mb-1 text-sm font-medium text-gray-800">
                          {d.dunningLadderTitle}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {steps.map((step) => (
                            <span
                              key={step.stepNo}
                              className="inline-flex items-center gap-1 rounded-sm border border-subtle bg-surface-sunken px-2 py-1 text-xs text-gray-700"
                            >
                              <span className="font-mono tabular-nums" dir="ltr">
                                {step.stepNo} · +{step.daysOverdue}d · {step.channel}
                              </span>
                              {step.escalate && (
                                <Badge tone="neutral">{d.dunningEscalateBadge}</Badge>
                              )}
                              {step.referToAgency && (
                                <Badge tone="neutral">{d.dunningReferAgencyBadge}</Badge>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-sm font-medium text-gray-800">
                          {d.dunningLateFeeTitle}
                        </p>
                        {lateFeeSummary(d, policy)}
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        )}

        {tab === "actions" && (
          <div className="flex flex-col gap-4">
            {canDun && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    setActionDraft(emptyActionDraft(todayIso()));
                    setActionOpen(true);
                  }}
                >
                  {d.dunningActionLogTitle}
                </Button>
              </div>
            )}
            <Card title={d.dunningTabActions}>
              <DataTable
                columns={[
                  {
                    id: "actionDate",
                    header: activeLocaleHeader(d.dunningColActionDate),
                    accessor: (row: CollectionActionRow) => row.actionDate,
                    sortable: true,
                    render: (row: CollectionActionRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.actionDate}
                      </span>
                    ),
                  },
                  {
                    id: "partner",
                    header: activeLocaleHeader(d.dunningColPartner),
                    accessor: (row: CollectionActionRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "invoice",
                    header: activeLocaleHeader(d.dunningColInvoice),
                    accessor: (row: CollectionActionRow) => row.invoiceId ?? "",
                    render: (row: CollectionActionRow) =>
                      row.invoiceId === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {invoiceLabel(row.invoiceId)}
                        </span>
                      ),
                  },
                  {
                    id: "actionType",
                    header: activeLocaleHeader(d.dunningColActionType),
                    accessor: (row: CollectionActionRow) => row.actionType,
                    render: (row: CollectionActionRow) => actionTypeLabel(d, row.actionType),
                  },
                  {
                    id: "outcome",
                    header: activeLocaleHeader(d.dunningColOutcome),
                    accessor: (row: CollectionActionRow) => row.outcome,
                    render: (row: CollectionActionRow) => (
                      <Badge tone={row.outcome === "PAID" ? "primary" : "neutral"}>
                        {outcomeLabel(d, row.outcome)}
                      </Badge>
                    ),
                  },
                  {
                    id: "promisedDate",
                    header: activeLocaleHeader(d.dunningColPromised),
                    accessor: (row: CollectionActionRow) => row.promisedDate ?? "",
                    render: (row: CollectionActionRow) =>
                      row.promisedDate === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.promisedDate}
                        </span>
                      ),
                  },
                  {
                    id: "amount",
                    header: activeLocaleHeader(d.dunningColAmount),
                    accessor: (row: CollectionActionRow) => row.amount ?? "",
                    numeric: true,
                    render: (row: CollectionActionRow) =>
                      row.amount === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {row.amount}
                        </span>
                      ),
                  },
                  {
                    id: "note",
                    header: activeLocaleHeader(d.dunningFormNote),
                    accessor: (row: CollectionActionRow) => row.note ?? "—",
                  },
                ]}
                rows={[...actions]}
                rowKey={(row) => row.id}
                empty={{ title: d.dunningActionsEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "reviews" && (
          <div className="flex flex-col gap-4">
            <Card title={d.dunningTabReviews}>
              <DataTable
                columns={[
                  {
                    id: "code",
                    header: activeLocaleHeader(d.dunningColCode),
                    accessor: (row: CreditReviewRow) => row.code,
                    mono: true,
                    render: (row: CreditReviewRow) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.code}
                      </span>
                    ),
                  },
                  {
                    id: "name",
                    header: activeLocaleHeader(d.dunningColPartner),
                    accessor: (row: CreditReviewRow) =>
                      localizedName(row.name, row.nameAr, locale),
                  },
                  {
                    id: "class",
                    header: activeLocaleHeader(d.dunningColClass),
                    accessor: (row: CreditReviewRow) => row.creditScoreClass ?? "",
                    render: (row: CreditReviewRow) =>
                      row.creditScoreClass === null ? (
                        <Badge tone="neutral">{d.dunningNoClass}</Badge>
                      ) : (
                        <Badge tone="primary" mono>
                          {row.creditScoreClass}
                        </Badge>
                      ),
                  },
                  {
                    id: "next",
                    header: activeLocaleHeader(d.dunningColNextReview),
                    accessor: (row: CreditReviewRow) => row.nextCreditReviewAt ?? "",
                    sortable: true,
                    render: (row: CreditReviewRow) =>
                      row.nextCreditReviewAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.nextCreditReviewAt}
                        </span>
                      ),
                  },
                  {
                    id: "last",
                    header: activeLocaleHeader(d.dunningColLastReview),
                    accessor: (row: CreditReviewRow) => row.lastCreditReviewAt ?? "",
                    render: (row: CreditReviewRow) =>
                      row.lastCreditReviewAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.lastCreditReviewAt}
                        </span>
                      ),
                  },
                  {
                    id: "note",
                    header: activeLocaleHeader(d.dunningFormReviewNote),
                    accessor: (row: CreditReviewRow) => row.creditReviewNote ?? "—",
                  },
                ]}
                rows={[...reviews]}
                rowKey={(row) => row.partnerId}
                rowActions={
                  canDun
                    ? [
                        {
                          id: "review",
                          label: d.dunningRecordReviewTitle,
                          onSelect: (row: CreditReviewRow) => {
                            setError(null);
                            setReviewClass("");
                            setReviewNextAt("");
                            setReviewNote("");
                            setReviewTarget(row);
                          },
                        },
                      ]
                    : undefined
                }
                empty={{ title: d.dunningReviewsEmpty }}
              />
            </Card>
          </div>
        )}

        {tab === "agencies" && canAgencies && (
          <div className="flex flex-col gap-4">
            {mintedToken !== null && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
              >
                <p className="font-semibold">{d.dunningAgencyTokenTitle}</p>
                <p>{d.dunningAgencyTokenOnce}</p>
                <p className="text-xs">
                  {d.dunningColAgency}: {agencyLabel(mintedToken.agencyId)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="max-w-full overflow-x-auto rounded border border-warning-border bg-surface-card px-2 py-1 font-mono text-xs text-gray-900"
                  >
                    {mintedToken.token}
                  </code>
                  <Button variant="secondary" size="sm" onClick={() => void copyToken()}>
                    {tokenCopied ? d.sourcingActionCopyDone : d.sourcingActionCopy}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMintedToken(null);
                      setTokenCopied(false);
                    }}
                  >
                    {d.sourcingActionDismiss}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setAgencyDraft(emptyAgencyDraft());
                  setAgencyOpen(true);
                }}
              >
                {d.dunningAgencyCreateTitle}
              </Button>
            </div>
            <Card title={d.dunningTabAgencies}>
              <DataTable
                columns={[
                  {
                    id: "agency",
                    header: activeLocaleHeader(d.dunningColAgency),
                    accessor: (row: CollectionAgencyRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "contact",
                    header: activeLocaleHeader(d.dunningColContact),
                    accessor: (row: CollectionAgencyRow) => row.contactName ?? "—",
                  },
                  {
                    id: "email",
                    header: activeLocaleHeader(d.dunningFormEmail),
                    accessor: (row: CollectionAgencyRow) => row.email ?? "—",
                    render: (row: CollectionAgencyRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.email ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "phone",
                    header: activeLocaleHeader(d.dunningFormPhone),
                    accessor: (row: CollectionAgencyRow) => row.phone ?? "—",
                    render: (row: CollectionAgencyRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.phone ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "commission",
                    header: activeLocaleHeader(d.dunningColCommissionMode),
                    accessor: (row: CollectionAgencyRow) => row.commissionMode,
                    render: (row: CollectionAgencyRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {commissionModeLabel(d, row.commissionMode)}
                        {row.commissionMode === "PCT_OF_COLLECTED" && row.commissionPct !== null
                          ? ` ${row.commissionPct}%`
                          : ""}
                        {row.commissionMode === "FLAT_FEE" && row.flatFee !== null
                          ? ` ${row.flatFee}`
                          : ""}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.returnsColStatus),
                    accessor: (row: CollectionAgencyRow) => row.status,
                    render: (row: CollectionAgencyRow) => (
                      <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                        {row.status === "ACTIVE"
                          ? d.dunningAgencyActive
                          : d.dunningAgencySuspended}
                      </Badge>
                    ),
                  },
                  {
                    id: "tokenIssuedAt",
                    header: activeLocaleHeader(d.dunningColTokenIssued),
                    accessor: (row: CollectionAgencyRow) => row.tokenIssuedAt ?? "",
                    render: (row: CollectionAgencyRow) =>
                      row.tokenIssuedAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {formatDateTime(row.tokenIssuedAt, locale)}
                        </span>
                      ),
                  },
                ]}
                rows={[...agencies]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "issue-token",
                    label: d.dunningActionIssueToken,
                    onSelect: (row: CollectionAgencyRow) => {
                      if (window.confirm(d.dunningConfirmIssueToken)) {
                        void issueToken(row);
                      }
                    },
                  },
                  {
                    id: "suspend",
                    label: d.dunningActionSuspend,
                    onSelect: (row: CollectionAgencyRow) => {
                      if (row.status !== "ACTIVE") {
                        return;
                      }
                      if (window.confirm(d.dunningConfirmSuspend)) {
                        void agencyStatusAction(row, "suspend");
                      }
                    },
                  },
                  {
                    id: "activate",
                    label: d.dunningActionActivate,
                    onSelect: (row: CollectionAgencyRow) => {
                      if (row.status !== "SUSPENDED") {
                        return;
                      }
                      void agencyStatusAction(row, "activate");
                    },
                  },
                ]}
                empty={{ title: d.dunningAgenciesEmpty }}
              />
            </Card>

            <Card
              title={d.dunningReferralCreateTitle}
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setReferDraft(emptyReferralDraft(todayIso()));
                    setReferOpen(true);
                  }}
                >
                  {d.dunningActionRefer}
                </Button>
              }
            >
              <DataTable
                columns={[
                  {
                    id: "agency",
                    header: activeLocaleHeader(d.dunningColAgency),
                    accessor: (row: CollectionReferralRow) => agencyLabel(row.agencyId),
                  },
                  {
                    id: "partner",
                    header: activeLocaleHeader(d.dunningColPartner),
                    accessor: (row: CollectionReferralRow) => partnerLabel(row.partnerId),
                  },
                  {
                    id: "invoice",
                    header: activeLocaleHeader(d.dunningColInvoice),
                    accessor: (row: CollectionReferralRow) => row.invoiceId ?? "",
                    render: (row: CollectionReferralRow) =>
                      row.invoiceId === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {invoiceLabel(row.invoiceId)}
                        </span>
                      ),
                  },
                  {
                    id: "referralDate",
                    header: activeLocaleHeader(d.dunningColReferralDate),
                    accessor: (row: CollectionReferralRow) => row.referralDate,
                    sortable: true,
                    render: (row: CollectionReferralRow) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.referralDate}
                      </span>
                    ),
                  },
                  {
                    id: "referred",
                    header: activeLocaleHeader(d.dunningColReferredAmount),
                    accessor: (row: CollectionReferralRow) => row.referredAmount,
                    numeric: true,
                    render: (row: CollectionReferralRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.referredAmount} {row.currencyCode}
                      </span>
                    ),
                  },
                  {
                    id: "settled",
                    header: activeLocaleHeader(d.dunningColSettledAmount),
                    accessor: (row: CollectionReferralRow) => row.settledAmount,
                    numeric: true,
                    render: (row: CollectionReferralRow) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.settledAmount} {row.currencyCode}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.returnsColStatus),
                    accessor: (row: CollectionReferralRow) => row.status,
                    render: (row: CollectionReferralRow) => (
                      <Badge tone={REFERRAL_TONES[row.status]}>
                        {referralStatusLabel(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "commission",
                    header: activeLocaleHeader(d.dunningColCommissionAmount),
                    accessor: (row: CollectionReferralRow) => row.commissionAmount ?? "",
                    numeric: true,
                    render: (row: CollectionReferralRow) =>
                      row.commissionAmount === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {row.commissionAmount}
                        </span>
                      ),
                  },
                ]}
                rows={[...referrals]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "settle",
                    label: d.dunningActionSettle,
                    onSelect: (row: CollectionReferralRow) => {
                      if (
                        row.status !== "REFERRED" &&
                        row.status !== "ACKNOWLEDGED" &&
                        row.status !== "PARTIAL"
                      ) {
                        return;
                      }
                      setError(null);
                      setSettleAmount("");
                      setSettleTarget(row);
                    },
                  },
                  {
                    id: "post-commission",
                    label: d.dunningActionPostCommission,
                    onSelect: (row: CollectionReferralRow) => {
                      if (row.status !== "SETTLED" && row.status !== "PARTIAL") {
                        return;
                      }
                      if (window.confirm(d.dunningConfirmPostCommission)) {
                        void referralAction(row, "post-commission");
                      }
                    },
                  },
                  {
                    id: "close",
                    label: d.dunningActionCloseReferral,
                    onSelect: (row: CollectionReferralRow) => {
                      if (row.status !== "COMMISSION_POSTED") {
                        return;
                      }
                      if (window.confirm(d.dunningConfirmClose)) {
                        void referralAction(row, "close");
                      }
                    },
                  },
                ]}
                empty={{ title: d.dunningReferralsEmpty }}
              />
            </Card>
          </div>
        )}
      </Tabs>

      <Dialog
        open={waiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWaiveTarget(null);
          }
        }}
        title={d.dunningWaiveTitle}
        size="sm"
      >
        <Input
          label={d.dunningWaiveReasonLabel}
          value={waiveReason}
          onValueChange={setWaiveReason}
          required
        />
        <p className="mt-2 text-sm text-gray-600">{d.dunningConfirmWaive}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setWaiveTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `waive-${waiveTarget?.id ?? ""}`}
            onClick={() => void submitWaive()}
          >
            {d.dunningActionWaiveFee}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={policyOpen}
        onOpenChange={setPolicyOpen}
        title={d.dunningPolicyCreateTitle}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={d.dunningFormPolicyName}
              value={policyDraft.name}
              onValueChange={(value) => setPolicyDraft({ ...policyDraft, name: value })}
              error={policyDraft.name.trim() === "" ? d.errorsValidation : undefined}
              required
            />
            <Input
              label={`${d.dunningFormPolicyNameAr} (${d.sourcingFormOptional})`}
              value={policyDraft.nameAr}
              onValueChange={(value) => setPolicyDraft({ ...policyDraft, nameAr: value })}
            />
            <div className="flex items-end pb-1">
              <Checkbox
                label={d.dunningFormIsDefault}
                checked={policyDraft.isDefault}
                onCheckedChange={(checked) =>
                  setPolicyDraft({ ...policyDraft, isDefault: checked === true })
                }
              />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-800">{d.dunningLadderTitle}</p>
            {policyDraft.steps.map((step, index) => (
              <div key={index} className="grid gap-3 rounded-md border border-subtle p-3 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
                <NumberInput
                  label={index === 0 ? d.dunningFormDaysOverdue : undefined}
                  value={step.daysOverdue}
                  onValueChange={(value) =>
                    setPolicyDraft({
                      ...policyDraft,
                      steps: policyDraft.steps.map((s, i) =>
                        i === index ? { ...s, daysOverdue: value } : s,
                      ),
                    })
                  }
                  min={1}
                  step={1}
                />
                <Select
                  label={index === 0 ? d.dunningFormChannel : undefined}
                  value={step.channel}
                  onValueChange={(value) =>
                    setPolicyDraft({
                      ...policyDraft,
                      steps: policyDraft.steps.map((s, i) =>
                        i === index ? { ...s, channel: value as DunningStep["channel"] } : s,
                      ),
                    })
                  }
                  options={CHANNELS.map((channel) => ({
                    value: channel,
                    label: channelLabel(d, channel),
                  }))}
                />
                <Input
                  label={index === 0 ? d.dunningFormTemplateKey : undefined}
                  value={step.templateKey}
                  onValueChange={(value) =>
                    setPolicyDraft({
                      ...policyDraft,
                      steps: policyDraft.steps.map((s, i) =>
                        i === index ? { ...s, templateKey: value } : s,
                      ),
                    })
                  }
                  mono
                  bidiIsolate
                />
                <div className="flex items-end">
                  {policyDraft.steps.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setPolicyDraft({
                          ...policyDraft,
                          steps: policyDraft.steps.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {d.dunningRemoveStep}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 sm:col-span-4">
                  <Checkbox
                    label={d.dunningFormEscalate}
                    checked={step.escalate}
                    onCheckedChange={(checked) =>
                      setPolicyDraft({
                        ...policyDraft,
                        steps: policyDraft.steps.map((s, i) =>
                          i === index ? { ...s, escalate: checked === true } : s,
                        ),
                      })
                    }
                  />
                  <Checkbox
                    label={d.dunningFormReferToAgency}
                    checked={step.referToAgency}
                    onCheckedChange={(checked) =>
                      setPolicyDraft({
                        ...policyDraft,
                        steps: policyDraft.steps.map((s, i) =>
                          i === index ? { ...s, referToAgency: checked === true } : s,
                        ),
                      })
                    }
                  />
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setPolicyDraft({
                  ...policyDraft,
                  steps: [
                    ...policyDraft.steps,
                    {
                      daysOverdue: "",
                      channel: "EMAIL",
                      templateKey: `dunning.reminder.${policyDraft.steps.length + 1}`,
                      escalate: false,
                      referToAgency: false,
                    },
                  ],
                })
              }
            >
              {d.dunningAddStep}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.dunningFormFeeMode}
              value={policyDraft.lateFeeMode}
              onValueChange={(value) =>
                setPolicyDraft({
                  ...policyDraft,
                  lateFeeMode: value as DunningPolicyRow["lateFeeMode"],
                })
              }
              options={(["DISABLED", "CONTRACT_RATE", "STATUTORY_CAP"] as const).map((mode) => ({
                value: mode,
                label: feeModeLabel(d, mode),
              }))}
            />
            {policyDraft.lateFeeMode !== "DISABLED" && (
              <Input
                label={d.dunningFormRatePct}
                value={policyDraft.lateFeeRatePct}
                onValueChange={(value) =>
                  setPolicyDraft({ ...policyDraft, lateFeeRatePct: value })
                }
                inputMode="decimal"
                error={
                  PCT_RE.test(policyDraft.lateFeeRatePct.trim())
                    ? undefined
                    : d.errorsValidation
                }
                required
              />
            )}
            <NumberInput
              label={d.dunningFormGraceDays}
              value={policyDraft.lateFeeGraceDays}
              onValueChange={(value) =>
                setPolicyDraft({ ...policyDraft, lateFeeGraceDays: value })
              }
              min={0}
              max={365}
              step={1}
            />
            <Input
              label={`${d.dunningFormMaxAmount} (${d.sourcingFormOptional})`}
              value={policyDraft.lateFeeMaxAmount}
              onValueChange={(value) =>
                setPolicyDraft({ ...policyDraft, lateFeeMaxAmount: value })
              }
              inputMode="decimal"
            />
            {policyDraft.lateFeeMode === "STATUTORY_CAP" && (
              <Input
                label={d.dunningFormFeeSource}
                value={policyDraft.lateFeeSource}
                onValueChange={(value) =>
                  setPolicyDraft({ ...policyDraft, lateFeeSource: value })
                }
                required
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPolicyOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "policy-create"}
            onClick={() => void createPolicy()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={actionOpen}
        onOpenChange={setActionOpen}
        title={d.dunningActionLogTitle}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.dunningFormPartner}
            value={actionDraft.partnerId}
            onValueChange={(value) => setActionDraft({ ...actionDraft, partnerId: value })}
            options={[
              { value: "", label: d.dunningFormPartner },
              ...customersOnly.map((partner) => ({
                value: partner.id,
                label: partnerNameById.get(partner.id) ?? partner.code,
              })),
            ]}
            required
          />
          <Select
            label={`${d.dunningFormInvoiceOptional} (${d.sourcingFormOptional})`}
            value={actionDraft.invoiceId}
            onValueChange={(value) => setActionDraft({ ...actionDraft, invoiceId: value })}
            options={[
              { value: "", label: d.dunningFormInvoiceOptional },
              ...invoices.map((invoice) => ({
                value: invoice.id,
                label: invoiceLabelById.get(invoice.id) ?? invoice.id,
              })),
            ]}
          />
          <Select
            label={d.dunningFormActionType}
            value={actionDraft.actionType}
            onValueChange={(value) =>
              setActionDraft({
                ...actionDraft,
                actionType: value as CollectionActionRow["actionType"],
              })
            }
            options={ACTION_TYPES.map((type) => ({
              value: type,
              label: actionTypeLabel(d, type),
            }))}
          />
          <Select
            label={d.dunningFormOutcome}
            value={actionDraft.outcome}
            onValueChange={(value) =>
              setActionDraft({ ...actionDraft, outcome: value as CollectionActionRow["outcome"] })
            }
            options={ACTION_OUTCOMES.map((outcome) => ({
              value: outcome,
              label: outcomeLabel(d, outcome),
            }))}
          />
          <DatePicker
            label={d.dunningFormActionDate}
            value={actionDraft.actionDate}
            onSelect={(iso) => setActionDraft({ ...actionDraft, actionDate: iso })}
            locale={locale}
            required
          />
          {actionDraft.actionType === "PROMISE_TO_PAY" ? (
            <DatePicker
              label={d.dunningFormPromisedDate}
              value={actionDraft.promisedDate === "" ? undefined : actionDraft.promisedDate}
              onSelect={(iso) => setActionDraft({ ...actionDraft, promisedDate: iso })}
              locale={locale}
              required
            />
          ) : (
            <DatePicker
              label={`${d.dunningFormFollowUpDate} (${d.sourcingFormOptional})`}
              value={actionDraft.followUpDate === "" ? undefined : actionDraft.followUpDate}
              onSelect={(iso) => setActionDraft({ ...actionDraft, followUpDate: iso })}
              locale={locale}
            />
          )}
          <Input
            label={`${d.dunningFormAmount} (${d.sourcingFormOptional})`}
            value={actionDraft.amount}
            onValueChange={(value) => setActionDraft({ ...actionDraft, amount: value })}
            inputMode="decimal"
          />
          <Input
            label={`${d.dunningFormNote} (${d.sourcingFormOptional})`}
            value={actionDraft.note}
            onValueChange={(value) => setActionDraft({ ...actionDraft, note: value })}
          />
        </div>
        {actionDraft.actionType === "PROMISE_TO_PAY" && (
          <p className="mt-2 text-sm text-gray-600">{d.dunningPromiseDateHint}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActionOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "action-create"}
            onClick={() => void createAction()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={reviewTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReviewTarget(null);
          }
        }}
        title={`${d.dunningRecordReviewTitle} — ${reviewTarget?.code ?? ""}`}
        size="md"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={`${d.dunningFormScoreClass} (${d.sourcingFormOptional})`}
            value={reviewClass}
            onValueChange={setReviewClass}
            options={[
              { value: "", label: d.dunningNoClass },
              { value: "A", label: "A" },
              { value: "B", label: "B" },
              { value: "C", label: "C" },
              { value: "D", label: "D" },
            ]}
          />
          <DatePicker
            label={`${d.dunningFormNextReview} (${d.sourcingFormOptional})`}
            value={reviewNextAt === "" ? undefined : reviewNextAt}
            onSelect={(iso) => setReviewNextAt(iso)}
            locale={locale}
          />
          <Input
            label={`${d.dunningFormReviewNote} (${d.sourcingFormOptional})`}
            value={reviewNote}
            onValueChange={setReviewNote}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReviewTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `review-${reviewTarget?.partnerId ?? ""}`}
            onClick={() => void submitReview()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={agencyOpen}
        onOpenChange={setAgencyOpen}
        title={d.dunningAgencyCreateTitle}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.dunningColAgency}
            value={agencyDraft.partnerId}
            onValueChange={(value) => setAgencyDraft({ ...agencyDraft, partnerId: value })}
            options={[
              { value: "", label: d.dunningColAgency },
              ...partners.map((partner) => ({
                value: partner.id,
                label: partnerNameById.get(partner.id) ?? partner.code,
              })),
            ]}
            required
          />
          <Input
            label={`${d.dunningFormContactName} (${d.sourcingFormOptional})`}
            value={agencyDraft.contactName}
            onValueChange={(value) => setAgencyDraft({ ...agencyDraft, contactName: value })}
          />
          <Input
            label={`${d.dunningFormEmail} (${d.sourcingFormOptional})`}
            value={agencyDraft.email}
            onValueChange={(value) => setAgencyDraft({ ...agencyDraft, email: value })}
            type="email"
            bidiIsolate
          />
          <Input
            label={`${d.dunningFormPhone} (${d.sourcingFormOptional})`}
            value={agencyDraft.phone}
            onValueChange={(value) => setAgencyDraft({ ...agencyDraft, phone: value })}
            type="tel"
            bidiIsolate
          />
          <Select
            label={d.dunningFormCommissionMode}
            value={agencyDraft.commissionMode}
            onValueChange={(value) =>
              setAgencyDraft({
                ...agencyDraft,
                commissionMode: value as CollectionAgencyRow["commissionMode"],
              })
            }
            options={[
              { value: "PCT_OF_COLLECTED", label: d.dunningCommissionPctOfCollected },
              { value: "FLAT_FEE", label: d.dunningCommissionFlatFee },
            ]}
          />
          {agencyDraft.commissionMode === "PCT_OF_COLLECTED" ? (
            <Input
              label={d.dunningFormRatePct}
              value={agencyDraft.commissionPct}
              onValueChange={(value) => setAgencyDraft({ ...agencyDraft, commissionPct: value })}
              inputMode="decimal"
              required
            />
          ) : (
            <Input
              label={d.dunningColFlatFee}
              value={agencyDraft.flatFee}
              onValueChange={(value) => setAgencyDraft({ ...agencyDraft, flatFee: value })}
              inputMode="decimal"
              required
            />
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAgencyOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "agency-create"}
            onClick={() => void createAgency()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={referOpen}
        onOpenChange={setReferOpen}
        title={d.dunningReferralCreateTitle}
        size="md"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.dunningFormAgency}
            value={referDraft.agencyId}
            onValueChange={(value) => setReferDraft({ ...referDraft, agencyId: value })}
            options={[
              { value: "", label: d.dunningFormAgency },
              ...activeAgencies.map((agency) => ({
                value: agency.id,
                label: partnerLabel(agency.partnerId),
              })),
            ]}
            required
          />
          <Select
            label={d.dunningFormPartner}
            value={referDraft.partnerId}
            onValueChange={(value) => setReferDraft({ ...referDraft, partnerId: value })}
            options={[
              { value: "", label: d.dunningFormPartner },
              ...customersOnly.map((partner) => ({
                value: partner.id,
                label: partnerNameById.get(partner.id) ?? partner.code,
              })),
            ]}
            required
          />
          <Select
            label={`${d.dunningFormInvoiceOptional} (${d.sourcingFormOptional})`}
            value={referDraft.invoiceId}
            onValueChange={(value) => setReferDraft({ ...referDraft, invoiceId: value })}
            options={[
              { value: "", label: d.dunningFormInvoiceOptional },
              ...invoices.map((invoice) => ({
                value: invoice.id,
                label: invoiceLabelById.get(invoice.id) ?? invoice.id,
              })),
            ]}
          />
          <Input
            label={d.dunningFormReferredAmount}
            value={referDraft.referredAmount}
            onValueChange={(value) => setReferDraft({ ...referDraft, referredAmount: value })}
            inputMode="decimal"
            error={
              referDraft.referredAmount.trim() === "" || toMoney4(referDraft.referredAmount) === null
                ? d.errorsValidation
                : undefined
            }
            required
          />
          <DatePicker
            label={d.dunningFormReferralDate}
            value={referDraft.referralDate}
            onSelect={(iso) => setReferDraft({ ...referDraft, referralDate: iso })}
            locale={locale}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReferOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "refer-create"}
            onClick={() => void submitRefer()}
          >
            {d.dunningActionRefer}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={settleTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSettleTarget(null);
          }
        }}
        title={d.dunningSettleTitle}
        size="sm"
      >
        <Input
          label={d.dunningFormSettledAmount}
          value={settleAmount}
          onValueChange={setSettleAmount}
          inputMode="decimal"
          error={
            settleAmount.trim() === "" || toMoney4(settleAmount) === null
              ? d.errorsValidation
              : undefined
          }
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSettleTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === `settle-${settleTarget?.id ?? ""}`}
            onClick={() => void submitSettle()}
          >
            {d.dunningActionSettle}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
