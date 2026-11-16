import { beforeAll, describe, expect, it } from "vitest";

import { TENANT_PAY, setupPayrollFixture, su, withTenant } from "./fixtures";
import { PitEngine } from "../../modules/payroll/application/pit-engine";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import { PitBracketSetInvalidError } from "../../modules/payroll/domain/statutory-errors";

/**
 * PHASE-046 (W-2, T-04) — the PIT engine's DB laws (§4): the marginal
 * fold over the spec's own VERIFIED synthetic bracket set (0% to 10k ·
 * 10% 10–30k · 20% above, allowance 5,000, per-dependent 1,000) — gross
 * 40,000 → taxable 35,000 → 3,000.0000; +2 dependents → 2,600.0000; the
 * zero band; the exemption override; the set-consistency refusal; the
 * no-bracket jurisdiction = zero PIT + the honest state (KSA);
 * REQUIRES_VERIFICATION brackets block typed (BR-085); rounding
 * residuals explicit in the breakdown.
 */

const audit = new AuditService(new DrizzleAuditStore());
const pit = new PitEngine(audit);

const ON_DATE = "2026-06-30";
const SYNTHETIC = "PIT-SYNTH"; // the spec's own VERIFIED set in jurisdiction ZP

beforeAll(async () => {
  await setupPayrollFixture();
  await withTenant(TENANT_PAY, () => materializeCanonicalStatutorySet());
  // The synthetic VERIFIED bracket set (0–10k @0% · 10–30k @10% · 30k+ @20%,
  // allowance 5,000, per-dependent 1,000) — superuser-seeded (the fixture
  // pattern); the 0089 VERIFIED⟺source CHECK requires the citation fields.
  const client = await su();
  for (const [sort, floor, ceiling, rate] of [
    [1, "0.0000", "10000.0000", "0.0000"],
    [2, "10000.0000", "30000.0000", "10.0000"],
    [3, "30000.0000", null, "20.0000"],
  ] as const) {
    await client.query(
      `INSERT INTO payroll_tax_brackets
         (id, tenant_id, jurisdiction_code, code, floor, ceiling, rate, sort,
          personal_allowance_default, per_dependent_allowance, effective_from, status,
          source_name, source_ref, verified_at)
       VALUES (gen_random_uuid(), $1, 'ZP', $2, $3, $4, $5, $6,
               5000.0000, 1000.0000, DATE '2020-01-01', 'VERIFIED',
               'The spec''s synthetic VERIFIED set (PHASE-046 §4)', 'the worked-example shape', now())
       ON CONFLICT DO NOTHING`,
      [TENANT_PAY, SYNTHETIC, floor, ceiling, rate, sort],
    );
  }
  // An INCONSISTENT set (a gap between the bands) in its OWN jurisdiction
  // (ZQ) for the typed refusal — never visible to the ZP resolution.
  for (const [sort, floor, ceiling, rate] of [
    [1, "0.0000", "10000.0000", "0.0000"],
    [2, "12000.0000", "30000.0000", "10.0000"], // a 2,000 gap — never tiles
  ] as const) {
    await client.query(
      `INSERT INTO payroll_tax_brackets
         (id, tenant_id, jurisdiction_code, code, floor, ceiling, rate, sort,
          personal_allowance_default, per_dependent_allowance, effective_from, status,
          source_name, source_ref, verified_at)
       VALUES (gen_random_uuid(), $1, 'ZQ', $2, $3, $4, $5, $6,
               5000.0000, 1000.0000, DATE '2020-01-01', 'VERIFIED',
               'The spec''s inconsistent set (PHASE-046 §4)', 'the gap shape', now())
       ON CONFLICT DO NOTHING`,
      [TENANT_PAY, "PIT-GAP", floor, ceiling, rate, sort],
    );
  }
  await client.end();
});

