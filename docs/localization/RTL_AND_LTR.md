# RTL and LTR — Direction Model (Logical Layer)

> **Status:** STABLE · **Owner:** Localization & Experience Architecture · **Updated:** 2026-10-27

Bidirectional-text rules for the Platform's **logical layer**: data, documents,
templates, and search. This file covers direction *semantics*; visual mirroring rules
(spacing, icons, layout flipping) live in
[../ui/RTL_DESIGN_RULES.md](../ui/RTL_DESIGN_RULES.md). Locale/negotiation model:
[LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md). Foundation lands in
[PHASE-005](../implementation/phases/PHASE-005.md); the test matrix in §8 is part of the
release regression suite (RISK-015 mitigation).

## 1. Direction model

- The active locale determines the app direction: `ar` → `dir="rtl"`, `en` → `dir="ltr"`.
- Direction is a **rendering** property; it is never persisted on data. Documents, lines,
  and records are direction-agnostic; every surface that renders them resolves direction
  at render time.
- Three independent direction decisions exist and must not be conflated:
  1. **App/UI direction** — from the user's active locale.
  2. **Document/print direction** — from the template's locale (§2).
  3. **Field-level direction** — from field semantics, not locale (§6).

## 2. Document and template direction (printing)

- Every print template declares a `locale` + `dir` (AR templates are RTL, EN templates
  LTR). A template renders identically regardless of the viewer's UI language — an
  accountant working in English still prints an Arabic invoice correctly.
- Bilingual templates (e.g., AR-primary with EN column, where a jurisdiction pack's
  `invoice_requirements.bilingual_requirements` demand it) declare a **primary**
  direction and a secondary-language block; the secondary block is direction-isolated
  (§3) so mixed labels never bleed into each other.
- PDF generation must set document-level direction and per-run isolation before layout —
  mirroring bugs in printouts are compliance bugs, not cosmetics
  ([ADR-0011](../architecture/ADR/ADR-0011-reporting-printing.md)).
- RTL print templates lay out tables right-to-left (first column on the right) with
  tabular numerals for amount columns ([CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md) §8).

## 3. Mixed-direction text and bidi isolation

Mixed Arabic/Latin/digit strings occur constantly (item names, addresses, memos). Rules:

- Latin segments, codes, numbers, URLs inside RTL text are wrapped in **Unicode isolates**
  (`LRI … PDI`, or `FSI … PDI` when the direction should be auto-detected) — isolates, not
  legacy embeddings (`LRE`/`RLE`), so directional state can never spill past the segment.
- The message-catalog runtime wraps ICU placeholders with isolates automatically when a
  placeholder renders direction-sensitive data (codes, amounts, dates) into RTL sentences.
- Punctuation adjacent to isolated runs (parentheses, colons, percent signs) stays inside
  the isolate when it belongs to the embedded value, outside when it belongs to the
  Arabic sentence — test matrix cases cover both (§8).
- Raw database values are stored **unmarked**; isolation is applied at render time so
  data remains clean for export, e-invoicing payloads, and API consumers.

Example (invoice memo, RTL): "تحصيل بموجب الشيك CHK-10023 بتاريخ 2026-10-27" — the check
number and the ISO date are LTR-isolated so neither reorders the sentence.

## 4. Mirrored vs non-mirrored elements catalog

Mirroring is a UI concern, but the catalog of what *logically* flips belongs here so
templates, exports, and clients agree:

| Element | Mirrored in RTL? | Notes |
|---------|------------------|-------|
| Text alignment & reading order | Yes | Columns, lists, breadcrumbs flow right → left |
| Numbers (amounts, quantities) | **Never** | Digits are always LTR-embedded; only their *column position* mirrors |
| Document/line numbers, SKUs, codes | Never | Always `latn` digits, LTR-isolated |
| Phone numbers | Never | LTR-embedded even inside Arabic sentences |
| Chart axes | Yes | Category axes run right → left in RTL charts |
| Progress bars / steppers | Yes | Fill advances right → left |
| Media (video controls, playback icons) | No | Play direction is semantic, not reading order |
| Logos, brand marks | No | Never mirrored |
| Clocks, gauges | No | Physical metaphors do not flip |
| Directional icons (arrows, "back", next/prev) | Yes | Mirror unless the arrow is semantic (e.g., a literal physical direction) |
| Sort indicators, tree expanders | Yes | Follow reading order |

## 5. Digit policy per context (Arabic-Indic vs Western)

Tenant setting `display.digits` (`latn` default, `arab` optional) governs *display-only*
contexts ([LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md) §7). Regardless of
the tenant setting, the following are **always Western (`latn`) digits, LTR-embedded**:

| Context | Digits | Rationale |
|---------|--------|-----------|
| Money amounts in ledgers, invoices, reports | `latn` | Amounts align in tabular columns; mixing digit shapes breaks comparison ([CURRENCY_AND_PRECISION.md](CURRENCY_AND_PRECISION.md) §8) |
| Document numbers, batch/serial numbers, barcodes, SKUs | `latn` | Machine-matched identifiers |
| Phone numbers, IBANs, tax numbers | `latn` | Copied/pasted/dialed values |
| E-invoicing payloads, QR contents, API fields | `latn` | Authority systems consume machine formats |
| Narrative text, quantities in prose, dashboards | per tenant setting | Presentation choice |

