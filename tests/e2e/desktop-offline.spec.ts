/**
 * PHASE-021 W3 task 3-b (T14; MASTER-PLAN §10 — BINDING) — the E2E desktop
 * offline journey, AR then EN, automating the essence of the phase doc §6
 * manual-verification journeys 2–3:
 *
 *   unlock (cached D-04 snapshot, full access) → cached item/partner reads
 *   with as-of labels + the reprint affordance → create a sales-invoice
 *   draft against the STALE cached price (DRAFT_LOCAL badge, queue 1, the
 *   auto fast-push honestly failing offline) → the connectivity flip + the
 *   ONLINE-ONLY manual-sync affordance disabled WITH its localized reason
 *   (the DR-P21-09 older-shell posture) → reconnect → the console's SyncNow
 *   drives the REAL SyncDesktopHost through the scripted FaultTransport →
 *   the cycle completes → the PRICE_CHANGED rejection renders (the seeded
 *   server price + the server's trace id) → accept-server-price → the
 *   local_events audit row + the RESEND (new commandId, fresh
 *   idempotencyKey, same entity) → the console's PushNow → ACCEPTED state +
 *   the official number rendered.
 *
 * Every step asserts the HONEST state at that point and the exact i18n
 * strings of the journey's locale (AR asserts Arabic, EN asserts English —
 * the strings come from the REAL apps/web dictionary, imported here, never
 * duplicated). The export is built once (~40 s) and shared; each locale
 * journey gets its own REAL desktop runtime (temp SQLite store + real host
 * + real session) and its own scripted transport.
 *
 * RESOLVED (DR-P21-3b-1 — the fix landed): the journey found the real
 * integration defect at the seam no unit test crossed — the console's
 * enqueueDraftCommand originally wrote the BUSINESS payload into the
 * outbox `payload` column while the engine sends `JSON.parse(row.payload)`
 * VERBATIM on the wire (no commandId/entityType/intent/idempotencyKey ⇒
 * unattributable server-side, the row froze IN_FLIGHT forever). The fix
 * stores the FULL v2 envelope in the column (outbox-view gained the compat
 * unwrap; the details.traceId follow-up closed the audit gap) — this spec
 * went green with zero behavioral tolerance needed: 2/2 journeys (AR+EN)
 * pass, see agent-ctx/T-P21-3b.md §RESOLUTION + T-P21-2b.md's post-W3
 * note. The step-5 fail-fast diagnostic remains as the guard: any future
 * enqueue-shape regression surfaces in ~3 s with wire evidence instead of
 * a 20-second timeout mystery.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

import { getDictionary, type Dictionary, type Locale } from "../../apps/web/i18n/dictionaries";
import {
  attachDesktopBridge,
  buildDesktopExport,
  cachedItem,
  cachedItem2,
  cachedPartner,
  createDesktopWorld,
  permissionKeys,
  postedInvoice,
  removeDesktopExport,
  resendOfficialNo,
  serverPrice,
  startStaticExportServer,
  type DesktopWorld,
  type StaticExportServer,
} from "./_desktop-harness";

/** `{placeholder}` substitution — the same semantics as apps/web lib/messages. */
function fmt(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

/** The literal text before the first {placeholder} of a template. */
function templatePrefix(template: string): string {
  return template.split("{")[0]!.trim();
}

/** The localized display name of a bilingual cached row (the console's rule). */
function displayName(locale: Locale, name: string, nameAr: string): string {
  return locale === "ar" ? nameAr : name;
}

/** The OfflineBadge queue-depth pill ("Queue 1" / "قائمة الانتظار 1") —
 * exact-matched: the bare label is a substring of the EN heading
 * ("Queue & rejections") and would multi-match. */
function queueBadge(page: Page, label: string, depth: number) {
  return page.getByText(`${label} ${String(depth)}`, { exact: true });
}

/** Any queue-depth pill (the drained-state absence assertion). */
function anyQueueBadge(page: Page, label: string) {
  return page.getByText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`));
}

/** Query the REAL store THROUGH the bridge double (the console's own path). */
async function bridgeSqlQuery(page: Page, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    ([query, values]) =>
      (
        window as unknown as {
          __erpDesktop: { sql: { query(statement: string, args?: unknown[]): Promise<Record<string, unknown>[]> } };
        }
      ).__erpDesktop.sql.query(query, values),
    [sql, params] as [string, unknown[]],
  );
}

/** The DR-P21-3b-1 diagnostic: the exact failure text surfaced when the
 * pushed outbox row freezes IN_FLIGHT because the server result cannot be
 * attributed to a command that reached the wire without a commandId. */
function enqueueDefectMessage(world: DesktopWorld, wireCommands: readonly Record<string, unknown>[]): string {
  const wireEvidence = wireCommands.map((command) => Object.keys(command));
  return [
    "DR-P21-3b-1 (the E2E-exposed 2-b enqueue defect) — the console's outbox row CANNOT drain:",
    "apps/web enqueueDraftCommand writes the BUSINESS PAYLOAD into the outbox `payload` column,",
    "but the engine (SyncClient.pushAllV2 → transport.pushV2) sends JSON.parse(row.payload)",
    "VERBATIM as the wire command. The pushed command carries no commandId/entityType/intent/",
    "idempotencyKey (wire evidence, per pushed command, the full key set:",
    `${JSON.stringify(wireEvidence)}), so the server's per-item result is unattributable and the`,
    "row freezes IN_FLIGHT forever — the mirror renders 'syncing' indefinitely and NO rejection",
    "can ever render. Verified against the real server shape too: normalize() shape-rejects the",
    "bare payload (VALIDATION_ERROR with a best-effort random id — same freeze).",
    "Fix (2-b surface, coordinator decision — diff-ready in agent-ctx/T-P21-3b.md): EITHER store",
    "the v2 command ENVELOPE in the payload column (JSON.stringify(command) — the engine's own",
    "ReferenceDevice.capture semantic) plus unwrap .payload in outbox-view.tsx/console.tsx reads,",
    "OR rebuild the envelope at the host's transport seam from the outbox row columns. This spec",
    "goes green unchanged the moment either lands.",
  ].join("\n");
}

