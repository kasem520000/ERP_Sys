# T19-WEB — PHASE-014 web UI (Subscription, Billing, Onboarding & Dashboards)

**Task ID:** T19-WEB (PHASE-014 T7 / §2.5–§2.10 — the subscription, billing, onboarding and
dashboard surfaces). Work ONLY in `apps/web` + `packages/contracts/src/navigation.ts` (+ this
worklog). `apps/api` untouched (frozen; its PHASE-014 surface was committed at
`5947634`/`de62e7b`).

**Repo state at handoff (recorded per AGENT_START_HERE §1):** the working tree carried a large
uncommitted, in-progress changeset that already matched this task's spec (the spec file itself
is untracked). Rather than discarding it, this session COMPLETED and verified it: two real
defects found in the in-progress code were fixed (see "Fixes on top of the handoff state"),
every §4 gate was re-run from scratch, and every API shape was re-verified against the frozen
controllers/services (never assumed from the in-progress types).

**Status:** COMPLETE — every mandated gate green (web build+typecheck+lint, i18n parity,
@erp/ui nav test, contracts typecheck/lint, ui-catalog) + bonus gates (permissions-drift,
dependency-cruiser).

## Files created / changed

| File | Change |
| --- | --- |
| `apps/web/app/[locale]/(marketing)/pricing/page.tsx` | **NEW** PUBLIC pricing page (route group `(marketing)`, no session; `PublicShell layout="page"`). Plan cards from `GET /public/plans` only — monthly + annual verbatim with the bilingual PLACEHOLDER badge (`placeholderPrice`), highlight ribbon on the seeded row, positioning line. Honest feature matrix: `featureKeys` grouped into families by prefix (platform/accounting/trade/treasury+tax/reporting **plus a 6th "growth" family** for the v2.0 prefixes) with ✓ count-of-union per plan — never the 100+ raw keys. CTAs: anonymous → `/{locale}/login?next=/{locale}/checkout?plan={key}` (shape-validated open-redirect guard); sessioned → straight into `/{locale}/checkout?plan={key}`. |
| `apps/web/app/[locale]/checkout/page.tsx` | **NEW** sandbox checkout page (session; `?plan=` prefill, `?session=`/`?invoice=` resume). Server pre-fetches billing + public plans; 403 → honest forbidden state. |
| `apps/web/components/checkout-workspace.tsx` | **NEW** the checkout flow client: plan picker → `POST /tenancy/subscriptions/change-plan {planKey, periodMonths}` → `checkout_created` parses the session ref out of the sandbox provider URL and routes in-app to `?session=&invoice=`; the open-invoice card (period/due/amount + PLACEHOLDER badge) with "Pay now (sandbox)" and the labeled "Simulate payment failure" demo → `POST /tenancy/subscriptions/checkout/:ref/complete {outcome}` → success (links /billing + /dashboard) / failure states; `downgrade_scheduled` honest InfoNotice (the API's bilingual message); 422 `tenancy/downgrade-blocked` renders EVERY blocker (usage vs target ceiling); read-only grace keeps the flow usable (exempt upstream — the resolving action) + grace note. |
| `apps/web/app/[locale]/billing/page.tsx` | **NEW** billing home (session; server resolves `GET /tenancy/subscriptions` + `GET /tenancy/usage`; 403 → honest forbidden). |
| `apps/web/components/billing-history.tsx` | **NEW** plan card (status chip via the extended `localizedStatus` TRIAL/ACTIVE/PAST_DUE/GRACE_READ_ONLY/SUSPENDED, period, PLACEHOLDER price, trial countdown + `trialDaysPlaceholder` note), usage meters (progress bar; "∞ Unlimited" when unlimited; warn80 amber / warn100 red chips; the API's own bilingual per-counter note — the documents row always carries the INV-022 "never blocked" note from the payload), billing history table (paidVia bilingual map: provider_webhook → بوابة الدفع/Payment provider, manual_recorded → تسجيل يدوي/Manual recording), events timeline (bilingual event vocabulary + via-platform-admin caption), plan-change CTA → checkout. |
| `apps/web/app/[locale]/dashboard/page.tsx` | **NEW** owner dashboard page (session). Server resolves session + entitlements + usage, computes `today` server-side, gates on the nav item's own resolution (`reporting.dashboards` feature + `reporting.reports.run` permission); ungranted → opaque 404-equivalent state (no feature-existence leak). |
| `apps/web/components/owner-dashboard.tsx` | **NEW** the 4 KPI widgets — LINKS, numbers ONLY from the bound report-contract run envelopes (`POST reporting/report-runs`, 2s poll ≤60s like the workspace): sales today = `sales.daily-revenue` totals `netSales.amount` (secondary Σ rows `invoiceCount`); cash position = `treasury.daily-cash` Σ rows `net` (`addExact`); AR overdue = `ar.aging` Σ rows (`baseTotal` − `notDue`) (`addExact`/`subtractExact`); stock alerts = `inventory.reorder-alerts` row count + first-5 preview. Exact string math (`lib/exact-money`), `tabular-nums`, LTR-isolated, per-widget loading skeleton + honest error chip + assertion-FAIL chip (never fake numbers). Grid `gap-4 sm:grid-cols-2 xl:grid-cols-4`; usage strip + trial/past-due banners under the grid. KPI tiles are INLINE token-based shells inside this component (design tokens only — no ad-hoc colors; see Deviations #3). |
| `apps/web/app/[locale]/notifications/page.tsx` | **NEW** notifications center page (session; self plane). Server resolves the unread list + channel preferences. |
| `apps/web/components/notifications-center.tsx` | **NEW** inbox + preferences: severity chips (info/warning/critical), row-carried bilingual content (no dictionary for content), unread filter toggle, mark-read on click (optimistic + rollback), internal action links locale-prefixed / external anchors; preferences panel — 4 categories × in-app/email `Switch`, PUT per change (optimistic + rollback); 60s poll refreshes list + unread-count (aria-live sync line). |
| `apps/web/components/notification-bell.tsx` | **NEW** header bell (44px target, unread badge capped at 99, fetch on mount + window focus, silent degradation). |
| `apps/web/components/platform-billing-panel.tsx` | **NEW** admin billing panel (mounted on `platform/tenants/[id]`): `GET /platform/subscriptions?tenantId=…` (subscription, plan, invoices, events), manual payment form (OPEN invoices only; via bank_transfer/cash/cheque; reference + reason ≥3 chars) → `POST /platform/subscriptions/:subscriptionId/manual-payment` (path :id = SUBSCRIPTION id, body carries `invoiceId`), suspend/restore with reason + confirm `Dialog`, "run daily pass" → `POST /platform/subscriptions/run-daily-pass` with outcome counts, `via_platform_admin` audit caption. |
| `apps/web/lib/read-only.tsx` | **NEW** the `useReadOnly` hook + `ReadOnlyProvider` context (fed by the shell's entitlements fetch). |
| `apps/web/app/[locale]/page.tsx` | **CHANGED** home redirects entitled users (reporting.dashboards feature + reports.run permission) server-side to `/{locale}/dashboard`; others keep the tiles page; an entitlements failure falls through honestly (no redirect). |
| `apps/web/app/[locale]/login/page.tsx` + `components/login-form.tsx` | **CHANGED** `?next=` support for the pricing CTAs — internal locale-prefixed paths only (open-redirect safe by shape). |
| `apps/web/app/[locale]/onboarding/page.tsx` | **CHANGED** resolves `GET /tenancy/settings` (journey resume state) + tenant profile (base currency) and passes both into the wizard. |
| `apps/web/components/onboarding-wizard.tsx` | **CHANGED** (855→971 lines) Journey A A6–A9: first item `POST /items` (REAL items-controller body: sku/name/nameAr/kind STOCK/uomId PCS/basePrice), first customer `POST /partners/partners` (REAL partners-controller body: kind CUSTOMER/code/name/nameAr), first invoice `POST /sales/sales-invoices` (REAL sales-controller body incl. `exchangeRate: null`, CREDIT line with no taxCode → honest no-tax note) then the API's REAL state machine submit → approve → post (stage line per hop) + final read for the POSTED row (number assigned at post); A9 renders the posted-invoice summary + the honest "document printing arrives with the print queue" note (verified: NO invoice document-print route exists — only the reporting print-preview for report runs) and records done-with-note. Every journey step has an honest resumable skip that writes the LAST GENUINELY achieved milestone (tracked `lastAchieved` — chained skips never fabricate); intermediate steps write their milestone; completion writes `{step:"completed", completed_at:now}`; journey PUT failures (read-only grace) surface honestly. |
| `apps/web/app/[locale]/platform/tenants/[id]/page.tsx` | **CHANGED** mounts `PlatformBillingPanel` next to the lifecycle panel. |
| `apps/web/components/app-shell.tsx` | **CHANGED** header `NotificationBell`; amber read-only grace banner (`role="status"` + "الدفع الآن/Pay now" → `/{locale}/billing`) under the header; `ReadOnlyProvider` fed by a parallel `GET /tenancy/entitlements` fetch (failure ⇒ writable, server re-enforces); +4 `FALLBACK_CRUMBS` entries (dashboard/billing/checkout/notifications). |
| `apps/web/components/public-shell.tsx` | **CHANGED** `layout="page"` wide surface for the marketing pricing page (default keeps the card). |
| `apps/web/components/report-workspace.tsx` | **CHANGED** dashboard drill-down deep links `/reports?report=…&dateFrom=…&dateTo=…[&asOf=…]` — applied once on mount (client-side; SSR renders defaults); unpermitted keys resolve to no selection (server is the enforcer). |
| `apps/web/i18n/dictionaries.ts` | **CHANGED** +218 keys appended at the END of the `Dictionary` interface, the `ar` literal and the `en` literal. Parity 1723/1723, no empty values. |
| `apps/web/lib/api-types.ts` | **CHANGED** +22 new wire types (`BillingBilingual`, `PublicPlanRow`, `BillingSubscriptionRow`, `BillingPlanSummary`, `SubscriptionInvoiceRow`, `BillingEventRow`, `BillingHistoryData`, `ChangePlanOutcome`, `CompleteCheckoutOutcome`, `UsageCounterView`, `UsageSnapshotData`, `JourneyStateValue`, `NotificationRow`, `NotificationPrefRow`, `UnreadCountData`, `PlatformBillingHistory`, `ManualPaymentOutcome`, `BillingSuspendOutcome`, `BillingRestoreOutcome`, `DailyPassOutcome`, `DowngradeBlocker`, `EntitlementSubscriptionState`) + the `DerivedEntitlements.subscription` extension — every one verified against the frozen API controllers/services. |
| `apps/web/lib/messages.ts` | **CHANGED** `localizedBillingError` (all subscription/billing error codes incl. `tenancy/limit-exceeded` details), `localizedBillingEvent` (the 12 emitted billing-event types), `localizedStatus` +TRIAL/PAST_DUE/GRACE_READ_ONLY. |
| `packages/contracts/src/navigation.ts` | **CHANGED** `home.dashboard` route `/`→`/dashboard` + `featureKey:"reporting.dashboards"` + `permission:"reporting.reports.run"` (group home, archetype dashboard — NAVIGATION_MODEL §1/§5); NEW `notifications.inbox` (home group, self plane — permission-less, resolveNavigation passes items with no gates); NEW `billing.home` (settings group — "subscription" per NAVIGATION_MODEL §1; NO featureKey on purpose — billing must stay reachable to pay; permission `tenancy.subscription.manage`). |

## Fixes on top of the handoff state (this session)

1. **`billing-history.tsx` AR plan name** — `planNameAr` read `plan.name` (the EN name) when the
   billing payload carried the plan, so the AR billing card showed the EN name. Fixed to
   `plan.nameAr`.
2. **Wizard skip honesty (chained skips)** — skip previously wrote a HARDCODED milestone for the
   step being skipped, so skipping the item step and then the customer step recorded
   `first_item_created` although no item was ever created. Skips now write the LAST GENUINELY
   achieved milestone (tracked as `lastAchieved`, initialized from the record, advanced only on
   real achievements); `skipPrint` writes the same honest stop.

## Verification (all green; exact outputs)

- `pnpm --filter @erp/web typecheck` — exit 0, clean.
- `pnpm --filter @erp/web lint` — exit 0, clean.
- `pnpm --filter @erp/web build` — `✓ Compiled successfully`; `✓ Generating static pages (132/132)`;
  routes emitted incl. `ƒ /[locale]/billing`, `ƒ /[locale]/checkout`, `ƒ /[locale]/dashboard`,
  `ƒ /[locale]/notifications`, `ƒ /[locale]/pricing`.
- `pnpm check:i18n-parity` — `ar=1723 keys, en=1723 keys`; `ar/en catalogs at 100% key parity; no empty values`.
- `pnpm --filter @erp/contracts typecheck` + `lint` — clean (exit 0 both).
- `pnpm check:ui-catalog` — `37 component exports ↔ 60 catalog rows`; `export↔row parity green`.
- `pnpm --filter @erp/ui test` — `Test Files 3 passed (3)`, `Tests 42 passed (42)`. The navigation
  behavior test needed NO changes: the new items live under the EXISTING home/settings groups, so
  the expected entitled group list is intact — verified by run; the zero-permission case still
  renders the home group because `notifications.inbox` is permission-less (never an empty group).
- Bonus gates (beyond §4): `pnpm check:permissions-drift` — `OK — matrix 224 keys, seed 224 keys`;
  `pnpm lint:depcruise` — `no dependency violations found (1360 modules, 4922 dependencies cruised)`.

## Deviations / notes for the next agent

1. **218 i18n keys, not ~120–180** — the spec's own surfaces (checkout incl. per-blocker lines,
   billing incl. events vocabulary, pricing matrix, dashboard, onboarding A6–A9, admin panel,
   read-only, statuses) required the extras. All keys are used; parity enforced at 1723.
2. **Pricing CTAs** — anonymous visitors follow the spec's `login?next=/{locale}/checkout?plan=…`
   shape exactly (URL-encoded); an already-sessioned visitor deep-links straight into checkout
   (login would be a no-op hop). The `?next=` value is validated by shape (internal
   locale-prefixed path only) — open-redirect safe.
3. **KPI tiles are inline in `owner-dashboard.tsx`** — @erp/ui ships NO `KPIStatCard`/`ChartCard`
   (verified by search). Per the spec's fallback instruction they are token-based (surface-card /
   border-subtle / primary-600 / shadow-e1 — no ad-hoc colors); a single-use tile did not warrant
   a separate component file. Sparklines are SKIPPED by decision: all four widgets pin a single
   day/as-of snapshot, so the envelope rows carry no time series — a chart would misrepresent
   single-day data (multi-day windows arrive with PHASE-015's ChartCard).
4. **Feature matrix adds a 6th "growth" family** (pos/industry/crm/manufacturing/distribution/
   offline prefixes) so the union never silently drops a key the plans actually carry.
5. **Notifications 60s poll** refreshes list + unread-count together (the spec asked for the
   unread-count poll; the shared refresh is a superset with one request pair).
6. **Report-workspace deep link is client-side on mount** — SSR renders the plain defaults, the
   parameters appear post-hydration; unpermitted report keys resolve to no selection (the
   `permitted` filter is the authority; the server re-checks the run permission anyway).
7. **Home redirect degrades honestly** — an entitlements fetch failure falls through to the tiles
   page (no redirect on uncertainty).
8. **Checkout "duplicate" outcome renders as success** (a replayed delivery means the first
   delivery already succeeded); `"no-op"` is typed upstream but unreachable with the current
   service (only succeeded|failed|duplicate are emitted).
9. **Journey PUT failures** (read-only grace blocks `PUT /tenancy/settings/...`) surface as a
   distinct `journeyError` notice; the in-session flow continues, and the server-side record
   remains the authority on the next load.

## API-shape observations (reported, never silently adapted)

1. `GET /tenancy/subscriptions` events carry MORE than the spec sketch `{id,type,payload,
   createdAt}` — the full store row incl. `viaPlatformAdmin`, `actorId`, `idempotencyKey`. The
   web types it verbatim (`BillingEventRow`) and uses `viaPlatformAdmin` for the caption — a
   superset, not a mismatch.
2. `GET /tenancy/usage` → `subscription.pendingPlanKey` is hardcoded `null` in the current
   usage-service (typed as `string | null`); the web never renders it. No action needed.
3. `POST …/checkout/:ref/complete` → `processed` includes `"no-op"` in the service TYPE but the
   implementation only emits `payment.succeeded | payment.failed | duplicate` today.
4. The `documents_per_month` counter note (the INV-022 line) comes from the payload verbatim;
   its AR copy in the API reads "…يستمر أبدًا" vs the spec's "…يستمر دائمًا" (EN matches the spec
   exactly). The web renders the payload as-is — the API is the authority; flagged for a future
   copy sync if desired.
5. `public/plans` `placeholderPrice` is derived `priceAmount === "0.0000"` — all three plan seeds
   are 0.0000 (OQ-002), so every price on the pricing/checkout/billing surfaces renders with the
   PLACEHOLDER badge; no number is ever hard-coded in the web.
