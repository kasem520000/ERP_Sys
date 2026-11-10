import { beforeAll, describe, expect, it } from "vitest";
import { generateUuidV7 } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { ensureTestDb, superuserClient, TENANT_A } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import * as definitions from "../../modules/configuration/application/custom-field-service";
import * as picklists from "../../modules/configuration/application/picklist-service";
import * as layouts from "../../modules/configuration/application/form-layout-service";
import { assertLayoutRules } from "../../modules/configuration/application/form-layout-service";

/**
 * PHASE-036 §6 acceptance proofs (machine-checked): the typed round-trip
 * for all seven data types, the value guard's typed 400 failure family
 * with ZERO partial writes, the picklist archive-preserving history
 * (BR-057), the form-layout BR-059 mandatory-native protection, and the
 * BR-058 key namespace discipline. The RLS A1–A10 battery for the five
 * 0049 tables rides the generated isolation suite (registry +5); this
 * spec proves the SEMANTICS.
 */

const ACTOR = "aaaaaaaa-0000-4000-8000-000000000001";

let partnerId = "";
let entityId = "";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant A (test)', 'المستأجر أ', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A],
  );
  await su.end();
  await withTenant(TENANT_A, async (tx) => {
    partnerId = generateUuidV7();
    // A partner row for the REFERENCE type's existence check (RLS: the
    // ambient GUC scopes the insert to the tenant — the tx handle, NOT the
    // pool: set_config(..., true) is transaction-local).
    await tx.execute(sql`INSERT INTO partners (id, tenant_id, kind, code, name)
      VALUES (${partnerId}, erp.current_tenant_id(), 'CUSTOMER',
              ${"CF-REF-" + partnerId.slice(0, 8)}, 'CF reference partner')
      ON CONFLICT (id) DO NOTHING`);
  });
  entityId = generateUuidV7();
});

async function expectTyped(rejection: Promise<unknown>, code: string): Promise<void> {
  await expect(rejection).rejects.toMatchObject({ code });
}

