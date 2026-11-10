/**
 * PHASE-022 · DR-P22-07 — bilingual mobile push templates (the FCM leg).
 *
 * The same discipline as application/templates.ts (the email registry):
 * rendering is pure and byte-stable — identical input → byte-identical
 * output; AR/EN resolved per the device's notification locale BEFORE the
 * channel call (§3.5: "template + locale (ar/en) resolved before the call")
 * — the port receives the resolved title/body, never a render instruction.
 *
 * NO financial payloads (DR-P22-07, asserted by the db suite): titles and
 * bodies carry DOCUMENT NUMBERS + NAMES + DATES only — never an amount,
 * price, balance, or quantity. The variable vocabulary below is the safe
 * set the FCM data whitelist mirrors (adapters/fcm/fcm-adapter.ts).
 */

export type PushTemplate =
  /**
   * A customer invoice was posted (issued) — the number + customer name;
   * the amount never rides the push (the app fetches it authenticated).
   */
  | "invoice_posted_to_customer"
  /** A receipt was confirmed against an invoice — the number + customer. */
  | "receipt_confirmed"
  /** An invoice/receivable is approaching its due date — number + date. */
  | "due_date_reminder"
  /** A device trust signal was recorded (DR-P22-09 security plane). */
  | "device_security_alert";

export interface PushTemplateVars {
  /** Official document numbers (SAL-/RCP-… forms) — never amounts. */
  readonly docNo?: string;
  /** Customer/partner display names. */
  readonly customerName?: string;
  /** ISO date labels (due dates, event times). */
  readonly dueDate?: string;
  /** Device display name (the security alert). */
  readonly deviceName?: string;
  /** Event timestamp (the security alert). */
  readonly at?: string;
}

export interface RenderedPushMessage {
  readonly title: string;
  readonly body: string;
}

const AR = {
  invoice_posted_to_customer: (v: PushTemplateVars) => ({
    title: `فاتورة مرحّلة: ${v.docNo ?? ""}`,
    body: `تم ترحيل فاتورة العميل «${v.customerName ?? ""}» رقم ${v.docNo ?? ""}. يمكنكم مراجعة تفاصيلها من التطبيق.`,
  }),
  receipt_confirmed: (v: PushTemplateVars) => ({
    title: `تأكيد سند قبض: ${v.docNo ?? ""}`,
    body: `تم تأكيد سند القبض رقم ${v.docNo ?? ""} من العميل «${v.customerName ?? ""}». يمكنكم مراجعته من التطبيق.`,
  }),
  due_date_reminder: (v: PushTemplateVars) => ({
    title: `تذكير استحقاق: ${v.docNo ?? ""}`,
    body: `الفاتورة رقم ${v.docNo ?? ""} للعميل «${v.customerName ?? ""}» تستحق في ${v.dueDate ?? ""}. يمكنكم مراجعة الاستحقاق من التطبيق.`,
  }),
  device_security_alert: (v: PushTemplateVars) => ({
    title: "تنبيه أمني للجهاز",
    body: `تم رصد إشارة ثقة للجهاز «${v.deviceName ?? ""}» في ${v.at ?? ""}. يمكنكم مراجعة إعدادات الجهاز من التطبيق.`,
  }),
} as const;

const EN = {
  invoice_posted_to_customer: (v: PushTemplateVars) => ({
    title: `Invoice posted: ${v.docNo ?? ""}`,
    body: `Invoice ${v.docNo ?? ""} for customer "${v.customerName ?? ""}" has been posted. Open the app to review it.`,
  }),
  receipt_confirmed: (v: PushTemplateVars) => ({
    title: `Receipt confirmed: ${v.docNo ?? ""}`,
    body: `Receipt ${v.docNo ?? ""} from customer "${v.customerName ?? ""}" was confirmed. Open the app to review it.`,
  }),
  due_date_reminder: (v: PushTemplateVars) => ({
    title: `Due date reminder: ${v.docNo ?? ""}`,
    body: `Invoice ${v.docNo ?? ""} for customer "${v.customerName ?? ""}" is due on ${v.dueDate ?? ""}. Open the app to review the outstanding.`,
  }),
  device_security_alert: (v: PushTemplateVars) => ({
    title: "Device security alert",
    body: `A trust signal was recorded for device "${v.deviceName ?? ""}" at ${v.at ?? ""}. Open the app to review the device settings.`,
  }),
} as const;

/** Render a push template in the device's locale (byte-stable, pure). */
export function renderPushMessage(
  template: PushTemplate,
  locale: "ar" | "en",
  vars: PushTemplateVars,
): RenderedPushMessage {
  const catalog = locale === "ar" ? AR : EN;
  return catalog[template](vars);
}
