/**
 * PHASE-041 (T-04 · FD-30) — the BUILTIN template catalog: the code-side
 * defaults every tenant starts from (the effective-template resolution:
 * tenant row || builtin fallback — a tenant never faces an empty
 * template). The catalog is also the documented variable contract (the
 * print-template variable documentation ships in DATA_DICTIONARY.md —
 * T-12): every variable is typed here (name, required, description).
 *
 * The 039/036 HANDOFF lands here: the dunning letters (WHATSAPP/SMS
 * persisting QUEUED since 036, EMAIL carrying the register-as-evidence
 * snapshot since 039) get their bilingual templates — dunning.step1..3
 * per channel. WhatsApp templates are TEMPLATE-MESSAGE shaped: the
 * declared variables map to the ordered positional body parameters the
 * adapter sends (WhatsApp's own discipline).
 */

import type { OutboundChannel } from "../domain/channel-port";

/** A typed variable declaration (the FD-30 variable contract). */
export interface TemplateVariable {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

/** One builtin template (one channel × one locale). */
export interface BuiltinTemplate {
  readonly key: string;
  readonly channel: OutboundChannel;
  readonly locale: "ar" | "en";
  readonly module: string;
  readonly subject?: string;
  readonly body: string;
  readonly variables: readonly TemplateVariable[];
}

/** The declaration order IS the WhatsApp positional-parameter order. */
const CUSTOMER_NAME: TemplateVariable = {
  name: "customer_name",
  required: true,
  description: "The customer's display name / اسم العميل",
};
const INVOICE_NUMBER: TemplateVariable = {
  name: "invoice_number",
  required: true,
  description: "The invoice document number / رقم الفاتورة",
};
const AMOUNT_DUE: TemplateVariable = {
  name: "amount_due",
  required: true,
  description: "The formatted outstanding amount / المبلغ المستحق منسَّقاً",
};
const DUE_DATE: TemplateVariable = {
  name: "due_date",
  required: true,
  description: "The localized due date / تاريخ الاستحقاق مترجماً",
};

function dunningTemplates(): BuiltinTemplate[] {
  const steps: { key: string; days: string; arDays: string; escalate: boolean }[] = [
    { key: "dunning.step1", days: "7", arDays: "٧", escalate: false },
    { key: "dunning.step2", days: "14", arDays: "١٤", escalate: false },
    { key: "dunning.step3", days: "30", arDays: "٣٠", escalate: true },
  ];
  const templates: BuiltinTemplate[] = [];
  for (const step of steps) {
    const escalateSuffixAr = step.escalate ? " وقد أحيل ملفكم إلى إجراءات التحصيل النهائية." : "";
    const escalateSuffixEn = step.escalate
      ? " Your account has now been referred to final collection procedures."
      : "";
    templates.push(
      {
        key: step.key,
        channel: "EMAIL",
        locale: "ar",
        module: "collections",
        subject: `تذكير بمستحقاتكم — فاتورة {{invoice_number}}`,
        body:
          `عزيزي/عزيزتي {{customer_name}},\n\n` +
          `نودّ تذكيركم بأن الفاتورة رقم {{invoice_number}} بمبلغ {{amount_due}} قد تجاوزت ` +
          `تاريخ استحقاقها بـ ${step.arDays} يوماً${escalateSuffixAr}\n\n` +
          `يشرفنا تسديد المستحق عبر البوابة أو التحويل البنكي. لأي استفسار نحن في خدمتكم.\n\n` +
          `مع خالص التقدير،\nإدارة الحسابات`,
        variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE],
      },
      {
        key: step.key,
        channel: "EMAIL",
        locale: "en",
        module: "collections",
        subject: `Payment reminder — invoice {{invoice_number}}`,
        body:
          `Dear {{customer_name}},\n\n` +
          `This is a reminder that invoice {{invoice_number}} for {{amount_due}} is now ` +
          `${step.days} day(s) past its due date.${escalateSuffixEn}\n\n` +
          `We would appreciate settlement via the portal or bank transfer. Please reach out ` +
          `with any questions.\n\nKind regards,\nAccounts Receivable`,
        variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE],
      },
      {
        key: step.key,
        channel: "WHATSAPP",
        locale: "ar",
        module: "collections",
        body:
          `مرحباً {{customer_name}}، تذكير بمستحقاتكم: الفاتورة {{invoice_number}} بمبلغ ` +
          `{{amount_due}} متأخرة ${step.arDays} يوماً${step.escalate ? " ويُرجى التواصل فوراً." : "。"}`,
        variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE],
      },
      {
        key: step.key,
        channel: "WHATSAPP",
        locale: "en",
        module: "collections",
        body:
          `Hello {{customer_name}}, a reminder that invoice {{invoice_number}} for ` +
          `{{amount_due}} is ${step.days} day(s) overdue${step.escalate ? " — please contact us urgently." : "."}`,
        variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE],
      },
      {
        key: step.key,
        channel: "SMS",
        locale: "ar",
        module: "collections",
        body: `تذكير: فاتورتكم {{invoice_number}} بمبلغ {{amount_due}} متأخرة ${step.arDays} يوماً. {{customer_name}}`,
        variables: [INVOICE_NUMBER, AMOUNT_DUE, CUSTOMER_NAME],
      },
      {
        key: step.key,
        channel: "SMS",
        locale: "en",
        module: "collections",
        body: `Reminder: invoice {{invoice_number}} ({{amount_due}}) is ${step.days} day(s) overdue. — {{customer_name}}`,
        variables: [INVOICE_NUMBER, AMOUNT_DUE, CUSTOMER_NAME],
      },
    );
  }
  return templates;
}

