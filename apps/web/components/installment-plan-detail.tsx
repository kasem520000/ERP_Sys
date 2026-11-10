"use client";

/**
 * PHASE-027 (wave F) — installment plan document detail (PAGE_ARCHETYPES
 * §5): the overview + BR-049 policy DefLists and the schedule lines table
 * (seq/due/amount/status/receipt refs/late fee). Per-line actions: waive
 * (reason-required dialog — BR-049; the button renders only for sessions
 * holding installments.lines.waive, the owner-permission surface) and
 * charge-late-fee (OVERDUE lines; installments.plans.manage). The schedule
 * is immutable after activation (BR-048) — this screen never offers edits.
 */
import { useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Dialog,
  Input,
  formatMoneyDisplay,
  useToast,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  InstallmentLineRow,
  InstallmentPlanDetailRow,
  LateFeeChargeResult,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatDateTime,
  formatMessage,
  localizedName,
  localizedInstallmentFrequency,
  localizedInstallmentLineStatus,
  localizedInstallmentSource,
  localizedInstallmentStatus,
  localizedInstallmentsError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";

export function InstallmentPlanDetail({
  locale,
  detail,
  partner,
  permissions,
  baseCurrency,
}: {
  locale: Locale;
  detail: InstallmentPlanDetailRow;
  partner: PartnerRow | null;
  permissions: readonly string[];
  baseCurrency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [plan, setPlan] = useState(detail.plan);
  const [lines, setLines] = useState<readonly InstallmentLineRow[]>(detail.lines);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);

  // -- waive dialog state -------------------------------------------------------
  const [waiveLine, setWaiveLine] = useState<InstallmentLineRow | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  const canWaive = permissions.includes("installments.lines.waive");
  const canChargeLateFee = permissions.includes("installments.plans.manage");

  async function refresh(): Promise<void> {
    const refreshed = await bffFetch<InstallmentPlanDetailRow>(`installment-plans/${plan.id}`);
    if (refreshed.ok) {
      setPlan(refreshed.data.plan);
      setLines(refreshed.data.lines);
    }
  }

  async function submitWaive(): Promise<void> {
    if (waiveLine === null) {
      return;
    }
    setError(null);
    if (waiveReason.trim() === "") {
      setError(d.instErrWaiveReason);
      return;
    }
    setBusyLine(waiveLine.id);
    const waived = await bffFetch<InstallmentLineRow>(
      `installment-plans/${plan.id}/lines/${waiveLine.id}/waive`,
      { method: "POST", body: { reason: waiveReason.trim() } },
    );
    setBusyLine(null);
    if (!waived.ok) {
      setError(localizedInstallmentsError(d, waived.error, waived.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.instWaiveToast, { seq: String(waiveLine.seq) }));
    setWaiveLine(null);
    setWaiveReason("");
    await refresh();
  }

  async function chargeLateFee(line: InstallmentLineRow): Promise<void> {
    setError(null);
    setNotice(null);
    setBusyLine(line.id);
    const charged = await bffFetch<LateFeeChargeResult>(
      `installment-plans/${plan.id}/lines/${line.id}/charge-late-fee`,
      { method: "POST", body: {} },
    );
    setBusyLine(null);
    if (!charged.ok) {
      setError(localizedInstallmentsError(d, charged.error, charged.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.instChargeLateFeeToast, {
        fee: formatMoneyDisplay(charged.data.fee, 2),
        entry: charged.data.journalEntryId,
      }),
    );
    toast({ tone: "success", title: d.instChargeLateFeeAction });
    await refresh();
  }

  const statusBadge = (
    <Badge tone={plan.status === null ? "neutral" : "primary"}>
      {localizedInstallmentStatus(d, plan.status)}
    </Badge>
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title={d.instDetailOverview} actions={statusBadge}>
          <DefList
            items={[
              { term: d.instFilterSource, children: localizedInstallmentSource(d, plan.sourceType) },
              {
                term: d.instColSource,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {plan.sourceNo ?? plan.sourceId}
                  </span>
                ),
              },
              {
                term: d.instFilterPartner,
                children:
                  partner === null ? plan.partnerId : localizedName(partner.name, partner.nameAr, locale),
              },
              {
                term: d.instWizBrTotal,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(plan.totalAmount, 2)} {currency}
                  </span>
                ),
              },
              {
                term: d.instWizDownPayment,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(plan.downPayment, 2)}
                  </span>
                ),
              },
              { term: d.instWizCount, children: String(plan.lineCount) },
              {
                term: d.instWizStartDate,
                children: (
                  <span className="font-mono text-sm" dir="ltr">
                    {plan.startDate}
                  </span>
                ),
              },
              { term: d.instWizFrequency, children: localizedInstallmentFrequency(d, plan.frequency) },
              ...(plan.activatedAt === null
                ? []
                : [{ term: d.instWizActivate, children: formatDateTime(plan.activatedAt, locale) }]),
              { term: d.notesFormNote, children: plan.note ?? <span className="text-muted-foreground">—</span> },
              { term: d.notesFormNoteAr, children: plan.noteAr ?? <span className="text-muted-foreground">—</span> },
            ]}
          />
        </Card>

        <Card
          title={d.instDetailPolicy}
          actions={<Badge tone="neutral">{d.instWizPlaceholderChip}</Badge>}
        >
          <DefList
            items={[
              {
                term: d.instWizPolicyRate,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(plan.lateFeePolicy.rate, 4)}
                  </span>
                ),
              },
              {
                term: d.instWizPolicyCap,
                children: (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(plan.lateFeePolicy.cap, 2)}
                  </span>
                ),
              },
              { term: d.instWizPolicyGrace, children: String(plan.lateFeePolicy.grace_days) },
              { term: d.instWizPolicyAuto, children: plan.lateFeePolicy.auto_charge ? "✓" : "—" },
              {
                term: d.instWizPolicyDefaulted,
                children: String(plan.lateFeePolicy.defaulted_after_lines),
              },
            ]}
          />
        </Card>
      </div>

      <Card title={d.instDetailSchedule}>
        {lines.length === 0 ? (
          <p className="text-sm text-gray-600">{d.instDetailScheduleEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{d.instDetailSchedule}</caption>
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
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.colStatus}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.instColCollected}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.instColReceipts}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.instColLateFee}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesActionsTitle}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-subtle">
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {line.seq}
                    </td>
                    <td className="px-2 py-2 font-mono text-sm" dir="ltr">
                      {line.dueDate}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.amount, 2)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={line.status === "PAID" ? "primary" : "neutral"}>
                        {localizedInstallmentLineStatus(d, line.status)}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(line.collectedAmount, 2)}
                    </td>
                    <td className="px-2 py-2">
                      {line.receiptRefs === null || line.receiptRefs.length === 0 ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span className="flex flex-col font-mono text-xs" dir="ltr">
                          {line.receiptRefs.map((ref) => (
                            <span key={ref.receiptId}>
                              {ref.receiptNo ?? ref.receiptId.slice(0, 8)} · {formatMoneyDisplay(ref.amount, 2)}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {line.lateFeeAmount === null ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        formatMoneyDisplay(line.lateFeeAmount, 2)
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {canWaive &&
                          line.status !== "WAIVED" &&
                          line.status !== "PAID" &&
                          line.waiveReason === null && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setWaiveLine(line);
                                setWaiveReason("");
                              }}
                            >
                              {d.instWaiveAction}
                            </Button>
                          )}
                        {canChargeLateFee && line.status === "OVERDUE" && line.lateFeeEntryId === null && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busyLine === line.id}
                            onClick={() => void chargeLateFee(line)}
                          >
                            {d.instChargeLateFeeAction}
                          </Button>
                        )}
                        {line.waiveReason !== null && (
                          <span className="text-xs text-gray-500">{line.waiveReason}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={waiveLine !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWaiveLine(null);
            setWaiveReason("");
          }
        }}
        title={`${d.instWaiveAction} — ${waiveLine === null ? "" : waiveLine.seq}`}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            id="inst-waive-reason"
            label={`${d.instWaiveReason} (${d.instErrWaiveReason})`}
            value={waiveReason}
            onValueChange={setWaiveReason}
            required
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setWaiveLine(null);
                setWaiveReason("");
              }}
            >
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void submitWaive()} loading={busyLine !== null}>
              {d.commonConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
