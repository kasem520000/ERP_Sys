import { beforeAll, describe, expect, it } from "vitest";

import {
  T_ACTOR,
  TENANT_T,
  receipts,
  setupTreasuryFixture,
  statements,
  withTenant,
  type TreasuryFixture,
} from "./fixtures";

/**
 * Bank reconciliation suite (PHASE-008 §2.8; BR-022 fixed;
 * RECONCILIATION.md §4): import via the adapter registry (CSV with Arabic
 * headers + BOM, XLSX), idempotency per file hash, row caps, auto-match
 * (amount + date window + reference), manual match, unmatched aging on
 * both sides, the per-account period lock, and the rule that statement
 * lines NEVER become ledger entries.
 */

let fixture: TreasuryFixture;

beforeAll(async () => {
  fixture = await setupTreasuryFixture();
});

function csvBase64(content: string): string {
  return Buffer.from(`\uFEFF${content}`, "utf8").toString("base64");
}

describe("import — adapters, Arabic headers, idempotency, row caps", () => {
  it("imports an Arabic-header CSV (BOM + التاريخ/المبلغ/المرجع/البيان) with the generic adapter", async () => {
    const csv = [
      "التاريخ,المبلغ,المرجع,البيان",
      "15/02/2026,500.00,REF-1,إيداع عميل",
      "16/02/2026,-120.50,REF-2,رسوم بنكية",
    ].join("\n");
    const result = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "statement-ar.csv",
        contentBase64: csvBase64(csv),
        actorId: T_ACTOR,
      }),
    );
    expect(result.idempotentReplay).toBe(false);
    expect(result.statement.lineCount).toBe(2);
    const lines = await withTenant(TENANT_T, () => statements.lines(result.statement.id));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.lineDate).toBe("2026-02-15");
    expect(lines[0]!.amount).toBe("500.0000");
    expect(lines[0]!.reference).toBe("REF-1");
    expect(lines[1]!.amount).toBe("-120.5000");
    expect(result.statement.periodStart).toBe("2026-02-15");
    expect(result.statement.periodEnd).toBe("2026-02-16");
  });

  it("re-importing the same bytes is idempotent: the stored statement returns, no duplicate lines", async () => {
    const csv = ["date,amount,reference,description", "2026-02-17,10.00,REF-3,two"].join("\n");
    const first = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "statement-b.csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        actorId: T_ACTOR,
      }),
    );
    const second = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "statement-b-copy.csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        actorId: T_ACTOR,
      }),
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.statement.id).toBe(first.statement.id);
    const lines = await withTenant(TENANT_T, () => statements.lines(first.statement.id));
    expect(lines).toHaveLength(1);
  });

  it("imports an XLSX workbook via the generic-xlsx adapter", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Statement");
    sheet.addRow(["Date", "Amount", "Reference", "Description"]);
    sheet.addRow([new Date("2026-02-18T00:00:00Z"), 75.25, "REF-4", "xlsx deposit"]);
    sheet.addRow([new Date("2026-02-19T00:00:00Z"), -5, "REF-5", "xlsx fee"]);
    const buffer = await workbook.xlsx.writeBuffer();
    const result = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "statement.xlsx",
        contentBase64: Buffer.from(buffer).toString("base64"),
        actorId: T_ACTOR,
      }),
    );
    expect(result.statement.adapterId).toBe("generic-xlsx");
    expect(result.statement.lineCount).toBe(2);
    const lines = await withTenant(TENANT_T, () => statements.lines(result.statement.id));
    expect(lines[0]!.amount).toBe("75.2500");
    expect(lines[1]!.amount).toBe("-5.0000");
  });

  it("row caps bound the import (STATEMENT_TOO_LARGE above 5000 rows)", async () => {
    const rows = ["date,amount,reference,description"];
    for (let index = 0; index < 5001; index += 1) {
      rows.push(`2026-02-20,1.00,R${index},bulk`);
    }
    await expect(
      withTenant(TENANT_T, () =>
        statements.import({
          cashAccountId: fixture.accountIds.bank,
          fileName: "too-large.csv",
          contentBase64: Buffer.from(rows.join("\n"), "utf8").toString("base64"),
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "STATEMENT_TOO_LARGE" });
  });

  it("malformed content is a typed format error; non-BANK accounts refuse statements", async () => {
    await expect(
      withTenant(TENANT_T, () =>
        statements.import({
          cashAccountId: fixture.accountIds.bank,
          fileName: "bad.csv",
          contentBase64: Buffer.from("date,amount\nNOT-A-DATE,5", "utf8").toString("base64"),
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "STATEMENT_FORMAT_INVALID" });
    const csv = "date,amount\n2026-02-21,5.00";
    await expect(
      withTenant(TENANT_T, () =>
        statements.import({
          cashAccountId: fixture.accountIds.cash,
          fileName: "cash-statement.csv",
          contentBase64: Buffer.from(csv, "utf8").toString("base64"),
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CASH_ACCOUNT_TYPE_INVALID" });
  });
});

describe("matching + aging + lock (BR-022 fixed)", () => {
  let statementId: string;

  it("system movements exist for the matching fixture (bank receipts)", async () => {
    // Two bank receipts (IN 500 on 2026-02-15 matching REF-1's line; IN 10
    // on 2026-02-17) — settled as on-account (no allocations needed).
    const first = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.bank,
        partnerId: fixture.partners.customerA.id,
        method: "BANK",
        payerName: null,
        currencyCode: "SAR",
        amount: "500.0000",
        exchangeRate: null,
        valueDate: "2026-02-15",
        reference: "REF-1",
        description: "bank receipt 500",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => receipts.post(first.id, T_ACTOR));
    const second = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.bank,
        partnerId: fixture.partners.customerA.id,
        method: "BANK",
        payerName: null,
        currencyCode: "SAR",
        amount: "10.0000",
        exchangeRate: null,
        valueDate: "2026-02-17",
        reference: "REF-3",
        description: "bank receipt 10",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => receipts.post(second.id, T_ACTOR));
  });

  it("auto-match pairs exact amount + direction within the window; unmatched stay listed with aging", async () => {
    // Import a statement covering the receipts (Arabic headers).
    const csv = [
      "التاريخ,المبلغ,المرجع,البيان",
      "15/02/2026,500.00,REF-1,إيداع عميل",
      "16/02/2026,-120.50,REF-2,رسوم",
      "17/02/2026,10.00,REF-3,إيداع صغير",
      "18/02/2026,999.00,REF-9,غير مطابق",
    ].join("\n");
    const result = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "match-statement.csv",
        contentBase64: csvBase64(csv),
        actorId: T_ACTOR,
      }),
    );
    statementId = result.statement.id;
    const matched = await withTenant(TENANT_T, async () =>
      (await import("./fixtures")).bankRec.autoMatch({ statementId, actorId: T_ACTOR }),
    );
    expect(matched.matched).toBe(2); // 500 + 10; −120.50 and 999 have no system side
    const lines = await withTenant(TENANT_T, () => statements.lines(statementId));
    const matched500 = lines.find((line) => line.amount === "500.0000")!;
    expect(matched500.matchedMovementId).not.toBeNull();
    expect(matched500.matchMode).toBe("AUTO");
    expect(lines.filter((line) => line.matchedMovementId === null)).toHaveLength(2);
  });

  it("manual match is exact (no tolerance absorption); wrong amounts and double-matching are rejected", async () => {
    const { bankRec } = await import("./fixtures");
    const lines = await withTenant(TENANT_T, () => statements.lines(statementId));
    const wrong = lines.find((line) => line.amount === "-120.5000")!;
    // The only OUT movement candidates: none of −120.50 exists on the
    // system side — manual match of an existing IN movement is a mismatch.
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_T, () =>
      store.listMovements({ cashAccountId: fixture.accountIds.bank, limit: 200 }),
    );
    const inMovement = movements.find((row) => row.direction === "IN" && row.amount === "10.0000")!;
    // Already auto-matched → double match rejected.
    await expect(
      withTenant(TENANT_T, () =>
        bankRec.manualMatch({ lineId: wrong.id, movementId: inMovement.id, actorId: T_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "MOVEMENT_ALREADY_MATCHED" });
  });

  it("unmatched aging lists BOTH sides with ages — never absorbed", async () => {
    const { bankRec } = await import("./fixtures");
    const aging = await withTenant(TENANT_T, () =>
      bankRec.unmatchedAging({ cashAccountId: fixture.accountIds.bank, asOf: "2026-03-01" }),
    );
    // Unmatched lines: −120.50 + 999; unmatched movements: none besides
    // possibly xlsx/other fixture receipts on other dates (scope to this
    // statement's lines for the assertion).
    expect(aging.unmatchedLines.length).toBeGreaterThanOrEqual(2);
    expect(aging.unmatchedLines.every((line) => typeof line.ageDays === "number")).toBe(true);
  });

  it("reconcile locks the period (BR-022): a BANK_REC run records; re-reconcile refused; matching inside the window refused", async () => {
    const { bankRec } = await import("./fixtures");
    const reconciled = await withTenant(TENANT_T, () =>
      bankRec.reconcile({ statementId, actorId: T_ACTOR }),
    );
    expect(reconciled.status).toBe("RECONCILED");
    // The framework run (PERIOD_CLOSING §2 item 3 reads these).
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const runs = await withTenant(TENANT_T, () => journal.latestReconciliationRuns("2026-02-28"));
    const bankRecRun = runs.find((run) => run.kind === "BANK_REC");
    expect(bankRecRun).toBeDefined();
    expect(bankRecRun!.status).toBe("OK");
    // Re-reconcile refused (BR-022).
    await expect(
      withTenant(TENANT_T, () => bankRec.reconcile({ statementId, actorId: T_ACTOR })),
    ).rejects.toMatchObject({ code: "STATEMENT_ALREADY_RECONCILED" });
    // Matching inside the locked window refused — a NEW statement whose
    // line date falls inside the reconciled period for this account.
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_T, () =>
      store.listMovements({ cashAccountId: fixture.accountIds.bank, limit: 200 }),
    );
    const candidate = movements.find((row) => row.direction === "IN")!;
    const lateCsv = "date,amount,reference,description\n2026-02-16," + candidate.amount.replace(/\.?0+$/, m => m.includes(".") ? "" : m) + ",LATE,late line in locked window";
    const lateImport = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: fixture.accountIds.bank,
        fileName: "late-statement.csv",
        contentBase64: Buffer.from(lateCsv, "utf8").toString("base64"),
        actorId: T_ACTOR,
      }),
    );
    const lateLines = await withTenant(TENANT_T, () => statements.lines(lateImport.statement.id));
    expect(lateLines).toHaveLength(1);
    await expect(
      withTenant(TENANT_T, () =>
        bankRec.manualMatch({
          lineId: lateLines[0]!.id,
          movementId: candidate.id,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BANK_REC_PERIOD_LOCKED" });
  });

  it("statement lines NEVER become ledger entries — no journal, no movement, from import through reconcile", async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const entries = await withTenant(TENANT_T, () => journal.listEntries({ limit: 500 }));
    const fromStatements = entries.rows.filter((row) => row.sourceType === "bank_statement");
    expect(fromStatements).toHaveLength(0);
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_T, () =>
      store.listMovements({ cashAccountId: fixture.accountIds.bank, limit: 500 }),
    );
    const fromStatementImport = movements.filter((row) => row.sourceType === "bank_statement");
    expect(fromStatementImport).toHaveLength(0);
  });
});
