import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSnapshot,
  canonicalize,
  snapshotContentHash,
  SNAPSHOT_SCHEMA_VERSION,
  type ConsolidationSnapshot,
} from "../application/snapshot";
import { computeConsolidatedLines, assertInv026 } from "../application/consolidation-math";

/**
 * PHASE-034 T6/T12 · the snapshot unit suite: immutable, versioned, and
 * DETERMINISTIC (same inputs ⇒ byte-identical output — the phase §6 pin);
 * the canonical serialization is key-order-stable (byte-level rebuilds);
 * the content hash makes tampering detectable; the T2 grant-scope hook
 * asserts the platform-plane reader grant's exact shape straight off the
 * migration SQL (SELECT-only, no writes, RLS untouched — the text-level
 * half of the isolation suite; the DB halves re-run on the live harness).
 */

const MIGRATION_PATH = join(
  process.cwd(),
  "migrations",
  "0041_consolidation.sql",
);

function fixtureSnapshot(): ConsolidationSnapshot {
  const members = [
    {
      memberTenantId: "01990000-0000-7000-8000-0000000000a1",
      memberName: null,
      ownershipPercent: "100.0000",
      includeFrom: null,
      baseCurrency: "SAR",
      appliedRates: {},
    },
    {
      memberTenantId: "01990000-0000-7000-8000-0000000000b2",
      memberName: "Entity B",
      ownershipPercent: "80.0000",
      includeFrom: "2026-06-01",
      baseCurrency: "USD",
      appliedRates: { USD: "3.75000000" },
    },
  ];
  const memberExtracts = [
    {
      memberTenantId: "01990000-0000-7000-8000-0000000000a1",
      accountCode: "1110",
      accountType: "ASSET",
      purposeKey: "CASH",
      amounts: { debit: "10000.0000", credit: "0.0000" },
    },
    {
      memberTenantId: "01990000-0000-7000-8000-0000000000b2",
      accountCode: "1110",
      accountType: "ASSET",
      purposeKey: "CASH",
      amounts: { debit: "3750.0000", credit: "0.0000" },
    },
  ];
  const eliminations = [
    {
      eliminationId: "01990000-0000-7000-8000-0000000000e3",
      eliminationNo: "EL-2026-000001",
      accountCode: "1130",
      purposeKey: "AR_CONTROL",
      amounts: { debit: "0.0000", credit: "500.0000" },
    },
    {
      eliminationId: "01990000-0000-7000-8000-0000000000e3",
      eliminationNo: "EL-2026-000001",
      accountCode: "2130",
      purposeKey: "AP_CONTROL",
      amounts: { debit: "500.0000", credit: "0.0000" },
    },
  ];
  const consolidated = computeConsolidatedLines(
    memberExtracts.map((line) => ({ ...line })),
    eliminations,
  );
  const inv026 = assertInv026({
    runId: "01990000-0000-7000-8000-0000000000r4",
    consolidated,
    members: memberExtracts,
    eliminations,
  });
  return buildSnapshot({
    runId: "01990000-0000-7000-8000-0000000000r4",
    groupId: "01990000-0000-7000-8000-0000000000g5",
    fiscalPeriodId: "01990000-0000-7000-8000-0000000000p6",
    periodEndDate: "2026-11-30",
    group: {
      groupId: "01990000-0000-7000-8000-0000000000g5",
      name: "Gulf Trading Group",
      nameAr: "مجموعة الخليج التجارية",
      baseCurrency: "SAR",
      fxTranslationMethod: "CLOSING_RATE",
    },
    members,
    memberExtracts,
    eliminations,
    consolidated,
    inv026: { status: inv026.status, compared: inv026.compared, brokenLines: inv026.brokenLines },
  });
}

describe("the run snapshot (T6 — immutable, versioned, deterministic)", () => {
  it("carries the schema version and sorts its collections deterministically", () => {
    const snapshot = fixtureSnapshot();
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.members.map((member) => member.memberTenantId)).toEqual([
      "01990000-0000-7000-8000-0000000000a1",
      "01990000-0000-7000-8000-0000000000b2",
    ]);
    expect(snapshot.consolidated.map((line) => line.accountCode)).toEqual([
      "1110",
      "1130",
      "2130",
    ]);
  });

  it("same inputs ⇒ byte-identical canonical serialization (determinism pin)", () => {
    const first = canonicalize(fixtureSnapshot());
    const second = canonicalize(fixtureSnapshot());
    expect(first).toBe(second);
    // Key order is canonical (sorted) regardless of construction order.
    expect(first.indexOf("\"accountCode\"")).toBeGreaterThan(-1);
    expect(first).not.toContain("undefined");
  });

  it("the content hash is stable for identical snapshots and shifts on any tamper", () => {
    const base = fixtureSnapshot();
    const rebuilt = fixtureSnapshot();
    expect(snapshotContentHash(base)).toBe(snapshotContentHash(rebuilt));
    const tampered: ConsolidationSnapshot = {
      ...base,
      consolidated: base.consolidated.map((line) =>
        line.accountCode === "1110"
          ? { ...line, amounts: { ...line.amounts, debit: "99999.0000" } }
          : line,
      ),
    };
    expect(snapshotContentHash(tampered)).not.toBe(snapshotContentHash(base));
  });

  it("the INV-026 result is recorded in the snapshot at build time (PASS on the fixture)", () => {
    const snapshot = fixtureSnapshot();
    expect(snapshot.inv026.status).toBe("PASS");
    // And the render-time re-check over the SAME snapshot components
    // reproduces the PASS (the contracts' line-by-line gate).
    const recheck = assertInv026({
      runId: snapshot.runId,
      consolidated: snapshot.consolidated,
      members: snapshot.memberExtracts,
      eliminations: snapshot.eliminations,
    });
    expect(recheck.status).toBe("PASS");
  });
});

