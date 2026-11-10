# Project Vision

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-28

## The problem

Businesses across the Middle East, North Africa, and the GCC — from a single-counter tire
shop in Sana'a to a twenty-branch supermarket group in Riyadh — are forced to choose between
two bad options:

1. **Generic global software** that ignores regional realities: Arabic-first RTL interfaces,
   Hijri calendars, local invoice numbering, ZATCA/ETA e-invoicing, VAT regimes that differ
   per country (15% in Saudi Arabia, 5% in the UAE, no VAT in Kuwait or Yemen), and
   cash-dominated, credit-informal trading habits.
2. **Local desktop accounting packages** that are single-user, single-branch, unaudited,
   offline-only, and fall apart the moment a business opens a second branch or hires an
   accountant.

Neither option serves the actual trajectory of these businesses: they grow, they add
branches and representatives with vans full of stock, they start manufacturing or servicing,
they register for VAT, and they need their history, in their language, on their devices —
online or offline.

## The vision

One **universal, configurable, multi-tenant SaaS ERP platform** with:

- **A single, rigorous financial core** — double-entry accounting, a centralized posting
  engine, immutable audit history — shared by every industry and module. Correctness is
  not negotiable and not per-industry.
- **Arabic-first, RTL-native experience** with full English — not a translated afterthought.
  Arabic terminology, Hijri support, Arabic-Indic numeral options, RTL-correct printing.
- **Industry configuration instead of industry forks** — a restaurant, an auto-parts shop,
  a distributor, and a bakery run on the same core with different templates, terminology,
  workflows, and reports. Adding an industry must not require rewriting modules.
- **Jurisdiction packs instead of hard-coded law** — each country's VAT rules, e-invoicing
  regimes, document requirements, and numbering live in versioned, verified packs behind
  adapters, including "no VAT" jurisdictions such as Yemen and Kuwait.
- **Offline-first where the business needs it** — POS terminals and field sales keep
  working without connectivity; the server stays authoritative for posted financial
  records. No blind last-write-wins for money.
- **One platform, many sizes** — a microbusiness on a phone and a multi-branch enterprise
  with granular permissions use the same product through subscription entitlements.

## Target users

| Segment | Example | What they need first |
|---------|---------|---------------------|
| Individual owners & micro shops | Mobile accessories repair counter | Dead-simple invoicing, cash tracking, Arabic UI |
| Small & medium enterprises | Pharmacy chain, 3 branches | Multi-branch stock, receivables, VAT returns |
| Retailers & wholesalers | Building-materials trader | Barcode POS, price tiers, credit customers |
| Restaurants & food | Café, bakery, buffet | POS, expiry-sensitive stock, daily cash |
| Auto businesses | Tire shop + workshop | Parts inventory linked to service job cards |
| Distributors | Beverage van-sales operation | Van stock, representative accountability, settlements |
| Manufacturers | Food production line | BOM, production costing, batch genealogy |
| Service & professional firms | Law office, contractor | Time-based and recurring billing, projects |
| Rental & logistics | Car rental, freight agency | Contracts, deposits, shipment tracking |
| Multi-country operators | KSA + Egypt trading group | Multi-currency, multi-jurisdiction tax |

## Product pillars

1. **Accounting correctness as a feature.** Balanced entries, posting idempotency, period
   integrity, subledger reconciliation — verified by invariant tests, not promises
   ([../accounting/ACCOUNTING_INVARIANTS.md](accounting/ACCOUNTING_INVARIANTS.md)).
2. **Configuration without chaos.** Industry templates, jurisdiction packs, subscription
   plans, tenant settings, and user permissions are separate layers with documented
   resolution rules ([../product/CONFIGURATION_ENGINE.md](product/CONFIGURATION_ENGINE.md)).
   Configuration can never override accounting invariants or security controls.
3. **Trustworthy data.** Multi-tenant isolation with PostgreSQL Row-Level Security as
   defense in depth, immutable audit events, tested backups
   ([../security/THREAT_MODEL.md](security/THREAT_MODEL.md)).
4. **Speed of daily work.** Dense, keyboard-first data entry, fast tables, no decorative
   motion in accounting workflows
   ([../ui/DESIGN_PRINCIPLES.md](ui/DESIGN_PRINCIPLES.md)).
5. **One coherent design system** shared by web, desktop, and Android
   ([../ui/DESIGN_SYSTEM.md](ui/DESIGN_SYSTEM.md)).

## Commercial shape

The platform is subscription SaaS with plans differentiated by feature entitlements,
users, branches, and industry add-ons (see
[../product/SUBSCRIPTION_AND_ENTITLEMENTS.md](product/SUBSCRIPTION_AND_ENTITLEMENTS.md)).
The **Minimum Viable Commercial Release (MVP)** is the back-office core: tenancy,
accounting, master data, inventory, purchasing, sales, tax, reporting, subscriptions —
end of [PHASE-014](planning/MASTER_ROADMAP.md). POS, industry templates, manufacturing,
offline clients, and regulatory integrations follow in later stages.

## Expansion (v2.0)

Post-GA, the platform expands to full financial depth — fixed assets & depreciation,
PDC notes & installments, budgeting, payroll (financial scope), and multi-entity
consolidation (stages 9–11, PHASE-026…034) — and to **13 industry templates** including
healthcare, education, and agriculture **commercial shells** that configure the existing
core for those industries' financial operations. Deep-vertical operations (clinical HIS,
academic LMS, agronomy science) remain **honest non-goals**: the shells sell the commercial
layer, never a vertical we do not operate. The goal is competitiveness with the leading
Arabic-market ERP systems on their own table-stakes list — without moving the MVP
(PHASE-014) or GA (PHASE-025) gates and without weakening a single architectural
guarantee. Canonical spec: [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md).

## Success criteria (product level)

- A shop owner can register, select "Restaurant", and issue a compliant Arabic invoice
  the same day without training.
- An accountant can close a period and produce a trial balance that reconciles to every
  subledger, with drill-down to source documents.
- A distributor's representative can sell from a van with no connectivity; nothing is
  double-posted when connectivity returns.
- A platform administrator can enable a module for one tenant without touching any other
  tenant's data or behavior.
- No feature ships without its acceptance criteria and automated tests passing
  ([../testing/TEST_STRATEGY.md](testing/TEST_STRATEGY.md)).

## Explicit non-goals

See [SCOPE_AND_NON_GOALS.md](SCOPE_AND_NON_GOALS.md) — including payroll/HR, a public app
marketplace, blockchain, and being all things to all businesses at launch.
