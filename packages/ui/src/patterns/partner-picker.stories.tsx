/**
 * PartnerPicker stories (P6-T11a) — minimal state pair for the visual matrix
 * (the harness drives AR/EN × density through the locale globals; the option
 * labels are bilingual so both directions render meaningfully). Two stories:
 * default + async-loading.
 */
import type { Meta, StoryFn } from "@storybook/react-vite";

import { PartnerPicker } from "./partner-picker";

const meta: Meta = {
  title: "Patterns/PartnerPicker",
  parameters: { layout: "padded" },
};
export default meta;

const options = [
  { id: "p-0001", label: "شركة النور للتجارة", labelAr: "شركة النور للتجارة", meta: "P-000001" },
  { id: "p-0002", label: "Al-Noor Trading Co.", labelAr: "مؤسسة البحر الأزرق", meta: "P-000002" },
  { id: "p-0003", label: "مصنع الرياض للبلاستيك", labelAr: "مصنع الرياض للبلاستيك", meta: "P-000003" },
];

export const Default: StoryFn = () => (
  <div className="w-96">
    <PartnerPicker label="الجهة / Partner" items={options} value="p-0001" placeholder="اختر جهة / Select a partner…" emptyText="لا نتائج / No matches" />
  </div>
);

export const LoadingSearch: StoryFn = () => (
  <div className="w-96">
    <PartnerPicker
      label="الجهة / Partner"
      items={[]}
      loading
      onSearch={() => {}}
      placeholder="ابحث / Search…"
      emptyText="لا نتائج / No matches"
      hint="بحث مؤجل 200ms / debounced 200ms"
    />
  </div>
);