function digestTemplates(): BuiltinTemplate[] {
  return [
    {
      key: "digest.daily",
      channel: "EMAIL",
      locale: "ar",
      module: "digest",
      subject: "ملخص اليوم — ما يحتاج انتباهكم",
      body:
        `صباح الخير {{user_name}},\n\n` +
        `ما يحتاج انتباهكم اليوم:\n` +
        `- فواتير متأخرة: {{overdue_invoices}}\n` +
        `- موافقات معلّقة: {{pending_approvals}}\n` +
        `- أصناف تحت حد الطلب: {{low_stock_items}}\n` +
        `- ضمانات تنتهي قريباً: {{expiring_warranties}}\n\n` +
        `تفاصيل أكثر في لوحة التحكم.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "overdue_invoices", required: true, description: "Count of overdue sales invoices / عدد الفواتير المتأخرة" },
        { name: "pending_approvals", required: true, description: "Count of approvals pending / عدد الموافقات المعلّقة" },
        { name: "low_stock_items", required: true, description: "Count of items below reorder / عدد الأصناف تحت حد الطلب" },
        { name: "expiring_warranties", required: true, description: "Count of warranties expiring soon / عدد الضمانات المنتهية قريباً" },
      ],
    },
    {
      key: "digest.daily",
      channel: "EMAIL",
      locale: "en",
      module: "digest",
      subject: "Your daily digest — what needs attention",
      body:
        `Good morning {{user_name}},\n\n` +
        `What needs your attention today:\n` +
        `- Overdue invoices: {{overdue_invoices}}\n` +
        `- Approvals pending: {{pending_approvals}}\n` +
        `- Items below reorder: {{low_stock_items}}\n` +
        `- Warranties expiring soon: {{expiring_warranties}}\n\n` +
        `More detail on your dashboard.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "overdue_invoices", required: true, description: "Count of overdue sales invoices / عدد الفواتير المتأخرة" },
        { name: "pending_approvals", required: true, description: "Count of approvals pending / عدد الموافقات المعلّقة" },
        { name: "low_stock_items", required: true, description: "Count of items below reorder / عدد الأصناف تحت حد الطلب" },
        { name: "expiring_warranties", required: true, description: "Count of warranties expiring soon / عدد الضمانات المنتهية قريباً" },
      ],
    },
  ];
}

