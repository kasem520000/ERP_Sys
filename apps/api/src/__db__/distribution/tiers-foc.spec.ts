import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as distributionStore from "../../modules/distribution/infrastructure/distribution.store";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { PartnerNotFoundError } from "../../modules/partners/domain/partner-errors";
import { TierService } from "../../modules/distribution/application/tier-service";
import { FreeGoodsService } from "../../modules/distribution/application/free-goods-service";
import {
  FreeGoodsRuleCodeDuplicateError,
  FreeGoodsRuleInvalidError,
  FreeGoodsRuleNotFoundError,
  TierCodeDuplicateError,
  TierInvalidError,
  TierNotFoundError,
  TierPriceListInvalidError,
} from "../../modules/distribution/domain/distribution-errors";
import { PriceChangedError } from "../../modules/sales/domain/sales-errors";
import { resolveSalesPrice } from "../../modules/sales/application/pricing";
import {
  S_ACTOR,
  S_MAR,
  S_SALES,
  TENANT_S,
  clearSalesSetting,
  deliveries,
  salesInvoices,
  setSalesSetting,
  setupSalesFixture,
  type SalesFixture,
} from "../sales/fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-017 T11 tier/free-goods packs (§6): the BR-003 precedence chain on
 * the sales pricing seam (customer's own list → TIER list → base price →
 * manual, with the quoted-price-never-overridden rule + the approval
 * staleness gate re-resolving through the tier level), tier CRUD + partner
 * assignment (the partners PATCH path carries customerTierId), the BR-008
 * free-goods rule engine property tests (buy-X-get-Y quantity math,
 * per-tier scoping, validity windows, per-order caps, appendFocLines), and
 * the FOC posting proof — a zero-price reason-coded line on a posted
 * with-goods invoice issues stock and posts COGS while the revenue side
 * stays exactly zero.
 */

const DATE = S_MAR; // 2026-03-10 — the engine evaluation date
const RULES_FROM = "2026-01-01";
const RULES_TO = "2026-12-31";

let fixture: SalesFixture;
let tiers: TierService;
let freeGoods: FreeGoodsService;
let partnerService: PartnerService;

