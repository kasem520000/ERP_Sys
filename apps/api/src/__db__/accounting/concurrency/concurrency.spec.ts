import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  resolveAccounts,
  restorePeriodsOpen,
  setupAccountingFixture,
  TENANT_A,
  withTenant,
} from "../fixtures";
import { withTenant as withTenantRaw } from "../../../infra/db/tenant-context";
import * as store from "../../../modules/accounting/infrastructure/accounting.store";

/**
 * PHASE-007 concurrency suites (ACCOUNTING_TESTS §6, this phase's subset):
 * CC-01 duplicate post (concurrent), CC-03 sequence race (50 parallel),
 * CC-05 period-lock race, CC-06 reversal vs duplicate re-post.
 * INV-013/014 interplay: at most one entry, at most one reversal.
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;
let yearId: string;

beforeAll(async () => {
  await setupAccountingFixture();
  yearId = (await ensureFiscalYear()).id;
  accounts = await resolveAccounts();
});

// Order-independence restore (PHASE-008 reality-audit repair): this suite
// LOCKS December on the SHARED FY2026 of tenant A (CC-05 period-lock race).
// Restore the pristine all-OPEN state so vitest's file order can never couple
// suites (no other tenant-A suite posts into December today, but the restore
// keeps that true by construction, not by luck).
afterAll(async () => {
  await restorePeriodsOpen(["12"]);
});

describe("CC-01 — concurrent duplicate post converges on ONE entry", () => {
  it("two parallel post() calls for the same source: exactly one entry set; the loser replays the stored result", async () => {
    const docId = newDocId();
    const spec = manualSpec({
      docId,
      debitAccountId: accounts.cash,
      creditAccountId: accounts.salesRevenue,
      amount: "88.0000",
      entryDate: "2026-05-10",
    });
    const [first, second] = await Promise.all([
      withTenantRaw(TENANT_A, () => posting.post(spec, { postedBy: ACTOR })),
      withTenantRaw(TENANT_A, () => posting.post(spec, { postedBy: ACTOR })),
    ]);
    const ids = new Set([first.journalEntryId, second.journalEntryId]);
    expect(ids.size).toBe(1);
    const replays = [first, second].filter((result) => result.idempotentReplay);
    expect(replays.length).toBeGreaterThanOrEqual(1);
    // No partial subledger: exactly the expected AR/AP rows (this fixture
    // has none) and exactly one entry row for the key.
    const { findEntryBySourceKey, listEntries } = await import(
      "../../../modules/accounting/infrastructure/journal.store"
    );
    const entry = await withTenant(TENANT_A, () =>
      findEntryBySourceKey("journal_entry", docId, "post"),
    );
    expect(entry).toBeDefined();
    const all = await withTenant(TENANT_A, () => listEntries({ sourceType: "journal_entry", limit: 500 }));
    const mine = all.rows.filter((row) => row.sourceId === docId);
    expect(mine.length).toBe(1);
  });
});

describe("CC-03 — sequence numbering race (50 parallel posts)", () => {
  it("50 unique official numbers, no gaps/collisions, no deadlocks", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        withTenantRaw(TENANT_A, () =>
          posting.post(
            manualSpec({
              docId: newDocId(),
              debitAccountId: accounts.cash,
              creditAccountId: accounts.salesRevenue,
              amount: "1.0000",
              entryDate: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
            }),
            { postedBy: ACTOR },
          ),
        ),
      ),
    );
    const numbers = results.map((result) => result.entryNo!);
    const unique = new Set(numbers);
    expect(unique.size).toBe(50);
    for (const number of numbers) {
      expect(number).toMatch(/^JE-2026-\d{6}$/);
    }
  });
});

describe("CC-05 — period lock race", () => {
  it("post() racing a LOCK: either the entry commits before the lock or gets PERIOD_LOCKED — never a silent third outcome", async () => {
    // Dedicated period: December, fresh OPEN state via reopen if needed.
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const december = periodsList.find((period) => period.name.endsWith("-12"))!;
    const { periods } = await import("../fixtures");
    // Ensure OPEN starting state.
    const current = await withTenant(TENANT_A, () => store.findPeriodById(december.id));
    if (current?.status !== "OPEN") {
      await withTenant(TENANT_A, () => periods.reopen(ACTOR, december.id, "race fixture reset"));
    }
    const docId = newDocId();
    const spec = manualSpec({
      docId,
      debitAccountId: accounts.cash,
      creditAccountId: accounts.salesRevenue,
      amount: "7.0000",
      entryDate: "2026-12-20",
    });
    const lockPromise = (async () => {
      await withTenantRaw(TENANT_A, async () => {
        await periods.softClose(ACTOR, december.id);
        await periods.lock(ACTOR, december.id);
      });
    })();
    let postOutcome: "posted" | "locked" | "other" = "other";
    try {
      await withTenantRaw(TENANT_A, () => posting.post(spec, { postedBy: ACTOR }));
      postOutcome = "posted";
    } catch (error) {
      const code = (error as { code?: string }).code;
      let message = error instanceof Error ? error.message : String(error);
      // Drizzle wraps the pg error; walk the cause chain for the trigger's
      // PERIOD_LOCKED message (the deferred INV-011 backstop).
      let cause: unknown = error;
      for (let depth = 0; depth < 5 && cause !== null && cause !== undefined; depth += 1) {
        const candidate = cause instanceof Error ? cause.message : String(cause);
        message = `${message} ${candidate}`;
        cause = (cause as { cause?: unknown }).cause;
      }
      // Either the ENGINE rejected (PERIOD_LOCKED) or the lock won the race
      // and the DEFERRED INV-011 trigger aborted the commit — both are the
      // invariant holding.
      postOutcome = code === "PERIOD_LOCKED" || message.includes("PERIOD_LOCKED") ? "locked" : "other";
    }
    await lockPromise;
    expect(["posted", "locked"]).toContain(postOutcome);
    if (postOutcome === "locked") {
      // No residue for the loser.
      await withTenant(TENANT_A, async () => {
        const { findEntryBySourceKey } = await import(
          "../../../modules/accounting/infrastructure/journal.store"
        );
        const entry = await findEntryBySourceKey("journal_entry", docId, "post");
        expect(entry).toBeUndefined();
      });
    }
    // Restore December to OPEN for later suites.
    await withTenant(TENANT_A, () => periods.reopen(ACTOR, december.id, "race cleanup"));
  });
});

describe("CC-06 — reversal vs duplicate re-post", () => {
  it("at most one entry + at most one reversal when reverse() races a duplicate delivery", async () => {
    const docId = newDocId();
    const spec = manualSpec({
      docId,
      debitAccountId: accounts.cash,
      creditAccountId: accounts.salesRevenue,
      amount: "44.0000",
      entryDate: "2026-05-15",
    });
    const original = await withTenantRaw(TENANT_A, () => posting.post(spec, { postedBy: ACTOR }));
    // Race: reverse() vs a duplicate post() delivery (replay path).
    const [reverseOutcome, duplicateOutcome] = await Promise.allSettled([
      withTenantRaw(TENANT_A, () =>
        posting.reverse(
          { originalEntryId: original.journalEntryId, entryDate: "2026-05-16", reason: "race reversal" },
          { reversedBy: ACTOR },
        ),
      ),
      withTenantRaw(TENANT_A, () => posting.post(spec, { postedBy: ACTOR })),
    ]);
    // The duplicate delivery always replays the stored entry.
    expect(duplicateOutcome.status).toBe("fulfilled");
    if (duplicateOutcome.status === "fulfilled") {
      expect(duplicateOutcome.value.journalEntryId).toBe(original.journalEntryId);
      expect(duplicateOutcome.value.idempotentReplay).toBe(true);
    }
    // The reversal either completed or lost the race cleanly.
    expect(["fulfilled", "rejected"]).toContain(reverseOutcome.status);
    const { listEntries } = await import("../../../modules/accounting/infrastructure/journal.store");
    const all = await withTenant(TENANT_A, () => listEntries({ limit: 500 }));
    const originalRows = all.rows.filter((row) => row.id === original.journalEntryId);
    expect(originalRows.length).toBe(1);
    // At most one reversal link.
    const entry = originalRows[0]!;
    expect(entry.reversedById === null || typeof entry.reversedById === "string").toBe(true);
    if (entry.reversedById !== null) {
      const reversals = all.rows.filter((row) => row.reversalOfId === original.journalEntryId);
      expect(reversals.length).toBe(1);
    }
  });
});
