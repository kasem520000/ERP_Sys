/**
 * Catalog stories — every PHASE-005 component with its §8 states. The
 * locale/direction/density matrix (AR+EN both mandatory, both densities) is
 * driven by the Playwright harness through globals (iframe.html?globals=…),
 * generated there by iteration — never hand-listed (VISUAL_TESTING §harness).
 */
import type { Meta, StoryFn } from "@storybook/react-vite";
import React, { useState } from "react";

import { documentRows, partners } from "../testing/fixtures";
import {
  Badge, DocumentStatusBadge, DocumentActions, Button, IconButton, Input, Textarea,
  NumberInput, SearchInput, MoneyInput, Select, Combobox, Checkbox, RadioGroup, Switch,
  DatePicker, DateRangePicker, Dialog, Drawer, Tooltip, Popover, Tabs, ToastProvider, useToast,
  EmptyState, LoadingState, ErrorState, Breadcrumbs, Pagination, DataTable,
  CommandMenu, NavigationSidebar, AppShell, Icon,
} from "../index";
import { NAV_ITEMS, resolveNavigation as resolveNav } from "@erp/contracts";

const meta: Meta = {
  title: "Catalog",
  parameters: { layout: "padded" },
};
export default meta;

const STATUS_AR: Record<string, string> = {
  DRAFT: "مسودة", PENDING_APPROVAL: "بانتظار الموافقة", APPROVED: "معتمد",
  POSTED: "مُرحّل", REVERSED: "معكوس", CANCELLED: "ملغي", PENDING_SYNC: "بانتظار المزامنة",
};
const STATUS_EN: Record<string, string> = {
  DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved",
  POSTED: "Posted", REVERSED: "Reversed", CANCELLED: "Cancelled", PENDING_SYNC: "Pending sync",
};
type StatusKey =
  | "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED"
  | "REVERSED" | "CANCELLED" | "PENDING_SYNC";

/** Demo rows typed once (the fixture literal union is intentionally narrow). */
interface DemoRow {
  id: string;
  number: string;
  partner: string;
  status: StatusKey;
  amount: string;
}
const demoRows: DemoRow[] = documentRows.map((r) => ({ ...r }));

export const Buttons: StoryFn = () => (
  <div className="flex flex-col gap-3">
    <Button variant="primary">حفظ / Save</Button>
    <Button variant="secondary">إلغاء / Cancel</Button>
    <Button variant="ghost">تخطي / Skip</Button>
    <Button variant="danger">حذف / Delete</Button>
    <Button variant="primary" iconStart="plus">فاتورة جديدة / New invoice</Button>
    <IconButton icon="search" label="بحث / Search" variant="secondary" />
  </div>
);
export const ButtonsLoading: StoryFn = () => <Button loading>جارٍ الحفظ / Saving…</Button>;
export const ButtonsDisabled: StoryFn = () => <Button disabled>معطل / Disabled</Button>;

export const Inputs: StoryFn = () => (
  <div className="flex w-96 flex-col gap-4">
    <Input label="اسم الجهة / Partner name" value="شركة النور للتجارة" onValueChange={() => {}} />
    <Input label="الرقم الضريبي / Tax number" value="310122393500003" mono bidiIsolate onValueChange={() => {}} hint="أرقام لاتينية دائماً / always latin digits" />
    <Textarea label="ملاحظات / Notes" value="" onValueChange={() => {}} />
    <NumberInput label="الكمية / Quantity" value="12.5" unitSuffix="قطعة" onValueChange={() => {}} />
    <SearchInput value="" placeholder="ابحث / Search…" onValueChange={() => {}} label="بحث" />
  </div>
);
export const InputsError: StoryFn = () => (
  <div className="flex w-96 flex-col gap-4">
    <Input label="البريد الإلكتروني / Email" value="not-an-email" error="بريد غير صالح / invalid email" onValueChange={() => {}} />
  </div>
);
export const InputsDisabled: StoryFn = () => (
  <div className="flex w-96 flex-col gap-4">
    <Input label="حقل معطل" value="قيمة" disabled />
  </div>
);

export const MoneyInputs: StoryFn = () => (
  <div className="flex w-96 flex-col gap-4">
    <MoneyInput label="المبلغ / Amount" amount="12500.50" currency="SAR" onAmountChange={() => {}} />
    <MoneyInput label="سالب / Negative" amount="-320.00" currency="SAR" allowNegative onAmountChange={() => {}} />
    <MoneyInput label="صفر / Zero" amount="0.00" currency="SAR" onAmountChange={() => {}} />
    <MoneyInput label="دينار / KWD (3 minor units)" amount="1250.500" currency="KWD" minorUnits={3} onAmountChange={() => {}} />
  </div>
);
export const MoneyInputsError: StoryFn = () => (
  <div className="flex w-96"><MoneyInput label="المبلغ" amount="abc" currency="SAR" error="قيمة غير صالحة / invalid amount" onAmountChange={() => {}} /></div>
);