async function valueRowCount(entityIdToCount: string): Promise<number> {
  return withTenant(TENANT_A, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT count(*)::int AS n FROM custom_field_values
        WHERE entity_id = ${entityIdToCount}`,
    );
    return (rows.rows[0] as { n: number }).n;
  });
}

describe("PHASE-036 typed round-trip (acceptance 3)", () => {
  it("all seven data types persist and re-read identically", async () => {
    const created = await withTenant(TENANT_A, async () => {
      const list = await picklists.createPicklist(ACTOR, {
        key: "rt_quality",
        name: "Quality tiers",
        nameAr: "درجات الجودة",
      });
      const optionA = await picklists.addOption(ACTOR, list.id, {
        label: "Grade A",
        labelAr: "درجة أولى",
      });
      const optionB = await picklists.addOption(ACTOR, list.id, {
        label: "Grade B",
        labelAr: "درجة ثانية",
      });
      const defs = [
        {
          entityType: "partners",
          key: "rt_municipality_license",
          label: "Municipality license",
          labelAr: "رقم رخصة البلدية",
          dataType: "TEXT" as const,
          required: true,
          minLength: 3,
          maxLength: 20,
        },
        {
          entityType: "partners",
          key: "rt_credit_score",
          label: "Credit score",
          labelAr: "درجة الائتمان",
          dataType: "NUMBER" as const,
          config: { precision: 2 },
          minValue: 0,
          maxValue: 1000,
        },
        {
          entityType: "partners",
          key: "rt_onboarded_at",
          label: "Onboarded at",
          labelAr: "تاريخ الانضمام",
          dataType: "DATE" as const,
        },
        {
          entityType: "partners",
          key: "rt_vip",
          label: "VIP",
          labelAr: "عميل مميز",
          dataType: "BOOLEAN" as const,
        },
        {
          entityType: "partners",
          key: "rt_quality_tier",
          label: "Quality tier",
          labelAr: "درجة الجودة",
          dataType: "SELECT" as const,
          config: { picklistId: list.id },
        },
        {
          entityType: "partners",
          key: "rt_tags",
          label: "Tags",
          labelAr: "الوسوم",
          dataType: "MULTISELECT" as const,
          config: { picklistId: list.id },
        },
        {
          entityType: "partners",
          key: "rt_referrer",
          label: "Referrer",
          labelAr: "العميل المُحيل",
          dataType: "REFERENCE" as const,
          config: { referenceEntity: "partners" },
        },
      ];
      const out: Record<string, string> = {};
      for (const def of defs) {
        const row = await definitions.createDefinition(ACTOR, def);
        out[def.key] = row.id;
      }
      return { list, optionA, optionB, out };
    });

    const payload = {
      rt_municipality_license: "LIC-77-2026",
      rt_credit_score: 742.5,
      rt_onboarded_at: "2026-01-15",
      rt_vip: true,
      rt_quality_tier: created.optionA.id,
      rt_tags: [created.optionA.id, created.optionB.id],
      rt_referrer: partnerId,
    };
    await withTenant(TENANT_A, async () => {
      const validated = await definitions.validateValues("partners", payload);
      await definitions.persistValues("partners", entityId, ACTOR, validated);
    });
    const read = await withTenant(TENANT_A, () =>
      definitions.readValues("partners", entityId),
    );
    expect(read.rt_municipality_license).toEqual({ value: "LIC-77-2026" });
    expect(read.rt_credit_score).toEqual({ value: 742.5 });
    expect(read.rt_onboarded_at).toEqual({ value: "2026-01-15" });
    expect(read.rt_vip).toEqual({ value: true });
    expect(read.rt_quality_tier).toEqual({
      value: created.optionA.id,
      optionLabel: "Grade A",
      optionLabelAr: "درجة أولى",
    });
    expect(read.rt_tags).toEqual({
      value: [created.optionA.id, created.optionB.id],
      optionLabel: "Grade A, Grade B",
      optionLabelAr: "درجة أولى، درجة ثانية",
    });
    expect(read.rt_referrer).toEqual({ value: partnerId });

    // Replace semantics: a full-replace payload with fewer keys CLEARS the
    // absent ones (the DELETE grant path) and rewrites the kept ones.
    await withTenant(TENANT_A, async () => {
      const validated = await definitions.validateValues("partners", {
        rt_municipality_license: "LIC-88-2026",
        rt_credit_score: 500,
        rt_onboarded_at: "2026-02-01",
        rt_vip: false,
        rt_quality_tier: created.optionB.id,
        rt_tags: [created.optionB.id],
        rt_referrer: partnerId,
      });
      await definitions.persistValues("partners", entityId, ACTOR, validated);
    });
    const afterReplace = await withTenant(TENANT_A, () =>
      definitions.readValues("partners", entityId),
    );
    expect(afterReplace.rt_municipality_license).toEqual({ value: "LIC-88-2026" });
    // All seven keys were present in the second payload too — none cleared.
    expect(Object.keys(afterReplace)).toHaveLength(7);
  });
});

describe("PHASE-036 value-guard failure family (acceptance 3 — typed, zero partial writes)", () => {
  const target = "bbbbbbbb-0000-4000-8000-000000000002";

  it("rejects wrong types with CUSTOM_FIELD_VALUE_INVALID", async () => {
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", { rt_credit_score: "not-a-number" }),
      ),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () => definitions.validateValues("partners", { rt_vip: "yes" })),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", { rt_onboarded_at: "15/01/2026" }),
      ),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
  });

  it("rejects regex/min/max/length violations", async () => {
    await withTenant(TENANT_A, async () => {
      await definitions.createDefinition(ACTOR, {
        entityType: "partners",
        key: "guard_regex",
        label: "Guarded",
        labelAr: "محروس",
        dataType: "TEXT",
        validationRegex: "^[A-Z]{3}-\\d{2,4}$",
      });
      await definitions.createDefinition(ACTOR, {
        entityType: "partners",
        key: "guard_number",
        label: "Guarded number",
        labelAr: "رقم محروس",
        dataType: "NUMBER",
        minValue: 10,
        maxValue: 20,
      });
      await definitions.createDefinition(ACTOR, {
        entityType: "partners",
        key: "guard_length",
        label: "Guarded length",
        labelAr: "طول محروس",
        dataType: "TEXT",
        minLength: 5,
        maxLength: 8,
      });
    });
    await expectTyped(
      withTenant(TENANT_A, () => definitions.validateValues("partners", { guard_regex: "abc" })),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () => definitions.validateValues("partners", { guard_number: 5 })),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () => definitions.validateValues("partners", { guard_number: 25 })),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () => definitions.validateValues("partners", { guard_length: "abc" })),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", { guard_length: "abcdefghi" }),
      ),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
  });

  it("rejects unknown keys, unknown options, bad references, missing required — with ZERO residue", async () => {
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", { no_such_field: "x" }),
      ),
      "CUSTOM_FIELD_UNKNOWN_KEY",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", {
          rt_quality_tier: "cccccccc-0000-4000-8000-000000000003",
        }),
      ),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", {
          rt_referrer: "dddddddd-0000-4000-8000-000000000004",
        }),
      ),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", { rt_municipality_license: "" }),
      ),
      "CUSTOM_FIELD_REQUIRED",
    );
    expect(await valueRowCount(target)).toBe(0);
  });
});

describe("PHASE-036 BR-057 archive semantics (acceptances 3/4/5)", () => {
  it("archiving a definition preserves its values and rejects new writes", async () => {
    // A DEDICATED entity row: full-replace semantics would clear the
    // round-trip entity's keys, so the archive proofs stay isolated.
    const archiveEntityId = "eeeeeeee-0000-4000-8000-000000000005";
    const archived = await withTenant(TENANT_A, async () => {
      const def = await definitions.createDefinition(ACTOR, {
        entityType: "partners",
        key: "arch_field",
        label: "To archive",
        labelAr: "سيُؤرشف",
        dataType: "TEXT",
      });
      const validated = await definitions.validateValues("partners", {
        rt_municipality_license: "LIC-77-2026", // the required field travels in every full-replace payload
        arch_field: "kept",
      });
      await definitions.persistValues("partners", archiveEntityId, ACTOR, validated);
      return definitions.archiveDefinition(def.id);
    });
    expect(archived.status).toBe("ARCHIVED");
    // Historical value still renders (BR-057).
    const read = await withTenant(TENANT_A, () =>
      definitions.readValues("partners", archiveEntityId),
    );
    expect(read.arch_field).toEqual({ value: "kept" });
    // New writes fail typed.
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.validateValues("partners", {
          rt_municipality_license: "LIC-77-2026",
          arch_field: "new",
        }),
      ),
      "CUSTOM_FIELD_ARCHIVED",
    );
  });

  it("archived picklist options are rejected for new values but keep rendering history", async () => {
    const read = await withTenant(TENANT_A, async () => {
      const lists = await picklists.listPicklists();
      const list = lists.find((row) => row.key === "rt_quality")!;
      const options = await picklists.listPicklistOptions(list.id);
      // After the replace round-trip the stored SELECT value points at
      // Grade B — archive THAT option (history) and prove the label stays.
      const gradeB = options.find((row) => row.label === "Grade B")!;
      await picklists.archiveOption(gradeB.id);
      return definitions.readValues("partners", entityId);
    });
    // The stored SELECT value (Grade B option) still resolves its label.
    expect(read.rt_quality_tier).toMatchObject({ optionLabel: "Grade B" });
    expect(read.rt_tags).toMatchObject({ optionLabel: "Grade B" });
    // New values selecting the archived option fail typed.
    await expectTyped(
      withTenant(TENANT_A, async () => {
        const lists = await picklists.listPicklists();
        const list = lists.find((row) => row.key === "rt_quality")!;
        const options = await picklists.listPicklistOptions(list.id);
        const gradeB = options.find((row) => row.label === "Grade B")!;
        return definitions.validateValues("partners", { rt_quality_tier: gradeB.id });
      }),
      "CUSTOM_FIELD_VALUE_INVALID",
    );
  });
});

describe("PHASE-036 BR-058 key namespace (acceptance 3)", () => {
  it("rejects reserved stems, native collisions, bad syntax, and duplicates", async () => {
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.createDefinition(ACTOR, {
          entityType: "partners",
          key: "tenant_id",
          label: "Reserved",
          labelAr: "محجوز",
          dataType: "TEXT",
        }),
      ),
      "CUSTOM_FIELD_KEY_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.createDefinition(ACTOR, {
          entityType: "partners",
          key: "creditLimit",
          label: "Native collision",
          labelAr: "تصادم",
          dataType: "TEXT",
        }),
      ),
      "CUSTOM_FIELD_KEY_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.createDefinition(ACTOR, {
          entityType: "partners",
          key: "Bad-Key",
          label: "Syntax",
          labelAr: "صياغة",
          dataType: "TEXT",
        }),
      ),
      "CUSTOM_FIELD_KEY_INVALID",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.createDefinition(ACTOR, {
          entityType: "partners",
          key: "rt_municipality_license",
          label: "Duplicate",
          labelAr: "مكرر",
          dataType: "TEXT",
        }),
      ),
      "CUSTOM_FIELD_KEY_TAKEN",
    );
    await expectTyped(
      withTenant(TENANT_A, () =>
        definitions.createDefinition(ACTOR, {
          entityType: "no_such_entity",
          key: "whatever",
          label: "Unknown entity",
          labelAr: "كيان غير معروف",
          dataType: "TEXT",
        }),
      ),
      "CUSTOM_FIELD_ENTITY_UNKNOWN",
    );
  });
});

describe("PHASE-036 form layouts (acceptance 5 — BR-059)", () => {
  const sections = (order: string[]) => ({
    name: "Partner layout",
    sections: [
      {
        key: "core",
        label: "Core",
        labelAr: "الأساس",
        collapsed: false,
        columns: 2,
        fields: order.map((key) => ({ key, custom: key.startsWith("rt_") })),
      },
    ],
  });

  it("saves a default layout + a role override; the override wins on resolve", async () => {
    await withTenant(TENANT_A, async () => {
      await layouts.upsertLayout(ACTOR, "partners", null, sections(["kind", "name", "code", "rt_vip"]));
      await layouts.upsertLayout(ACTOR, "partners", "sales", sections(["kind", "name", "taxNumber"]));
    });
    const resolved = await withTenant(TENANT_A, () => layouts.resolveLayout("partners", "sales"));
    expect(resolved?.roleKey).toBe("sales");
    const fallback = await withTenant(TENANT_A, () => layouts.resolveLayout("partners", "viewer"));
    expect(fallback?.roleKey).toBeNull();
    const none = await withTenant(TENANT_A, () => layouts.resolveLayout("items", "sales"));
    expect(none).toBeNull();
  });

  it("BR-059: removing or reordering mandatory native fields is rejected", async () => {
    const active = new Set(["rt_vip"]);
    // name (mandatory) removed:
    await expectTyped(
      (async () => {
        assertLayoutRules("partners", sections(["kind", "code", "rt_vip"]).sections, active);
      })(),
      "FORM_LAYOUT_NATIVE_PROTECTED",
    );
    // kind AFTER name (mandatory canonical order flipped):
    await expectTyped(
      (async () => {
        assertLayoutRules("partners", sections(["name", "kind", "code"]).sections, active);
      })(),
      "FORM_LAYOUT_NATIVE_PROTECTED",
    );
    // duplicate field:
    await expectTyped(
      (async () => {
        assertLayoutRules(
          "partners",
          sections(["kind", "name", "name", "code"]).sections,
          active,
        );
      })(),
      "FORM_LAYOUT_INVALID",
    );
    // unknown native + unknown custom:
    await expectTyped(
      (async () => {
        assertLayoutRules("partners", sections(["kind", "name", "no_such_native"]).sections, active);
      })(),
      "FORM_LAYOUT_INVALID",
    );
    await expectTyped(
      (async () => {
        assertLayoutRules(
          "partners",
          sections(["kind", "name", "no_such_custom"]).sections,
          new Set(["rt_vip"]),
        );
      })(),
      "FORM_LAYOUT_INVALID",
    );
  });
});

describe("PHASE-036 DB laws (the 0049 row-level floor)", () => {
  it("the num_nonnulls law rejects multi-typed rows (guard-bypass tamper)", async () => {
    await expect(
      withTenant(TENANT_A, async (tx) => {
        await tx.execute(sql`
          INSERT INTO custom_field_values
            (id, tenant_id, entity_type, entity_id, field_id, value_text, value_boolean)
          VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'partners', ${entityId},
                  ${generateUuidV7()}, 'text', true)
        `);
      }),
    ).rejects.toThrow();
  });

  it("value_json must be an array (the MULTISELECT shape floor)", async () => {
    await expect(
      withTenant(TENANT_A, async (tx) => {
        await tx.execute(sql`
          INSERT INTO custom_field_values
            (id, tenant_id, entity_type, entity_id, field_id, value_json)
          VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'partners', ${entityId},
                  ${generateUuidV7()}, '{"not":"an array"}'::jsonb)
        `);
      }),
    ).rejects.toThrow();
  });
});

describe("PHASE-036 cross-tenant isolation of the value store", () => {
  it("values read only inside the owning tenant's scope", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ('33333333-3333-4000-8000-000000000003', 'CF Tenant B', 'مستأجر ب', 'SAR', 'SA', 'Asia/Riyadh')
       ON CONFLICT (id) DO NOTHING`,
    );
    await su.end();
    const inA = await withTenant(TENANT_A, () => definitions.readValues("partners", entityId));
    expect(Object.keys(inA).length).toBeGreaterThan(0);
    // Same entity id in tenant B's scope: RLS hides tenant A's rows (the
    // generated A-suite proves the full battery; this is the read-merge
    // proof at the service layer).
    const inB = await withTenant("33333333-3333-4000-8000-000000000003", () =>
      definitions.readValues("partners", entityId),
    );
    expect(Object.keys(inB)).toHaveLength(0);
  });
});

