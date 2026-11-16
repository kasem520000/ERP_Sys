import { beforeAll, describe, expect, it } from "vitest";

import { P_ACTOR, TENANT_PAY, setupPayrollFixture, su, withTenant } from "./fixtures";
import { StatutoryProfileService } from "../../modules/payroll/application/statutory-profile-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import {
  StatutoryAlreadyVerifiedError,
  StatutoryProfileNotFoundError,
  StatutoryVerifySoDError,
} from "../../modules/payroll/domain/statutory-errors";

/**
 * PHASE-046 (W-2, T-03) — the statutory profile service's DB laws (§4):
 * the effective-dated row-set resolution (the date picks the set;
 * expired/future rows never match), the wage-base fold + BOTH cap shapes
 * over the seeded KSA GOSI schedule (the dual-cap law), the
 * CITIZEN/NON_CITIZEN/ALL resolution incl. the NULL-nationality
 * fail-closed warning, BR-085 both ways (the KSA fixture prices; the
 * AE/EG/JO blocked rows refuse typed + the audit event), and the verify
 * act (CAS + SoD + the audit trail). Zero residue on every refusal.
 *
 * Isolation: the dedicated PAY tenant (the payroll fixture's world); the
 * canonical statutory set materializes here (idempotent) — the seeded
 * GOSI rows carry the 0093 PwC citation records. No employees are
 * created (the resolution takes the employee's facts, not the row).
 */

const audit = new AuditService(new DrizzleAuditStore());
const statutory = new StatutoryProfileService(audit);

/** The KSA worked example: basic 10,000 + housing 2,000 (+ noise). */
const KSA_BASIC = "10000.0000";
const KSA_COMPONENTS = [
  { key: "HOUSING", amount: "2000.0000" },
  { key: "TRANSPORT", amount: "500.0000" },
] as const;

const ON_DATE = "2026-06-30";

beforeAll(async () => {
  await setupPayrollFixture();
  await withTenant(TENANT_PAY, () => materializeCanonicalStatutorySet());
});

