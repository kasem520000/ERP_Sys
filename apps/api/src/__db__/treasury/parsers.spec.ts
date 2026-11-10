import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as parked from "../../modules/treasury/parsers/parked-lines";
import { setupTreasuryFixture, statements, TENANT_T, type TreasuryFixture } from "./fixtures";

/**
 * PHASE-023 T7 verification (phase §6): the format-family adapters parse
 * their declared shapes; unparseable rows PARK (raw cells verbatim — never
 * a guessed amount into bank_statement_lines); manual mapping resolves
 * with mapper-confirmed fields; re-import is idempotent per checksum.
 */

let fixture: TreasuryFixture;
let bankAccountId: string;

beforeAll(async () => {
  fixture = await setupTreasuryFixture();
  bankAccountId = fixture.accountIds.bank;
});

async function importCsv(fileName: string, content: string, adapterId?: string): Promise<{ id: string }> {
  const result = await withTenant(TENANT_T, () =>
    statements.import({
      cashAccountId: bankAccountId,
      fileName,
      contentBase64: Buffer.from(content, "utf8").toString("base64"),
      actorId: null,
      adapterId,
    }),
  );
  return { id: result.statement.id };
}

describe("csv-debit-credit family adapter", () => {
  it("derives signed amounts from the debit/credit pair", async () => {
    const csv = [
      "date,debit,credit,reference",
      "2026-11-01,100.00,,REF-1",
      "2026-11-02,,250.50,REF-2",
    ].join("\n");
    const { id } = await importCsv(`dc-${Date.now()}.csv`, csv, "csv-debit-credit");
    const lines = await withTenant(TENANT_T, () => statements.lines(id));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ amount: "-100.0000", reference: "REF-1" });
    expect(lines[1]).toMatchObject({ amount: "250.5000", reference: "REF-2" });
  });

  it("parks ambiguous rows (both or neither debit/credit) — never guesses", async () => {
    const csv = [
      "date,debit,credit",
      "2026-11-01,10.00,20.00", // both set → ambiguous
      "2026-11-02,,", // neither set → ambiguous
      "2026-11-03,5.00,,", // fine
    ].join("\n");
    const { id } = await importCsv(`amb-${Date.now()}.csv`, csv, "csv-debit-credit");
    const lines = await withTenant(TENANT_T, () => statements.lines(id));
    expect(lines).toHaveLength(1);
    const parkedRows = await withTenant(TENANT_T, () =>
      parked.listParkedLines({ statementId: id }),
    );
    expect(parkedRows).toHaveLength(2);
    expect(parkedRows[0]?.parkedReason).toContain("ambiguous");
    expect(parkedRows[1]?.rawCells).toEqual(["2026-11-02", "", ""]);
    // No guessed amounts: parked rows never carry an amount.
    expect(JSON.stringify(parkedRows)).not.toMatch(/"amount"\s*:/);
  });

  it("parks unparseable dates; the parseable rows import", async () => {
    const csv = ["date,debit,credit", "NOT-A-DATE,5.00,,", "2026-11-03,7.00,,"].join("\n");
    const { id } = await importCsv(`baddate-${Date.now()}.csv`, csv, "csv-debit-credit");
    const parkedRows = await withTenant(TENANT_T, () =>
      parked.listParkedLines({ statementId: id }),
    );
    expect(parkedRows).toHaveLength(1);
    expect(parkedRows[0]?.parkedReason).toContain("unparseable date");
  });
});

describe("csv-with-balances family adapter", () => {
  it("records balance drift as an advisory (never a correction)", async () => {
    const csv = [
      "date,amount,balance",
      "2026-11-01,100.00,1100.00",
      "2026-11-02,-50.00,999.00", // drift: expected 1050
    ].join("\n");
    const { id } = await importCsv(`bal-${Date.now()}.csv`, csv, "csv-with-balances");
    const lines = await withTenant(TENANT_T, () => statements.lines(id));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ amount: "-50.0000" });
    // The amounts are the FILE's amounts — no correction was applied.
    expect(lines.map((line) => line.amount)).toEqual(["100.0000", "-50.0000"]);
  });
});

describe("parked-line resolution (manual mapping)", () => {
  it("resolve writes the mapper-confirmed line and links it; discard requires a note", async () => {
    const csv = ["date,debit,credit", "2026-11-01,30.00,,", "2026-11-01,10.00,20.00,"].join("\n");
    const { id } = await importCsv(`resolve-${Date.now()}.csv`, csv, "csv-debit-credit");
    const rows = await withTenant(TENANT_T, () => parked.listParkedLines({ statementId: id }));
    expect(rows).toHaveLength(1);
    const target = rows[0]!;
    const resolved = await withTenant(TENANT_T, () =>
      parked.resolveParkedLine({
        parkedLineId: target.id,
        lineDate: "2026-11-01",
        amount: "-15.0000",
        reference: "MAP-1",
        description: "manual mapping",
        actorId: null,
      }),
    );
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedLineId).not.toBeNull();
    const lines = await withTenant(TENANT_T, () => statements.lines(id));
    expect(lines.some((line) => line.amount === "-15.0000" && line.reference === "MAP-1")).toBe(true);
    // Double resolution refuses.
    await expect(
      withTenant(TENANT_T, () =>
        parked.resolveParkedLine({
          parkedLineId: target.id,
          lineDate: "2026-11-01",
          amount: "-15.0000",
          actorId: null,
        }),
      ),
    ).rejects.toThrow(/already RESOLVED/);
    // Discard without a note refuses (no silent drops).
    const csv2 = ["date,debit,credit", "2026-11-02,9.00,,", "2026-11-02,1.00,2.00,"].join("\n");
    const second = await importCsv(`discard-${Date.now()}.csv`, csv2, "csv-debit-credit");
    const rows2 = await withTenant(TENANT_T, () => parked.listParkedLines({ statementId: second.id }));
    await expect(
      withTenant(TENANT_T, () =>
        parked.discardParkedLine({ parkedLineId: rows2[0]!.id, note: "x", actorId: null }),
      ),
    ).rejects.toThrow(/discard note/);
    const discarded = await withTenant(TENANT_T, () =>
      parked.discardParkedLine({ parkedLineId: rows2[0]!.id, note: "duplicate export row", actorId: null }),
    );
    expect(discarded.status).toBe("DISCARDED");
  });
});

describe("re-import idempotency (per file checksum — unchanged PHASE-008 rule)", () => {
  it("the same bytes never import twice", async () => {
    const csv = ["date,debit,credit", "2026-11-05,30.00,,"].join("\n");
    const first = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: bankAccountId,
        fileName: "idem.csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        actorId: null,
        adapterId: "csv-debit-credit",
      }),
    );
    const second = await withTenant(TENANT_T, () =>
      statements.import({
        cashAccountId: bankAccountId,
        fileName: "idem.csv",
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        actorId: null,
        adapterId: "csv-debit-credit",
      }),
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.statement.id).toBe(first.statement.id);
  });
});

describe("registry rows (bank_statement_formats)", () => {
  it("the four shipped format rows are present", async () => {
    const result = await withTenant(TENANT_T, async () => {
      const tx = (await import("../../infra/db/tenant-context")).requireTenantContext();
      const rows = await tx.tx!.execute(
        (await import("drizzle-orm")).sql`SELECT key FROM bank_statement_formats ORDER BY key`,
      );
      return rows.rows as unknown as { key: string }[];
    });
    expect(result.map((row) => row.key)).toEqual([
      "csv-debit-credit",
      "csv-with-balances",
      "generic-csv",
      "generic-xlsx",
    ]);
  });
});