test.describe("PHASE-021 T14 — the desktop offline journey (AR then EN)", () => {
  // NOT serial: both locale journeys must RUN and report their own verdict
  // even when one fails (workers: 1 keeps them sequential anyway).
  let server: StaticExportServer;

  test.beforeAll(async () => {
    // Built ONCE and reused by both locale journeys (the DR-P21-07 export:
    // prebuild stash → ERP_TARGET=desktop next build → restore), then
    // served statically for both journeys. The E2E_SKIP_BUILD=1 env reuses
    // a pre-built export instead (see the gate).
    buildDesktopExport();
    server = await startStaticExportServer();
  });

  test.afterAll(async () => {
    await server?.close();
    // The D6 posture: the export is a transient, regenerable artifact — it
    // never survives the run (apps/web lint/tree stay clean). Under
    // E2E_SKIP_BUILD=1 the export is caller-managed (the gate built it
    // explicitly) — the caller removes it.
    if (process.env.E2E_SKIP_BUILD !== "1") {
      removeDesktopExport();
    }
  });

  for (const locale of ["ar", "en"] as const) {
    test(`[${locale}] unlock → cached reads → draft → offline ONLINE-ONLY → reconnect → PRICE_CHANGED → accept-server-price → ACCEPTED`, async ({
      browser,
    }) => {
      test.info().annotations.push({
        type: "warning",
        description:
          "steps 5–6 are blocked by DR-P21-3b-1 (the 2-b outbox payload-column/wire-shape drift, fully diagnosed in agent-ctx/T-P21-3b.md) — the spec fails fast at step 5 with the diagnostic until the 2-b fix lands",
      });
      test.setTimeout(150_000);
      const world = createDesktopWorld(locale);
      try {
        await runJourney(browser, world, locale, server.origin);
      } finally {
        world.close();
      }
    });
  }
});

