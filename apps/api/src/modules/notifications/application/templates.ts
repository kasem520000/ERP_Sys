/**
 * Bilingual email templates (PHASE-003 §2.8): invitation, password reset,
 * login notification — AR + EN, plain-text-first (RTL renders naturally in
 * every mail client; HTML templates arrive with the design system in
 * PHASE-005). Rendering is pure: same input → byte-identical output
 * (asserted by the unit suite).
 */

export type EmailTemplate =
  | "invitation"
  | "password_reset"
  | "login_notification"
  /** PHASE-004 §2.8: the registration welcome mail (in scope: "email
   * templates beyond registration/invite" are the excluded ones). */
  | "registration_welcome"
  /** PHASE-010 BR-019: the nightly reorder-level digest (alert, not
   * autopilot — no automatic POs exist; the in-app surface lands
   * PHASE-015). */
  | "stock_below_reorder"
  /** PHASE-012 §2.9: the invoice.overdue nightly digest (alert, not
   * dunning — one notification per overdue invoice, exactly once). */
  | "invoice_overdue"
  /** PHASE-014 §2.8: the §6 soft-limit warning (80%/100%) to the owner. */
  | "limit_warning"
  /** PHASE-014 §7/§8: subscription state changes (trial expiring, grace
   * entered, suspended, restored) to the owner. */
  | "subscription_state"
  /** PHASE-019 §3 (crm): the daily task-reminder sweep's email leg — one
   * mail per remindable task (dedupe key crm-task-reminder:<taskId>:<remindAt>). */
  | "task_reminder";

