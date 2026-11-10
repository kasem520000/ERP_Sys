/**
 * ItemPicker stories (P6-T11a) — minimal state pair for the visual matrix
 * (AR/EN × density via the harness locale globals). Two stories: default +
 * empty (no matches — the scan-not-found state).
 */
import type { Meta, StoryFn } from "@storybook/react-vite";

import { ItemPicker } from "./item-picker";

const meta: Meta = {
  title: "Patterns/ItemPicker",
  parameters: { layout: "padded" },
};
export default meta;

const options = [
  { id: "i-0001", label: "زيت Toyota 5W-30 أصلي", labelAr: "زيت Toyota 5W-30 أصلي", meta: "SKU-0001" },
  { id: "i-0002", label: "Industrial Water Pump", labelAr: "مضخة مياه صناعية", meta: "SKU-0002" },
  { id: "i-0003", label: "كرتون تغليف مقاس متوسط", labelAr: "كرتون تغليف مقاس متوسط", meta: "SKU-0003" },
];

export const Default: StoryFn = () => (
  <div className="w-96">
    <ItemPicker label="الصنف / Item" items={options} value="i-0001" placeholder="اختر صنفًا / Select an item…" emptyText="لا نتائج / No matches" />
  </div>
);

export const Empty: StoryFn = () => (
  <div className="w-96">
    <ItemPicker label="الصنف / Item" items={[]} placeholder="امسح الباركود أو اكتب / Scan or type…" emptyText="لا نتائج / No matches" error="غير موجود / not found" />
  </div>
);