/** Insert a spec-owned profile row (superuser — the fixture pattern). */
async function insertProfile(row: {
  code: string;
  jurisdictionCode: string;
  employeeRate?: string;
  employerRate?: string;
  baseMin?: string | null;
  baseMax?: string | null;
  appliesTo?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  status?: string;
  contributoryKeys?: string[];
  updatedBy?: string | null;
}): Promise<string> {
  const client = await su();
  const result = await client.query<{ id: string }>(
    `INSERT INTO statutory_contribution_profiles
       (id, tenant_id, jurisdiction_code, code, name, employee_rate, employer_rate, base_min, base_max,
        contributory_keys, applies_to, effective_from, effective_to, status, updated_by,
        source_name, source_ref, verified_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
             CASE WHEN $12 = 'VERIFIED' THEN 'The spec''s VERIFIED row (PHASE-046 §4)' ELSE NULL END,
             CASE WHEN $12 = 'VERIFIED' THEN 'the spec citation' ELSE NULL END,
             CASE WHEN $12 = 'VERIFIED' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      TENANT_PAY,
      row.jurisdictionCode,
      row.code,
      row.employeeRate ?? "0.0000",
      row.employerRate ?? "0.0000",
      row.baseMin ?? null,
      row.baseMax ?? null,
      JSON.stringify(row.contributoryKeys ?? ["HOUSING"]),
      row.appliesTo ?? "ALL",
      row.effectiveFrom ?? "2020-01-01",
      row.effectiveTo ?? null,
      row.status ?? "REQUIRES_VERIFICATION",
      row.updatedBy ?? null,
    ],
  );
  await client.end();
  return result.rows[0]!.id;
}

async function readAudit(action: string, entityId?: string): Promise<{ action: string; actor_id: string | null }[]> {
  const client = await su();
  const result = await client.query(
    `SELECT action, actor_id FROM audit_events
      WHERE tenant_id = $1 AND action = $2 AND ($3::uuid IS NULL OR entity_id = $3)
      ORDER BY at DESC LIMIT 5`,
    [TENANT_PAY, action, entityId ?? null],
  );
  await client.end();
  return result.rows as { action: string; actor_id: string | null }[];
}

describe("PHASE-046 T-03 — the statutory profile service", () => {
  it("(a) THE EFFECTIVE-DATED RESOLUTION — the date picks the set; expired, future, and retired rows never match or block", async () => {
    await withTenant(TENANT_PAY, async () => {
      await insertProfile({ code: "ZZ-OLD", jurisdictionCode: "ZZ", status: "VERIFIED", effectiveFrom: "2020-01-01", effectiveTo: "2025-12-31" });
      await insertProfile({ code: "ZZ-NEW", jurisdictionCode: "ZZ", status: "VERIFIED", effectiveFrom: "2026-01-01" });
      await insertProfile({ code: "ZZ-FUTURE", jurisdictionCode: "ZZ", status: "VERIFIED", effectiveFrom: "2027-01-01" });
      await insertProfile({ code: "ZZ-RETIRED", jurisdictionCode: "ZZ", status: "RETIRED", effectiveFrom: "2020-01-01" });

      const mid26 = await statutory.resolveSet({ jurisdictionCode: "ZZ", onDate: "2026-06-30" });
      expect(mid26.rows.map((row) => row.code).sort()).toEqual(["ZZ-NEW", "ZZ-RETIRED"]); // expired + future never match
      const mid25 = await statutory.resolveSet({ jurisdictionCode: "ZZ", onDate: "2025-06-30" });
      expect(mid25.rows.map((row) => row.code).sort()).toEqual(["ZZ-OLD", "ZZ-RETIRED"]);

      // A RETIRED row that matches the employee neither prices NOR blocks.
      const resolution = await statutory.resolveForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000aa",
        nationality: "SA",
        basic: KSA_BASIC,
        components: KSA_COMPONENTS,
        onDate: "2026-06-30",
        jurisdictionCode: "ZZ",
      });
      expect(resolution.contributions.map((row) => row.code)).toEqual(["ZZ-NEW"]);
    });
  });

  it("(b) THE KSA WORKED EXAMPLE — the seeded schedule prices the Saudi split exactly (base 12,000: employee 1,170.0000 / employer 1,410.0000)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const resolution = await statutory.resolveForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000aa",
        nationality: "SA",
        basic: KSA_BASIC,
        components: KSA_COMPONENTS,
        onDate: ON_DATE,
        jurisdictionCode: "SA",
      });
      expect(resolution.warnings).toHaveLength(0);
      expect(resolution.contributions).toHaveLength(3); // PENSION + SANED (CITIZEN) + OH (ALL)
      const byCode = new Map(resolution.contributions.map((row) => [row.code, row]));
      expect(byCode.get("GOSI-PENSION")).toMatchObject({
        wageBase: "12000.0000",
        clampedBase: "12000.0000",
        clampedBy: null,
        employeeAmount: "1080.0000",
        employerAmount: "1080.0000",
      });
      expect(byCode.get("GOSI-SANED")).toMatchObject({
        clampedBase: "12000.0000",
        employeeAmount: "90.0000",
        employerAmount: "90.0000",
      });
      expect(byCode.get("GOSI-OH")).toMatchObject({
        clampedBase: "12000.0000",
        employeeAmount: "0.0000",
        employerAmount: "240.0000",
      });
      expect(resolution.employeeTotal).toBe("1170.0000");
      expect(resolution.employerTotal).toBe("1410.0000"); // 1,080 + 90 + 240 — the owner's corrected total
    });
  });

  it("(c) THE DUAL-CAP CLAMP — base 50,000 clamps: pension/OH at 45,000, SANED at 15,000", async () => {
    await withTenant(TENANT_PAY, async () => {
      const resolution = await statutory.resolveForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000ab",
        nationality: "SA",
        basic: "45000.0000",
        components: [{ key: "HOUSING", amount: "5000.0000" }],
        onDate: ON_DATE,
        jurisdictionCode: "SA",
      });
      const byCode = new Map(resolution.contributions.map((row) => [row.code, row]));
      expect(byCode.get("GOSI-PENSION")).toMatchObject({ clampedBase: "45000.0000", clampedBy: "MAX", employeeAmount: "4050.0000" });
      expect(byCode.get("GOSI-SANED")).toMatchObject({ clampedBase: "15000.0000", clampedBy: "MAX", employeeAmount: "112.5000" });
      expect(byCode.get("GOSI-OH")).toMatchObject({ clampedBase: "45000.0000", clampedBy: "MAX", employerAmount: "900.0000" });
    });
  });

  it("(d) THE APPLIES-TO SPLIT — the non-Saudi arm is OH-only; NULL nationality fails closed with the explicit warning", async () => {
    await withTenant(TENANT_PAY, async () => {
      const nonSaudi = await statutory.resolveForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000ac",
        nationality: "EG",
        basic: KSA_BASIC,
        components: KSA_COMPONENTS,
        onDate: ON_DATE,
        jurisdictionCode: "SA",
      });
      expect(nonSaudi.contributions).toHaveLength(1); // the OH row (ALL) only
      expect(nonSaudi.contributions[0]).toMatchObject({ code: "GOSI-OH", employerAmount: "240.0000", employeeAmount: "0.0000" });
      expect(nonSaudi.employeeTotal).toBe("0.0000");
      expect(nonSaudi.employerTotal).toBe("240.0000");

      const nullNationality = await statutory.resolveForEmployee({
        employeeId: "00000000-0000-4000-8000-0000000000ad",
        nationality: null,
        basic: KSA_BASIC,
        components: KSA_COMPONENTS,
        onDate: ON_DATE,
        jurisdictionCode: "SA",
      });
      expect(nullNationality.contributions).toHaveLength(0); // fail-closed — NO guessed rate
      expect(nullNationality.warnings).toHaveLength(1);
      expect(nullNationality.warnings[0]!.code).toBe("unpricedNationality");
      expect(nullNationality.employeeTotal).toBe("0.0000");
      expect(nullNationality.employerTotal).toBe("0.0000");
    });
  });

  it("(e) BR-085 BOTH WAYS — the AE blocked row refuses typed with the audit event; zero residue; the KSA fixture prices", async () => {
    const client = await su();
    const before = await client.query(
      `SELECT id, status, source_name FROM statutory_contribution_profiles
        WHERE tenant_id = $1 AND jurisdiction_code = 'AE'`,
      [TENANT_PAY],
    );
    expect(before.rows).toHaveLength(1); // the 0092/0093 seeded placeholder
    await client.end();

    await withTenant(TENANT_PAY, async () => {
      await expect(
        statutory.resolveForEmployee({
          employeeId: "00000000-0000-4000-8000-0000000000ae",
          nationality: "AE",
          basic: KSA_BASIC,
          components: KSA_COMPONENTS,
          onDate: ON_DATE,
          jurisdictionCode: "AE",
        }),
      ).rejects.toMatchObject({ code: "STATUTORY_REQUIRES_VERIFICATION" });
    });

    // The refusal is AUDITED (the blocked-state surface — its OWN unit of
    // work, so the evidence survives the caller's rollback).
    const events = await readAudit("payroll.statutory_refused");
    expect(events[0]!.action).toBe("payroll.statutory_refused");

    // ZERO RESIDUE: the blocked row is unchanged.
    const client2 = await su();
    const after = await client2.query(
      `SELECT id, status, source_name FROM statutory_contribution_profiles
        WHERE tenant_id = $1 AND jurisdiction_code = 'AE'`,
      [TENANT_PAY],
    );
    await client2.end();
    expect(after.rows).toEqual(before.rows);
  });

  it("(f) THE VERIFY ACT — the CAS flips once, the SoD law refuses the last editor, the audit trail records the flip", async () => {
    const otherActor = "00000000-0000-4000-8000-0000000000ff";
    const profileId = await insertProfile({ code: "ZZ-VERIFY", jurisdictionCode: "ZZ", status: "REQUIRES_VERIFICATION", updatedBy: otherActor });
    await withTenant(TENANT_PAY, async () => {

      // The SoD law (D-10): the row's last editor cannot verify it.
      await expect(
        statutory.verify({ profileId, actorId: otherActor, sourceName: "The official schedule" }),
      ).rejects.toBeInstanceOf(StatutoryVerifySoDError);

      // A different actor flips it (the CAS) + the audit trail.
      const flipped = await statutory.verify({
        profileId,
        actorId: P_ACTOR,
        sourceName: "The official AE social-insurance schedule",
        sourceRef: "the spec's citation",
      });
      expect(flipped.status).toBe("VERIFIED");
      expect(flipped.verifiedBy).toBe(P_ACTOR);
      expect(flipped.sourceName).toBe("The official AE social-insurance schedule");

      // The CAS: the second verify is the typed 409 (one flip per row).
      await expect(
        statutory.verify({ profileId, actorId: P_ACTOR, sourceName: "again" }),
      ).rejects.toBeInstanceOf(StatutoryAlreadyVerifiedError);

      // A foreign/unknown id is the typed 404 (A7 parity).
      await expect(
        statutory.verify({
          profileId: "00000000-0000-4000-8000-00000000deaf",
          actorId: P_ACTOR,
          sourceName: "x",
        }),
      ).rejects.toBeInstanceOf(StatutoryProfileNotFoundError);
    });

    // The audit trail (committed with the verify's UoW).
    const events = await readAudit("payroll.statutory_verified", profileId);
    expect(events[0]).toMatchObject({ action: "payroll.statutory_verified", actor_id: P_ACTOR });
  });

  it("(g) the 0093 citation record rides the seeded rows — the PwC source is the seeded KSA citation", async () => {
    await withTenant(TENANT_PAY, async () => {
      const { rows } = await statutory.resolveSet({ jurisdictionCode: "SA", onDate: ON_DATE });
      const gosi = rows.filter((row) => row.code.startsWith("GOSI-"));
      expect(gosi).toHaveLength(3);
      for (const row of gosi) {
        expect(row.sourceName).toContain("PwC Worldwide Tax Summaries");
        expect(row.sourceName).toContain("https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes");
        expect(row.status).toBe("VERIFIED");
      }
      const saned = gosi.find((row) => row.code === "GOSI-SANED")!;
      expect(saned.reviewNote).toContain("does NOT state the SANED-specific 15,000 ceiling");
    });
  });
});
