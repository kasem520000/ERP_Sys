/**
 * Seeded typed fixture factories (VISUAL_TESTING §3: same UUIDs, amounts,
 * partner names, mixed-script strings every run — pixel-stable baselines).
 */
import type { ComboboxItem } from "../../primitives/combobox";

export const FIXTURE_CLOCK = "2026-10-27T09:00:00";

export const mixedScriptFixtures = {
  /** The §4 mixed-script byte-for-byte fixture: فاتورة INV-000123 من 2026-01-02 لـ john@example.com */
  invoiceSentence: "فاتورة INV-000123 من 2026-01-02 لـ john@example.com",
  iban: "SA03 8000 0000 6080 1016 7519",
  taxNumber: "310122393500003",
  email: "john@example.com",
  docNumber: "INV-000123",
  partnerNameAr: "شركة النور للتجارة",
  partnerNameEn: "Al-Noor Trading Co.",
  phone: "+966 50 123 4567",
  productName: "زيت Toyota 5W-30 أصلي",
};

export const partners: ComboboxItem[] = [
  { value: "p-0001", label: "شركة النور للتجارة", keywords: "Al-Noor Trading Co." },
  { value: "p-0002", label: "مؤسسة البحر الأزرق", keywords: "Blue Sea Establishment" },
  { value: "p-0003", label: "مصنع الرياض للبلاستيك", keywords: "Riyadh Plastics Factory" },
  { value: "p-0004", label: "Al-Noor Trading Co.", keywords: "شركة النور للتجارة" },
];

export const documentRows = [
  { id: "d-0001", number: "INV-2026-0042", partner: "شركة النور للتجارة", status: "POSTED", amount: "12500.50" },
  { id: "d-0002", number: "INV-2026-0043", partner: "مؤسسة البحر الأزرق", status: "DRAFT", amount: "-320.00" },
  { id: "d-0003", number: "INV-2026-0044", partner: "مصنع الرياض للبلاستيك", status: "PENDING_APPROVAL", amount: "4180.75" },
  { id: "d-0004", number: "INV-2026-0045", partner: "Al-Noor Trading Co.", status: "APPROVED", amount: "0.00" },
  { id: "d-0005", number: "INV-2026-0046", partner: "شركة النور للتجارة", status: "CANCELLED", amount: "999.99" },
] as const;

export const tenThousandRows = Array.from({ length: 10000 }, (_, i) => ({
  id: `row-${i}`,
  number: `INV-2026-${String(i).padStart(5, "0")}`,
  partner: i % 2 === 0 ? "شركة النور للتجارة" : "Al-Noor Trading Co.",
  amount: `${(i % 1000) + 0.5}`,
}));