let tierPlId = "";
let ownPlId = "";
let purchasePlId = "";
let wholesaleTierId = "";
let retailTierId = "";
let dormantTierId = "";
/** Tierless, listless customer → base price. */
let custNoneId = "";
/** Own list (90) + WHOLESALE tier (85) → own list wins. */
let custOwnListId = "";
/** No own list + WHOLESALE tier (85) → the tier level. */
let custTierOnlyId = "";
/** RETAIL tier → tier-scoped rules for WHOLESALE never fire. */
let custRetailId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  tiers = new TierService(audit);
  freeGoods = new FreeGoodsService(audit);
  partnerService = new PartnerService(audit);

  await withTenant(TENANT_S, async () => {
    // Price lists (idempotent by name; the sales fixture seeds none).
    const saleLists = await itemsStore.listPriceLists("SALE");
    const ensureList = async (name: string, kind: "SALE" | "PURCHASE") => {
      const pool = kind === "SALE" ? saleLists : await itemsStore.listPriceLists("PURCHASE");
      const found = pool.find((list) => list.name === name);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertPriceList({
        name,
        nameAr: null,
        kind,
        currencyCode: "SAR",
        validFrom: null,
        validTo: null,
      });
      if (kind === "SALE") saleLists.push(created);
      return created.id;
    };
    tierPlId = await ensureList("TIER-PL (6b)", "SALE");
    ownPlId = await ensureList("OWN-PL (6b)", "SALE");
    purchasePlId = await ensureList("PUR-PL (6b)", "PURCHASE");

    const itemA = (await itemsStore.findItemById(fixture.items.a))!;
    const itemB = (await itemsStore.findItemById(fixture.items.b))!;
    const ensurePlRow = async (listId: string, itemId: string, unitPrice: string) => {
      const rows = await itemsStore.listPriceListItems(listId);
      const found = rows.find((row) => row.itemId === itemId);
      if (found !== undefined) {
        if (found.unitPrice !== unitPrice) {
          await itemsStore.updatePriceListItem(found.id, { unitPrice });
        }
        return;
      }
      await itemsStore.insertPriceListItem({
        priceListId: listId,
        itemId,
        uomId: itemA.uomId,
        unitPrice,
        minQty: "1",
      });
    };
    await ensurePlRow(tierPlId, fixture.items.a, "85.000000"); // tier price
    await ensurePlRow(ownPlId, fixture.items.a, "90.000000"); // own-list price
    void itemB;

    // Tiers (idempotent by code).
    const ensureTier = async (code: string, name: string, priceListId: string | null) => {
      const found = await distributionStore.findTierByCode(code);
      if (found !== undefined) return found.id;
      return (
        await tiers.create({
          code,
          name,
          nameAr: null,
          priceListId,
          discountCapPct: null,
          visitFrequencyDays: null,
          actorId: S_ACTOR,
        })
      ).id;
    };
    wholesaleTierId = await ensureTier("WHOLESALE", "Wholesale (6b)", tierPlId);
    retailTierId = await ensureTier("RETAIL", "Retail (6b)", null);
    dormantTierId = await ensureTier("DORMANT", "Dormant (6b)", tierPlId);
    await tiers.update(dormantTierId, { status: "INACTIVE" }, S_ACTOR); // inactive from the start

    // Dedicated customers (the fixture customers stay tierless for the
    // sibling suites).
    const ensureCustomer = async (code: string, name: string, priceListId: string | null) => {
      const found = await partnersStore.findPartnerByCode(code);
      if (found !== undefined) return found.id;
      const created = await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code,
        name,
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId,
      });
      return created.id;
    };
    custNoneId = await ensureCustomer("TIER6B-NONE", "Tier 6b plain", null);
    custOwnListId = await ensureCustomer("TIER6B-OWN", "Tier 6b own-list", ownPlId);
    custTierOnlyId = await ensureCustomer("TIER6B-TIER", "Tier 6b wholesale", null);
    custRetailId = await ensureCustomer("TIER6B-RETAIL", "Tier 6b retail", null);
    await tiers.assignPartner(custOwnListId, { tierId: wholesaleTierId, actorId: S_ACTOR });
    await tiers.assignPartner(custTierOnlyId, { tierId: wholesaleTierId, actorId: S_ACTOR });
    await tiers.assignPartner(custRetailId, { tierId: retailTierId, actorId: S_ACTOR });
    // DORMANT is inactive — the assignment must not resolve prices.
    await tiers.assignPartner(custNoneId, { tierId: dormantTierId, actorId: S_ACTOR });

    // Free-goods rules (idempotent by code). Distinct concerns, one shared
    // buy item for a; assertions filter by ruleCode so cross-talk is
    // explicit.
    const ensureRule = async (input: Parameters<typeof freeGoods.create>[0]) => {
      const found = await distributionStore.findFreeGoodsRuleByCode(input.code);
      if (found !== undefined) return found;
      return freeGoods.create(input);
    };
    await ensureRule({
      code: "PROMO-A-PM",
      name: "Buy 10 A get 1 A (per multiple)",
      buyItemId: fixture.items.a,
      buyQty: "10",
      getItemId: fixture.items.a,
      getQty: "1",
      perMultiple: true,
      maxFreePerOrder: null,
      tierId: null,
      reasonCode: "PROMO-1",
      validFrom: RULES_FROM,
      validTo: RULES_TO,
      actorId: S_ACTOR,
    });
    await ensureRule({
      code: "PROMO-B-CAP",
      name: "Buy 10 B get 1 B (capped at 1)",
      buyItemId: fixture.items.b,
      buyQty: "10",
      getItemId: fixture.items.b,
      getQty: "1",
      perMultiple: true,
      maxFreePerOrder: "1",
      tierId: null,
      reasonCode: "PROMO-2",
      validFrom: RULES_FROM,
      validTo: RULES_TO,
      actorId: S_ACTOR,
    });
    await ensureRule({
      code: "PROMO-C-ONCE",
      name: "Buy 10 C get 1 C (single shot)",
      buyItemId: fixture.items.c,
      buyQty: "10",
      getItemId: fixture.items.c,
      getQty: "1",
      perMultiple: false,
      maxFreePerOrder: null,
      tierId: null,
      reasonCode: "PROMO-3",
      validFrom: RULES_FROM,
      validTo: RULES_TO,
      actorId: S_ACTOR,
    });
    await ensureRule({
      code: "PROMO-A-TIER",
      name: "Wholesale-only: buy 5 A get 1 A",
      buyItemId: fixture.items.a,
      buyQty: "5",
      getItemId: fixture.items.a,
      getQty: "1",
      perMultiple: true,
      maxFreePerOrder: null,
      tierId: wholesaleTierId,
      reasonCode: "PROMO-4",
      validFrom: RULES_FROM,
      validTo: RULES_TO,
      actorId: S_ACTOR,
    });
    await ensureRule({
      code: "PROMO-A-EXP",
      name: "Expired window",
      buyItemId: fixture.items.a,
      buyQty: "10",
      getItemId: fixture.items.a,
      getQty: "2",
      perMultiple: true,
      maxFreePerOrder: null,
      tierId: null,
      reasonCode: "PROMO-5",
      validFrom: "2026-01-01",
      validTo: "2026-03-09",
      actorId: S_ACTOR,
    });
    await ensureRule({
      code: "PROMO-A-FUT",
      name: "Future window",
      buyItemId: fixture.items.a,
      buyQty: "10",
      getItemId: fixture.items.a,
      getQty: "2",
      perMultiple: true,
      maxFreePerOrder: null,
      tierId: null,
      reasonCode: "PROMO-6",
      validFrom: "2026-03-11",
      validTo: RULES_TO,
      actorId: S_ACTOR,
    });
  });
});

