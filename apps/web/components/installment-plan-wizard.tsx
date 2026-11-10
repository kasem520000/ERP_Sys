"use client";

/**
 * PHASE-027 (wave F) — the installment plan wizard (PAGE_ARCHETYPES §9):
 * step 1 picks the source document (a POSTED CREDIT sales invoice or an
 * ACTIVE service contract — the exact sets the API's resolveSource
 * accepts), step 2 sets the schedule parameters with a LIVE preview
 * computed by the client-side kernel mirror (lib/installments-schedule —
 * lineAmount = round4((total−down)/count), the last line absorbs the
 * remainder, Σ lines == total − down EXACTLY), step 3 sets the BR-049
 * late-fee policy pre-filled with the PLACEHOLDER (OQ-002) defaults. The
 * create POST never sends totalAmount (the server resolves the source
 * total — BR-048's equality target); contract-source totals are unknown
 * client-side so the preview runs on a clearly-labeled estimate. Activate
 * (POST :id/activate) enforces the exact-total rule server-side.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
  useToast,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  InstallmentPlanDetailRow,
  InstallmentPlanRow,
  PartnerRow,
  SalesInvoiceRow,
  ServiceContractReadRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { sumExact } from "../lib/exact-money";
import {
  computeSchedulePreview,
  LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS,
  type InstallmentFrequency,
  type ScheduleLine,
} from "../lib/installments-schedule";
import {
  formatMessage,
  localizedName,
  localizedInstallmentFrequency,
  localizedInstallmentSource,
  localizedInstallmentStatus,
  localizedInstallmentsError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice } from "./notices";

type WizardStep = 1 | 2 | 3;
const TOTAL_STEPS = 3;
const FREQUENCIES: readonly InstallmentFrequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"];

export function InstallmentPlanWizard({
  locale,
  partners,
  salesInvoices,
  contracts,
  baseCurrency,
  today,
}: {
  locale: Locale;
  partners: readonly PartnerRow[];
  salesInvoices: readonly SalesInvoiceRow[];
  contracts: readonly ServiceContractReadRow[];
  baseCurrency: string;
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [step, setStep] = useState<WizardStep>(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // -- step 1: the source document -------------------------------------------
  const [sourceType, setSourceType] = useState<"sales_invoice" | "service_contract">("sales_invoice");
  const [sourceId, setSourceId] = useState("");
  const [estimateTotal, setEstimateTotal] = useState("");

  // -- step 2: schedule parameters --------------------------------------------
  const [downPayment, setDownPayment] = useState("0");
  const [count, setCount] = useState("4");
  const [startDate, setStartDate] = useState(today);
  const [frequency, setFrequency] = useState<InstallmentFrequency>("MONTHLY");

  // -- step 3: the BR-049 policy (PLACEHOLDER defaults pre-filled) -------------
  const [policyRate, setPolicyRate] = useState<string>(LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS.rate);
  const [policyCap, setPolicyCap] = useState<string>(LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS.cap);
  const [policyGrace, setPolicyGrace] = useState(String(LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS.grace_days));
  const [policyAuto, setPolicyAuto] = useState<boolean>(LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS.auto_charge);
  const [policyDefaulted, setPolicyDefaulted] = useState(
    String(LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS.defaulted_after_lines),
  );
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");

  // -- created draft + activation ---------------------------------------------
  const [created, setCreated] = useState<InstallmentPlanDetailRow | null>(null);

  const sourceOptions = useMemo(() => {
    if (sourceType === "sales_invoice") {
      return salesInvoices.map((invoice) => ({
        value: invoice.id,
        label: `${invoice.invoiceNo ?? invoice.id} · ${formatMoneyDisplay(invoice.totalGross, 2)} ${invoice.currencyCode}`,
      }));
    }
    return contracts.map((row) => ({
      value: row.contract.id,
      label: `${row.contract.contractNo ?? row.contract.id} · ${localizedName(row.contract.title, row.contract.titleAr, locale)}`,
    }));
  }, [sourceType, salesInvoices, contracts, locale]);

  /** The preview total: invoices carry their own; contracts need an estimate. */
  const previewTotal = useMemo(() => {
    if (sourceType === "sales_invoice") {
      const invoice = salesInvoices.find((row) => row.id === sourceId);
      return invoice === undefined ? "" : invoice.totalGross;
    }
    return estimateTotal;
  }, [sourceType, sourceId, salesInvoices, estimateTotal]);

  const partnerLabel = useMemo(() => {
    if (sourceId === "") {
      return "";
    }
    let partnerId = "";
    if (sourceType === "sales_invoice") {
      partnerId = salesInvoices.find((row) => row.id === sourceId)?.customerId ?? "";
    } else {
      partnerId = contracts.find((row) => row.contract.id === sourceId)?.contract.partnerId ?? "";
    }
    const partner = partners.find((row) => row.id === partnerId);
    return partner === undefined ? partnerId : localizedName(partner.name, partner.nameAr, locale);
  }, [sourceType, sourceId, salesInvoices, contracts, partners, locale]);

  /** LIVE preview through the kernel mirror (throws on an impossible shape). */
  const preview: { lines: ScheduleLine[]; sum: string; invalid: boolean } = useMemo(() => {
    const countNumber = Number(count);
    if (
      previewTotal === "" ||
      !/^\d+$/.test(count.trim()) ||
      countNumber < 1 ||
      countNumber > 120 ||
      startDate === "" ||
      downPayment === ""
    ) {
      return { lines: [], sum: "0.0000", invalid: true };
    }
    try {
      const lines = computeSchedulePreview({
        total: previewTotal,
        down: downPayment,
        count: countNumber,
        startDate,
        frequency,
      });
      return { lines, sum: sumExact(lines.map((line) => line.amount)), invalid: false };
    } catch {
      return { lines: [], sum: "0.0000", invalid: true };
    }
  }, [previewTotal, count, startDate, downPayment, frequency]);

  const stepOneReady = sourceId !== "" && (sourceType === "sales_invoice" || estimateTotal !== "");
  const stepTwoReady = !preview.invalid;

  function goToStep(next: WizardStep): void {
    setError(null);
    if (next > 1 && !stepOneReady) {
      setError(d.errorsValidation);
      return;
    }
    if (next > 2 && !stepTwoReady) {
      setError(d.instWizPreviewInvalid);
      return;
    }
    setStep(next);
  }

  async function createPlan(): Promise<void> {
    setError(null);
    if (!stepOneReady || !stepTwoReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const createdPlan = await bffFetch<InstallmentPlanDetailRow>("installment-plans", {
      method: "POST",
      body: {
        sourceType,
        sourceId,
        downPayment,
        count: Number(count),
        startDate,
        frequency,
        lateFeePolicy: {
          rate: policyRate,
          cap: policyCap,
          grace_days: Number(policyGrace),
          auto_charge: policyAuto,
          defaulted_after_lines: Number(policyDefaulted),
        },
        note: note.trim() === "" ? null : note.trim(),
        noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
      },
    });
    setBusy(false);
    if (!createdPlan.ok) {
      setError(localizedInstallmentsError(d, createdPlan.error, createdPlan.retryAfterSeconds));
      return;
    }
    setCreated(createdPlan.data);
    toast({ tone: "success", title: d.instWizCreatedToast });
  }

  async function activatePlan(): Promise<void> {
    if (created === null) {
      return;
    }
    setError(null);
    setBusy(true);
    const activated = await bffFetch<InstallmentPlanRow>(`installment-plans/${created.plan.id}/activate`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!activated.ok) {
      setError(localizedInstallmentsError(d, activated.error, activated.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.instWizActivatedToast });
    router.push(`/${locale}/installments/${created.plan.id}`);
  }

  if (created !== null) {
    return (
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <Card
          title={d.instDetailOverview}
          actions={
            <Badge tone={created.plan.status === null ? "neutral" : "primary"}>
              {localizedInstallmentStatus(d, created.plan.status)}
            </Badge>
          }
        >
          <DefList
            items={[
              { term: d.instFilterSource, children: localizedInstallmentSource(d, created.plan.sourceType) },
              {
                term: d.instColSource,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {created.plan.sourceNo ?? created.plan.sourceId}
                  </span>
                ),
              },
              {
                term: d.instWizBrTotal,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(created.plan.totalAmount, 2)} {currency}
                  </span>
                ),
              },
              {
                term: d.instWizDownPayment,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(created.plan.downPayment, 2)}
                  </span>
                ),
              },
              { term: d.instWizCount, children: String(created.plan.lineCount) },
              {
                term: d.instWizFrequency,
                children: localizedInstallmentFrequency(d, created.plan.frequency),
              },
            ]}
          />
        </Card>
        <InfoNotice>{d.instWizActivateHint}</InfoNotice>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void activatePlan()} loading={busy}>
            {d.instWizActivate}
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push(`/${locale}/installments/${created.plan.id}`)}
          >
            {d.commonOpen}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <nav aria-label={d.instNewTitle} className="flex flex-wrap items-center gap-2">
        {[
          { id: 1 as WizardStep, label: d.instWizStepSource },
          { id: 2 as WizardStep, label: d.instWizStepSchedule },
          { id: 3 as WizardStep, label: d.instWizStepPolicy },
        ].map((entry) =>
          entry.id === step ? (
            <span
              key={entry.id}
              aria-current="step"
              className="rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800"
            >
              {formatMessage(d.instWizStepOf, { current: entry.id, total: TOTAL_STEPS })} — {entry.label}
            </span>
          ) : (
            <span
              key={entry.id}
              className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-500"
            >
              {formatMessage(d.instWizStepOf, { current: entry.id, total: TOTAL_STEPS })} — {entry.label}
            </span>
          ),
        )}
      </nav>

      {step === 1 && (
        <Card title={d.instWizStepSource}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id="inst-wiz-source-type"
                label={d.instWizSourceType}
                value={sourceType}
                onValueChange={(value) => {
                  setSourceType(value === "service_contract" ? "service_contract" : "sales_invoice");
                  setSourceId("");
                  setEstimateTotal("");
                }}
                options={[
                  { value: "sales_invoice", label: d.instWizSourceInvoice },
                  { value: "service_contract", label: d.instWizSourceContract },
                ]}
                required
              />
              <Select
                id="inst-wiz-source"
                label={sourceType === "sales_invoice" ? d.instWizSourceInvoice : d.instWizSourceContract}
                value={sourceId}
                onValueChange={setSourceId}
                options={[{ value: "", label: d.kindFilterAll }, ...sourceOptions]}
                required
              />
            </div>
            {sourceOptions.length === 0 && <InfoNotice>{d.pickerEmptyText}</InfoNotice>}
            {sourceType === "service_contract" && sourceId !== "" && (
              <div className="flex flex-col gap-1">
                <MoneyInput
                  id="inst-wiz-estimate"
                  label={d.instWizSourceTotal}
                  amount={estimateTotal}
                  onAmountChange={setEstimateTotal}
                  currency={currency}
                  required
                />
                <Badge tone="neutral">{d.instWizEstimateChip}</Badge>
                <p className="text-xs text-gray-600">{d.instWizActivateHint}</p>
              </div>
            )}
            {partnerLabel !== "" && (
              <p className="text-sm text-gray-600">
                {d.instFilterPartner}: <strong>{partnerLabel}</strong>
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => goToStep(2)}>
                {d.instWizNext}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card title={d.instWizStepSchedule}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MoneyInput
                id="inst-wiz-down"
                label={d.instWizDownPayment}
                amount={downPayment}
                onAmountChange={setDownPayment}
                currency={currency}
                required
              />
              <Input
                id="inst-wiz-count"
                label={d.instWizCount}
                value={count}
                onValueChange={setCount}
                inputMode="numeric"
                mono
                required
              />
              <Input
                id="inst-wiz-start"
                label={d.instWizStartDate}
                value={startDate}
                onValueChange={setStartDate}
                placeholder="YYYY-MM-DD"
                mono
                bidiIsolate
                required
              />
              <Select
                id="inst-wiz-frequency"
                label={d.instWizFrequency}
                value={frequency}
                onValueChange={(value) => {
                  const next = FREQUENCIES.find((entry) => entry === value);
                  if (next !== undefined) {
                    setFrequency(next);
                  }
                }}
                options={FREQUENCIES.map((entry) => ({
                  value: entry,
                  label: localizedInstallmentFrequency(d, entry),
                }))}
                required
              />
            </div>
            <p className="text-sm text-gray-600">
              {d.instWizSourceTotal}:{" "}
              {previewTotal === "" ? (
                "—"
              ) : (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(previewTotal, 2)} {currency}
                </span>
              )}
              {sourceType === "service_contract" && (
                <Badge tone="neutral">{d.instWizEstimateChip}</Badge>
              )}
            </p>
            {preview.invalid ? (
              <ErrorNotice>{d.instWizPreviewInvalid}</ErrorNotice>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="text-start text-xs font-medium text-gray-600">
                    {d.instWizPreviewTitle}
                  </caption>
                  <thead>
                    <tr className="border-b border-subtle">
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.instColSeq}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.notesFormMaturityDate}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.instColAmount}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((line) => (
                      <tr key={line.seq} className="border-b border-subtle">
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {line.seq}
                        </td>
                        <td className="px-2 py-2 font-mono text-sm" dir="ltr">
                          {line.dueDate}
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(line.amount, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-subtle">
                      <td scope="row" colSpan={2} className="px-2 py-2 text-start font-medium">
                        {d.instColTotal} (Σ {d.instWizCount} {locale === "ar" ? "قسط" : "lines"})
                      </td>
                      <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(preview.sum, 2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => goToStep(1)}>
                {d.instWizBack}
              </Button>
              <Button variant="primary" disabled={preview.invalid} onClick={() => goToStep(3)}>
                {d.instWizNext}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card
          title={d.instWizPolicyTitle}
          actions={<Badge tone="neutral">{d.instWizPlaceholderChip}</Badge>}
        >
          <div className="flex flex-col gap-3">
            <InfoNotice>{d.instWizPolicyHint}</InfoNotice>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                id="inst-wiz-policy-rate"
                label={d.instWizPolicyRate}
                value={policyRate}
                onValueChange={setPolicyRate}
                mono
                bidiIsolate
              />
              <MoneyInput
                id="inst-wiz-policy-cap"
                label={d.instWizPolicyCap}
                amount={policyCap}
                onAmountChange={setPolicyCap}
                currency={currency}
              />
              <Input
                id="inst-wiz-policy-grace"
                label={d.instWizPolicyGrace}
                value={policyGrace}
                onValueChange={setPolicyGrace}
                inputMode="numeric"
                mono
              />
              <div className="flex items-center pt-5">
                <Checkbox
                  label={d.instWizPolicyAuto}
                  checked={policyAuto}
                  onCheckedChange={(checked) => setPolicyAuto(checked === true)}
                />
              </div>
              <Input
                id="inst-wiz-policy-defaulted"
                label={d.instWizPolicyDefaulted}
                value={policyDefaulted}
                onValueChange={setPolicyDefaulted}
                inputMode="numeric"
                mono
              />
              <Input id="inst-wiz-note" label={d.notesFormNote} value={note} onValueChange={setNote} />
              <Input
                id="inst-wiz-note-ar"
                label={d.notesFormNoteAr}
                value={noteAr}
                onValueChange={setNoteAr}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => goToStep(2)}>
                {d.instWizBack}
              </Button>
              <Button variant="primary" onClick={() => void createPlan()} loading={busy}>
                {d.instWizCreate}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