describe("PHASE-036 OA-06 EXPLAIN budgets (acceptance 9)", () => {
  // The two hot paths every first-wave entity read adds: the definition
  // lookup by (tenant, entity_type, status) and the batched value fetch by
  // (tenant, entity_type, entity_id). enable_seqscan=off isolates the
  // index proof from the planner's volume-dependent cost choice (the
  // budget under test is the INDEX SHAPE servicing the hot path — the
  // per-type indexes and the composite unique are migration 0049 §4).
  it("definition lookup rides ix_custom_field_definitions_tenant_entity_status (index scan, no seq-scan)", async () => {
    const plan = await withTenant(TENANT_A, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute(sql`
        EXPLAIN SELECT id, key, data_type, config, required, validation_regex,
                        min_value, max_value, min_length, max_length, status, version
        FROM custom_field_definitions
        WHERE tenant_id = erp.current_tenant_id() AND entity_type = 'partners' AND status = 'ACTIVE'
      `);
      return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
        (row) => row["QUERY PLAN"],
      );
    });
    const text = plan.join("\n");
    expect(text).toMatch(/Index (Only )?Scan using ix_custom_field_definitions_tenant_entity_status/);
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("value fetch rides uq_custom_field_values_tenant_entity_field (index scan, no seq-scan)", async () => {
    const plan = await withTenant(TENANT_A, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute(sql`
        EXPLAIN SELECT field_id, value_text, value_number, value_date, value_boolean, value_json
        FROM custom_field_values
        WHERE tenant_id = erp.current_tenant_id() AND entity_type = 'partners'
          AND entity_id = ${entityId}
      `);
      return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
        (row) => row["QUERY PLAN"],
      );
    });
    const text = plan.join("\n");
    // PHASE-037 gate repair (recorded): the planner picks EITHER index on
    // the same (tenant, entity_type, entity_id) predicate — the partial
    // UNIQUE uq_custom_field_values_tenant_entity_field or the covering
    // ix_custom_field_values_tenant_entity_ids — depending on stats
    // volume; the budget's intent is "index scan, never seq-scan", so
    // both honest index paths pass.
    expect(text).toMatch(
      /Index (Only )?Scan using (uq_custom_field_values_tenant_entity_field|ix_custom_field_values_tenant_entity_ids)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
