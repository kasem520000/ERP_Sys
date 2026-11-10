/**
 * PHASE-007 accounting pattern stories (COMPONENT_CATALOG §6.3):
 * JournalEntryGrid (+ its MoneySummaryBar live Δ), the bar alone, and
 * ApprovalsQueue. Minimal state pairs for the visual matrix — the harness
 * drives AR/EN × density through globals; labels are bilingual inline.
 */
import type { Meta, StoryFn } from "@storybook/react-vite";
import { useState } from "react";

import { ApprovalsQueue } from "./approvals-queue";
import { JournalEntryGrid, emptyLine, type JournalLineDraft } from "./journal-entry-grid";
import { MoneySummaryBar } from "./money-summary-bar";

const meta: Meta = {
  title: "Patterns/Accounting",
  parameters: { layout: "padded" },
};
export default meta;

const accounts = [
  { id: "a1", label: "Cash — main / الصندوق الرئيسي", labelAr: "الصندوق الرئيسي", meta: "1111" },
  { id: "a2", label: "Accounts receivable / العملاء", labelAr: "العملاء (المدينون)", meta: "1130" },
  { id: "a3", label: "Sales revenue / إيرادات المبيعات", labelAr: "إيرادات المبيعات", meta: "4100" },
  { id: "a4", label: "Rent expense / مصروف الإيجار", labelAr: "مصروف الإيجار", meta: "5210" },
];

const partners = [
  { id: "p1", label: "شركة النور للتجارة", labelAr: "شركة النور للتجارة", meta: "P-000001" },
  { id: "p2", label: "Al-Bahr Blue Est.", labelAr: "مؤسسة البحر الأزرق", meta: "P-000002" },
];

const costCenters = [
  { id: "c1", label: "HQ / المركز الرئيسي", labelAr: "المركز الرئيسي", meta: "CC-01" },
];

const bilingualLabels = {
  account: "الحساب / Account",
  description: "البيان / Description",
  costCenter: "مركز التكلفة / Cost center",
  partner: "الجهة / Partner",
  debit: "مدين / Debit",
  credit: "دائن / Credit",
  taxCode: "الضريبة / Tax",
  lineTotal: "سطر / Line",
  addLine: "إضافة سطر / Add line",
  removeLine: "حذف / Remove",
  duplicateLine: "تكرار السطر / Duplicate",
  partnerRequired: "مطلوب تحديد الجهة لهذا الحساب / Partner is required on this account",
  summary: {
    debit: "إجمالي المدين / Σ Debit",
    credit: "إجمالي الدائن / Σ Credit",
    difference: "الفرق / Δ",
    balanced: "متوازن / Balanced",
    unbalanced: "القيد غير متوازن / Entry unbalanced",
  },
};

export const JournalGridBalanced: StoryFn = () => {
  const [lines, setLines] = useState<JournalLineDraft[]>([
    { id: "l1", accountId: "a2", partnerId: "p1", debit: "1150.0000", credit: "" },
    { id: "l2", accountId: "a3", debit: "", credit: "1000.0000" },
    { id: "l3", accountId: "a4", costCenterId: "c1", debit: "", credit: "150.0000" },
  ]);
  return (
    <div className="w-full max-w-5xl">
      <JournalEntryGrid
        currency="SAR"
        accounts={accounts}
        partners={partners}
        costCenters={costCenters}
        partnerRequiredAccountIds={new Set(["a2"])}
        labels={bilingualLabels}
        lines={lines}
        onLinesChange={setLines}
      />
    </div>
  );
};

export const JournalGridUnbalanced: StoryFn = () => {
  const [lines, setLines] = useState<JournalLineDraft[]>([
    { id: "l1", accountId: "a2", partnerId: "p1", debit: "1150.0000", credit: "" },
    { id: "l2", accountId: "a3", debit: "", credit: "1000.0000" },
  ]);
  return (
    <div className="w-full max-w-5xl">
      <JournalEntryGrid
        currency="SAR"
        accounts={accounts}
        partners={partners}
        costCenters={costCenters}
        partnerRequiredAccountIds={new Set(["a2"])}
        labels={bilingualLabels}
        lines={lines}
        onLinesChange={setLines}
      />
    </div>
  );
};

export const JournalGridEmpty: StoryFn = () => {
  const [lines, setLines] = useState<JournalLineDraft[]>([emptyLine(), emptyLine()]);
  return (
    <div className="w-full max-w-5xl">
      <JournalEntryGrid
        currency="SAR"
        accounts={accounts}
        partners={partners}
        costCenters={costCenters}
        partnerRequiredAccountIds={new Set(["a2"])}
        labels={bilingualLabels}
        lines={lines}
        onLinesChange={setLines}
      />
    </div>
  );
};

export const SummaryBarBalanced: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <MoneySummaryBar
      debit="1380.0000"
      credit="1380.0000"
      currency="SAR"
      labels={bilingualLabels.summary}
    />
  </div>
);

export const SummaryBarUnbalanced: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <MoneySummaryBar
      debit="1150.0000"
      credit="1000.0000"
      currency="SAR"
      labels={bilingualLabels.summary}
    />
  </div>
);

export const ApprovalsQueueDefault: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ApprovalsQueue
      rows={[
        {
          id: "j1",
          title: "قيد إيجار يونيو / Rent journal — June",
          description: "monthly rent accrual",
          totalBase: "15000.0000",
          currency: "SAR",
          submittedBy: "سارة / Sara",
          submittedAt: "2026-06-28",
          isOwnSubmission: false,
          status: "PENDING_APPROVAL",
        },
        {
          id: "j2",
          title: "تسوية بنكية / Bank adjustment",
          totalBase: "420.5000",
          currency: "SAR",
          submittedBy: "أنت / You",
          submittedAt: "2026-06-29",
          isOwnSubmission: true,
          status: "PENDING_APPROVAL",
        },
      ]}
      labels={{
        title: "بانتظار الموافقة / Pending approvals",
        empty: "لا عناصر / Nothing awaiting approval",
        approve: "اعتماد / Approve",
        reject: "رفض / Reject",
        openPreview: "معاينة / Preview",
        totalBase: "الإجمالي / Total (base)",
        submittedBy: "مقدم بواسطة / By",
        selfApprovalHint: "لا يمكنك اعتماد قيدك الخاص / You cannot approve your own document",
        statusLabel: "بانتظار الموافقة / Pending",
      }}
    />
  </div>
);

export const ApprovalsQueueEmpty: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ApprovalsQueue
      rows={[]}
      labels={{
        title: "بانتظار الموافقة / Pending approvals",
        empty: "لا عناصر / Nothing awaiting approval",
        approve: "اعتماد / Approve",
        reject: "رفض / Reject",
        openPreview: "معاينة / Preview",
        totalBase: "الإجمالي / Total (base)",
        submittedBy: "مقدم بواسطة / By",
        selfApprovalHint: "—",
        statusLabel: "بانتظار الموافقة / Pending",
      }}
    />
  </div>
);