async function runJourney(browser: Browser, world: DesktopWorld, locale: Locale, origin: string): Promise<void> {
  const d: Dictionary = getDictionary(locale);

  // -- the bridge double: full capabilities INCLUDING the sync driver ------
  const context = await browser.newContext({ timezoneId: "UTC" });
  try {
    await attachDesktopBridge(context, world, { withSyncDriver: true });
    const page = await context.newPage();

    // STEP 1 — unlock against the cached D-04 permission snapshot.
    await page.goto(`${origin}/${locale}/unlock`);
    // The injected bridge validated structurally — desktop mode, never the
    // browser fallback (a half-injected bridge would render the browser note).
    const bridgeShape = await page.evaluate(() => {
      const bridge = (window as unknown as { __erpDesktop?: Record<string, unknown> }).__erpDesktop;
      return (
        bridge !== undefined &&
        typeof bridge.version === "string" &&
        typeof (bridge.sql as { query?: unknown }).query === "function" &&
        typeof (bridge.sync as { syncNow?: unknown } | undefined)?.syncNow === "function"
      );
    });
    expect(bridgeShape, "the injected __erpDesktop must be structurally complete (detectBridge)").toBe(true);
    await expect(page.getByText(d.unlockBrowserNote)).toHaveCount(0);
    // Full access per the cached snapshot — the D-04 verdict + the keys.
    await expect(page.getByText(d.unlockModeFull)).toBeVisible();
    await expect(page.getByText(d.unlockPermissionsHeading)).toBeVisible();
    for (const key of permissionKeys) {
      await expect(page.getByText(key, { exact: true })).toBeVisible();
    }
    const snapshotDate = new Date(world.snapshotAtMs).toISOString().slice(0, 19);
    await expect(page.getByText(fmt(d.unlockSnapshotAt, { date: snapshotDate }))).toBeVisible();

    // STEP 2 — cached reads with the as-of label + the offline badge state.
    await page.goto(`${origin}/${locale}/offline`);
    await expect(page.getByRole("heading", { name: d.offlineConsoleTitle }).first()).toBeVisible();
    await expect(page.getByText(d.offlineReasonBrowser)).toHaveCount(0);
    // Desktop mode: the real form renders (never the browser ONLINE-ONLY note).
    await expect(page.getByRole("button", { name: d.offlineSubmitQueue })).toBeVisible();
    // Connectivity (online), the idle phase badge, the seeded as-of stamp —
    // MAX(cursors.synced_at) rendered, never the never-synced guess.
    await expect(page.getByText(d.offlineOnlineLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(d.offlinePhaseIdle, { exact: true })).toBeVisible();
    // The console header + the cached-reads panel each render the AsOfLabel.
    const asOfLabel = page.getByText(new RegExp(`^${escapeRegExp(templatePrefix(d.offlineAsOfLabel))}`)).first();
    await expect(asOfLabel).toBeVisible();
    // The seeded stamp (2026-11-04T09:30Z) formatted by the page locale.
    await expect(asOfLabel).toContainText("2026");
    await expect(page.getByText(d.offlineAsOfNever)).toHaveCount(0);
    // The cached items + partner (the pickers' sources), localized display.
    await expect(page.getByText(cachedItem.sku, { exact: true })).toBeVisible();
    await expect(page.getByText(displayName(locale, cachedItem.name, cachedItem.nameAr), { exact: true })).toBeVisible();
    await expect(page.getByText(cachedItem.basePrice, { exact: true })).toBeVisible();
    await expect(page.getByText(cachedItem2.sku, { exact: true })).toBeVisible();
    // The partner row in the cached-reads list (the customer picker's hidden
    // native option carries the same text — scope to the rendered row).
    const partnerRow = page.locator("li").filter({ hasText: cachedPartner.code });
    await expect(partnerRow).toBeVisible();
    await expect(partnerRow).toContainText(displayName(locale, cachedPartner.name, cachedPartner.nameAr));
    // Master-data search over the caches narrows honestly (READ-CACHED);
    // scoped to the rendered rows (the item picker's hidden native option
    // always carries every sku).
    await page.getByLabel(d.offlineReadsSearchItems).fill("ESP");
    await expect(page.locator("li").filter({ hasText: cachedItem2.sku })).toHaveCount(0);
    await expect(page.locator("li").filter({ hasText: cachedItem.sku })).toHaveCount(1);
    await page.getByLabel(d.offlineReadsSearchItems).fill("");
    await expect(page.getByText(cachedItem2.sku, { exact: true })).toBeVisible();
    // The posted cached invoice + the row-32 reprint affordance (captured
    // through bridge.print.printHtml — the CACHED doc_no, never re-numbered).
    await expect(page.getByText(postedInvoice.docNo, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: d.offlineReadsReprint }).first().click();
    await expect(page.getByText(d.offlineReadsReprintSent)).toBeVisible();
    expect(world.printedHtml.length, "bridge.print.printHtml captured exactly one reprint").toBe(1);
    expect(world.printedHtml[0]).toContain(postedInvoice.docNo);
    expect(world.printedHtml[0]).toContain("REPRINT");
    expect(world.printedHtml[0]).toContain(cachedPartner.nameAr);
    // The queue starts empty.
    await expect(page.getByText(d.offlineOutboxEmpty)).toBeVisible();

    // STEP 3 — create the sales-invoice draft against the STALE cached price.
    // (Radix Select: the trigger opens the listbox portal; options are picked
    // INSIDE the open listbox — the visually-hidden native select carries
    // duplicate options outside it.)
    await page.getByRole("combobox", { name: d.offlineFieldCustomer }).click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: displayName(locale, cachedPartner.name, cachedPartner.nameAr), exact: true })
      .click();
    await page.getByLabel(d.offlineFieldDate).fill("2026-11-04");
    await page.getByRole("combobox", { name: `${d.offlineFieldItem} 1` }).click();
    await page
      .getByRole("listbox")
      .getByRole("option", {
        name: `${cachedItem.sku} · ${displayName(locale, cachedItem.name, cachedItem.nameAr)}`,
        exact: true,
      })
      .click();
    await page.getByLabel(d.offlineFieldQty).fill("3");
    await page.getByLabel(d.offlineFieldUnitPrice).fill(cachedItem.basePrice);
    await page.getByRole("button", { name: d.offlineSubmitQueue }).click();
    // The honest local states: queued toast, DRAFT_LOCAL badge, queue 1,
    // the outbox row QUEUED with the real command identity.
    await expect(page.getByText(d.offlineQueuedToast)).toBeVisible();
    await expect(page.getByText(d.offlineStateDraftLocal, { exact: true })).toBeVisible();
    await expect(queueBadge(page, d.offlineQueueLabel, 1)).toBeVisible();
    await expect(page.getByText(d.offlineStatusQueued, { exact: true })).toBeVisible();
    await expect(page.getByText("sales_invoice:create_draft", { exact: true })).toBeVisible();
    // Through the bridge (the console's own SQL path): the crash-safe
    // enqueue wrote outbox FIRST then the draft projection; the auto
    // post-write fast push honestly failed offline — poll until the
    // transport error is stamped on the row (the push + result application
    // ride the same awaited tick, but the poll keeps this deterministic on
    // slow machines) and the command is back in QUEUED — never a fabricated
    // ACK, never lost.
    await expect
      .poll(
        async () => {
          const rows = await bridgeSqlQuery(page, "SELECT status, last_error FROM outbox");
          const row = rows[0];
          return row === undefined ? "none" : `${String(row.status)}|${String(row.last_error ?? "")}`;
        },
        { timeout: 15_000 },
      )
      .toMatch(/^QUEUED\|transport:/);
    let outbox = await bridgeSqlQuery(page, "SELECT * FROM outbox");
    expect(outbox.length).toBe(1);
    const firstCommandId = String(outbox[0]!.command_id);
    expect(outbox[0]!.entity_type).toBe("sales_invoice");
    expect(outbox[0]!.intent).toBe("create_draft");
    expect(outbox[0]!.official_no).toBeNull();
    let drafts = await bridgeSqlQuery(page, "SELECT * FROM draft_docs");
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.local_status).toBe("DRAFT_LOCAL");
    expect(drafts[0]!.command_id).toBe(firstCommandId);

    // STEP 4 — connectivity flips OFF + the ONLINE-ONLY affordance.
    await page.evaluate("window.__e2eSetOnline(false)");
    await expect(page.getByText(d.offlineOfflineLabel, { exact: true })).toBeVisible();
    // Honest offline state: the queue is unchanged (offline never fakes or
    // drops queued work) and the phase stays idle.
    await expect(queueBadge(page, d.offlineQueueLabel, 1)).toBeVisible();
    await expect(page.getByText(d.offlinePhaseIdle, { exact: true })).toBeVisible();
    // The ONLINE-ONLY affordance, disabled WITH its localized reason: the
    // DR-P21-09 older-shell posture (no optional `sync` member) — the
    // console's manual-sync controls (online actions by nature) render
    // disabled with the shell-build reason, and the SAME store shows the
    // SAME queued draft (the store is the shared truth).
    const legacyContext = await browser.newContext({ timezoneId: "UTC" });
    try {
      await attachDesktopBridge(legacyContext, world, { withSyncDriver: false });
      const legacyPage = await legacyContext.newPage();
      await legacyPage.goto(`${origin}/${locale}/offline`);
      await expect(legacyPage.getByRole("button", { name: d.offlineSyncNow })).toBeDisabled();
      await expect(legacyPage.getByRole("button", { name: d.offlinePushNow })).toBeDisabled();
      // (both gated controls render the reason — one per button)
      await expect(legacyPage.getByText(d.offlineSyncUnavailable, { exact: true }).first()).toBeVisible();
      await expect(legacyPage.getByText(d.offlineStateDraftLocal, { exact: true })).toBeVisible();
      await expect(queueBadge(legacyPage, d.offlineQueueLabel, 1)).toBeVisible();
    } finally {
      await legacyContext.close();
    }
    // The webview NEVER does its own HTTP — the sync engine is shell-side.
    expect(world.httpCalls, "bridge.http must stay unused (the engine is shell-side)").toHaveLength(0);

    // STEP 5 — reconnect → the cycle → the PRICE_CHANGED rejection.
    world.transport.phase = "online";
    await page.evaluate("window.__e2eSetOnline(true)");
    await expect(page.getByText(d.offlineOnlineLabel, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: d.offlineSyncNow }).click();
    // Wait for the cycle to touch the row (the push marks it IN_FLIGHT;
    // the healthy path applies the per-item result within the same awaited
    // tick, so the row lands terminal — REJECTED — before any observation).
    await expect
      .poll(
        async () => {
          const rows = await bridgeSqlQuery(page, "SELECT status FROM outbox WHERE command_id = ?", [firstCommandId]);
          return rows[0] === undefined ? "none" : String(rows[0].status);
        },
        { timeout: 15_000 },
      )
      .not.toBe("QUEUED");
    // A beat for the result application to land (sub-ms healthy; the frozen
    // path never lands), then read the store truth + the wire evidence.
    await page.waitForTimeout(1_500);
    outbox = await bridgeSqlQuery(page, "SELECT * FROM outbox");
    const cycledRow = outbox.find((row) => row.command_id === firstCommandId);
    const wireCommands = world.transport.pushV2Calls.flatMap((call) => call.commands as Record<string, unknown>[]);
    if (cycledRow !== undefined && cycledRow.status === "IN_FLIGHT") {
      // DR-P21-3b-1 — the documented 2-b enqueue defect (see the spec
      // header): fail FAST with the diagnosis + wire evidence instead of a
      // 20-second locator timeout.
      throw new Error(enqueueDefectMessage(world, wireCommands));
    }
    if (world.transport.pushV2Calls.length === 0) {
      throw new Error(
        "unexpected: the reconnect cycle never pushed the queued command (no transport.pushV2 call) — " +
          "this is NOT the documented DR-P21-3b-1 path; investigate drain pacing (next_attempt_at) " +
          `or the cycle outcome. Row: ${JSON.stringify(cycledRow ?? null)}`,
      );
    }
    // The cycle completed: the rejection renders in the outbox view with the
    // §3 label + meaning, the seeded server price (old → new) and the
    // server's trace id from the typed message.
    const rejection = page
      .locator("li")
      .filter({ hasText: "sales_invoice:create_draft" })
      .getByRole("alert");
    await expect(rejection).toBeVisible();
    await expect(rejection.getByText(d.offlineRejPriceChanged, { exact: true })).toBeVisible();
    await expect(rejection.getByText(d.offlineRejMeaningPriceChanged)).toBeVisible();
    // The server message carries old → new price + the trace id; the same
    // strings also appear inside the collapsed server-response <details>
    // block — the message span is the first match.
    await expect(rejection.getByText(cachedItem.basePrice).first()).toBeVisible();
    await expect(rejection.getByText(serverPrice).first()).toBeVisible();
    await expect(rejection.getByText(world.transport.rejectionTraceId).first()).toBeVisible();
    await expect(page.getByText(d.offlineStatusRejected, { exact: true })).toBeVisible();
    // The §3 action set for PRICE_CHANGED, exactly: accept-server-price
    // (ENABLED — the details carry the server price), edit-and-resend, cancel.
    const acceptServerPrice = page.getByRole("button", { name: d.offlineActionAcceptServerPrice });
    await expect(acceptServerPrice).toBeEnabled();
    await expect(page.getByRole("button", { name: d.offlineActionEditResend })).toBeEnabled();
    await expect(page.getByRole("button", { name: d.offlineActionCancel })).toBeEnabled();
    // Through the bridge: the outbox row is REJECTED with the typed payload.
    const rejectedRow = outbox.find((row) => row.status === "REJECTED");
    expect(rejectedRow).toBeDefined();
    expect(rejectedRow!.command_id).toBe(firstCommandId);
    expect(rejectedRow!.rejection_reason).toBe("PRICE_CHANGED");
    expect(rejectedRow!.official_no).toBeNull();
    const typedError = JSON.parse(String(rejectedRow!.last_error)) as {
      reason: string;
      details: { serverPrice?: string; traceId?: string };
    };
    expect(typedError.reason).toBe("PRICE_CHANGED");
    expect(typedError.details.serverPrice).toBe(serverPrice);
    expect(typedError.details.traceId).toBe(world.transport.rejectionTraceId);
    // A second manual cycle converges the mirror's projection: the draft
    // flips to SYNC_FAILED carrying the typed reason (reconcileDrafts).
    await page.getByRole("button", { name: d.offlineSyncNow }).click();
    await expect(page.getByText(d.offlineStateSyncFailed, { exact: true })).toBeVisible();

    // STEP 6 — resolution: accept the server price → the audited RESEND.
    await acceptServerPrice.click();
    // The localized effect note (the server price + the audit record).
    await expect(page.getByText(`${fmt(d.offlineEffectAcceptPrice, { price: serverPrice })} ${d.offlineChoiceRecorded}`)).toBeVisible();
    // Through the bridge: the audit-logged choice (CONFLICT_RESOLUTION §3).
    const events = await bridgeSqlQuery(page, "SELECT * FROM local_events ORDER BY id");
    expect(events.length).toBe(1);
    expect(events[0]!.kind).toBe("rejection_choice");
    expect(events[0]!.choice).toBe("accept_server_price");
    expect(events[0]!.reason).toBe("PRICE_CHANGED");
    expect(events[0]!.command_id).toBe(firstCommandId);
    expect(String(events[0]!.payload)).toContain(serverPrice);
    // The audit row carries the rejecting response's traceId (fixed with
    // DR-P21-3b-1's follow-up: parseTypedRejection reads details.traceId —
    // the typed lastError envelope shape — closing the recorded gap; the
    // acceptance criterion "every choice audit-logged with the rejecting
    // traceId" is now met end-to-end).
    expect(events[0]!.trace_id).toBe(world.transport.rejectionTraceId);
    // The RESEND: a NEW commandId + a FRESH idempotencyKey (same entity),
    // the draft row re-pointed at the new command via the same local_id.
    outbox = await bridgeSqlQuery(page, "SELECT * FROM outbox");
    expect(outbox.length).toBe(2);
    const resendRow = outbox.find((row) => row.status === "QUEUED");
    expect(resendRow).toBeDefined();
    const resendCommandId = String(resendRow!.command_id);
    expect(resendCommandId).not.toBe(firstCommandId);
    expect(resendRow!.idempotency_key).not.toBe(rejectedRow!.idempotency_key);
    // The resent business payload carries the SERVER price on the same item.
    // TOLERANCE (documented): the 2-b fix may land as either sanctioned
    // shape — the v2 envelope in the payload column (the business payload
    // rides .payload) or the business payload as today with the envelope
    // rebuilt at the transport seam — both keep the business meaning
    // identical, so the assertion reads through both.
    const resendWire = JSON.parse(String(resendRow!.payload)) as Record<string, unknown>;
    const resendPayload = (resendWire.payload ?? resendWire) as {
      customerId: string | null;
      lines: { itemId: string; unitPrice: string }[];
    };
    expect(resendPayload.lines[0]!.unitPrice).toBe(serverPrice);
    expect(resendPayload.lines[0]!.itemId).toBe(cachedItem.id);
    expect(resendPayload.customerId).toBe(cachedPartner.id);
    drafts = await bridgeSqlQuery(page, "SELECT * FROM draft_docs");
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.command_id).toBe(resendCommandId);
    expect(drafts[0]!.local_status).toBe("DRAFT_LOCAL");
    // The queue badge reflects the resend (depth 1 again).
    await expect(queueBadge(page, d.offlineQueueLabel, 1)).toBeVisible();

    // The console's PushNow → the RESEND accepted: the official number is
    // the ONLY place it appears (ACCEPTED state, never before).
    await page.getByRole("button", { name: d.offlinePushNow }).click();
    await expect(page.getByText(fmt(d.offlineOutboxOfficialNo, { no: resendOfficialNo }))).toBeVisible();
    await expect(page.getByText(d.offlineStatusAcked, { exact: true })).toBeVisible();
    // A final manual cycle converges the projection: MERGED (the honest
    // post-sync state) and the queue drains to zero.
    await page.getByRole("button", { name: d.offlineSyncNow }).click();
    await expect(page.getByText(d.offlineStateMerged, { exact: true })).toBeVisible();
    // The queue drains to zero: every queue-depth pill is gone (the badge
    // renders only while QUEUED + IN_FLIGHT > 0).
    await expect(anyQueueBadge(page, d.offlineQueueLabel)).toHaveCount(0);
    // Through the bridge: the terminal outbox + draft truth.
    outbox = await bridgeSqlQuery(page, "SELECT * FROM outbox");
    const ackedRow = outbox.find((row) => row.status === "ACKED");
    expect(ackedRow).toBeDefined();
    expect(ackedRow!.command_id).toBe(resendCommandId);
    expect(ackedRow!.official_no).toBe(resendOfficialNo);
    drafts = await bridgeSqlQuery(page, "SELECT * FROM draft_docs");
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.command_id).toBe(resendCommandId);
    expect(drafts[0]!.local_status).toBe("MERGED");
    // Transport honesty: exactly TWO pushes ever reached the server — the
    // rejected first push and the accepted resend (never a duplicate).
    expect(world.transport.pushV2Calls.length).toBe(2);
    expect(String(world.transport.pushV2Calls[1]!.commands[0]!.commandId)).toBe(resendCommandId);
    // The webview still never did its own HTTP.
    expect(world.httpCalls).toHaveLength(0);

    await page.close();
  } finally {
    await context.close();
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