function InteractiveControls(): React.JSX.Element {
  const [partner, setPartner] = useState<string | undefined>("p-0001");
  return (
    <div className="flex w-96 flex-col gap-4">
      <Select label="الفرع / Branch" options={[{ value: "b-1", label: "الفرع الرئيسي / Main" }, { value: "b-2", label: "فرع جدة / Jeddah" }]} value="b-1" onValueChange={() => {}} />
      <Combobox label="الجهة / Partner" items={partners} value={partner} onValueChange={setPartner} allowClear={false} />
      <Checkbox label="تحديد الكل / Select all" checked="indeterminate" onCheckedChange={() => {}} />
      <RadioGroup label="طريقة الدفع / Payment method" options={[{ value: "cash", label: "نقدي / Cash" }, { value: "bank", label: "بنكي / Bank" }]} value="cash" onValueChange={() => {}} />
      <Switch label="التحقق بخطوتين" description="Two-factor authentication" checked onCheckedChange={() => {}} />
    </div>
  );
}
export const Controls: StoryFn = () => <InteractiveControls />;
export const ControlsError: StoryFn = () => (
  <div className="flex w-96"><Select label="العملة" options={[{ value: "sar", label: "ريال" }]} error="مطلوب / required" /></div>
);

function InteractiveDates(): React.JSX.Element {
  const [date, setDate] = useState("2026-10-27");
  const [range, setRange] = useState({ start: "2026-10-01", end: "2026-10-31" });
  const locale = document.documentElement.lang === "en" ? "en" : "ar";
  return (
    <div className="flex w-96 flex-col gap-4">
      <DatePicker label={locale === "ar" ? "التاريخ (هجري ثانوي)" : "Date (Hijri secondary)"} value={date} onSelect={setDate} locale={locale} hijriDisplay />
      <DatePicker label="Gregorian only" value={date} onSelect={setDate} locale={locale} />
      <DateRangePicker label={locale === "ar" ? "الفترة" : "Range"} start={range.start} end={range.end} onSelect={setRange} locale={locale} />
    </div>
  );
}
export const DatePickers: StoryFn = () => <InteractiveDates />;

export const StatusBadges: StoryFn = () => (
  <div className="flex flex-col gap-3">
    {(Object.keys(STATUS_AR) as StatusKey[]).map((status) => (
      <div key={status} className="flex items-center gap-3">
        <DocumentStatusBadge status={status} label={STATUS_AR[status] ?? status} />
        <DocumentStatusBadge status={status} label={STATUS_EN[status] ?? status} />
        <Badge mono>#{status}</Badge>
      </div>
    ))}
    <DocumentActions
      status="PENDING_APPROVAL"
      labels={{ submit: "إرسال", approve: "اعتماد", reject: "رفض", post: "ترحيل", reverse: "عكس", cancel: "إلغاء" }}
      onAction={() => {}}
      triggerLabel="إجراءات / Actions"
    />
  </div>
);

export const Overlays: StoryFn = () => (
  <div className="flex flex-wrap gap-4">
    <Dialog trigger={<Button variant="primary">حوار / Dialog</Button>} title="تأكيد الحذف" description="Confirm deletion">
      <p>هل أنت متأكد؟ / Are you sure?</p>
    </Dialog>
    <Drawer trigger={<Button>لوح جانبي / Drawer</Button>} title="تفاصيل الجهة">
      <p>المحتوى / Content</p>
    </Drawer>
    <Tooltip content="تلميح / Tooltip" shortcut="⌘K">
      <Button>تلميح / Tooltip</Button>
    </Tooltip>
    <Popover content={<div className="w-40 text-sm text-gray-800">مرشح سريع / quick filter</div>}>
      <Button>مرشح / Popover</Button>
    </Popover>
    <Tabs
      items={[{ value: "a", label: "التفاصيل / Details" }, { value: "b", label: "الحركات / Entries" }]}
      value="a"
      onValueChange={() => {}}
    >
      <div data-slot="a">تفاصيل المستند</div>
      <div data-slot="b">قيود اليومية</div>
    </Tabs>
  </div>
);

