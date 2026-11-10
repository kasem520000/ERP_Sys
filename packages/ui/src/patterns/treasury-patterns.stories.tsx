/**
 * PHASE-008 treasury pattern stories (COMPONENT_CATALOG §6.3 ShiftPanel):
 * the cashier-shift console across its lifecycle — OPEN with the capture +
 * close form, close with variance (supervisor fields live), the CLOSED
 * read-only summary, and the error state (BR-021 supervisor-required
 * feedback from the app's error mapping). Bilingual inline labels, same
 * CSF + data-testid conventions as accounting-patterns.stories.tsx.
 */
import type { Meta, StoryFn } from "@storybook/react-vite";

import { ShiftPanel, type ShiftClosePayload } from "./shift-panel";

const meta: Meta = {
  title: "Patterns/Treasury",
  parameters: { layout: "padded" },
};
export default meta;

const bilingualLabels = {
  title: "وردية الصندوق / Cashier shift",
  statusOpen: "مفتوحة / Open",
  statusClosed: "مغلقة / Closed",
  statusCancelled: "ملغاة / Cancelled",
  opening: "العهدة الافتتاحية / Opening float",
  capturedIn: "القبض المُسجّل / Captured in",
  capturedOut: "الصرف المُسجّل / Captured out",
  expected: "المتوقع / Expected",
  counted: "المعدود / Counted",
  difference: "الفرق / Variance",
  balanced: "مطابق للعدّ / Counts match",
  varianceNote: "أدخل السبب، وبيانات المشرف عند تجاوز حد التسامح / Enter a reason + supervisor when beyond tolerance",
  closeReason: "سبب الإغلاق / Close reason",
  supervisor: "المشرف / Supervisor",
  supervisorPin: "رمز المشرف / Supervisor PIN",
  supervisorHint: "مطلوب عند فرق يتجاوز التسامح / required when variance exceeds tolerance",
  captureTitle: "تسجيل حركة / Capture movement",
  captureHint: "سجّل الإيداعات والمصروفات النقدية خلال الوردية / Record cash in/out during the shift",
  captureSubmit: "تسجيل / Capture",
  closeTitle: "إغلاق الوردية / Close shift",
  closeSubmit: "إغلاق / Close",
  closeVarianceJournal: "قيد فرق الوردية / Variance journal",
  closedNote: "الوردية مغلقة — الملخص للعرض فقط / Shift closed — read-only summary",
};

export const ShiftOpenCapture: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ShiftPanel
      shift={{
        id: "s1",
        status: "OPEN",
        currency: "SAR",
        openingAmount: "500.00",
        capturedIn: "2340.5000",
        capturedOut: "160.2500",
        expectedAmount: null,
        countedAmount: null,
        difference: null,
        closeReason: null,
      }}
      labels={bilingualLabels}
      onCapture={(cashIn, cashOut) => {
        void cashIn;
        void cashOut;
      }}
      onClose={(payload: ShiftClosePayload) => void payload}
    />
  </div>
);

export const ShiftCloseVariance: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ShiftPanel
      shift={{
        id: "s2",
        status: "OPEN",
        currency: "SAR",
        openingAmount: "500.00",
        capturedIn: "2340.5000",
        capturedOut: "160.2500",
        expectedAmount: null,
        countedAmount: null,
        difference: null,
        closeReason: null,
      }}
      labels={bilingualLabels}
      // The close form opens with a counted amount that leaves a variance —
      // the reason + supervisor fields go live (BR-021 presentation).
      initialCloseDraft={{ countedAmount: "2660.0000", reason: "عجز نقدي / cash shortage" }}
      onCapture={() => undefined}
      onClose={(payload: ShiftClosePayload) => void payload}
    />
  </div>
);

export const ShiftClosedSummary: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ShiftPanel
      shift={{
        id: "s3",
        status: "CLOSED",
        currency: "SAR",
        openingAmount: "500.00",
        capturedIn: "2340.5000",
        capturedOut: "160.2500",
        expectedAmount: "2680.2500",
        countedAmount: "2670.2500",
        difference: "-10.0000",
        closeReason: "عجز نقدية أثناء الجرد / cash shortage during count",
      }}
      labels={bilingualLabels}
    />
  </div>
);

export const ShiftSupervisorRequired: StoryFn = () => (
  <div className="w-full max-w-3xl">
    <ShiftPanel
      shift={{
        id: "s4",
        status: "OPEN",
        currency: "SAR",
        openingAmount: "500.00",
        capturedIn: "2340.5000",
        capturedOut: "160.2500",
        expectedAmount: null,
        countedAmount: null,
        difference: null,
        closeReason: null,
      }}
      labels={bilingualLabels}
      onCapture={() => undefined}
      onClose={(payload: ShiftClosePayload) => void payload}
      error="الفرق يتجاوز حد التسامح — مطلوب مشرف ورمز وسبب / Variance exceeds tolerance — supervisor id + PIN + reason required"
    />
  </div>
);
