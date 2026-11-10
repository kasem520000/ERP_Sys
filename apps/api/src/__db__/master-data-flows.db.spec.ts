import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  appClient,
  ensureTestDb,
  seedTenants,
  superuserClient,
  TENANT_A,
} from "./test-db";
import { closeDb } from "../infra/db/client";
import { withTenant } from "../infra/db/tenant-context";
import { AuditService } from "../modules/audit/api/audit";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerService } from "../modules/partners/application/partner-service";
import { CreditTermsService } from "../modules/partners/application/credit-terms-service";
import { CreditCheckService } from "../modules/partners/application/credit-check-service";
import { OpeningBalancesService } from "../modules/partners/application/opening-balances-service";
import { ItemService } from "../modules/items/application/item-service";
import { UomService } from "../modules/items/application/uom-service";
import { PriceListService } from "../modules/items/application/price-list-service";
import {
  PartnerCodeTakenError,
  PartnerKindChangeForbiddenError,
  OpeningBalanceDraftError,
  OpeningBalanceDraftExistsError,
  SystemCreditTermsImmutableError,
} from "../modules/partners/domain/partner-errors";
import {
  ItemSkuTakenError,
  BarcodeTakenError,
  CategoryCycleError,
  ConversionNotFoundError,
  TrackingFlagsInvalidError,
} from "../modules/items/domain/items-errors";
import * as partnerStore from "../modules/partners/infrastructure/partners.store";

/**
 * PHASE-006 master-data golden paths (TEST_STRATEGY §8 service coverage):
 * BR-025 partner code rules + auto-numbering, BR-026 system terms
 * immutability, BR-001 credit-check math over drafts, the opening-balance
 * DRAFT validation matrix, item/category/barcode/UoM rules, the exact
 * conversion property, BR-003 pricing precedence + provenance, and the
 * ZERO-POSTING proof (acceptance 5) — no journal tables may exist after
 * this suite runs.
 */

const audit = new AuditService(new DrizzleAuditStore());
const partners = new PartnerService(audit);
const creditTerms = new CreditTermsService(audit);
const creditCheck = new CreditCheckService();
const openingBalances = new OpeningBalancesService(audit);
const items = new ItemService(audit);
const uoms = new UomService(audit);
const priceLists = new PriceListService(audit, uoms);

let uomKg = "";
let uomG = "";
let uomPcs = "";

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'master-actor@fixture.test', 'Master Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  await su.end();
  // Onboarding-equivalent master-data basics (the provisionWorkspace step):
  // the migration backfill only covers tenants existing at migration time.
  const { seedMasterDataBasics } = await import("../modules/tenancy/infrastructure/tenancy.store");
  await withTenant(TENANT_A, async () => {
    await seedMasterDataBasics();
  });
});

/** Real user row — audit_events.actor_id carries an FK to users. */
const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";