describe("PHASE-046 T-04 — the PIT engine", () => {
  it("(a) THE WORKED EXAMPLE — gross 40,000 → taxable 35,000 → 3,000.0000 (the zero band + both marginal slices)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const result = await pit.computeForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000b1",
        gross: "40000.0000",
        onDate: ON_DATE,
        jurisdictionCode: "ZP",
      });
      expect(result.noBracketState).toBe(false);
      expect(result.exemptions!.taxable).toBe("35000.0000");
      expect(result.tax).toBe("3000.0000");
      expect(result.slices).toHaveLength(3);
      expect(result.slices[0]).toMatchObject({ slice: "10000.0000", amount: "0.0000" });
      expect(result.slices[1]).toMatchObject({ slice: "20000.0000", amount: "2000.0000" });
      expect(result.slices[2]).toMatchObject({ slice: "5000.0000", amount: "1000.0000" });
      expect(result.residualNote).toContain("no absorbed residual");
    });
  });

  it("(b) +2 DEPENDENTS → taxable 33,000 → 2,600.0000 (the per-dependent allowance)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const result = await pit.computeForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000b2",
        gross: "40000.0000",
        pitExemptions: { dependents: "2" },
        onDate: ON_DATE,
        jurisdictionCode: "ZP",
      });
      expect(result.exemptions!.dependentAllowance).toBe("2000.0000");
      expect(result.exemptions!.taxable).toBe("33000.0000");
      expect(result.tax).toBe("2600.0000");
    });
  });

  it("(c) THE EXEMPTION OVERRIDE — the employee's personal allowance replaces the set default; the zero band prices zero", async () => {
    await withTenant(TENANT_PAY, async () => {
      const overridden = await pit.computeForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000b3",
        gross: "40000.0000",
        pitExemptions: { personalAllowance: "8000.0000" },
        onDate: ON_DATE,
        jurisdictionCode: "ZP",
      });
      expect(overridden.exemptions!.personalAllowance).toBe("8000.0000");
      expect(overridden.exemptions!.taxable).toBe("32000.0000");
      expect(overridden.tax).toBe("2400.0000"); // 2,000 + 10% × 20,000 + 20% × 2,000

      const zeroBand = await pit.computeForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000b4",
        gross: "8000.0000",
        onDate: ON_DATE,
        jurisdictionCode: "ZP",
      });
      expect(zeroBand.tax).toBe("0.0000");
      expect(zeroBand.slices).toHaveLength(1);
      expect(zeroBand.slices[0]!.amount).toBe("0.0000");
    });
  });

  it("(d) THE SET-CONSISTENCY REFUSAL — a gapped set is the typed PitBracketSetInvalidError (never a partial fold)", async () => {
    await withTenant(TENANT_PAY, async () => {
      // The consistent ZP set resolves (already proven by (a)–(c)); the
      // gapped ZQ set throws typed — the D-03 SET-CONSISTENT law.
      await expect(pit.resolveSets({ jurisdictionCode: "ZQ", onDate: ON_DATE })).rejects.toBeInstanceOf(
        PitBracketSetInvalidError,
      );
      await expect(
        pit.computeForEmployee({
          employeeId: "00000000-0000-4000-8000-0000000000b5",
          gross: "40000.0000",
          onDate: ON_DATE,
          jurisdictionCode: "ZQ",
        }),
      ).rejects.toBeInstanceOf(PitBracketSetInvalidError);
    });
  });

  it("(e) THE HONEST NO-BRACKET STATE — the KSA jurisdiction computes ZERO PIT and says so", async () => {
    await withTenant(TENANT_PAY, async () => {
      const result = await pit.computeForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000b6",
        gross: "40000.0000",
        onDate: ON_DATE,
        jurisdictionCode: "SA",
      });
      expect(result.noBracketState).toBe(true);
      expect(result.bracketSet).toBeNull();
      expect(result.tax).toBe("0.0000");
      expect(result.residualNote).toContain("no employee PIT");
    });
  });

  it("(f) BR-085 — the AE placeholder brackets refuse typed (the blocked state, never a guessed rate)", async () => {
    await withTenant(TENANT_PAY, async () => {
      await expect(
        pit.computeForEmployee({
          employeeId: "00000000-0000-4000-8000-0000000000b7",
          gross: "40000.0000",
          onDate: ON_DATE,
          jurisdictionCode: "AE",
        }),
      ).rejects.toMatchObject({ code: "STATUTORY_REQUIRES_VERIFICATION" });
    });
  });
});