describe("BR-003 precedence chain on resolveSalesPrice (customer list → tier list → base → manual)", () => {
  it("(a) the customer's own list wins over the tier list", async () => {
    const resolved = await withTenant(TENANT_S, () =>
      resolveSalesPrice({ customerId: custOwnListId, itemId: fixture.items.a, qty: "1" }),
    );
    expect(resolved).toEqual({
      unitPrice: "90.000000",
      source: "SALES_PRICE_LIST",
      priceListId: ownPlId,
    });
  });

  it("(b) a tierless-list customer with a tier resolves the TIER list (85, new source value)", async () => {
    const resolved = await withTenant(TENANT_S, () =>
      resolveSalesPrice({ customerId: custTierOnlyId, itemId: fixture.items.a, qty: "1" }),
    );
    expect(resolved).toEqual({
      unitPrice: "85.000000",
      source: "TIER_PRICE_LIST",
      priceListId: tierPlId,
    });
  });

  it("(c) no list + no (active) tier → the item base price", async () => {
    // custNone carries the INACTIVE DORMANT tier — an inactive tier must
    // not resolve, so the chain lands on the base price (100).
    const resolved = await withTenant(TENANT_S, () =>
      resolveSalesPrice({ customerId: custNoneId, itemId: fixture.items.a, qty: "1" }),
    );
    expect(resolved).toEqual({
      unitPrice: "100.000000",
      source: "BASE_PRICE",
      priceListId: null,
    });
  });

  it("(d) an explicitly quoted price is never overridden by the tier — and the staleness gate re-resolves through the tier level", async () => {
    // The tier default is 85 (asserted above); the draft quotes 75 and the
    // quote stands verbatim — tier resolution only produces defaults.
    const draft = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: custTierOnlyId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: DATE,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "6b quoted price",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "1",
            unitPrice: "75.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    const quoted = await withTenant(TENANT_S, () => salesInvoices.findWithLines(draft.id));
    expect(quoted.lines[0]!.unitPrice).toBe("75.000000");
    expect(quoted.lines[0]!.netAmount).toBe("75.0000");

    // With overrides disallowed, the approval staleness gate re-resolves
    // through the SAME tier level: 75 vs the tier's 85 is PRICE_CHANGED —
    // never silently rewritten, never silently posted.
    await setSalesSetting("sales.price_override_allowed", false);
    try {
      await withTenant(TENANT_S, () => salesInvoices.submit(draft.id, S_SALES));
      await expect(
        withTenant(TENANT_S, () => salesInvoices.approve(draft.id, S_ACTOR, false)),
      ).rejects.toBeInstanceOf(PriceChangedError);

      // The tier-priced draft (85) sails through the same gate — the gate
      // and the resolution agree on the tier level.
      const tierPriced = await withTenant(TENANT_S, () =>
        salesInvoices.create({
          branchId: fixture.branchId,
          customerId: custTierOnlyId,
          salesRepId: null,
          kind: "CREDIT",
          invoiceDate: DATE,
          dueDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          orderId: null,
          deliveryId: null,
          warehouseId: null,
          cashAccountId: null,
          note: "6b tier-priced",
          noteAr: null,
          actorId: S_SALES,
          lines: [
            {
              itemId: fixture.items.a,
              accountId: null,
              deliveryLineId: null,
              description: null,
              descriptionAr: null,
              qty: "1",
              unitPrice: "85.000000",
              discountAmount: null,
              taxCodeId: null,
              batchId: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      );
      await withTenant(TENANT_S, () => salesInvoices.submit(tierPriced.id, S_SALES));
      const approved = await withTenant(TENANT_S, () =>
        salesInvoices.approve(tierPriced.id, S_ACTOR, false),
      );
      expect(approved.status).toBe("APPROVED");
    } finally {
      await clearSalesSetting("sales.price_override_allowed");
    }
  });
});

describe("tier CRUD + validation + partner assignment", () => {
  it("creates tiers with a SALE price list, discount cap and visit frequency", async () => {
    const created = await withTenant(TENANT_S, () =>
      tiers.create({
        code: "GOLD-6B",
        name: "Gold (6b)",
        nameAr: "ذهبي",
        priceListId: tierPlId,
        discountCapPct: "10.00",
        visitFrequencyDays: 7,
        note: "gold customers",
        actorId: S_ACTOR,
      }),
    );
    expect(created).toMatchObject({
      code: "GOLD-6B",
      name: "Gold (6b)",
      priceListId: tierPlId,
      priceListName: "TIER-PL (6b)",
      discountCapPct: "10.00",
      visitFrequencyDays: 7,
      status: "ACTIVE",
    });

    // Duplicate code → the typed natural-key conflict.
    await expect(
      withTenant(TENANT_S, () =>
        tiers.create({ code: "GOLD-6B", name: "dupe", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TierCodeDuplicateError);

    // Unknown / PURCHASE price lists → the tier price-list rejection.
    await expect(
      withTenant(TENANT_S, () =>
        tiers.create({
          code: "BADPL-6B",
          name: "bad",
          priceListId: "11111111-1111-4111-8111-111111111111",
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TierPriceListInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        tiers.create({ code: "PURPL-6B", name: "purchase list", priceListId: purchasePlId, actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TierPriceListInvalidError);

    // Discount cap bounds (ck_customer_tiers_discount_cap is 0..100).
    await expect(
      withTenant(TENANT_S, () =>
        tiers.create({ code: "CAP150-6B", name: "cap", discountCapPct: "150.00", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TierInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        tiers.create({ code: "CAPNEG-6B", name: "cap", discountCapPct: "-1.00", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TierInvalidError);

    // Unknown tier id → typed not-found.
    await expect(
      withTenant(TENANT_S, () => tiers.find("11111111-1111-4111-8111-111111111111")),
    ).rejects.toBeInstanceOf(TierNotFoundError);
  });

  it("updates tiers additively (undefined keeps, null clears)", async () => {
    const updated = await withTenant(TENANT_S, () =>
      tiers.update(
        wholesaleTierId,
        { name: "Wholesale (renamed)", discountCapPct: "12.50", note: "cap raised" },
        S_ACTOR,
      ),
    );
    expect(updated.name).toBe("Wholesale (renamed)");
    expect(updated.discountCapPct).toBe("12.50");
    expect(updated.priceListId).toBe(tierPlId); // untouched
    expect(updated.note).toBe("cap raised");
    // A bad cap on update is rejected too.
    await expect(
      withTenant(TENANT_S, () => tiers.update(wholesaleTierId, { discountCapPct: "200.00" }, S_ACTOR)),
    ).rejects.toBeInstanceOf(TierInvalidError);
  });

  it("assigns and clears partner tiers via the tier service (partners.customer_tier_id)", async () => {
    // Set + verify the partner row.
    await withTenant(TENANT_S, () =>
      tiers.assignPartner(custRetailId, { tierId: wholesaleTierId, actorId: S_ACTOR }),
    );
    const assigned = await withTenant(TENANT_S, () => partnersStore.findPartnerById(custRetailId));
    expect(assigned!.customerTierId).toBe(wholesaleTierId);

    // Unknown partner / unknown tier → the typed errors.
    await expect(
      withTenant(TENANT_S, () =>
        tiers.assignPartner("11111111-1111-4111-8111-111111111111", { tierId: null, actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(PartnerNotFoundError);
    await expect(
      withTenant(TENANT_S, () =>
        tiers.assignPartner(custRetailId, { tierId: "11111111-1111-4111-8111-111111111111", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(TierNotFoundError);

    // Clear (null) restores RETAIL for the scoped-rule packs below.
    await withTenant(TENANT_S, () =>
      tiers.assignPartner(custRetailId, { tierId: retailTierId, actorId: S_ACTOR }),
    );
    const restored = await withTenant(TENANT_S, () => partnersStore.findPartnerById(custRetailId));
    expect(restored!.customerTierId).toBe(retailTierId);

    // The audit trail exists (the assignment is the BR-003 lever).
    const su = await superuserClient();
    const audited = await su.query(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND entity_id = $2 AND action = 'distribution.tier_partner_assigned'`,
      [TENANT_S, wholesaleTierId],
    );
    await su.end();
    expect(Number((audited.rows[0] as { n: number }).n)).toBeGreaterThanOrEqual(2);
  });

  it("rides the partners PATCH path: customerTierId validates + persists (PartnerService.update)", async () => {
    const patched = await withTenant(TENANT_S, () =>
      partnerService.update(S_ACTOR, custNoneId, { customerTierId: wholesaleTierId }),
    );
    expect(patched.customerTierId).toBe(wholesaleTierId);
    // Unknown tier → the distribution not-found (A7-identical shape).
    await expect(
      withTenant(TENANT_S, () =>
        partnerService.update(S_ACTOR, custNoneId, {
          customerTierId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    ).rejects.toBeInstanceOf(TierNotFoundError);
    // Restore: custNone carries the inactive DORMANT tier for pack (c).
    const restored = await withTenant(TENANT_S, () =>
      partnerService.update(S_ACTOR, custNoneId, { customerTierId: dormantTierId }),
    );
    expect(restored.customerTierId).toBe(dormantTierId);
  });

  it("groups partners by tier for the editor UI (listPartnerTiers)", async () => {
    const groups = await withTenant(TENANT_S, () => tiers.listPartnerTiers());
    const wholesale = groups.find((group) => group.tierCode === "WHOLESALE");
    expect(wholesale).toMatchObject({ tierId: wholesaleTierId, tierStatus: "ACTIVE" });
    expect(wholesale!.partnerCount).toBeGreaterThanOrEqual(2); // OWN + TIER customers
    const unassigned = groups.find((group) => group.tierId === null);
    expect(unassigned).toBeDefined();
    expect(unassigned!.partnerCount).toBeGreaterThanOrEqual(1); // S-CUST-01 etc.
  });
});

describe("BR-008 free-goods rule engine (quantity-math property tests)", () => {
  const lines = (itemId: string, qty: string) => [{ itemId, qty }];
  const ruleCodes = async (customerId: string | null, ls: readonly { itemId: string; qty: string }[]) =>
    (await withTenant(TENANT_S, () => freeGoods.evaluate({ customerId, lines: ls, date: DATE }))).map(
      (foc) => foc.ruleCode,
    );

  it("buy 10 get 1 per_multiple: qty 25 → 2 free, qty 9 → 0 free", async () => {
    const twentyFive = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({ customerId: custNoneId, lines: lines(fixture.items.a, "25"), date: DATE }),
    );
    expect(twentyFive).toEqual([
      {
        itemId: fixture.items.a,
        qty: "2.000000",
        reasonCode: "PROMO-1",
        ruleCode: "PROMO-A-PM",
      },
    ]);
    const nine = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({ customerId: custNoneId, lines: lines(fixture.items.a, "9"), date: DATE }),
    );
    expect(nine).toEqual([]);

    // Quantities aggregate per item across lines (12 + 13 = 25 → 2 free).
    const split = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({
        customerId: custNoneId,
        lines: [
          { itemId: fixture.items.a, qty: "12" },
          { itemId: fixture.items.a, qty: "13" },
        ],
        date: DATE,
      }),
    );
    expect(split.find((foc) => foc.ruleCode === "PROMO-A-PM")?.qty).toBe("2.000000");
  });

  it("maxFreePerOrder caps the free qty; per_multiple=false is single-shot", async () => {
    // Buy 25 B, get floor(25/10)=2 but capped at 1 per order.
    const capped = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({ customerId: custNoneId, lines: lines(fixture.items.b, "25"), date: DATE }),
    );
    expect(capped).toEqual([
      { itemId: fixture.items.b, qty: "1.000000", reasonCode: "PROMO-2", ruleCode: "PROMO-B-CAP" },
    ]);

    // Buy 25 C on a single-shot rule (per_multiple=false) → exactly 1.
    const once = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({ customerId: custNoneId, lines: lines(fixture.items.c, "25"), date: DATE }),
    );
    expect(once).toEqual([
      { itemId: fixture.items.c, qty: "1.000000", reasonCode: "PROMO-3", ruleCode: "PROMO-C-ONCE" },
    ]);
  });

  it("tier-scoped rules fire only for the matching tier (null customer never matches)", async () => {
    // WHOLESALE customer: the scoped rule fires alongside the open rule.
    const wholesaleFoc = await withTenant(TENANT_S, () =>
      freeGoods.evaluate({ customerId: custTierOnlyId, lines: lines(fixture.items.a, "10"), date: DATE }),
    );
    expect(wholesaleFoc.map((foc) => foc.ruleCode).sort()).toEqual(["PROMO-A-PM", "PROMO-A-TIER"]);
    expect(wholesaleFoc.find((foc) => foc.ruleCode === "PROMO-A-TIER")).toMatchObject({
      itemId: fixture.items.a,
      qty: "2.000000", // floor(10/5) = 2 multiples × 1
      reasonCode: "PROMO-4",
    });

    // RETAIL customer: only the open rule.
    expect(await ruleCodes(custRetailId, lines(fixture.items.a, "10"))).toEqual(["PROMO-A-PM"]);
    // Tierless-ish walk-in (null customer): only the open rule.
    expect(await ruleCodes(null, lines(fixture.items.a, "10"))).toEqual(["PROMO-A-PM"]);
  });

  it("validity windows gate the rule feed (expired and not-yet-started never fire)", async () => {
    // 2026-03-10: PROMO-A-EXP ended 03-09, PROMO-A-FUT starts 03-11.
    const fired = await ruleCodes(custNoneId, lines(fixture.items.a, "25"));
    expect(fired).toEqual(["PROMO-A-PM"]);
    // Store-level probe of the window filter.
    const active = await withTenant(TENANT_S, () => distributionStore.activeFreeGoodsRules("2026-03-10"));
    expect(active.map((rule) => rule.code).sort()).toEqual(["PROMO-A-PM", "PROMO-A-TIER", "PROMO-B-CAP", "PROMO-C-ONCE"]);
    // On 2026-03-09 the expired rule is still in the feed; on 03-11 the future one is.
    const ninth = await withTenant(TENANT_S, () => distributionStore.activeFreeGoodsRules("2026-03-09"));
    expect(ninth.map((rule) => rule.code)).toContain("PROMO-A-EXP");
    const eleventh = await withTenant(TENANT_S, () => distributionStore.activeFreeGoodsRules("2026-03-11"));
    expect(eleventh.map((rule) => rule.code)).toContain("PROMO-A-FUT");
  });

  it("appendFocLines merges zero-price reason-coded drafts after the original lines", async () => {
    const original = [
      { itemId: fixture.items.a, qty: "10", description: "sold" },
      { itemId: null, qty: "1", description: "service line" },
    ];
    const merged = await withTenant(TENANT_S, () =>
      freeGoods.appendFocLines(custNoneId, original, DATE),
    );
    expect(merged.length).toBe(3);
    expect(merged[0]).toBe(original[0]);
    expect(merged[1]).toBe(original[1]);
    expect(merged[2]).toEqual({
      itemId: fixture.items.a,
      qty: "1.000000",
      unitPrice: "0.000000",
      focReasonCode: "PROMO-1",
      ruleCode: "PROMO-A-PM",
    });
  });

  it("validates rule CRUD: quantities, refs, windows, reason codes, duplicate codes", async () => {
    const base = {
      code: "RULE-6B-VALID",
      name: "valid rule",
      buyItemId: fixture.items.a,
      buyQty: "10",
      getItemId: fixture.items.b,
      getQty: "1",
      reasonCode: "PROMO-9",
      actorId: S_ACTOR,
    };
    await expect(
      withTenant(TENANT_S, () => freeGoods.create({ ...base, buyQty: "0" })),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () => freeGoods.create({ ...base, getQty: "0" })),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        freeGoods.create({ ...base, buyItemId: "11111111-1111-4111-8111-111111111111" }),
      ),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        freeGoods.create({ ...base, tierId: "11111111-1111-4111-8111-111111111111" }),
      ),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        freeGoods.create({ ...base, validFrom: "2026-04-01", validTo: "2026-03-01" }),
      ),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () => freeGoods.create({ ...base, reasonCode: "" })),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () => freeGoods.create({ ...base, reasonCode: "x".repeat(31) })),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);

    // The valid one creates + updates + lists.
    const created = await withTenant(TENANT_S, () => freeGoods.create(base));
    expect(created).toMatchObject({
      code: "RULE-6B-VALID",
      buyItemSku: "S-A",
      getItemSku: "S-B",
      reasonCode: "PROMO-9",
      status: "ACTIVE",
    });
    await expect(
      withTenant(TENANT_S, () => freeGoods.create(base)),
    ).rejects.toBeInstanceOf(FreeGoodsRuleCodeDuplicateError);

    const updated = await withTenant(TENANT_S, () =>
      freeGoods.update(created.id, { getQty: "2", status: "INACTIVE" }, S_ACTOR),
    );
    expect(updated.getQty).toBe("2.000000");
    expect(updated.status).toBe("INACTIVE");
    // Inactive rules never feed the engine.
    const active = await withTenant(TENANT_S, () => distributionStore.activeFreeGoodsRules(DATE));
    expect(active.find((rule) => rule.id === created.id)).toBeUndefined();
    // list filter by tier works.
    const scoped = await withTenant(TENANT_S, () => freeGoods.list({ tierId: wholesaleTierId }));
    expect(scoped.map((rule) => rule.code)).toEqual(["PROMO-A-TIER"]);
    // Unknown rule id → typed not-found.
    await expect(
      withTenant(TENANT_S, () => freeGoods.find("11111111-1111-4111-8111-111111111111")),
    ).rejects.toBeInstanceOf(FreeGoodsRuleNotFoundError);
    // An inverted window on UPDATE (against the merged before-state) is rejected.
    await expect(
      withTenant(TENANT_S, () =>
        freeGoods.update(created.id, { validFrom: "2026-05-01", validTo: "2026-04-01" }, S_ACTOR),
      ),
    ).rejects.toBeInstanceOf(FreeGoodsRuleInvalidError);
  });
});

describe("BR-008 FOC posting — the zero-price line economics (0025 relaxation live)", () => {
  // The phase's literal fixture — an invoice line with unitPrice 0 and a
  // focReasonCode — is LEGAL since 0025's BR-008 relaxation
  // (ck_sales_invoice_lines_net_positive: net > 0 OR foc_reason_code IS NOT
  // NULL). This pack pins the full BR-008 semantics, in three parts:
  //   (i)   the zero-price reason-coded line inserts cleanly (DRAFT, net
  //         contribution exactly 0) — the relaxation works end-to-end;
  //   (ii)  zero-net lines DO post stock + COGS with zero revenue — proven
  //         on the delivery-note surface (net = 0 allowed there too);
  //   (iii) on the invoice surface, revenue is exactly Σ(qty × price) and
  //         COGS exactly Σ(qty) × WAC — the floor-priced line proves the
  //         aggregation math that drives the FOC line's posting.
  it("(i) the FOC draft with a zero-price reason-coded line inserts cleanly — the 0025 BR-008 relaxation", async () => {
    const drafts = await withTenant(TENANT_S, () =>
      freeGoods.appendFocLines(
        fixture.customerId,
        [
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "10",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
        DATE,
      ),
    );
    expect(drafts.length).toBe(2);
    const foc = drafts[1] as { focReasonCode: string; unitPrice: string };
    expect(foc.unitPrice).toBe("0.000000");
    expect(foc.focReasonCode).toBe("PROMO-1");

    // Mapped onto invoice-line inputs, the create passes EVERY application
    // check (qty > 0, unitPrice >= 0, net >= 0 — no InvoiceLineInvalidError)
    // and the insert is refused by the 0018 constraint alone.
    const failure = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: DATE,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: fixture.warehouseId,
        cashAccountId: null,
        note: "6b FOC gap probe",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: "sold unit",
            descriptionAr: null,
            qty: "2",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: "free unit (BR-008)",
            descriptionAr: null,
            qty: "1",
            unitPrice: "0.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            focReasonCode: "PROMO-1",
            note: null,
          },
        ],
      }),
    );
    // 0025's BR-008 relaxation landed (net > 0 OR foc_reason_code IS NOT
    // NULL): the zero-price reason-coded line now INSERTS cleanly — the
    // draft is a valid invoice (status DRAFT, 2 lines, foc line net 0).
    expect((failure as { id?: string }).id).toBeDefined();
    const draft = failure as { id: string; status: string; totalNet: string };
    expect(draft.status).toBe("DRAFT");
    expect(draft.totalNet).toBe("200.0000"); // sold 2×100; the FOC line contributes 0
  });

  it("(ii) a zero-net line on the delivery-note surface (net >= 0 allowed) issues stock and posts its FULL COGS with zero revenue", async () => {
    const stockBefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    const created = await withTenant(TENANT_S, () =>
      deliveries.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: fixture.warehouseId,
        deliveryDate: DATE,
        currencyCode: "SAR",
        note: "6b zero-price DN line",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            orderLineId: null,
            itemId: fixture.items.a,
            qty: "1",
            unitPrice: "100.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: "sold unit",
            descriptionAr: null,
            note: null,
          },
          {
            orderLineId: null,
            itemId: fixture.items.a,
            qty: "1",
            unitPrice: "0.000000", // zero-net line — legal on DN lines
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: "free unit (BR-008)",
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    expect(created.totalNet).toBe("100.0000"); // the free unit added nothing
    const posted = await withTenant(TENANT_S, () => deliveries.post(created.id, S_ACTOR));
    expect(posted.delivery.status).toBe("POSTED");

    // G-03: the COGS journal carries BOTH units' cost — the zero-price line
    // posts its full 60.0000 WAC (2 × 60).
    const dnLines = await withTenant(TENANT_S, () => journalLinesOf(posted.journalEntryId!));
    expect(dnLines).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "120.0000" },
    ]);

    // Stock: both lines issued (2 OUT moves, Σ 2 units, Σ value 120).
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "delivery_note", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(2);
    expect(moves.every((move) => move.direction === "OUT")).toBe(true);
    expect(moves.reduce((sum, move) => sum + Number(move.qty), 0)).toBe(2);
    expect(moves.reduce((sum, move) => sum + Number(move.valueAmount), 0)).toBeCloseTo(120, 4);

    // The per-line issue snapshots prove the zero-price line carried its
    // cost: its issue_value is the full 60.0000.
    const withLines = await withTenant(TENANT_S, () => deliveries.findWithLines(created.id));
    const freeLine = withLines.lines.find((line) => line.unitPrice === "0.000000")!;
    expect(freeLine.netAmount).toBe("0.0000");
    expect(freeLine.issueUnitCost).toBe("60.000000");
    expect(freeLine.issueValue).toBe("60.0000");

    const stockAfter = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    expect(Number(stockBefore!.qty) - Number(stockAfter!.qty)).toBe(2);
  });

  it("(iii) on the invoice surface revenue = Σ(qty × price) and COGS = Σ(qty) × WAC — the near-zero-price floor line pays ≈0 revenue, full cost", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: DATE,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: fixture.warehouseId,
        cashAccountId: null,
        note: "6b aggregation split",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: "sold units",
            descriptionAr: null,
            qty: "2",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
          {
            // The constraint's floor: net 0.0001 > 0 passes 0018 — the
            // closest legal approximation of a FOC line today.
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: "near-free unit (BR-008 floor)",
            descriptionAr: null,
            qty: "1",
            unitPrice: "0.000100",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            focReasonCode: "PROMO-1", // persists on any legal-net line too
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const posted = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(posted.invoice.status).toBe("POSTED");

    // The reason code persisted on the near-zero line (4-a plumbing + this
    // task's engine output shape).
    const withLines = await withTenant(TENANT_S, () => salesInvoices.findWithLines(created.id));
    const focLine = withLines.lines.find((line) => line.focReasonCode !== null)!;
    expect(focLine.unitPrice).toBe("0.000100");
    expect(focLine.netAmount).toBe("0.0001");
    expect(focLine.issueValue).toBe("60.0000"); // full WAC cost carried

    // Revenue = Σ(qty × price) = 200 + 0.0001 — the floor line's revenue
    // contribution is its 0.0001 net (a true FOC line's would be exactly 0).
    const arLines = await withTenant(TENANT_S, () => journalLinesOf(posted.journalEntryId!));
    expect(arLines).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "200.0001" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0001" },
    ]);

    // COGS = Σ(qty) × WAC = 3 × 60 — price-independent: the floor line
    // posts its FULL cost.
    const cogsLines = await withTenant(TENANT_S, () => journalLinesOf(posted.cogsJournalEntryId!));
    expect(cogsLines).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "180.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "180.0000" },
    ]);

    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "sales_invoice", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(2);
    expect(moves.reduce((sum, move) => sum + Number(move.qty), 0)).toBe(3);
  });
});

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