function nudgeTemplates(): BuiltinTemplate[] {
  return [
    {
      key: "nudge.invoice_due",
      channel: "EMAIL",
      locale: "ar",
      module: "invoice_overdue",
      subject: "اقترب موعد استحقاق الفاتورة {{invoice_number}}",
      body:
        `عزيزي/عزيزتي {{customer_name}},\n\n` +
        `نودّ إعلامكم بأن الفاتورة رقم {{invoice_number}} بمبلغ {{amount_due}} تستحق في ` +
        `{{due_date}}.\n\nيشرفنا التسديد قبل الموعد.`,
      variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.invoice_due",
      channel: "EMAIL",
      locale: "en",
      module: "invoice_overdue",
      subject: "Invoice {{invoice_number}} is due soon",
      body:
        `Dear {{customer_name}},\n\n` +
        `A gentle reminder that invoice {{invoice_number}} for {{amount_due}} is due on ` +
        `{{due_date}}.\n\nWe appreciate settlement before the due date.`,
      variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.invoice_due",
      channel: "WHATSAPP",
      locale: "ar",
      module: "invoice_overdue",
      body: `مرحباً {{customer_name}}، الفاتورة {{invoice_number}} بمبلغ {{amount_due}} تستحق في {{due_date}}.`,
      variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.invoice_due",
      channel: "WHATSAPP",
      locale: "en",
      module: "invoice_overdue",
      body: `Hello {{customer_name}}, invoice {{invoice_number}} for {{amount_due}} is due on {{due_date}}.`,
      variables: [CUSTOMER_NAME, INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.invoice_due",
      channel: "SMS",
      locale: "ar",
      module: "invoice_overdue",
      body: `تذكير: الفاتورة {{invoice_number}} بمبلغ {{amount_due}} تستحق في {{due_date}}.`,
      variables: [INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.invoice_due",
      channel: "SMS",
      locale: "en",
      module: "invoice_overdue",
      body: `Reminder: invoice {{invoice_number}} ({{amount_due}}) is due on {{due_date}}.`,
      variables: [INVOICE_NUMBER, AMOUNT_DUE, DUE_DATE],
    },
    {
      key: "nudge.task_due",
      channel: "EMAIL",
      locale: "ar",
      module: "crm",
      subject: "مهمة تستحق قريباً: {{task_title}}",
      body:
        `مرحباً {{user_name}},\n\n` +
        `المهمة «{{task_title}}» تستحق في {{due_date}} — هذه رسالة تذكير استباقية.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "task_title", required: true, description: "The task title / عنوان المهمة" },
        DUE_DATE,
      ],
    },
    {
      key: "nudge.task_due",
      channel: "EMAIL",
      locale: "en",
      module: "crm",
      subject: "Task due soon: {{task_title}}",
      body:
        `Hello {{user_name}},\n\n` +
        `The task "{{task_title}}" is due on {{due_date}} — this is a proactive reminder.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "task_title", required: true, description: "The task title / عنوان المهمة" },
        DUE_DATE,
      ],
    },
    {
      key: "nudge.contract_renewal",
      channel: "EMAIL",
      locale: "ar",
      module: "crm",
      subject: "عقد {{contract_number}} مؤهل للتجديد قريباً",
      body:
        `مرحباً {{user_name}},\n\n` +
        `عقد «{{contract_number}}» مع {{partner_name}} ينتهي في {{renewal_date}} — ` +
        `هذه رسالة تذكير استباقية لمراجعة التجديد.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "contract_number", required: true, description: "The contract number / رقم العقد" },
        { name: "partner_name", required: true, description: "The partner's name / اسم الشريك" },
        { name: "renewal_date", required: true, description: "The renewal date / تاريخ التجديد" },
      ],
    },
    {
      key: "nudge.contract_renewal",
      channel: "EMAIL",
      locale: "en",
      module: "crm",
      subject: "Contract {{contract_number}} is up for renewal",
      body:
        `Hello {{user_name}},\n\n` +
        `Contract "{{contract_number}}" with {{partner_name}} ends on {{renewal_date}} — ` +
        `this is a proactive renewal reminder.`,
      variables: [
        { name: "user_name", required: true, description: "The user's display name / اسم المستخدم" },
        { name: "contract_number", required: true, description: "The contract number / رقم العقد" },
        { name: "partner_name", required: true, description: "The partner's name / اسم الشريك" },
        { name: "renewal_date", required: true, description: "The renewal date / تاريخ التجديد" },
      ],
    },
  ];
}

/**
 * The builtin catalog. Keys are stable public identifiers — NEVER rename
 * (saved dunning ladders reference templateKey values; the completion
 * report lists the full catalog).
 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = Object.freeze([
  ...dunningTemplates(),
  ...digestTemplates(),
  ...nudgeTemplates(),
]);

const BUILTIN_INDEX = new Map(
  BUILTIN_TEMPLATES.map((template) => [
    `${template.key}|${template.channel}|${template.locale}`,
    template,
  ]),
);

export function findBuiltinTemplate(
  key: string,
  channel: OutboundChannel,
  locale: "ar" | "en",
): BuiltinTemplate | undefined {
  return BUILTIN_INDEX.get(`${key}|${channel}|${locale}`);
}

/** The full builtin variable contract (the DATA_DICTIONARY source). */
export function builtinVariableCatalog(): ReadonlyArray<{
  readonly key: string;
  readonly channel: OutboundChannel;
  readonly locale: "ar" | "en";
  readonly variables: readonly TemplateVariable[];
}> {
  return BUILTIN_TEMPLATES.map((template) => ({
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    variables: template.variables,
  }));
}