describe("PHASE-006 master-data service suite", () => {
  it("seeds the canonical uoms + NET-N terms for tenant A (onboarding contract)", async () => {
    const seeded = await withTenant(TENANT_A, async () => {
      const list = await uoms.list();
      const terms = await creditTerms.list();
      return { list, terms };
    });
    expect(seeded.list.map((row) => row.code).sort()).toEqual(
      ["BOX", "CTN", "G", "HR", "KG", "L", "M", "PCS"].sort(),
    );
    expect(seeded.terms.filter((row) => row.isSystem).map((row) => row.code)).toEqual([
      "NET-7",
      "NET-15",
      "NET-30",
      "NET-60",
    ]);
    uomKg = seeded.list.find((row) => row.code === "KG")!.id;
    uomG = seeded.list.find((row) => row.code === "G")!.id;
    uomPcs = seeded.list.find((row) => row.code === "PCS")!.id;
  });

  it("BR-025: auto-numbers partner codes tenant-wide P-000001… and blocks taken manual codes", async () => {
    const created = await withTenant(TENANT_A, async () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER",
        code: undefined,
        name: "شركة الأمل",
        nameAr: "شركة الأمل",
        taxNumber: null,
        creditLimit: "10000.0000",
        creditTermsId: null,
        priceListId: null,
      }),
    );
    expect(created.code).toBe("P-000001");
    await expect(
      withTenant(TENANT_A, () =>
        partners.create(ACTOR, {
          kind: "CUSTOMER",
          code: "P-000001",
          name: "Duplicate",
          nameAr: null,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(PartnerCodeTakenError);
    // Auto-numbering continues past the manual collision domain.
    const second = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "SUPPLIER",
        code: undefined,
        name: "مؤسسة النور",
        nameAr: "مؤسسة النور",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    expect(second.code).toBe("P-000002");
  });

  it("BR-025: kind changes are allowed while no postings exist (interface-level guard)", async () => {
    const partner = await withTenant(TENANT_A, () =>
      partnerStore.findPartnerByCode("P-000001"),
    );
    const changed = await withTenant(TENANT_A, () =>
      partners.changeKind(ACTOR, partner!.id, "BOTH"),
    );
    expect(changed.kind).toBe("BOTH");
    // The guard itself is the contract sales/postings must honor
    // (acceptance 2: interface-level proof) — with postings > 0 it throws.
    expect(PartnerKindChangeForbiddenError).toBeDefined();
  });

  it("BR-026: system credit terms are immutable; custom terms are auditable", async () => {
    await expect(
      withTenant(TENANT_A, async () => {
        const terms = await partnerStore.findCreditTermsByCode("NET-30");
        return creditTerms.update(ACTOR, terms!.id, { days: 45 });
      }),
    ).rejects.toBeInstanceOf(SystemCreditTermsImmutableError);
    const custom = await withTenant(TENANT_A, () =>
      creditTerms.create(ACTOR, {
        code: "NET-10",
        name: "Net 10 days",
        nameAr: "صافي 10 أيام",
        days: 10,
        description: null,
      }),
    );
    expect(custom.days).toBe(10);
  });

  it("opening-balance DRAFT validation matrix: signs per kind, duplicates, currency = base", async () => {
    const partner = await withTenant(TENANT_A, () => partnerStore.findPartnerByCode("P-000001"));
    const draft = await withTenant(TENANT_A, () =>
      openingBalances.create(ACTOR, {
        kind: "PARTNER",
        partnerId: partner!.id,
        amount: "5000.0000",
      }),
    );
    expect(draft.status).toBe("DRAFT");
    // One DRAFT per target.
    await expect(
      withTenant(TENANT_A, () =>
        openingBalances.create(ACTOR, { kind: "PARTNER", partnerId: partner!.id, amount: "1" }),
      ),
    ).rejects.toBeInstanceOf(OpeningBalanceDraftExistsError);
    // Supplier drafts must be negative (AP credit).
    const supplier = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "SUPPLIER",
        code: "SUP-01",
        name: "Supplier X",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    await expect(
      withTenant(TENANT_A, () =>
        openingBalances.create(ACTOR, {
          kind: "PARTNER",
          partnerId: supplier.id,
          amount: "100",
        }),
      ),
    ).rejects.toBeInstanceOf(OpeningBalanceDraftError);
    // Stock drafts need a STOCK item with qty > 0.
    const stockItem = await withTenant(TENANT_A, () =>
      items.create(ACTOR, {
        sku: "RICE-1KG",
        name: "White Rice 1kg",
        nameAr: "أرز أبيض 1كجم",
        kind: "STOCK",
        uomId: uomKg,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "12.500000",
      }),
    );
    await expect(
      withTenant(TENANT_A, () =>
        openingBalances.create(ACTOR, { kind: "STOCK", itemId: stockItem.id, qty: "0" }),
      ),
    ).rejects.toBeInstanceOf(OpeningBalanceDraftError);
    const stockDraft = await withTenant(TENANT_A, () =>
      openingBalances.create(ACTOR, {
        kind: "STOCK",
        itemId: stockItem.id,
        qty: "100",
        unitCost: "12.5",
      }),
    );
    expect(new Decimal(stockDraft.qty ?? "0").toFixed(6)).toBe("100.000000");
  });

  it("BR-001 credit-check: exposure math over drafts with the warn default", async () => {
    const partner = await withTenant(TENANT_A, () => partnerStore.findPartnerByCode("P-000001"));
    const result = await withTenant(TENANT_A, () =>
      creditCheck.checkCredit(partner!.id, "6000.0000"),
    );
    // draft 5000 + delta 6000 = 11000 > limit 10000 → policy warn (default).
    expect(result.basis).toBe("DRAFTS_ONLY");
    expect(new Decimal(result.projectedExposure).toFixed(4)).toBe("11000.0000");
    expect(result.limitExceeded).toBe(true);
    expect(result.action).toBe("warn");
    const within = await withTenant(TENANT_A, () =>
      creditCheck.checkCredit(partner!.id, "1000.0000"),
    );
    expect(within.action).toBe("allow");
  });

  it("partner_balances read model reflects drafts honestly (draft sums; open stays 0)", async () => {
    const partner = await withTenant(TENANT_A, () => partnerStore.findPartnerByCode("P-000001"));
    const balance = await withTenant(TENANT_A, () => partners.balance(partner!.id));
    expect(new Decimal(balance.draftBalance).toFixed(4)).toBe("5000.0000");
    expect(new Decimal(balance.openBalance).toFixed(4)).toBe("0.0000");
    expect(new Decimal(balance.overdueAmount).toFixed(4)).toBe("0.0000");
  });

  it("items: sku uniqueness, tracking-flag matrix, expiry-requires-batch", async () => {
    await expect(
      withTenant(TENANT_A, () =>
        items.create(ACTOR, {
          sku: "RICE-1KG",
          name: "Duplicate SKU",
          nameAr: null,
          kind: "SERVICE",
          uomId: uomKg,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: false,
          trackSerial: false,
          trackImei: false,
          hasExpiry: false,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ItemSkuTakenError);
    await expect(
      withTenant(TENANT_A, () =>
        items.create(ACTOR, {
          sku: "SVC-HOUR",
          name: "Consulting hour",
          nameAr: null,
          kind: "SERVICE",
          uomId: uomKg,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: true,
          trackSerial: false,
          trackImei: false,
          hasExpiry: false,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        }),
      ),
    ).rejects.toBeInstanceOf(TrackingFlagsInvalidError);
    await expect(
      withTenant(TENANT_A, () =>
        items.create(ACTOR, {
          sku: "MILK-1L",
          name: "Fresh milk",
          nameAr: null,
          kind: "STOCK",
          uomId: uomKg,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: false,
          trackSerial: false,
          trackImei: false,
          hasExpiry: true,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        }),
      ),
    ).rejects.toBeInstanceOf(TrackingFlagsInvalidError);
  });

  it("categories: bilingual tree with cycle-proof reparenting", async () => {
    const root = await withTenant(TENANT_A, () =>
      items.createCategory(ACTOR, {
        code: "FOOD",
        name: "Food",
        nameAr: "أطعمة",
        parentId: null,
      }),
    );
    const child = await withTenant(TENANT_A, () =>
      items.createCategory(ACTOR, {
        code: "DAIRY",
        name: "Dairy",
        nameAr: "ألبان",
        parentId: root.id,
      }),
    );
    await expect(
      withTenant(TENANT_A, () => items.updateCategory(ACTOR, root.id, { parentId: child.id })),
    ).rejects.toBeInstanceOf(CategoryCycleError);
  });

  it("barcodes: tenant-wide scan-unique + per-UoM rows", async () => {
    const item = await withTenant(TENANT_A, async () => {
      const found = await import("../modules/items/infrastructure/items.store").then((m) =>
        m.findItemBySku("RICE-1KG"),
      );
      return found!;
    });
    await withTenant(TENANT_A, () =>
      items.addBarcode(ACTOR, { itemId: item.id, uomId: uomPcs, code: "6291000000018" }),
    );
    await expect(
      withTenant(TENANT_A, () =>
        items.addBarcode(ACTOR, {
          itemId: item.id,
          uomId: uomKg,
          code: "6291000000018",
        }),
      ),
    ).rejects.toBeInstanceOf(BarcodeTakenError);
  });

  it("T2: conversions compose EXACTLY (6-dp, zero drift) and fail closed without a path", async () => {
    const factorKgG = await withTenant(TENANT_A, () => uoms.resolveFactor(uomKg, uomG));
    expect(factorKgG).toBe("1000");
    const chain = await withTenant(TENANT_A, async () => {
      // Chain KG → G then express in a custom unit triple.
      const custom = await uoms.create(ACTOR, {
        code: "G3",
        name: "Three grams",
        nameAr: null,
      });
      await uoms.addConversion(ACTOR, { fromUomId: uomG, toUomId: custom.id, factor: "3" });
      return uoms.resolveFactor(uomKg, custom.id);
    });
    expect(new Decimal(chain).toFixed(6)).toBe("3000.000000");
    await expect(
      withTenant(TENANT_A, () => uoms.resolveFactor(uomKg, "00000000-0000-4000-8000-000000000009")),
    ).rejects.toBeInstanceOf(ConversionNotFoundError);
  });

  it("BR-003: precedence with provenance — customer list → branch default → base price", async () => {
    // Setup: price list A (customer's), list B (branch default), base price.
    const { item, listA, listB } = await withTenant(TENANT_A, async () => {
      const found = await import("../modules/items/infrastructure/items.store").then((m) =>
        m.findItemBySku("RICE-1KG"),
      );
      const listA = await priceLists.create(ACTOR, {
        name: "Golden customers",
        nameAr: "العملاء المميزون",
        kind: "SALE",
        currencyCode: "SAR",
        validFrom: null,
        validTo: null,
      });
      const listB = await priceLists.create(ACTOR, {
        name: "Riyadh default",
        nameAr: "افتراضي الرياض",
        kind: "SALE",
        currencyCode: "SAR",
        validFrom: null,
        validTo: null,
      });
      await priceLists.upsertRow(ACTOR, listA.id, {
        itemId: found!.id,
        uomId: uomKg,
        unitPrice: "10.000000",
        minQty: "1",
      });
      await priceLists.upsertRow(ACTOR, listB.id, {
        itemId: found!.id,
        uomId: uomKg,
        unitPrice: "11.000000",
        minQty: "1",
      });
      // Partner's assigned list.
      const partner = await partnerStore.findPartnerByCode("P-000001");
      await partnerStore.updatePartner(partner!.id, { priceListId: listA.id });
      return { item: found!, listA, listB };
    });
    // Assign the branch default list on a MAIN branch (created for the test).
    // Order-independence (PHASE-008 reality-audit repair): reuse the
    // isolation suite's canonical fixture row id (abababab-…0001) instead of
    // a private id for the same (tenant, code='MAIN') — branches are unique
    // per (tenant_id, code), so two different ids for the same code made the
    // isolation suite's narrow ON CONFLICT (id) seed crash whenever this
    // suite happened to run first. One canonical row serves both suites in
    // any order.
    const su = await superuserClient();
    await su.query(
      `INSERT INTO branches (id, tenant_id, code, name) VALUES ($1, $2, 'MAIN', 'Main')
       ON CONFLICT DO NOTHING`,
      ["abababab-0000-4000-8000-000000000001", TENANT_A],
    );
    await su.query(
      `UPDATE branches SET default_price_list_id = $1 WHERE tenant_id = $2 AND code = 'MAIN'`,
      [listB.id, TENANT_A],
    );
    await su.end();

    expect(listA.name).toBe("Golden customers");
    const partner = await withTenant(TENANT_A, () => partnerStore.findPartnerByCode("P-000001"));
    // Level 1: customer's list wins.
    const fromCustomerList = await withTenant(TENANT_A, () =>
      priceLists.resolvePrice({ itemId: item.id, partnerId: partner!.id, qty: "1" }),
    );
    expect(fromCustomerList.source).toBe("CUSTOMER_PRICE_LIST");
    expect(new Decimal(fromCustomerList.unitPrice).toFixed(6)).toBe("10.000000");
    expect(fromCustomerList.conversionFactor).toBe("1");
    expect(fromCustomerList.manualOverrideAllowed).toBe(true);

    // Level 2: branch default (partner without a list + branch given).
    const partnerNoList = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER",
        code: "WALK-IN",
        name: "Walk-in",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    const branchesRow = await withTenant(TENANT_A, async () => {
      const { findBranchByCode } = await import("../modules/tenancy/infrastructure/tenancy.store");
      return (await findBranchByCode("MAIN"))!.id;
    });
    const fromBranchDefault = await withTenant(TENANT_A, () =>
      priceLists.resolvePrice({
        itemId: item.id,
        partnerId: partnerNoList.id,
        branchId: branchesRow,
        qty: "1",
      }),
    );
    expect(fromBranchDefault.source).toBe("DEFAULT_PRICE_LIST");
    expect(new Decimal(fromBranchDefault.unitPrice).toFixed(6)).toBe("11.000000");

    // Level 3: base price with UoM conversion (KG price → per G).
    const fromBase = await withTenant(TENANT_A, () =>
      priceLists.resolvePrice({
        itemId: item.id,
        partnerId: partnerNoList.id,
        uomId: uomG,
        qty: "1",
      }),
    );
    expect(fromBase.source).toBe("BASE_PRICE");
    expect(new Decimal(fromBase.unitPrice).toFixed(7)).toBe("0.0125000"); // 12.5 × 0.001, exact
    expect(new Decimal(fromBase.conversionFactor).toFixed(6)).toBe("0.001000");
  });

  it("POSTING BOUNDARY (PHASE-006 acceptance 5, superseded shape): master-data operations post nothing", async () => {
    // PHASE-006 proved the journal TABLES did not exist; PHASE-007 creates
    // them by design (migration 0011). The surviving invariant: the
    // master-data flows THEMSELVES never write a journal row — the posting
    // engine is the only writer (ADR-0007). This suite's partners/items/
    // drafts operations run between the two snapshots below.
    const su = await superuserClient();
    const before = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries`,
    );
    await withTenant(TENANT_A, async () => {
      const created = await partners.create(ACTOR, {
        kind: "BOTH",
        code: undefined,
        name: "boundary probe",
        nameAr: "فحص الحدود",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      await openingBalances.create(ACTOR, {
        kind: "PARTNER",
        partnerId: created.id,
        amount: "10.0000",
      });
      await items.create(ACTOR, {
        sku: "BOUNDARY-PROBE",
        name: "boundary probe",
        nameAr: "فحص الحدود",
        kind: "STOCK",
        uomId: uomPcs,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
    });
    const after = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries`,
    );
    await su.end();
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("boundary proof: partners/items modules import no accounting-WRITER code (PHASE-007 seam-aware)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const scan = (dir: string): string[] => {
      const found: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          found.push(...scan(full));
        } else if (entry.endsWith(".ts")) {
          found.push(readFileSync(full, "utf8"));
        }
      }
      return found;
    };
    const root = process.cwd() + "/src/modules";
    const sources = [...scan(`${root}/partners`), ...scan(`${root}/items`)];
    expect(sources.length).toBeGreaterThan(20);
    // PHASE-007 seam (MODULE_BOUNDARIES write matrix): the partners module
    // implements the accounting-DECLARED partner-subledger port — the one
    // sanctioned partners → accounting surface, whose table naturally
    // references journal columns. The seam file is excluded from the
    // journal-reference scan; everything else stays banned outright.
    const seam = readFileSync(`${root}/partners/application/subledger-service.ts`, "utf8");
    const others = sources.filter((source) => source !== seam);
    expect(others.length).toBeGreaterThan(20);
    for (const source of others) {
      expect(source).not.toMatch(/modules\/accounting/);
      expect(source).not.toMatch(/journal_entr(y|ies)/);
      expect(source).not.toMatch(/posting-engine/);
      expect(source).not.toMatch(/journal\.store/);
    }
    // The seam file itself imports ONLY the port declaration — never the
    // engine, the journal store, or any accounting infrastructure.
    expect(seam).toMatch(/partner-subledger-port/);
    expect(seam).not.toMatch(/posting-engine/);
    expect(seam).not.toMatch(/journal\.store/);
    expect(seam).not.toMatch(/infrastructure/);
  });
});

afterAll(async () => {
  const app = await appClient();
  await app.end();
  await closeDb();
});
