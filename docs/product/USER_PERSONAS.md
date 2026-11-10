# User Personas

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-27

The personas the Platform is designed around. They are the reference frame for
[USER_JOURNEYS.md](USER_JOURNEYS.md), the role templates, and UX density decisions. The
product is Arabic-first: personas think, work, and read in Arabic first; English is a full
parity second language, never a prerequisite.

**Roles used below** are the system role templates seeded by the platform (see
[../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md), `roles` with
`tenant_id = null`): **owner**, **accountant**, **sales**, **purchasing**, **warehouse**,
**cashier**, **viewer**. Platform staff (persona P-07) are not tenant users; they act through
the platform admin console with separate permissions and `via_platform_admin` audit marking
([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md)).

## P-01 · Abu Mohammed — micro-shop owner

| Attribute | Detail |
|---|---|
| Business | Mobile accessories & repair counter, one room, one cash drawer |
| Role template | **owner** (all permissions; branch scope: all) |
| Devices | Android phone first; shared shop tablet later |
| Language | Arabic only; reads numerals in Arabic-Indic option |
| First satisfied | PHASE-012 (first invoice) · PHASE-014 (self-serve onboarding + dashboard) |

**Background.** Runs a 3-person shop: himself, a repair technician, and a nephew at the
counter. Today his "system" is a paper notebook plus WhatsApp photos of invoices to his
wholesaler. He has heard about VAT and e-invoicing from other shop owners but does not know
what applies to him.

**Goals.** Issue a proper Arabic invoice (فاتورة ضريبية) in under 30 seconds; know today's
cash at day end; stop losing track of who owes him what; be ready if the tax authority asks
questions.

**Daily workflows.** Open the drawer → sell over the counter (cash) → occasional repair
service invoicing → note credit sales to known neighbors → evening: count the drawer, buy
stock from the wholesaler.

**Pain points with current tools.** Paper invoices are unnumbered and unauditable; local
desktop packages are Windows-only, LTR, and in English; web tools assume an accountant's
vocabulary (debit/credit) he refuses to learn.

**What he needs from the Platform.** Registration and onboarding he can complete on his phone
in one sitting ("اختر نشاطك" — choose your activity — then everything is preconfigured);
one-tap cash invoice; a simple "who owes me" list (المدينون); day-end cash summary; the
security that his data survives his phone.

**Permissions posture.** Starts as the only user with the **owner** role. He may invite a
**cashier** (the nephew) and later an external accountant (see P-09) without exposing
settings. He should never need the full permission matrix screen — sensible defaults, with
advanced controls progressive-disclosed.

**UX implications.** Phone-first layouts (single column, large touch targets); minimal
accounting terminology (defaults come from the industry template, `industry.retail`);
Arabic-Indic numeral option; RTL-native printing; no wizard step that requires a CoA
decision — templates map purposes automatically.

## P-02 · Sara — SMB accountant (chartered level)

| Attribute | Detail |
|---|---|
| Business | 12-employee building-materials trader, 2 branches |
| Role template | **accountant** (+ viewer on reports); she is not owner |
| Devices | Laptop, external keyboard; dense-grid data entry |
| Language | Arabic first; reads English financial terms comfortably |
| First satisfied | PHASE-007 (core) · PHASE-013 (statements & reconciliation workspace) |

**Background.** A qualified accountant (محاسبة قانونية) who spent six years in an audit
firm. She cares about the same things an auditor will ask her: trial balance integrity,
subledger control, documented corrections, and a clean paper trail.

**Goals.** Close the month on a checklist she can trust; reconcile AR/AP/inventory/VAT/cash
to the GL without exporting to Excel; produce a VAT return that matches the books to the
dirham; never let anyone edit a posted entry.

**Daily workflows.** Review overnight reconciliation statuses → process receipts and
allocations → clear bank statement lines → review approval queue (journals, large invoices)
→ month-end: run the close checklist, verify VAT draft, lock the period.

**Pain points with current tools.** Generic ERPs give her a trial balance that does not
reconcile to customer statements; corrections are editable rows (who changed what is a
mystery); local packages have no audit trail and no VAT engine at all.

**What she needs from the Platform.** The reconciliation health center (مساحة المطابقة)
as a first-class screen; immutable postings with reversal-only corrections; period locks
that actually block; side-by-side VAT return vs GL (INV-012) with drill-down; keyboard-first
journal entry with account-code typeahead in both languages.

**Permissions posture.** **accountant** role: full accounting module, period close, no
subscription/billing administration, no user management. She configures approval thresholds
only if the owner delegates it (`accounting.approvals.configure`).

**UX implications.** Maximum information density; tables over cards; keyboard navigation
complete for journal entry (NFR-002); error messages that name the invariant violated
(e.g., "القيد غير متوازن — مجموع المدين لا يساوي مجموع الدائن"); zero decorative motion
in accounting screens; export everything.

