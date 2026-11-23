import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  ensureQualityPostingWorld,
  freshQualityItem,
  setupQualityFixture,
} from "./fixtures";
import { CapaService } from "../../modules/quality/application/capa-service";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  CapaActionsPendingError,
  CapaCostAlreadyRecordedError,
  CapaEffectivenessRequiredError,
  CapaRecordNotFoundError,
  CapaStateError,
  NcrRecordNotFoundError,
  QualityInputInvalidError,
} from "../../modules/quality/domain/quality-errors";

/**
 * PHASE-050 (W-26 — T-07, 2026-11-23) `quality-capa.db.spec` — THE CAPA
 * ENGINE over real PG16 (the plan §4's own arm; acceptance #2's CAPA
 * arms): the root-cause/start act's CAS law, the actions array's shape
 * law, BR-103's effectiveness gate (the typed refusals carrying the open
 * action/due-date figures; the elapsed-window boundary), G-63's
 * exactly-once (the single-use source key `(capa_record, id,
 * external_cost)` + the single-use cost stamp — DR 5320 · CR 2137), the
 * unmapped-purpose fail-closed with the ZERO residue and the
 * flip-and-restore re-run, and the honest no-cost shapes (a zero-cost
 * CAPA carries no entry; the CLOSED register refuses every move).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const capa = new CapaService(audit, posting, numbering);
const ncr = new NcrService(audit, posting, numbering);

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();
});

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string, operation: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.base_amount::text AS amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND je.operation = ${operation}
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

/** Count a source key's entries (the INV-013 idempotency proof). */
async function entryCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}
  `);
  return rows.rows[0]!.n;
}

/** The flip-and-restore idiom (the ncr goldens' own). */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

async function restorePurposeKey(purposeKey: string, code: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  if (active === undefined) {
    const account = await tenancy.findAccountByCode(code);
    expect(account).toBeDefined();
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId: account!.id,
      activeFrom: new Date().toISOString().slice(0, 10),
    });
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  return new Date(Date.parse(todayIso()) - 86_400_000).toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  return new Date(Date.parse(todayIso()) + 86_400_000).toISOString().slice(0, 10);
}

/** A started CAPA (create + root cause) — the working record. */
async function startedCapa(code: string, withNcr = false) {
  let ncrId: string | null = null;
  if (withNcr) {
    const itemId = await freshQualityItem(`CAPA-NCR-${code}`);
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId,
        problem: `The ${code} linked NCR`,
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    ncrId = created.id;
  }
  const created = await withTenant(TENANT_QUALITY, () =>
    capa.create({ title: `The ${code} CAPA`, ncrId, actorId: QL_ACTOR }),
  );
  const started = await withTenant(TENANT_QUALITY, () =>
    capa.recordRootCause(created.id, {
      rootCause: `The ${code} root cause analysis`,
      actorId: QL_ACTOR,
    }),
  );
  return started;
}

describe("PHASE-050 W-26 — T-07: the CAPA register (create — the shapes, the NCR link)", () => {
  it("creates a standalone CAPA with the official number, OPEN, no stamps", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: "The standalone CAPA", actorId: QL_ACTOR }),
    );
    expect(created.capaNo).toMatch(/^CAPA-20\d{2}-\d{6}$/);
    expect(created.status).toBe("OPEN");
    expect(created.rootCause).toBeNull();
    expect(created.rootCauseAt).toBeNull();
    expect(created.actions).toEqual([]);
    expect(created.effectiveness).toBeNull();
    expect(created.externalCost).toBe("0.0000");
    expect(created.journalEntryId).toBeNull();
    expect(created.closedAt).toBeNull();
    expect(created.ncrId).toBeNull();
  });

  it("the NCR link binds the module's OWN row — a foreign id is the typed not-found", async () => {
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .create({
          title: "The foreign-link CAPA",
          ncrId: "99999999-9999-4999-8999-999999999999",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(NcrRecordNotFoundError);
    expect((refused as NcrRecordNotFoundError).code).toBe("NCR_RECORD_NOT_FOUND");
  });

  it("the linked CAPA lists under its NCR", async () => {
    const started = await startedCapa("LINKED", true);
    expect(started.ncrId).not.toBeNull();
    const rows = await withTenant(TENANT_QUALITY, () =>
      capa.list({ ncrId: started.ncrId! }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(started.id);
  });

  it("a foreign CAPA id is the typed not-found on every act", async () => {
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa.find("99999999-9999-4999-8999-999999999999").catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CapaRecordNotFoundError);
  });
});

describe("PHASE-050 W-26 — T-07: the root-cause start act + the actions array (the shape laws)", () => {
  it("the root-cause act IS the start: OPEN → IN_PROGRESS in the same CAS, the pair stamped", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: "The start-act CAPA", actorId: QL_ACTOR }),
    );
    const started = await withTenant(TENANT_QUALITY, () =>
      capa.recordRootCause(created.id, {
        rootCause: "The gasket was out of tolerance",
        actorId: QL_ACTOR,
      }),
    );
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.rootCause).toBe("The gasket was out of tolerance");
    expect(started.rootCauseAt).not.toBeNull();
    // The re-record at IN_PROGRESS: the analysis evolved, the stamp refreshed.
    const revised = await withTenant(TENANT_QUALITY, () =>
      capa.recordRootCause(created.id, {
        rootCause: "The gasket AND the seat were out of tolerance",
        actorId: QL_ACTOR,
      }),
    );
    expect(revised.status).toBe("IN_PROGRESS");
    expect(revised.rootCause).toContain("AND the seat");
    expect(revised.rootCauseAt).not.toBe(started.rootCauseAt);
  });

  it("the actions array records at OPEN and IN_PROGRESS; the malformed cell is the typed refusal naming it", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: "The actions CAPA", actorId: QL_ACTOR }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .recordActions(created.id, {
          actions: [{ title: "T", dueDate: "15/11/2026" }],
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInputInvalidError);
    expect((refused as QualityInputInvalidError).details).toMatchObject({ field: "actions" });
    // The plan CAN be drafted before the analysis (OPEN carries it).
    const drafted = await withTenant(TENANT_QUALITY, () =>
      capa.recordActions(created.id, {
        actions: [
          {
            title: "Replace the gasket",
            ownerEmployeeId: null,
            dueDate: yesterdayIso(),
            completedAt: null,
          },
        ],
        actorId: QL_ACTOR,
      }),
    );
    expect(drafted.actions).toHaveLength(1);
    expect(drafted.status).toBe("OPEN");
    // The array REPLACES wholesale: the second record supersedes the first.
    const replaced = await withTenant(TENANT_QUALITY, () =>
      capa.recordActions(created.id, { actions: [], actorId: QL_ACTOR }),
    );
    expect(replaced.actions).toEqual([]);
  });
});

describe("PHASE-050 W-26 — T-07: G-63 — the external quality cost through the REAL engine (D-06)", () => {
  it("THE GOLDEN-CLASS ARM: DR 5320 QUALITY_EXPENSE · CR 2137 EXTERNAL_ACCRUAL — the entry, the single-use stamp, the record's figures", async () => {
    const started = await startedCapa("G63");
    const result = await withTenant(TENANT_QUALITY, () =>
      capa.recordExternalCost(started.id, { amount: "750", actorId: QL_ACTOR }),
    );
    expect(result.capa.externalCost).toBe("750.0000");
    expect(result.capa.journalEntryId).not.toBeNull();
    expect(result.capa.journalEntryId).toBe(result.journalEntryId);
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("capa_record", started.id, "external_cost"),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "5320", amount: "750.0000" },
      { direction: "CREDIT", code: "2137", amount: "750.0000" },
    ]);
  });

  it("INV-013's exactly-once: the second cost act is the typed COST_ALREADY_RECORDED — one journal, zero new rows", async () => {
    const started = await startedCapa("ONCE");
    await withTenant(TENANT_QUALITY, () =>
      capa.recordExternalCost(started.id, { amount: "120", actorId: QL_ACTOR }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .recordExternalCost(started.id, { amount: "80", actorId: QL_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CapaCostAlreadyRecordedError);
    expect((refused as CapaCostAlreadyRecordedError).code).toBe("CAPA_COST_ALREADY_RECORDED");
    // The single-use proof: exactly one journal for the source key, the
    // cost unchanged.
    expect(await withTenant(TENANT_QUALITY, () => entryCount("capa_record", started.id))).toBe(1);
    const row = await withTenant(TENANT_QUALITY, () => capa.find(started.id));
    expect(row.externalCost).toBe("120.0000");
  });

  it("the cost at OPEN is refused NOT_STARTED — the 0114 stamp gate's own wording; zero residue", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: "The unstarted cost CAPA", actorId: QL_ACTOR }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .recordExternalCost(created.id, { amount: "50", actorId: QL_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CapaStateError);
    expect((refused as CapaStateError).code).toBe("CAPA_STATE_ERROR");
    expect((refused as CapaStateError).details).toMatchObject({ from: "OPEN" });
    expect(await withTenant(TENANT_QUALITY, () => entryCount("capa_record", created.id))).toBe(0);
  });

  it("THE UNMAPPED-PURPOSE FAIL-CLOSED: QUALITY_EXPENSE superseded → PURPOSE_NOT_MAPPED with ZERO residue; restored → the re-run GREEN", async () => {
    const started = await startedCapa("UNMAPPED");
    await withTenant(TENANT_QUALITY, async () => {
      await supersedePurposeKey("QUALITY_EXPENSE");
      const refused = await capa
        .recordExternalCost(started.id, { amount: "300", actorId: QL_ACTOR })
        .catch((error: unknown) => error);
      // The engine's own refusal (fail-closed — no fallback account).
      expect((refused as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
      // THE ZERO RESIDUE: the record keeps its pre-act state, zero
      // journals, the cost still 0.
      const untouched = await capa.find(started.id);
      expect(untouched.externalCost).toBe("0.0000");
      expect(untouched.journalEntryId).toBeNull();
      expect(await entryCount("capa_record", started.id)).toBe(0);
      // THE RESTORE: the tenant's own runtime repair path — the re-run
      // GREEN (the flip-and-restore idiom).
      await restorePurposeKey("QUALITY_EXPENSE", "5320");
      const result = await capa.recordExternalCost(started.id, {
        amount: "300",
        actorId: QL_ACTOR,
      });
      expect(result.capa.journalEntryId).not.toBeNull();
      expect(await entryCount("capa_record", started.id)).toBe(1);
    });
  });

  it("a zero-cost CAPA needs no cost act — the close carries NO entry (the honest no-GL shape)", async () => {
    const started = await startedCapa("NOCOST");
    const closed = await withTenant(TENANT_QUALITY, () =>
      capa.close(started.id, {
        summary: "Verified — the fix holds",
        effective: true,
        checkedAt: new Date().toISOString(),
        actorId: QL_ACTOR,
      }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.journalEntryId).toBeNull();
    expect(await withTenant(TENANT_QUALITY, () => entryCount("capa_record", started.id))).toBe(0);
  });
});

describe("PHASE-050 W-26 — T-07: BR-103 (the effectiveness gate) + the closed register", () => {
  it("the close on OPEN is refused NOT_STARTED — never a silent effectiveness-less closure", async () => {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: "The unstarted close CAPA", actorId: QL_ACTOR }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .close(created.id, {
          summary: "x",
          effective: true,
          checkedAt: new Date().toISOString(),
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CapaStateError);
    expect((refused as CapaStateError).details).toMatchObject({ from: "OPEN" });
  });

  it("the future-dated open action BLOCKS the close — the refusal carries the open action/due-date figures", async () => {
    const started = await startedCapa("PENDING");
    await withTenant(TENANT_QUALITY, () =>
      capa.recordActions(started.id, {
        actions: [
          { title: "Done action", ownerEmployeeId: null, dueDate: yesterdayIso(), completedAt: new Date().toISOString() },
          { title: "Open future action", ownerEmployeeId: null, dueDate: tomorrowIso(), completedAt: null },
          { title: "Open undated action", ownerEmployeeId: null, dueDate: null, completedAt: null },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .close(started.id, {
          summary: "x",
          effective: true,
          checkedAt: new Date().toISOString(),
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CapaActionsPendingError);
    expect((refused as CapaActionsPendingError).code).toBe("CAPA_ACTIONS_PENDING");
    expect((refused as CapaActionsPendingError).details).toMatchObject({
      capaId: started.id,
      capaNo: started.capaNo,
      openActionCount: 2,
      pendingCount: 2,
    });
    const row = await withTenant(TENANT_QUALITY, () => capa.find(started.id));
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.closedAt).toBeNull();
  });

  it("THE BOUNDARY: an open action due TODAY has its window elapsed — the close lands with the effectiveness record", async () => {
    const started = await startedCapa("BOUNDARY");
    await withTenant(TENANT_QUALITY, () =>
      capa.recordActions(started.id, {
        actions: [
          { title: "Due today, open", ownerEmployeeId: null, dueDate: todayIso(), completedAt: null },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const checkedAt = new Date().toISOString();
    const closed = await withTenant(TENANT_QUALITY, () =>
      capa.close(started.id, {
        summary: "The window elapsed; the fix verified",
        effective: true,
        checkedAt,
        actorId: QL_ACTOR,
      }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.effectiveness).toMatchObject({
      summary: "The window elapsed; the fix verified",
      effective: true,
      checkedAt,
    });
  });

  it("the future-dated CHECK is refused — the fabrication guard (a check 'performed' tomorrow)", async () => {
    const started = await startedCapa("FABRICATED");
    const refused = await withTenant(TENANT_QUALITY, () =>
      capa
        .close(started.id, {
          summary: "x",
          effective: true,
          checkedAt: `${tomorrowIso()}T09:00:00.000Z`,
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInputInvalidError);
    expect((refused as QualityInputInvalidError).details).toMatchObject({ field: "checkedAt" });
  });

  it("the honest negative check closes the record — D-10 demands the CHECK RECORDED, never a forced verdict", async () => {
    const started = await startedCapa("NEGATIVE");
    await withTenant(TENANT_QUALITY, () =>
      capa.recordActions(started.id, {
        actions: [
          { title: "Done", ownerEmployeeId: null, dueDate: yesterdayIso(), completedAt: new Date().toISOString() },
        ],
        actorId: QL_ACTOR,
      }),
    );
    const closed = await withTenant(TENANT_QUALITY, () =>
      capa.close(started.id, {
        summary: "Not effective — a successor CAPA carries the escalation",
        effective: false,
        checkedAt: new Date().toISOString(),
        actorId: QL_ACTOR,
      }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.effectiveness).toMatchObject({ effective: false });
  });

  it("the CLOSED register refuses every move BY NAME — the evidence law", async () => {
    const started = await startedCapa("EVIDENCE");
    const closed = await withTenant(TENANT_QUALITY, () =>
      capa.close(started.id, {
        summary: "Verified",
        effective: true,
        checkedAt: new Date().toISOString(),
        actorId: QL_ACTOR,
      }),
    );
    expect(closed.status).toBe("CLOSED");
    for (const refused of [
      await withTenant(TENANT_QUALITY, () =>
        capa
          .recordRootCause(closed.id, { rootCause: "x", actorId: QL_ACTOR })
          .catch((error: unknown) => error),
      ),
      await withTenant(TENANT_QUALITY, () =>
        capa
          .recordActions(closed.id, { actions: [], actorId: QL_ACTOR })
          .catch((error: unknown) => error),
      ),
      await withTenant(TENANT_QUALITY, () =>
        capa
          .recordExternalCost(closed.id, { amount: "10", actorId: QL_ACTOR })
          .catch((error: unknown) => error),
      ),
      await withTenant(TENANT_QUALITY, () =>
        capa
          .close(closed.id, {
            summary: "x",
            effective: true,
            checkedAt: new Date().toISOString(),
            actorId: QL_ACTOR,
          })
          .catch((error: unknown) => error),
      ),
    ]) {
      expect(refused).toBeInstanceOf(CapaStateError);
      expect((refused as CapaStateError).details).toMatchObject({ from: "CLOSED" });
    }
    expect(
      (await withTenant(TENANT_QUALITY, () => entryCount("capa_record", closed.id))) === 0,
    ).toBe(true);
    // The effectiveness-required arm's own proof: the fold's second
    // condition carried by the DB floor (a closed row without the
    // record cannot exist — the 0114 CHECK).
    const row = await withTenant(TENANT_QUALITY, () => capa.find(closed.id));
    expect(row.effectiveness).not.toBeNull();
    expect(CapaEffectivenessRequiredError).toBeDefined();
  });
});
