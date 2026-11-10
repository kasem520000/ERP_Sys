"use client";

/**
 * T19-WEB (PHASE-014) + PHASE-015 T11 (3-a) — the onboarding wizard
 * (Journey A; Wizard archetype). Step sequence (7 steps):
 *
 *  1 industry      — PHASE-015: choose an industry template (activity picker
 *                    → bilingual template cards with the §4 capability
 *                    preview) or the honest "plain workspace" skip; NOT a
 *                    journey milestone (nothing written; the selection is
 *                    in-session state, the applied template is recorded
 *                    server-side on tenant_industry_config);
 *  2 provisioning  — the PHASE-004 two-step provisioning (fiscal month +
 *                    numbering policy → idempotent provision diff);
 *                    AFTER a successful provision the wizard applies the
 *                    selected template (POST /configuration/templates/:key/
 *                    apply) — blocked/failed applies NEVER stop onboarding
 *                    (the workspace continues on platform defaults and the
 *                    Industry & templates screen owns the retry);
 *  3 result        — the provision diff + the industry-apply outcome
 *                    (applied / already applied / blocked with the typed
 *                    AR-EN guidance + missing chain — never a raw dump);
 *  4 first item    — POST /items (sku, bilingual name, sale price, PCS uom);
 *  5 first customer— POST /partners (code, bilingual name, CUSTOMER);
 *  6 first invoice — POST /sales/sales-invoices + the API's REAL state
 *                    machine submit → approve → post;
 *  7 print         — the posted invoice summary + the honest "document
 *                    printing arrives with the print queue" note.
 *
 * Journey tracking: every MILESTONE writes
 * PUT /tenancy/settings/platform.onboarding.journey_state (completed_at null
 * mid-journey; ISO timestamp on completion). Skip is honest and resumable —
 * it writes the step where the user STOPPED (the last achieved milestone),
 * never a fabricated "done"; resume state comes from GET /tenancy/settings
 * (page-resolved). Read-only grace: every mutating button is disabled with
 * the bilingual reason; journey PUT failures surface honestly.
 */
import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

import { Button, Input, MoneyInput, Select } from "@erp/ui";

import { getDictionary, monthNames, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ConfigLocalizedText,
  ItemRow,
  JourneyStateValue,
  PartnerRow,
  ProvisionDiff,
  SalesInvoiceRow,
  TemplateApplyOutcome,
  UomRow,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedBillingError,
  localizedMasterDataError,
  localizedSalesError,
} from "../lib/messages";
import { useReadOnly } from "../lib/read-only";
import { Card } from "./card";
import { DefList } from "./def-list";
import { LinkButton } from "./link-button";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { AppliedTemplateInfo, IndustryStep } from "./onboarding/industry-step";

type AssignAt = "posting" | "approval";
type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const JOURNEY_KEY = "platform.onboarding.journey_state";
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;
const SKU_RE = /^.{1,40}$/;

/**
 * Exact qty×price (≤6dp each) at the 4dp money scale, half-up — mirrors the
 * engine's display rounding for the PREVIEW only; the created row is the
 * authority (string math throughout — ADR-0009, no floats).
 */
function multiplyExact(a: string, b: string): string {
  const toMinor6 = (value: string): bigint => {
    const [int = "0", frac = ""] = value.split(".");
    return BigInt(int === "" ? "0" : int) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  };
  const product = toMinor6(a) * toMinor6(b); // 12dp minor units
  const fourDpUnits = 100_000_000n; // 10^8: 12dp → 4dp
  const units = product / fourDpUnits;
  const remainder = product % fourDpUnits;
  const rounded = remainder * 2n >= fourDpUnits ? units + 1n : units;
  const whole = rounded / 10_000n;
  const frac = (rounded % 10_000n).toString().padStart(4, "0");
  return `${whole}.${frac}`;
}

/** Resume mapping: the recorded milestone decides where the journey restarts
 * (the industry step is step 1 — it is not a milestone; the applied template
 * state itself comes from the server-resolved effective config). */
function stepForJourney(journey: JourneyStateValue | null): StepId {
  switch (journey?.step) {
    case "workspace_provisioned":
    case "opening_balances_done":
      return 3;
    case "first_item_created":
      return 4;
    case "first_customer_created":
      return 5;
    case "first_invoice_posted":
    case "first_invoice_printed":
    case "completed":
      return 7;
    default:
      // registered / activity_picked / skipped — restart from the industry
      // step (the provision POST is idempotent; the diff shows created=0).
      return 1;
  }
}