function ToastDemo(): React.JSX.Element {
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => toast({ tone: "success", title: "تم الترحيل", description: "JE-2026-0001" })}>نجاح / success</Button>
      <Button onClick={() => toast({ tone: "danger", title: "فشل الحفظ", description: "القيد غير متوازن" })}>خطأ / danger</Button>
    </div>
  );
}
export const Toasts: StoryFn = () => <ToastProvider testMode><ToastDemo /></ToastProvider>;

export const States: StoryFn = () => (
  <div className="flex flex-wrap items-start gap-8">
    <div className="w-64"><EmptyState title="لا توجد بيانات / No data" description="أنشئ أول سجل" primaryAction={<Button size="sm">إنشاء / Create</Button>} /></div>
    <div className="w-64"><LoadingState variant="table" rows={4} /></div>
    <div className="w-64"><ErrorState title="تعذر التحميل / Failed" retry={<Button size="sm">إعادة / Retry</Button>} /></div>
  </div>
);

export const BreadcrumbPagination: StoryFn = () => (
  <div className="flex w-[32rem] flex-col gap-6">
    <Breadcrumbs items={[{ label: "الرئيسية", href: "#" }, { label: "المبيعات", href: "#" }, { label: "فواتير البيع", href: "#" }, { label: "INV-2026-0042" }]} />
    <Breadcrumbs items={[{ label: "Home" }, { label: "Sales" }, { label: "Invoices" }, { label: "Invoices" }, { label: "Statements" }, { label: "INV-2026-0042" }]} />
    <Pagination page={3} pageSize={25} total={300} onPageChange={() => {}} announceLabel="صفحة 3 من 12 / page 3 of 12" />
  </div>
);

const tableColumns = [
  { id: "number", header: { ar: "الرقم", en: "Number" }, accessor: (r: DemoRow) => r.number, mono: true, sortable: true, stickyStart: true },
  { id: "partner", header: { ar: "الجهة", en: "Partner" }, accessor: (r: DemoRow) => r.partner, sortable: true, filterable: true },
  { id: "status", header: { ar: "الحالة", en: "Status" }, accessor: (r: DemoRow) => r.status, render: (r: DemoRow) => <DocumentStatusBadge status={r.status as StatusKey} label={STATUS_AR[r.status] ?? r.status} /> },
  { id: "amount", header: { ar: "المبلغ", en: "Amount" }, accessor: (r: DemoRow) => r.amount, numeric: true, sortable: true },
];
export const DataTableDefault: StoryFn = () => (
  <div className="w-[52rem]">
    <DataTable
      rows={demoRows}
      columns={tableColumns}
      rowKey={(r) => r.id}
      selected={new Set(["d-0002"])}
      onSelectedChange={() => {}}
      selectionLabel={(n) => `تم تحديد ${n} صفوف / ${n} rows selected`}
      rowActions={[{ id: "open", label: "فتح", onSelect: () => {} }, { id: "cancel", label: "إلغاء", danger: true, onSelect: () => {} }]}
    />
  </div>
);
export const DataTableEmpty: StoryFn = () => (
  <div className="w-[52rem]">
    <DataTable rows={[]} columns={tableColumns} rowKey={(r: DemoRow) => r.id} empty={{ title: "لا فواتير / No invoices", description: "أنشئ أول فاتورة" }} />
  </div>
);
export const DataTableError: StoryFn = () => (
  <div className="w-[52rem]">
    <DataTable rows={[]} columns={tableColumns} rowKey={(r: DemoRow) => r.id} error={{ title: "خطأ في التحميل / Load failed", retry: <Button size="sm">إعادة / Retry</Button> }} />
  </div>
);
export const DataTableLoading: StoryFn = () => (
  <div className="w-[52rem]">
    <DataTable rows={[]} columns={tableColumns} rowKey={(r: DemoRow) => r.id} loading />
  </div>
);