Arabic-Indic digits are display-only: parsing, storage, and computation are always
decimal strings (ADR-0009).

## 6. Input field direction heuristics

Field direction is derived from **field semantics** at the schema/contract level, not
auto-detected from typed content (with one exception, below):

| Field | Direction | Rule |
|-------|-----------|------|
| `name_ar` and other `_ar` columns | `rtl` | Arabic content by definition |
| `name` (English/primary) | `ltr` | Latin content by definition |
| Email, username, code, SKU, serial, IBAN, tax number | `ltr` (forced) | Machine values; also `autocomplete` + monospace rendering |
| Amounts | digits LTR, alignment follows container | Value is neutral; §5 digit policy applies |
| Free text (notes, memos, descriptions) | `dir="auto"` **with isolation on save-render** | Auto-detect per paragraph is allowed for free text only; every later render isolates embedded Latin/number runs (§3) |
| Address lines | `rtl` if `name_ar`-style field, else `ltr`; full address block renders as one isolated group | Addresses mix numbers and text |

`dir="auto"` on constrained fields (emails, codes) is forbidden — wrong guesses create
data-entry errors that look like corruption.

## 7. Search normalization (Arabic)

Arabic search must find what users type regardless of orthographic variants. The
normalization pipeline (applied at query time, or to a generated `search_text` column):

1. **Tashkeel stripping** — remove combining diacritics U+064B–U+0652 (e.g., "مَبيعات" →
   "مبيعات").
2. **Tatweel removal** — strip U+0640 (كـــــتاب → كتاب).
3. **Alef/hamza unification** — normalize أ إ آ → ا (سلأم/سلام variants match).
4. **Hamza-on-heh / alef-maksura normalization** — ة → ه and ى → ي are *tenant-optional*
   (they change meaning in some words, so default OFF, enabled for name-search contexts
   where recall beats precision).
5. **Case folding** for Latin segments; NFKC normalization for compatibility forms.
6. Search runs over **both** `name` and `name_ar` columns
   ([LOCALIZATION_ARCHITECTURE.md](LOCALIZATION_ARCHITECTURE.md) §6).

Normalization is **query/index-only** — stored data is never rewritten.

## 8. Bidi test matrix

Every case below is a unit test on the isolation layer **and** a visual snapshot in both
directions; e-invoicing payload tests assert the *raw* (unmarked) values:

| # | Case | Input sketch | Expected rendering |
|---|------|--------------|---------------------|
| 1 | URL in an Arabic sentence | "راجع التفاصيل على https://erp.example.com/invoices" | URL stays contiguous LTR, no character reordering |
| 2 | Mixed EN/AR item name | "زيت Toyota 5W-30 أصلي" | Arabic RTL, "Toyota 5W-30" isolated LTR inside |
| 3 | Negative amount in RTL row | total −1,234.50 SAR | Minus sign stays attached to the number (never "1,234.50−" or detached) |
| 4 | IBAN/tax number in RTL sentence | "حوالة على IBAN SA44 2000 0001 2345 6789 1234" | IBAN reads left-to-right as one token, spaces intact |
| 5 | Arabic name containing digits | "عبدالله2" | Digits do not flip name segment order |
| 6 | Date in RTL memo | "استحق في 2026-10-27" | ISO date stays Y-M-D left-to-right |
| 7 | Parenthesized Latin in Arabic | "المورد (Acme Ltd) — Riyadh" | Parentheses hug "Acme Ltd", never mirrored onto Arabic text |
| 8 | Percent after Arabic word | "خصم 15%" | Percent attaches to the number, not the word |
| 9 | Trailing punctuation | "تم السداد." after an LTR code | Period renders at the RTL sentence end, not after the code |
| 10 | Phone number in Arabic | "اتصل على ‎+966 50 123 4567" | Number is one LTR run with +966 leading |
| 11 | Credit-note reference in AR print | "إشعار دائن مقابل INV-000123" | Reference isolated; no spillover into the Arabic label |
| 12 | RTL label, LTR value column | template amount column | Label right-aligned RTL, value left-aligned LTR, tabular numerals |

## 9. Ownership and phases

- Isolation utilities, digit policy, and field-direction metadata:
  [PHASE-005](../implementation/phases/PHASE-005.md) (shared packages, consumed by web,
  print, and RN).
- Print-template direction: [PHASE-013](../implementation/phases/PHASE-013.md).
- Pack bilingual requirements per country:
  [COUNTRY_PACKS.md](COUNTRY_PACKS.md) / [compliance-matrix/](compliance-matrix/README.md).
- Visual regression in both directions: [../testing/TEST_STRATEGY.md](../testing/TEST_STRATEGY.md).