describe("T2 · the platform-plane reader grant's scope (asserted off the migration SQL)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("creates the reader role NOLOGIN + BYPASSRLS (disabled-by-default, the 0003 envelope)", () => {
    expect(sql).toContain("CREATE ROLE erp_consolidation_reader NOLOGIN BYPASSRLS");
    expect(sql).toContain("GRANT erp_consolidation_reader TO erp_migrate");
  });

  it("grants SELECT-only on exactly the member GL read models + the consolidation tables", () => {
    // The exact grant statements (the scope IS the list).
    expect(sql).toMatch(
      /GRANT SELECT ON "journal_entries", "journal_lines", "accounts", "account_purposes",\n  "fiscal_periods", "partner_subledger_entries", "partners" TO erp_consolidation_reader;/,
    );
    expect(sql).toMatch(
      /GRANT SELECT ON "consolidation_groups", "group_entities", "elimination_entries",\n  "consolidation_runs" TO erp_consolidation_reader;/,
    );
  });

  it("NEVER grants INSERT/UPDATE/DELETE to the reader role (zero cross-tenant writes — INV-026's DB half)", () => {
    const readerGrants = sql
      .split("\n")
      .filter((line) => /TO erp_consolidation_reader/.test(line))
      .join("\n");
    expect(readerGrants).not.toMatch(/GRANT\s+INSERT/i);
    expect(readerGrants).not.toMatch(/GRANT\s+UPDATE/i);
    expect(readerGrants).not.toMatch(/GRANT\s+DELETE/i);
    expect(readerGrants).not.toMatch(/GRANT\s+ALL/i);
  });

  it("the reader functions are SECURITY DEFINER with PUBLIC revoked, erp_app granted", () => {
    for (const fn of [
      "erp.consolidation_read_member_gl",
      "erp.consolidation_member_periods",
      "erp.consolidation_read_member_ar_ap",
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${fn}(`);
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${fn}\\([^)]*\\) FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}\\([^)]*\\) TO erp_app;`));
    }
    expect(sql).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER\nSET search_path = public, erp/);
  });

  it("the RLS policy set is untouched on member tables (no new policies, no drops — the canary contract)", () => {
    // The ONLY apply_tenant_policy calls target the four NEW tables.
    const policyTargets = [...sql.matchAll(/erp\.apply_tenant_policy\('([^']+)'\)/g)].map(
      (match) => match[1]!,
    );
    expect(policyTargets.sort()).toEqual([
      '"consolidation_groups"',
      '"consolidation_runs"',
      '"elimination_entries"',
      '"group_entities"',
    ]);
    // No DROP POLICY / CREATE POLICY touches any member-tenant table (the
    // purge_path policies are scoped to the four NEW tables only — the
    // FOREACH array is exactly the four, whitespace-tolerant).
    expect(sql).toMatch(
      /ARRAY\s*\['consolidation_groups',\s*'group_entities',\s*'elimination_entries',\s*'consolidation_runs'\]/,
    );
    expect(sql).not.toMatch(/DROP POLICY[^\n]*(journal_lines|journal_entries|accounts|fiscal_periods|partner_subledger|partners)/i);
    expect(sql).not.toMatch(/CREATE POLICY[^\n]*(journal_lines|journal_entries|accounts|fiscal_periods|partner_subledger|partners)/i);
  });

  it("BR-056 is re-verified in the reader function (SOFT_CLOSED/LOCKED pass, OPEN never does)", () => {
    expect(sql).toContain("fp.status IN ('SOFT_CLOSED', 'LOCKED')");
    expect(sql).toContain("je.source_type <> 'consolidation_elimination'");
  });

  it("the COMPLETED-snapshot immutability guard + the CHECK shapes land", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION erp.consolidation_runs_guard()");
    expect(sql).toMatch(
      /ck_consolidation_runs_snapshot_shape CHECK \(\s*\("status" = 'COMPLETED' AND "snapshot" IS NOT NULL/,
    );
  });

  it("seeds the §3.15 permission keys + the five feature-key plan grants + CoA 3220", () => {
    for (const key of [
      "consolidation.groups.manage",
      "consolidation.eliminations.create",
      "consolidation.eliminations.post",
      "consolidation.runs.execute",
      "consolidation.reports.view",
    ]) {
      expect(sql).toContain(`('${key}', 'consolidation',`);
    }
    expect(sql).toMatch(/ARRAY\['consolidation\.groups', 'consolidation\.eliminations',/);
    expect(sql).toContain("'3220', 'Consolidation adjustments'");
    expect(sql).toContain("('schema_version', 41)");
  });
});