const demoNavigation = resolveNav(NAV_ITEMS, {
  featureKeys: new Set(["platform.users_roles", "platform.branches", "platform.registration"]),
  permissions: new Set(["identity.users.view", "tenancy.branches.manage", "tenancy.settings.manage", "identity.sessions.revoke", "identity.mfa.manage"]),
});
export const Sidebar: StoryFn = () => (
  <div className="h-[32rem] w-64 overflow-hidden rounded-lg border border-subtle bg-surface-card">
    <NavigationSidebar navigation={demoNavigation} activePath="/users" hrefFor={(r) => r} locale={document.documentElement.lang === "en" ? "en" : "ar"} />
  </div>
);
export const AppShellPage: StoryFn = () => {
  const locale = document.documentElement.lang === "en" ? "en" : "ar";
  const dir = document.documentElement.dir === "ltr" ? "ltr" : "rtl";
  return (
    <div className="h-[40rem] w-[64rem] overflow-hidden rounded-lg border border-subtle">
      <AppShell
        locale={locale}
        dir={dir}
        navigation={demoNavigation}
        activePath="/users"
        brand={{ name: "ERP" }}
        strings={{
          skipToContent: locale === "ar" ? "تجاوز إلى المحتوى" : "Skip to content",
          commandMenuLabel: locale === "ar" ? "ابحث" : "Search",
          shortcutsTitle: locale === "ar" ? "الاختصارات" : "Shortcuts",
          closeLabel: locale === "ar" ? "إغلاق" : "Close",
          moreLabel: locale === "ar" ? "المزيد" : "More",
        }}
        userMenu={<Button size="sm">{locale === "ar" ? "خروج" : "Sign out"}</Button>}
      >
        <div className="flex flex-col gap-2">
          <Breadcrumbs items={[{ label: locale === "ar" ? "الإعدادات" : "Settings" }, { label: locale === "ar" ? "المستخدمون" : "Users" }]} />
          <h1 className="text-lg font-semibold text-gray-900">{locale === "ar" ? "المستخدمون" : "Users"}</h1>
          <DataTable
            rows={demoRows}
            columns={[
              { id: "number", header: { ar: "الرقم", en: "Number" }, accessor: (r: DemoRow) => r.number, mono: true },
              { id: "partner", header: { ar: "الاسم", en: "Name" }, accessor: (r: DemoRow) => r.partner },
              { id: "amount", header: { ar: "الرصيد", en: "Balance" }, accessor: (r: DemoRow) => r.amount, numeric: true },
            ]}
            rowKey={(r) => r.id}
          />
        </div>
      </AppShell>
    </div>
  );
};
AppShellPage.parameters = { layout: "fullscreen" };

export const CommandMenuOpen: StoryFn = () => (
  <div className="h-[40rem] w-[64rem] overflow-hidden rounded-lg border border-subtle bg-surface-page">
    <CommandMenu
      open
      onOpenChange={() => {}}
      navigation={demoNavigation}
      locale={document.documentElement.lang === "en" ? "en" : "ar"}
      hrefFor={(r) => r}
    />
  </div>
);

export const Icons: StoryFn = () => (
  <div className="grid grid-cols-8 gap-4">
    {["arrow-start", "arrow-end", "chevron-start", "chevron-end", "undo-2", "log-out", "send", "home", "receipt", "boxes", "ledger", "banknote", "users", "settings", "barcode", "qr-code"].map((name) => (
      <div key={name} className="flex flex-col items-center gap-1 text-xs text-gray-600">
        <Icon name={name as never} size={20} />
        <span className="font-mono">{name}</span>
      </div>
    ))}
  </div>
);

const TEN_K_STATUSES: StatusKey[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED"];
const tenKRows: DemoRow[] = Array.from({ length: 10000 }, (_, i) => ({
  id: `row-${i}`,
  number: `INV-2026-${String(i).padStart(5, "0")}`,
  partner: i % 2 === 0 ? "شركة النور للتجارة" : "Al-Noor Trading Co.",
  amount: `${(i % 1000) + 0.5}`,
  status: TEN_K_STATUSES[i % 4] ?? "DRAFT",
}));
export const DataTableTenK: StoryFn = () => (
  <div className="w-[52rem]">
    <DataTable
      rows={tenKRows}
      columns={tableColumns}
      rowKey={(r) => r.id}
    />
  </div>
);

/** THREAT_MODEL S-03 fixtures: stored-XSS + bidi-override payloads in
 *  bilingual fields — rendered as TEXT through the catalog components. */
export const BidiPayloads: StoryFn = () => {
  const payloads = [
    { label: "xss-img", value: '<img src=x onerror="alert(1)">' },
    { label: "xss-script", value: "<script>alert(2)</script>" },
    { label: "rlo-override", value: "A\u202EB\u202EC" },
    { label: "lri-hidden", value: "\u2068evil\u2069<svg onload=alert(3)>" },
    { label: "mixed-ar", value: 'فاتورة INV-000123 من 2026-01-02 لـ john@example.com' },
  ];
  return (
    <div className="flex w-[36rem] flex-col gap-4">
      {payloads.map((p) => (
        <Input key={p.label} label={p.label} value={p.value} onValueChange={() => {}} mono bidiIsolate />
      ))}
      <MoneyInput label="amount-payload" amount="1<img>" currency="SAR" onAmountChange={() => {}} />
    </div>
  );
};