/** The industry-template apply outcome rendered on the result step. */
type IndustryApplyOutcome =
  | { kind: "none" }
  | { kind: "applied"; templateKey: string; version: string }
  | { kind: "already-applied" }
  | { kind: "blocked"; guidance: ConfigLocalizedText | null; missingChain: readonly string[] }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** The typed blocked-error guidance (422 configuration/template-prerequisites-blocked). */
function blockedGuidanceOf(details: unknown): ConfigLocalizedText | null {
  if (
    isRecord(details) &&
    isRecord(details.guidance) &&
    typeof details.guidance.ar === "string" &&
    typeof details.guidance.en === "string"
  ) {
    return { ar: details.guidance.ar, en: details.guidance.en };
  }
  return null;
}

/** The typed blocked-error missing chain (sorted feature keys). */
function missingChainOf(details: unknown): readonly string[] {
  if (isRecord(details) && Array.isArray(details.missingChain)) {
    return details.missingChain.filter((key: unknown): key is string => typeof key === "string");
  }
  return [];
}

export function OnboardingWizard({
  locale,
  baseCurrency,
  initialJourney,
  appliedTemplate,
}: {
  locale: Locale;
  /** Tenant base currency (invoice header + money inputs). */
  baseCurrency: string;
  /** The recorded journey state (GET /tenancy/settings, page-resolved). */
  initialJourney: JourneyStateValue | null;
  /** PHASE-015: the applied industry template (effective config L1, page-resolved). */
  appliedTemplate: AppliedTemplateInfo | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { readOnly } = useReadOnly();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<StepId>(stepForJourney(initialJourney));
  // The last milestone GENUINELY achieved this visit (initialized from the
  // record). Every skip writes THIS — never a fabricated later step: skipping
  // the item step and then the customer step records "workspace_provisioned",
  // not "first_item_created" (the honest resumable-stop rule).
  const [lastAchieved, setLastAchieved] = useState<JourneyStateValue["step"] | null>(
    initialJourney?.step ?? null,
  );
  // PHASE-015 T11: the industry selection (in-session only — not a milestone)
  // and the apply outcome rendered on the result step.
  const [industrySelection, setIndustrySelection] = useState<
    { key: string; label: ConfigLocalizedText } | null
  >(appliedTemplate === null ? null : { key: appliedTemplate.key, label: { ar: appliedTemplate.key, en: appliedTemplate.key } });
  const [applyOutcome, setApplyOutcome] = useState<IndustryApplyOutcome | null>(null);
  const [fiscalMonth, setFiscalMonth] = useState("1");
  const [assignAt, setAssignAt] = useState<AssignAt>("posting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ProvisionDiff | null>(null);

  // A6 — first item
  const [itemSku, setItemSku] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemNameAr, setItemNameAr] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [pcsUom, setPcsUom] = useState<UomRow | null>(null);
  const [createdItem, setCreatedItem] = useState<ItemRow | null>(null);

  // A7 — first customer
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerNameAr, setCustomerNameAr] = useState("");
  const [createdCustomer, setCreatedCustomer] = useState<PartnerRow | null>(null);

  // A8 — first invoice
  const [branches, setBranches] = useState<readonly BranchRow[]>([]);
  const [items, setItems] = useState<readonly ItemRow[]>([]);
  const [customers, setCustomers] = useState<readonly PartnerRow[]>([]);
  const [referenceLoaded, setReferenceLoaded] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [invoiceItemId, setInvoiceItemId] = useState("");
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [invoiceQty, setInvoiceQty] = useState("1");
  const [invoicePrice, setInvoicePrice] = useState("");
  const [invoiceStage, setInvoiceStage] = useState<string | null>(null);
  const [postedInvoice, setPostedInvoice] = useState<SalesInvoiceRow | null>(null);
  // Step 6 terminal state: completed (ISO stamped) vs skipped (resumable).
  const [terminal, setTerminal] = useState<"completed" | "skipped" | null>(
    initialJourney?.step === "completed" ? "completed" : null,
  );

  const steps: readonly string[] = [
    d.onboardingStepIndustry,
    d.settingsFiscalNumberingTitle,
    d.onboardingResultTitle,
    d.onboardingStepItem,
    d.onboardingStepCustomer,
    d.onboardingStepInvoice,
    d.onboardingStepPrint,
  ];

  // Focus management: the step heading receives focus on every transition.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  /** PUT the journey milestone (completed_at null mid-journey). */
  async function writeJourney(value: JourneyStateValue): Promise<boolean> {
    setJourneyError(null);
    const result = await bffFetch(`tenancy/settings/${JOURNEY_KEY}`, {
      method: "PUT",
      body: { value: { step: value.step, completed_at: value.completed_at } },
    });
    if (!result.ok) {
      // 403 subscription-read-only in grace is expected — surface it honestly.
      setJourneyError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return false;
    }
    return true;
  }

  async function onProvision(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await bffFetch<ProvisionDiff>("tenancy/onboarding/provision", {
      method: "POST",
      body: {
        fiscalCalendarStartMonth: Number.parseInt(fiscalMonth, 10),
        numberingAssignAt: assignAt,
      },
    });
    if (!result.ok) {
      setBusy(false);
      setError(localizedBillingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDiff(result.data);
    setLastAchieved("workspace_provisioned");
    void writeJourney({ step: "workspace_provisioned", completed_at: null });
    // PHASE-015 T11: apply the selected industry template AFTER provisioning
    // (idempotent; typed blocked failures render the guided plan-selection
    // guidance on the result step — onboarding NEVER stops here, the
    // workspace runs on platform defaults and /settings/templates owns retry).
    if (industrySelection === null) {
      setApplyOutcome({ kind: "none" });
    } else {
      const apply = await bffFetch<TemplateApplyOutcome>(
        `configuration/templates/${encodeURIComponent(industrySelection.key)}/apply`,
        { method: "POST", body: {} },
      );
      if (apply.ok) {
        setApplyOutcome(
          apply.data.applied
            ? {
                kind: "applied",
                templateKey: apply.data.templateKey,
                version: apply.data.version,
              }
            : { kind: "already-applied" },
        );
      } else if (apply.error.code === "configuration/template-prerequisites-blocked") {
        setApplyOutcome({
          kind: "blocked",
          guidance: blockedGuidanceOf(apply.error.details),
          missingChain: missingChainOf(apply.error.details),
        });
      } else if (apply.status === 403 || apply.error.code === "FORBIDDEN") {
        setApplyOutcome({ kind: "forbidden" });
      } else {
        setApplyOutcome({
          kind: "error",
          message: localizedBillingError(d, apply.error, apply.retryAfterSeconds),
        });
      }
    }
    setBusy(false);
    setStep(3);
  }

  // A6: the PCS uom resolves from the seeded system uoms (fetch on first need).
  useEffect(() => {
    if (step !== 4 || pcsUom !== null) {
      return;
    }
    void (async (): Promise<void> => {
      const result = await bffFetch<readonly UomRow[]>("items/uoms");
      if (result.ok) {
        const pcs = result.data.find((uom) => uom.code === "PCS" && uom.isActive);
        setPcsUom(pcs ?? null);
      }
    })();
  }, [step, pcsUom]);

  async function createFirstItem(): Promise<void> {
    if (pcsUom === null) {
      setError(d.onboardingNeedPcsUom);
      return;
    }
    if (
      !SKU_RE.test(itemSku.trim()) ||
      itemName.trim() === "" ||
      !PRICE_RE.test(invoiceSafe(itemPrice))
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<ItemRow>("items", {
      method: "POST",
      body: {
        sku: itemSku.trim(),
        name: itemName.trim(),
        nameAr: itemNameAr.trim() === "" ? null : itemNameAr.trim(),
        kind: "STOCK",
        uomId: pcsUom.id,
        categoryId: null,
        taxCodeId: null,
        basePrice: invoiceSafe(itemPrice),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreatedItem(result.data);
    setStep(4);
    setLastAchieved("first_item_created");
    void writeJourney({ step: "first_item_created", completed_at: null });
  }

  async function createFirstCustomer(): Promise<void> {
    if (customerName.trim() === "" || customerCode.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<PartnerRow>("partners/partners", {
      method: "POST",
      body: {
        kind: "CUSTOMER",
        code: customerCode.trim(),
        name: customerName.trim(),
        nameAr: customerNameAr.trim() === "" ? null : customerNameAr.trim(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreatedCustomer(result.data);
    setStep(5);
    setLastAchieved("first_customer_created");
    void writeJourney({ step: "first_customer_created", completed_at: null });
  }

  // A8 reference data (branches + sellable items + customers) — fetched when
  // the invoice step opens; failures leave the selects empty with the error.
  useEffect(() => {
    if (step !== 6 || referenceLoaded) {
      return;
    }
    void (async (): Promise<void> => {
      const [branchResult, itemResult, partnerResult] = await Promise.all([
        bffFetch<readonly BranchRow[]>("tenancy/branches"),
        bffFetch<readonly ItemRow[]>("items?limit=100"),
        bffFetch<readonly PartnerRow[]>("partners?limit=100"),
      ]);
      if (branchResult.ok) {
        setBranches(branchResult.data.filter((branch) => branch.isActive));
      }
      if (itemResult.ok) {
        setItems(itemResult.data);
        if (createdItem !== null && itemResult.data.some((item) => item.id === createdItem.id)) {
          setInvoiceItemId(createdItem.id);
        } else if (itemResult.data.length > 0 && createdItem === null) {
          const first = itemResult.data.find((item) => item.status === "ACTIVE") ?? itemResult.data[0]!;
          setInvoiceItemId(first.id);
        }
      }
      if (partnerResult.ok) {
        setCustomers(partnerResult.data.filter((partner) => partner.kind === "CUSTOMER" || partner.kind === "BOTH"));
        if (createdCustomer !== null) {
          setInvoiceCustomerId(createdCustomer.id);
        }
      }
      setReferenceLoaded(true);
    })();
    // createdItem/createdCustomer identities are stable for the visit
  }, [step, referenceLoaded]);

  const previewNet =
    QTY_RE.test(invoiceQty) && PRICE_RE.test(invoiceSafe(invoicePrice))
      ? multiplyExact(invoiceQty, invoiceSafe(invoicePrice))
      : null;

  /** Create → submit → approve → post: the API's real states, one row per hop. */
  async function createFirstInvoice(): Promise<void> {
    if (branchId === "" || invoiceItemId === "" || invoiceCustomerId === "") {
      setError(d.errorsValidation);
      return;
    }
    if (!QTY_RE.test(invoiceQty) || !PRICE_RE.test(invoiceSafe(invoicePrice))) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    setInvoiceStage(d.onboardingInvoiceStageCreated);
    const created = await bffFetch<SalesInvoiceRow>("sales/sales-invoices", {
      method: "POST",
      body: {
        branchId,
        customerId: invoiceCustomerId,
        kind: "CREDIT",
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: null,
        currencyCode: baseCurrency === "" ? "SAR" : baseCurrency,
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        lines: [
          {
            itemId: invoiceItemId,
            accountId: null,
            qty: invoiceQty,
            unitPrice: invoiceSafe(invoicePrice),
            discountAmount: null,
            taxCodeId: null,
          },
        ],
      },
    });
    if (!created.ok) {
      setBusy(false);
      setInvoiceStage(null);
      setError(localizedSalesError(d, created.error, created.retryAfterSeconds));
      return;
    }
    const id = created.data.id;
    const run = async (
      act: "submit" | "approve" | "post",
      stage: string,
    ): Promise<boolean> => {
      setInvoiceStage(stage);
      const result = await bffFetch<SalesInvoiceRow>(`sales/sales-invoices/${id}/${act}`, {
        method: "POST",
        body: {},
      });
      if (!result.ok) {
        setBusy(false);
        setInvoiceStage(null);
        setError(localizedSalesError(d, result.error, result.retryAfterSeconds));
        return false;
      }
      return true;
    };
    if (!(await run("submit", d.onboardingInvoiceStageSubmitted))) return;
    if (!(await run("approve", d.onboardingInvoiceStageApproved))) return;
    if (!(await run("post", d.onboardingInvoiceStagePosted))) return;
    // one final read for the POSTED row (number assigned at post)
    const posted = await bffFetch<SalesInvoiceRow>(`sales/sales-invoices/${id}`);
    setBusy(false);
    setInvoiceStage(null);
    if (!posted.ok) {
      setError(localizedSalesError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setPostedInvoice(posted.data);
    setStep(7);
    setLastAchieved("first_invoice_posted");
    void writeJourney({ step: "first_invoice_posted", completed_at: null });
  }

  // A9 on resume: no session invoice — show the latest POSTED invoice honestly.
  useEffect(() => {
    if (step !== 7 || postedInvoice !== null) {
      return;
    }
    void (async (): Promise<void> => {
      const result = await bffFetch<readonly SalesInvoiceRow[]>("sales/sales-invoices?status=POSTED&limit=1");
      if (result.ok && result.data.length > 0) {
        setPostedInvoice(result.data[0] ?? null);
      }
    })();
  }, [step, postedInvoice]);

  /** Finish: the print step is done-with-note → the journey is completed. */
  async function finishJourney(): Promise<void> {
    const ok = await writeJourney({ step: "first_invoice_printed", completed_at: null });
    if (!ok) {
      return;
    }
    setLastAchieved("first_invoice_printed");
    const done = await writeJourney({ step: "completed", completed_at: new Date().toISOString() });
    if (done) {
      setLastAchieved("completed");
      setTerminal("completed");
    }
  }

  /**
   * Skip the print step: honest stop at the last GENUINELY achieved milestone
   * (first_invoice_posted unless the record says further) — resumable.
   */
  function skipPrint(): void {
    setTerminal("skipped");
    const stopAt = lastAchieved ?? "first_invoice_posted";
    void writeJourney({ step: stopAt, completed_at: null });
  }

  /** MoneyInput canonical value ("" → "0" for the wire's decimal regex). */
  function invoiceSafe(value: string): string {
    const trimmed = value.trim();
    return trimmed === "" ? "0" : trimmed;
  }

  /**
   * Skip one journey step: record the last GENUINELY achieved milestone
   * (never a fabricated later step) and move on in-session.
   */
  function skipTo(next: StepId): void {
    setStep(next);
    setError(null);
    if (lastAchieved !== null) {
      void writeJourney({ step: lastAchieved, completed_at: null });
    }
  }

  const stepper: ReactNode = (
    <ol className="flex flex-wrap items-center gap-2" aria-label={d.onboardingTitle}>
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        const active = step === stepNumber;
        const done = step > stepNumber || (stepNumber === 7 && terminal !== null);
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={
                active
                  ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 font-mono text-xs text-white"
                  : done
                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 font-mono text-xs text-primary-800"
                    : "flex h-6 w-6 items-center justify-center rounded-full border border-default bg-surface-card font-mono text-xs text-gray-600"
              }
            >
              {stepNumber}
            </span>
            <span className={active ? "text-sm font-medium text-gray-900" : "text-sm text-gray-600"}>
              {label}
            </span>
            {stepNumber < steps.length && <span aria-hidden="true" className="text-gray-400">—</span>}
          </li>
        );
      })}
    </ol>
  );

  /** The shared action rail for the journey steps (primary + skip + reason). */
  function actionRail(primary: ReactNode, onSkip: (() => void) | null, skipLabel: string): ReactNode {
    return (
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-subtle pt-3">
        {readOnly && <span className="me-auto text-xs text-warning-text">{d.readOnlyReason}</span>}
        {onSkip !== null && !readOnly && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
            {skipLabel}
          </Button>
        )}
        {primary}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">{d.onboardingSubtitle}</p>
      {stepper}
      <p className="sr-only">{formatMessage(d.wizardStepOf, { current: step, total: steps.length })}</p>

      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {journeyError !== null && <ErrorNotice>{journeyError}</ErrorNotice>}
      {readOnly && <InfoNotice>{d.readOnlyReason}</InfoNotice>}

      {step === 1 ? (
        <IndustryStep
          locale={locale}
          appliedTemplate={appliedTemplate}
          selection={industrySelection}
          busy={busy}
          headingRef={headingRef}
          onSelect={setIndustrySelection}
          onContinue={() => setStep(2)}
          onSkip={() => {
            setIndustrySelection(null);
            setApplyOutcome({ kind: "none" });
            setStep(2);
          }}
        />
      ) : step === 3 && diff !== null ? (
        <div className="flex flex-col gap-4">
          <h2 ref={headingRef} tabIndex={-1} className="outline-none text-md font-semibold text-gray-900">
            {d.onboardingResultTitle}
          </h2>
          <Card title={d.onboardingResultTitle} ariaLabel={d.onboardingResultTitle}>
            <DefList
              items={[
                {
                  term: d.onboardingRolesLabel,
                  children: (
                    <span>
                      {formatMessage(d.onboardingCreatedCount, {
                        created: diff.roles.created.length,
                        existing: diff.roles.existing.length,
                      })}
                      {diff.roles.created.length > 0 && (
                        <span className="font-mono text-xs text-gray-500"> — {diff.roles.created.join(", ")}</span>
                      )}
                    </span>
                  ),
                },
                {
                  term: d.onboardingAccountsLabel,
                  children: formatMessage(d.onboardingCreatedCount, {
                    created: diff.accounts.created,
                    existing: diff.accounts.existing,
                  }),
                },
                {
                  term: d.onboardingPurposesLabel,
                  children: formatMessage(d.onboardingCreatedCount, {
                    created: diff.purposes.created,
                    existing: diff.purposes.existing,
                  }),
                },
                {
                  term: d.onboardingSettingsLabel,
                  children: (
                    <span>
                      {formatMessage(d.onboardingCreatedCount, {
                        created: diff.settings.created.length,
                        existing: diff.settings.existing.length,
                      })}
                      {diff.settings.created.length > 0 && (
                        <span className="font-mono text-xs text-gray-500"> — {diff.settings.created.join(", ")}</span>
                      )}
                    </span>
                  ),
                },
              ]}
            />
            {diff.roles.created.length === 0 &&
              diff.accounts.created === 0 &&
              diff.purposes.created === 0 &&
              diff.settings.created.length === 0 && (
                <SuccessNotice className="mt-3">{d.onboardingZeroDuplicatesHint}</SuccessNotice>
              )}
          </Card>
          {applyOutcome !== null && (
            <Card title={d.industryOutcomeTitle} ariaLabel={d.industryOutcomeTitle}>
              {applyOutcome.kind === "none" ? (
                <InfoNotice>{d.industryPlainChosen}</InfoNotice>
              ) : applyOutcome.kind === "applied" ? (
                <SuccessNotice>
                  {formatMessage(d.industryAppliedOk, {
                    template: industrySelection?.label[locale] ?? applyOutcome.templateKey,
                    version: applyOutcome.version,
                  })}
                </SuccessNotice>
              ) : applyOutcome.kind === "already-applied" ? (
                <InfoNotice>{d.industryApplyAlready}</InfoNotice>
              ) : applyOutcome.kind === "forbidden" ? (
                <>
                  <ErrorNotice>{d.industryApplyForbidden}</ErrorNotice>
                  <InfoNotice>{d.industryApplyFailedContinue}</InfoNotice>
                </>
              ) : applyOutcome.kind === "blocked" ? (
                <>
                  <ErrorNotice>
                    {d.industryApplyBlockedPrefix}
                    {applyOutcome.guidance !== null ? ` ${applyOutcome.guidance[locale]}` : ""}
                    {applyOutcome.missingChain.length > 0 && (
                      <span dir="ltr" className="mt-1 block font-mono text-xs">
                        {applyOutcome.missingChain.join(" · ")}
                      </span>
                    )}
                  </ErrorNotice>
                  <InfoNotice>{d.industryApplyFailedContinue}</InfoNotice>
                </>
              ) : (
                <>
                  <ErrorNotice>{applyOutcome.message}</ErrorNotice>
                  <InfoNotice>{d.industryApplyFailedContinue}</InfoNotice>
                </>
              )}
              {applyOutcome.kind !== "none" && applyOutcome.kind !== "applied" && (
                <p className="mt-2 text-xs text-gray-500">{d.industryRetryHint}</p>
              )}
            </Card>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="primary" onClick={() => setStep(4)}>
              {d.onboardingContinueJourney}
            </Button>
            <LinkButton href={`/${locale}`} variant="secondary">
              {d.onboardingGoHome}
            </LinkButton>
            <LinkButton href={`/${locale}/branches`} variant="secondary">
              {d.onboardingGoBranches}
            </LinkButton>
          </div>
        </div>
      ) : step === 4 ? (
        <Card className="w-full max-w-xl">
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 outline-none text-md font-semibold text-gray-900">
            {d.onboardingStepItem}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createFirstItem();
            }}
            noValidate
          >
            <fieldset className="flex flex-col gap-4" disabled={busy || readOnly}>
              <legend className="mb-2 text-sm font-medium text-gray-700">{d.onboardingStepItem}</legend>
              <Input
                id="onb-item-sku"
                label={d.onboardingItemSku}
                value={itemSku}
                onValueChange={setItemSku}
                mono
                required
              />
              <Input
                id="onb-item-name"
                label={d.onboardingItemName}
                value={itemName}
                onValueChange={setItemName}
                required
              />
              <Input
                id="onb-item-name-ar"
                label={d.onboardingItemNameAr}
                value={itemNameAr}
                onValueChange={setItemNameAr}
              />
              <MoneyInput
                id="onb-item-price"
                label={d.onboardingItemPrice}
                amount={itemPrice}
                onAmountChange={setItemPrice}
                currency={baseCurrency === "" ? "SAR" : baseCurrency}
                required
              />
              <p className="text-xs text-gray-500">
                {formatMessage(d.onboardingItemFixed, { uom: pcsUom !== null ? pcsUom.code : "PCS" })}
              </p>
            </fieldset>
            {actionRail(
              <Button type="submit" variant="primary" loading={busy} disabled={readOnly}>
                {d.onboardingCreateItem}
              </Button>,
              () => skipTo(5),
              d.onboardingSkipItem,
            )}
          </form>
        </Card>
      ) : step === 5 ? (
        <Card className="w-full max-w-xl">
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 outline-none text-md font-semibold text-gray-900">
            {d.onboardingStepCustomer}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createFirstCustomer();
            }}
            noValidate
          >
            <fieldset className="flex flex-col gap-4" disabled={busy || readOnly}>
              <legend className="mb-2 text-sm font-medium text-gray-700">{d.onboardingStepCustomer}</legend>
              <Input
                id="onb-customer-code"
                label={d.onboardingCustomerCode}
                value={customerCode}
                onValueChange={setCustomerCode}
                mono
                required
              />
              <Input
                id="onb-customer-name"
                label={d.onboardingCustomerName}
                value={customerName}
                onValueChange={setCustomerName}
                required
              />
              <Input
                id="onb-customer-name-ar"
                label={d.onboardingCustomerNameAr}
                value={customerNameAr}
                onValueChange={setCustomerNameAr}
              />
              <p className="text-xs text-gray-500">{d.onboardingCustomerFixed}</p>
            </fieldset>
            {actionRail(
              <Button type="submit" variant="primary" loading={busy} disabled={readOnly}>
                {d.onboardingCreateCustomer}
              </Button>,
              () => skipTo(6),
              d.onboardingSkipCustomer,
            )}
          </form>
        </Card>
      ) : step === 6 ? (
        <Card className="w-full max-w-2xl">
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 outline-none text-md font-semibold text-gray-900">
            {d.onboardingStepInvoice}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createFirstInvoice();
            }}
            noValidate
          >
            <fieldset className="flex flex-col gap-4" disabled={busy || readOnly}>
              <legend className="mb-2 text-sm font-medium text-gray-700">{d.onboardingStepInvoice}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  id="onb-invoice-branch"
                  label={d.salesBranch}
                  value={branchId}
                  onValueChange={setBranchId}
                  options={[
                    { value: "", label: d.salesSelectBranch },
                    ...branches.map((branch) => ({
                      value: branch.id,
                      label: localizedName(branch.name, branch.nameAr, locale),
                    })),
                  ]}
                />
                <Select
                  id="onb-invoice-customer"
                  label={d.salesCustomer}
                  value={invoiceCustomerId}
                  onValueChange={setInvoiceCustomerId}
                  options={[
                    { value: "", label: d.salesSelectCustomer },
                    ...customers.map((partner) => ({
                      value: partner.id,
                      label: `${localizedName(partner.name, partner.nameAr, locale)} · ${partner.code}`,
                    })),
                  ]}
                />
                <Select
                  id="onb-invoice-item"
                  label={d.salesItem}
                  value={invoiceItemId}
                  onValueChange={setInvoiceItemId}
                  options={[
                    { value: "", label: d.onboardingSelectItem },
                    ...items
                      .filter((item) => item.status === "ACTIVE")
                      .map((item) => ({
                        value: item.id,
                        label: `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`,
                      })),
                  ]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="onb-invoice-qty"
                    label={d.salesQty}
                    value={invoiceQty}
                    onValueChange={setInvoiceQty}
                    mono
                    required
                  />
                  <MoneyInput
                    id="onb-invoice-price"
                    label={d.salesUnitPrice}
                    amount={invoicePrice}
                    onAmountChange={setInvoicePrice}
                    currency={baseCurrency === "" ? "SAR" : baseCurrency}
                    required
                  />
                </div>
              </div>
              <div className="rounded-md border border-subtle bg-surface-sunken p-3">
                <p className="text-sm font-medium text-gray-800">{d.onboardingTaxPreview}</p>
                {previewNet !== null ? (
                  <p dir="ltr" className="mt-1 font-mono text-sm tabular-nums text-gray-700">
                    {invoiceQty} × {invoiceSafe(invoicePrice)} = {previewNet}
                    <span className="ms-2 font-sans text-xs text-gray-500">
                      {d.onboardingPreviewEstimate}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-gray-600">{d.onboardingPreviewPending}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">{d.onboardingNoTaxNote}</p>
              </div>
              {invoiceStage !== null && (
                <p aria-live="polite" role="status" className="text-sm text-primary-800">
                  {invoiceStage}
                </p>
              )}
            </fieldset>
            {actionRail(
              <Button type="submit" variant="primary" loading={busy} disabled={readOnly}>
                {d.onboardingCreateInvoice}
              </Button>,
              () => skipTo(7),
              d.onboardingSkipInvoice,
            )}
          </form>
        </Card>
      ) : step === 7 ? (
        <div className="flex flex-col gap-4">
          <h2 ref={headingRef} tabIndex={-1} className="outline-none text-md font-semibold text-gray-900">
            {d.onboardingStepPrint}
          </h2>
          {terminal === "completed" ? (
            <SuccessNotice>{d.onboardingCompletedNote}</SuccessNotice>
          ) : terminal === "skipped" ? (
            <InfoNotice>{d.onboardingSkippedNote}</InfoNotice>
          ) : (
            <>
              <Card title={d.onboardingInvoiceSummary} ariaLabel={d.onboardingInvoiceSummary}>
                {postedInvoice === null ? (
                  <p className="text-sm text-gray-600">{d.onboardingNoPostedInvoice}</p>
                ) : (
                  <DefList
                    items={[
                      {
                        term: d.salesInvoiceNo,
                        children: (
                          <span dir="ltr" className="font-mono">
                            {postedInvoice.invoiceNo ?? "—"}
                          </span>
                        ),
                      },
                      {
                        term: d.salesInvoiceDate,
                        children: (
                          <span dir="ltr" className="font-mono">
                            {postedInvoice.invoiceDate}
                          </span>
                        ),
                      },
                      {
                        term: d.salesTotalNet,
                        children: (
                          <span dir="ltr" className="font-mono tabular-nums">
                            {postedInvoice.totalNet} {postedInvoice.currencyCode}
                          </span>
                        ),
                      },
                      {
                        term: d.salesTotalTax,
                        children: (
                          <span dir="ltr" className="font-mono tabular-nums">
                            {postedInvoice.totalTax} {postedInvoice.currencyCode}
                          </span>
                        ),
                      },
                      {
                        term: d.salesTotalGross,
                        children: (
                          <span dir="ltr" className="font-mono tabular-nums">
                            {postedInvoice.totalGross} {postedInvoice.currencyCode}
                          </span>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
              <InfoNotice>{d.onboardingPrintQueueNote}</InfoNotice>
              <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-subtle bg-surface-card py-3">
                {readOnly && <span className="me-auto text-xs text-warning-text">{d.readOnlyReason}</span>}
                {!readOnly && (
                  <Button variant="ghost" onClick={skipPrint}>
                    {d.onboardingSkipPrint}
                  </Button>
                )}
                <Button variant="primary" disabled={readOnly} onClick={() => void finishJourney()}>
                  {d.onboardingFinish}
                </Button>
                <LinkButton href={`/${locale}/sales/invoices`} variant="secondary">
                  {d.onboardingGoInvoices}
                </LinkButton>
              </div>
            </>
          )}
          {terminal !== null && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <LinkButton href={`/${locale}`} variant="primary">
                {d.onboardingGoHome}
              </LinkButton>
              <LinkButton href={`/${locale}/sales/invoices`} variant="secondary">
                {d.onboardingGoInvoices}
              </LinkButton>
              <LinkButton href={`/${locale}/dashboard`} variant="secondary">
                {d.onboardingGoDashboard}
              </LinkButton>
            </div>
          )}
        </div>
      ) : (
        <Card className="w-full max-w-xl">
          <h2 ref={headingRef} tabIndex={-1} className="mb-2 outline-none text-md font-semibold text-gray-900">
            {d.settingsFiscalNumberingTitle}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onProvision();
            }}
            noValidate
          >
            <fieldset className="flex flex-col gap-4" disabled={busy || readOnly}>
              <legend className="mb-2 text-sm font-medium text-gray-700">
                {d.settingsFiscalNumberingTitle}
              </legend>
              <Select
                id="onb-fiscal-month"
                label={d.fiscalStartMonthLabel}
                value={fiscalMonth}
                onValueChange={setFiscalMonth}
                options={monthNames[locale].map((name, index) => ({
                  value: String(index + 1),
                  label: name,
                }))}
              />
              <Select
                id="onb-assign-at"
                label={d.numberingAssignAtLabel}
                value={assignAt}
                onValueChange={(value) => setAssignAt(value as AssignAt)}
                options={[
                  { value: "posting", label: d.numberingAssignAtPosting },
                  { value: "approval", label: d.numberingAssignAtApproval },
                ]}
              />
            </fieldset>
            {actionRail(
              <Button type="submit" variant="primary" loading={busy} disabled={readOnly}>
                {d.onboardingProvisionButton}
              </Button>,
              null,
              "",
            )}
          </form>
        </Card>
      )}
    </div>
  );
}

/** Narrow an untyped settings value into a JourneyStateValue (untrusted input). */
export function isJourneyStateValue(value: unknown): value is JourneyStateValue {
  if (!isRecord(value)) {
    return false;
  }
  const steps = [
    "registered",
    "activity_picked",
    "workspace_provisioned",
    "opening_balances_done",
    "first_item_created",
    "first_customer_created",
    "first_invoice_posted",
    "first_invoice_printed",
    "completed",
    "skipped",
  ] as const;
  return (
    typeof value.step === "string" &&
    (steps as readonly string[]).includes(value.step) &&
    (typeof value.completed_at === "string" || value.completed_at === null)
  );
}