## P-03 · Rashid — warehouse keeper

| Attribute | Detail |
|---|---|
| Business | Central warehouse of a grocery distributor |
| Role template | **warehouse** |
| Devices | Shop tablet on a trolley; occasionally the shared office PC |
| Language | Arabic only |
| First satisfied | PHASE-010 (inventory) |

**Background.** Fifteen years in the warehouse; knows every pallet by smell. Barcode
scanning is familiar from the old handheld that "only worked when it wanted".

**Goals.** Receive goods against the right order fast; find where a batch/serial is; count
stock without stopping shipments; never be blamed for a discrepancy he reported.

**Daily workflows.** Morning: check expected receipts → GRN scanning → putaway → pick and
issue against delivery notes → mid-day: urgent transfers to the branch → quarter-end: count
sheets.

**Pain points with current tools.** Paper GRNs re-keyed by the accountant (errors blamed on
him); expiry dates invisible until a customer complains; counts freeze operations for two
days.

**What he needs from the Platform.** Scan-to-receive against a PO (سند استلام البضاعة);
batch/expiry capture at receipt; FEFO pick suggestions; counts with a system snapshot so
operations continue; variance review that records the counter's name honestly.

**Permissions posture.** **warehouse** role: goods receipts, transfers, counts, stock
queries — no prices, no customer balances, no posting of invoices (margin data hidden;
see the authorization matrix workstream).

**UX implications.** Big touch targets; barcode-first, typing-last; offline-tolerant count
entry (POS-lite per the offline capabilities matrix); Arabic labels using his vocabulary
(جرد، تحويل، استلام) — not generic "inventory transaction type 4".

## P-04 · Noura — cashier / POS operator

| Attribute | Detail |
|---|---|
| Business | Retail store chain counter; 6 sister branches |
| Role template | **cashier** (branch-scoped to her store) |
| Devices | POS terminal with barcode scanner + cash drawer + 80 mm printer |
| Language | Arabic only |
| First satisfied | PHASE-016 (POS) · shifts from PHASE-008 |

**Background.** Part-time university student; rings up ~300 sales a day during peak. She is
not an accounting user and must never see one.

**Goals.** Get through the queue fast; handle returns without calling the manager; end her
shift with zero difference (فرق الصندوق = 0).

**Pain points with current tools.** The old POS freezes and the queue backs up; when the
internet drops, sales stop entirely; voided sales need a manager who is "in the back".

**What she needs from the Platform.** Sub-second item add (scan or quick search); clear
payment split (cash/card/cheque); offline sale that completes with an honest "pending sync"
state; shift open/close in three taps; manager PIN prompts only where policy demands.

**Permissions posture.** **cashier** role, branch-scoped: POS sales, returns within policy,
shift open/close, no discounts above her ceiling (BR-002), no back-office screens. On
offline devices her permissions travel as a cached snapshot with sync-time revalidation.

**UX implications.** Full-screen sale surface; number pads, no keyboards; high-contrast
totals; RTL receipt layout mirrored correctly; audible scan confirmation; the terminal
never shows GL accounts, tax jargon, or other branches' data.

## P-05 · Khaled — field sales representative (van sales)

| Attribute | Detail |
|---|---|
| Business | Beverage & snacks distributor; one van, 25–40 customer stops a day |
| Role template | **sales** (rep attribution + van-stock accountability) |
| Devices | Company Android phone; poor connectivity on the route |
| Language | Arabic only |
| First satisfied | PHASE-017 (van sales) · PHASE-022 (offline Android app) |

**Background.** Sells from a van stocked each morning; collects cash from credit customers;
carries free-goods promotions. His employer's trust in him — and his commission — depend on
clean settlement (تسوية).

**Goals.** Load the van fast; sell and collect all day with or without signal; prove exactly
what he sold, returned, and collected; get his commission statement without arguing.

**Pain points with current tools.** Paper triplicate books; the accountant re-types them a
day later; mismatches between his book, the warehouse, and the cash box are always "his
fault"; no promotion visibility in the field.

**What he needs from the Platform.** Morning: scan-load the van against the transfer; on
route: fast invoice + receipt capture, cached customer balances, free-goods suggestions;
evening: guided settlement that reconciles cash, invoices, returns, and van stock — with
each line attributed to him.

**Permissions posture.** **sales** role: create invoices/receipts for assigned route
customers, view their statements, view his own van stock and commissions — nothing else.
Collections post through treasury; he never touches bank accounts directly.

**UX implications.** Offline-capable Android flows (ADR-0012); one-hand operation; big
numeric fields; customer photos; honest pending-sync badges; Arabic-first voice-note-free
data entry — no free-text-only capture that breaks settlement math.

## P-06 · Tariq — purchasing manager

