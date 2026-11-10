/**
 * TimelinePanel stories (PHASE-027) — the custody-trail states for the
 * visual matrix (AR/EN × density via the harness locale globals). Three
 * stories: the mixed-tone custody trail, the empty log (never a fabricated
 * row), and the dense all-critical trail (dishonor sequence).
 */
import type { Meta, StoryFn } from "@storybook/react-vite";

import { TimelinePanel, type TimelineItem } from "./timeline-panel";

const meta: Meta = {
  title: "Patterns/Timeline",
  parameters: { layout: "padded" },
};
export default meta;

const trail: readonly TimelineItem[] = [
  {
    date: "2026-10-01",
    kind: "RECEIVE",
    title: "استلام الشيك / Cheque received",
    subtitle: "شيك رقم 4471 — بنك الرياض / Cheque no. 4471 — Riyad Bank",
    tone: "positive",
    icon: "receipt-text",
  },
  {
    date: "2026-10-05",
    kind: "DEPOSIT",
    title: "إيداع لدى البنك / Deposited at bank",
    subtitle: "حساب نقدي 1010 / Cash account 1010",
    icon: "landmark",
  },
  {
    date: "2026-10-12",
    kind: "DISHONOR",
    title: "رفض الدفع / Dishonored",
    subtitle: "الرصيد غير كافٍ / Insufficient funds",
    tone: "critical",
    icon: "warning",
  },
  {
    date: "2026-10-13",
    kind: "RECLASSIFY",
    title: "إعادة تصنيف / Reclassified",
    subtitle: "تصحيح رقم الشيك / Metadata correction",
    tone: "warning",
  },
];

export const CustodyTrail: StoryFn = () => (
  <div className="max-w-md">
    <TimelinePanel
      locale="ar"
      title="سجل الحيازة / Custody log"
      items={trail}
      emptyText="لا أحداث / No events"
    />
  </div>
);

export const Empty: StoryFn = () => (
  <div className="max-w-md">
    <TimelinePanel title="سجل الحيازة / Custody log" items={[]} emptyText="لا أحداث / No events" />
  </div>
);

export const DenseTrail: StoryFn = () => (
  <div className="max-w-md">
    <TimelinePanel
      items={[
        { date: "2026-11-01", kind: "RETURN", title: "إرجاع / Returned", tone: "warning", icon: "corner-up-left" },
        { date: "2026-11-02", kind: "DISHONOR", title: "رفض الدفع / Dishonored", tone: "critical", icon: "warning" },
        { date: "2026-11-03", kind: "COLLECT", title: "تحصيل / Collected", tone: "positive", icon: "circle-check" },
      ]}
    />
  </div>
);