export interface EmailPayload {
  template: EmailTemplate;
  locale: "ar" | "en";
  recipient: string;
  /** Template variables (URLs, names) — never secrets. */
  variables: Record<string, string>;
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

const AR = {
  invitation: (v: Record<string, string>) => ({
    subject: `دعوة للانضمام إلى ${v.tenantName} — نظام ERP`,
    body: [
      `مرحبًا،`,
      ``,
      `تمت دعوتك للانضمام إلى «${v.tenantName}» بدور «${v.roleName}».`,
      `لقبول الدعوة وإنشاء كلمة المرور، استخدم الرابط التالي خلال 72 ساعة:`,
      ``,
      v.acceptUrl,
      ``,
      `إذا لم تكن تتوقع هذه الدعوة فيمكنك تجاهل هذه الرسالة.`,
      `— ${v.tenantName}`,
    ].join("\r\n"),
  }),
  password_reset: (v: Record<string, string>) => ({
    subject: "إعادة تعيين كلمة المرور — نظام ERP",
    body: [
      `مرحبًا،`,
      ``,
      `طلبتم إعادة تعيين كلمة المرور. الرابط صالح لمدة 30 دقيقة وللاستخدام مرة واحدة:`,
      ``,
      v.resetUrl,
      ``,
      `إذا لم تطلب ذلك فيمكنك تجاهل هذه الرسالة — لن يتغير أي شيء.`,
    ].join("\r\n"),
  }),
  login_notification: (v: Record<string, string>) => ({
    subject: "إشعار تسجيل دخول جديد — نظام ERP",
    body: [
      `مرحبًا،`,
      ``,
      `تم تسجيل الدخول إلى حسابكم من جهاز/شبكة جديدة.`,
      `الوقت: ${v.at}`,
      `العنوان: ${v.ip}`,
      ``,
      `إذا لم تكن أنت فنرجو تغيير كلمة المرور فورًا.`,
    ].join("\r\n"),
  }),
  registration_welcome: (v: Record<string, string>) => ({
    subject: `تم إنشاء حسابكم في «${v.tenantName}» — نظام ERP`,
    body: [
      `مرحبًا ${v.ownerName}،`,
      ``,
      `تم إنشاء مساحة عملكم «${v.tenantName}» بنجاح.`,
      `يمكنكم الآن تسجيل الدخول لإكمال التهيئة الأولى (دليل الحسابات، الفروع، الترقيم):`,
      ``,
      v.loginUrl,
      ``,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
  stock_below_reorder: (v: Record<string, string>) => ({
    subject: `تنبيه: أصناف بلغت حد إعادة الطلب — ${v.tenantName}`,
    body: [
      `مرحبًا،`,
      ``,
      `الأصناف التالية بلغت حد إعادة الطلب أو دونه:`,
      v.items,
      ``,
      `هذا تنبيه فقط — لا يتم إنشاء أوامر شراء تلقائيًا (BR-019).`,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
  invoice_overdue: (v: Record<string, string>) => ({
    subject: `تنبيه: فواتير عملاء متأخرة السداد — ${v.tenantName}`,
    body: [
      `مرحبًا،`,
      ``,
      `الفواتير التالية تجاوزت تاريخ الاستحقاق ولها رصيد قائم:`,
      v.items,
      ``,
      `هذا تنبيه فقط — لا يتم إنشاء مستندات تلقائيًا.`,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
  limit_warning: (v: Record<string, string>) => ({
    subject: `تنبيه استخدام: ${v.counter} — ${v.usage} / ${v.limit} (${v.level})`,
    body: [
      `مرحبًا،`,
      ``,
      `اقترب استخدامكم من حد الخطة: ${v.counter} = ${v.usage} من ${v.limit}.`,
      v.note,
      ``,
      `يمكنكم مراجعة الاستخدام من لوحة التحكم:`,
      v.usageUrl,
      ``,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
  subscription_state: (v: Record<string, string>) => ({
    subject: `حالة الاشتراك: ${v.state} — ${v.tenantName}`,
    body: [
      `مرحبًا،`,
      ``,
      v.detail,
      v.action,
      ``,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
  task_reminder: (v: Record<string, string>) => ({
    subject: `تذكير مهمة: ${v.title} — ${v.tenantName}`,
    body: [
      `مرحبًا،`,
      ``,
      `لديكم مهمة مستحقة التنبيه:`,
      `المهمة: ${v.title}`,
      `تاريخ الاستحقاق: ${v.dueDate}`,
      ``,
      `يمكنكم مراجعة المهمة من:`,
      v.tasksUrl,
      ``,
      `— فريق المنصة`,
    ].join("\r\n"),
  }),
} as const;

const EN = {
  invitation: (v: Record<string, string>) => ({
    subject: `Invitation to join ${v.tenantName} — ERP`,
    body: [
      `Hello,`,
      ``,
      `You have been invited to join "${v.tenantName}" with the role "${v.roleName}".`,
      `To accept the invitation and set a password, use the link below within 72 hours:`,
      ``,
      v.acceptUrl,
      ``,
      `If you were not expecting this invitation you can ignore this email.`,
      `— ${v.tenantName}`,
    ].join("\r\n"),
  }),
  password_reset: (v: Record<string, string>) => ({
    subject: "Password reset — ERP",
    body: [
      `Hello,`,
      ``,
      `A password reset was requested for your account. The link is valid for 30 minutes and single-use:`,
      ``,
      v.resetUrl,
      ``,
      `If you did not request this you can ignore this email — nothing will change.`,
    ].join("\r\n"),
  }),
  login_notification: (v: Record<string, string>) => ({
    subject: "New login notification — ERP",
    body: [
      `Hello,`,
      ``,
      `A new login to your account was detected from a new device/network.`,
      `Time: ${v.at}`,
      `Address: ${v.ip}`,
      ``,
      `If this was not you, please change your password immediately.`,
    ].join("\r\n"),
  }),
  registration_welcome: (v: Record<string, string>) => ({
    subject: `Your workspace "${v.tenantName}" is ready — ERP`,
    body: [
      `Hello ${v.ownerName},`,
      ``,
      `Your workspace "${v.tenantName}" has been created.`,
      `Sign in to complete the initial setup (chart of accounts, branches, numbering):`,
      ``,
      v.loginUrl,
      ``,
      `— The platform team`,
    ].join("\r\n"),
  }),
  stock_below_reorder: (v: Record<string, string>) => ({
    subject: `Alert: items at or below reorder level — ${v.tenantName}`,
    body: [
      `Hello,`,
      ``,
      `The following items are at or below their reorder level:`,
      v.items,
      ``,
      `This is an alert only — no purchase orders are created automatically (BR-019).`,
      `— ${v.tenantName}`,
    ].join("\r\n"),
  }),
  invoice_overdue: (v: Record<string, string>) => ({
    subject: `Alert: overdue customer invoices — ${v.tenantName}`,
    body: [
      `Hello,`,
      ``,
      `The following customer invoices are past due with an outstanding balance:`,
      v.items,
      ``,
      `This is an alert only — no documents are created automatically.`,
      `— ${v.tenantName}`,
    ].join("\r\n"),
  }),
  limit_warning: (v: Record<string, string>) => ({
    subject: `Usage alert: ${v.counter} — ${v.usage} / ${v.limit} (${v.level})`,
    body: [
      `Hello,`,
      ``,
      `Your usage is approaching the plan limit: ${v.counter} = ${v.usage} of ${v.limit}.`,
      v.note,
      ``,
      `Review usage from your dashboard:`,
      v.usageUrl,
      ``,
      `— The platform team`,
    ].join("\r\n"),
  }),
  subscription_state: (v: Record<string, string>) => ({
    subject: `Subscription state: ${v.state} — ${v.tenantName}`,
    body: [
      `Hello,`,
      ``,
      v.detail,
      v.action,
      ``,
      `— The platform team`,
    ].join("\r\n"),
  }),
  task_reminder: (v: Record<string, string>) => ({
    subject: `Task reminder: ${v.title} — ${v.tenantName}`,
    body: [
      `Hello,`,
      ``,
      `You have a task due for follow-up:`,
      `Task: ${v.title}`,
      `Due date: ${v.dueDate}`,
      ``,
      `Review it from:`,
      v.tasksUrl,
      ``,
      `— The platform team`,
    ].join("\r\n"),
  }),
} as const;

/** Render a template in the recipient's locale (byte-stable). */
export function renderEmail(payload: EmailPayload): RenderedEmail {
  const catalog = payload.locale === "ar" ? AR : EN;
  const renderer = catalog[payload.template];
  return renderer(payload.variables);
}