| Attribute | Detail |
|---|---|
| Business | Same distributor as P-05; manages 40+ suppliers |
| Role template | **purchasing** (+ viewer on inventory) |
| Devices | Laptop; supplier calls on WhatsApp |
| Language | Arabic first; English for some supplier catalogs |
| First satisfied | PHASE-011 |

**Background.** Negotiates prices, juggles delivery windows, and answers to the owner for
stock-outs. Hates buying things twice because someone else already ordered them.

**Goals.** Convert requests to POs quickly; know what is received-but-not-invoiced (GRNI);
match supplier invoices to orders automatically; land freight/customs into true item cost.

**Daily workflows.** Review purchase requests → issue POs → chase deliveries → receive
discrepancy alerts → review three-way match exceptions → approve supplier invoices within
his threshold → plan payments with the accountant.

**Pain points with current tools.** Excel PO register; supplier invoices paid twice because
"was this already entered?"; landed costs ignored, so margins lie.

**What he needs from the Platform.** Request→PO conversion with dedup warnings; GRNI aging
report (المستلم غير مفوتر); three-way match (المطابقة الثلاثية) with tolerance rules
(BR-009) and exception-only review; approval thresholds he can see (BR-010); landed-cost
allocation he can explain to the owner.

**Permissions posture.** **purchasing** role: PR/PO/GRN/supplier-invoice review within
thresholds; cannot post payments (accountant does); cannot change price lists or approve
beyond his threshold — escalation is one click to owner.

**UX implications.** Exception-driven queues ("3 invoices need matching review"); side-by-side
match views (order vs receipt vs invoice columns); supplier statement drill-down; dense
tables with saved column layouts; English/Arabic supplier-name search parity.

## P-07 · Layla — platform administrator (internal)

| Attribute | Detail |
|---|---|
| Business | Platform operator staff (not a tenant) |
| Role | Platform staff — admin console role; no tenant role template applies |
| Devices | Work laptop, internal network; on-call phone |
| Language | Arabic/English bilingual operations runbooks |
| First satisfied | PHASE-004 |

**Background.** Runs tenant operations: provisioning issues, plan changes, abuse reports,
support escalations. She is measured on tenant safety and audit cleanliness.

**Goals.** See tenant state at a glance; change entitlements without touching data; perform
support access that is time-boxed, reason-tagged, and visible to the tenant; never become
the unauthorized editor of a customer's books.

**Daily workflows.** Triage admin console alerts → verify ownership for sensitive actions →
apply plan/entitlement overrides with justification → grant/expire support access → review
platform-level audit trail → coordinate suspension/restore with billing.

**Pain points with current tools.** (Internal greenfield.) The risk is procedural: without
guardrails, staff impersonation drifts into unaudited data changes.

**What she needs from the Platform.** Admin console (وحدة تحكم المنصة) with tenant search,
status timeline, entitlement diff preview before apply; support access with hard expiry;
suspension that provably kills sessions and rejects sync (MULTI_TENANCY §6); read access to
`platform.audit.read` events flagged `via_platform_admin`.

**Permissions posture.** Platform-scope permissions only (`platform.admin.access`,
`platform.tenants.manage`, `platform.support.access`); every operation executes inside a
tenant-scoped context with per-action audit; cross-tenant bulk operations require the
explicit `PlatformScope` marker.

**UX implications.** Console is deliberately boring: dense tables, destructive-action
confirmations with typed tenant names, immutable action log inline; no dark patterns; every
override form has a mandatory reason field.

## P-08 · Eng. Mohammed — multi-branch CEO

| Attribute | Detail |
|---|---|
| Business | Owner-CEO of a 5-branch automotive parts & service group |
| Role template | **owner** (+ uses **viewer** shares for branch managers) |
| Devices | iPhone + office laptop; reviews on weekend |
| Language | Arabic; comfortable with financial dashboards |
| First satisfied | PHASE-014 (dashboards) · approvals from PHASE-007 |

**Background.** Grew from one workshop to five branches. His fear: a branch manager who is
both recording sales and handling cash in the same window with no oversight.

**Goals.** See per-branch cash, sales, margins, and receivables without calling each
manager; approve big exceptions from his phone; enforce that no single person posts and
approves the same large document.

**Daily workflows.** Morning dashboard scan (5 minutes) → approval queue (credit-limit
exceptions, large POs, period reopens) → weekly: branch comparison; monthly: review the
close checklist his accountant locked.

**Pain points with current tools.** Branch data in five WhatsApp groups and one fragile
spreadsheet; approvals happen verbally and nobody wrote them down.

**What he needs from the Platform.** Cross-branch dashboard with drill-down to the document;
mobile approval inbox with full effect preview; segregation-of-duties by default
(`allow_self_approval = false`, BR-034); an audit trail he can hand to an external auditor
without embarrassment.

**Permissions posture.** **owner** everywhere, but he assigns **viewer** to branch managers
(read-only dashboards + their branch) and **cashier**/**sales** to staff — the principle of
least privilege is the product's job to make easy.

**UX implications.** Dashboard-first mobile experience; approval cards with amount, branch,
requester, and effect preview; push/in-app notifications for threshold breaches; RTL charts
and Arabic-Indic numerals; nothing that requires him to open a journal.

## P-09 · Huda — external accounting office bookkeeper

| Attribute | Detail |
|---|---|
| Business | Runs a 2-person accounting office serving ~30 micro/SMB clients |
| Role template | **accountant** in each client tenant (multi-tenant membership) |
| Devices | Office desktop, two monitors |
| Language | Arabic first; formal financial Arabic vocabulary |
| First satisfied | PHASE-003 (multi-membership) · PHASE-013 (statements/printing) |

**Background.** Her office does monthly bookkeeping + VAT returns for shops that have no
in-house accountant. She is a tenant member of many tenants simultaneously and must never
mix them up.

**Goals.** Switch between client tenants safely; find each client's uncategorized cash and
unallocated receipts fast; print/send statements and VAT return drafts in Arabic; know the
client (owner role) saw and approved the return before filing.

**Daily workflows.** Per client: review dashboard exceptions → allocate on-account receipts
→ review expense claims → verify VAT draft vs GL → send report package → record the client's
filing confirmation.

**Pain points with current tools.** One license per client desktop package = 30 installs;
client data arrives as phone photos; no way to prove who approved what.

**What she needs from the Platform.** Clean tenant switcher with visual tenant identity;
"bookkeeper checklist" view per client (unallocated receipts, unreconciled bank lines, open
drafts, broken reconciliations); one-click bilingual statement packs; approval history on
the VAT return draft (see [USER_JOURNEYS.md](USER_JOURNEYS.md) journey E).

**Permissions posture.** **accountant** in client tenants; she must be invited per tenant
and can be scoped to exclude sensitive HR-ish data (none at MVP) and subscription
administration. Her access per tenant is visible in that tenant's audit trail.

**UX implications.** Multi-tenant identity switcher in the header with tenant color/name in
both languages; global "my clients" work queue; keyboard-dense batch screens (bulk
allocation); print/preview parity between AR and EN.

## Persona → role → screens → phase matrix

| # | Persona | Role template | Primary screens | First satisfied |
|---|---|---|---|---|
| P-01 | Abu Mohammed (micro-shop owner) | owner | Onboarding wizard · New invoice · Day-end cash · Receivables list | PHASE-012 (invoice) / PHASE-014 (onboarding UX + dashboard) |
| P-02 | Sara (SMB accountant) | accountant | Close checklist · Reconciliation health center · Journal entry · VAT return | PHASE-007 / PHASE-013 |
| P-03 | Rashid (warehouse keeper) | warehouse | Goods receipt · Stock transfer · Count session · Batch/serial lookup | PHASE-010 |
| P-04 | Noura (cashier) | cashier (branch-scoped) | POS sale screen · Shift open/close · Return flow | PHASE-016 (shifts from PHASE-008) |
| P-05 | Khaled (van-sales rep) | sales | Van load · Route visits · Invoice/receipt capture · Settlement | PHASE-017 (offline at PHASE-022) |
| P-06 | Tariq (purchasing manager) | purchasing | PO form · GRN · Three-way match exceptions · GRNI aging | PHASE-011 |
| P-07 | Layla (platform administrator) | platform staff (admin console) | Tenant search · Entitlement override · Support access · Platform audit | PHASE-004 |
| P-08 | Eng. Mohammed (multi-branch CEO) | owner | Dashboards · Approval inbox · Branch comparison | PHASE-014 |
| P-09 | Huda (external bookkeeper) | accountant (multi-tenant) | Tenant switcher · Client work queue · Statement packs · VAT draft review | PHASE-003 (membership) / PHASE-013 |

## Usage rules for design and engineering

1. Every screen and journey must name its personas; if a screen serves no persona, it does
   not ship ([USER_JOURNEYS.md](USER_JOURNEYS.md) journeys carry an *actors* field).
2. Density follows the persona: P-02/P-09 get dense grids; P-01/P-04/P-05 get large targets
   and progressive disclosure; P-08 gets dashboards and cards, never journals.
3. Arabic-first means: Arabic labels are designed, English is a peer locale — never a
   translated leftover (NFR-001). Examples above use canonical Arabic UI strings.
4. Offline expectations are per persona, not uniform: P-04 and P-05 are offline-critical;
   P-02 accepts read-only cached views; P-07 requires connectivity by policy.
5. When a persona's needs conflict, the accountant's correctness posture wins (the platform
   is accounting-correct first — [../PROJECT_VISION.md](../PROJECT_VISION.md) pillar 1).
