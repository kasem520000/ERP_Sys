import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { GlQueries } from "../../modules/accounting/application/gl-queries";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { ReconciliationService } from "../../modules/accounting/application/reconciliation-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { AdjustmentService } from "../../modules/inventory/application/adjustment-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { CountService } from "../../modules/inventory/application/count-service";
import { TrackingService } from "../../modules/inventory/application/tracking-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { InventoryReconciliationService } from "../../modules/inventory/application/reconciliation-service";
import { MethodSwitchService } from "../../modules/inventory/application/method-switch-service";
import { OpeningStockService } from "../../modules/inventory/application/opening-stock-service";

/**
 * PHASE-010 inventory db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production paths
 * run — every journal flows through PostingEngine.post, every stock row
 * through the inventory services, nothing inserts GL rows directly.
 *
 * Dedicated tenant I (SAR base): the accounting suites own tenant A, the
 * treasury/tax suites own T — inventory consumes its own isolated tenant
 * with the same onboarding-shaped CoA substrate. FY2026 spans the whole
 * test timeline (opening 2025-12-31 for the G-16 stock leg; moves Jan–Mar;
 * December reserved for the PERIOD_LOCKED packs).
 */

export const I_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000a1";
export const I_COUNTER = "aaaaaaaa-0000-4000-8000-0000000000a2";
export const I_SUPERVISOR = "aaaaaaaa-0000-4000-8000-0000000000a3";
export const TENANT_I = "55555555-5555-5555-5555-555555555555";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);

export const warehouses = new WarehouseService(audit);
export const stock = new StockService(audit, posting);
export const adjustments = new AdjustmentService(audit, posting, numbering);
export const transfers = new TransferService(audit, posting, numbering);
export const counts = new CountService(audit, posting, numbering);
export const tracking = new TrackingService(audit, stock);
export const reservations = new ReservationService(audit);
export const inventoryReconciliation = new InventoryReconciliationService(audit);
export const methodSwitcher = new MethodSwitchService(audit, posting);
export const openingStock = new OpeningStockService(audit, posting);

// PHASE-007 surfaces the inventory suite reuses (locked-period packs etc.).
export const iPosting = posting;
export const iPeriods = new PeriodService(audit);
export const iReconciliation = new ReconciliationService(audit);
export const iJournals = new JournalService(audit, posting);
export const iCoa = new CoaService(audit);
export const iGl = new GlQueries();

export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant I). */
export const I_OPENING_DATE = "2025-12-31";
export const I_JAN = "2026-01-15";
export const I_FEB = "2026-02-15";
export const I_MAR = "2026-03-10";

export interface InventoryItemIds {
  /** WAC plain item. */
  wac: string;
  /** FIFO plain item. */
  fifo: string;
  /** Batch + expiry item (FEFO — BR-017). */
  perishable: string;
  /** Serial/IMEI item (BR-018). */
  device: string;
}

export interface InventoryFixture {
  fiscalYearId: string;
  warehouseMain: string;
  warehouseSecond: string;
  /** The tenant-default INVENTORY purpose account + the second warehouse's override. */
  glInventory: string;
  glInventorySecond: string;
  glShrinkage: string;
  glAppreciation: string;
  glOpeningEquity: string;
  glCogs: string;
  items: InventoryItemIds;
}

let fixture: InventoryFixture | undefined;

/** Boots the suite db + tenant I's full inventory substrate (idempotent). */
export async function setupInventoryFixture(): Promise<InventoryFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant I (inventory)', 'المستأجر ي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_I],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'inventory-actor@fixture.test', 'Inventory Actor', 'x', 'ACTIVE'),
       ($2, 'inventory-counter@fixture.test', 'Inventory Counter', 'x', 'ACTIVE'),
       ($3, 'inventory-supervisor@fixture.test', 'Inventory Supervisor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [I_ACTOR, I_COUNTER, I_SUPERVISOR],
  );
  await superuser.end();

  const items = {} as InventoryItemIds;
  let fiscalYearId = "";
  let warehouseMain = "";
  let warehouseSecond = "";
  const glIds: Pick<
    InventoryFixture,
    "glInventory" | "glInventorySecond" | "glShrinkage" | "glAppreciation" | "glOpeningEquity" | "glCogs"
  > = {
    glInventory: "",
    glInventorySecond: "",
    glShrinkage: "",
    glAppreciation: "",
    glOpeningEquity: "",
    glCogs: "",
  };

  await withTenant(TENANT_I, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // Purpose mappings the template leaves unmarked (the 0008 fail-closed
    // gap — same tenant-setup step the treasury fixture performs):
    // OPENING_EQUITY → 3100 + the new INVENTORY_APPRECIATION host 4920.
    if ((await findActivePurpose("OPENING_EQUITY")) === undefined) {
      const account = await findAccountByCode("3100");
      if (account === undefined) throw new Error("fixture account 3100 missing");
      await insertAccountPurpose({
        purposeKey: "OPENING_EQUITY",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      let appreciation = await findAccountByCode("4920");
      if (appreciation === undefined) {
        appreciation = await iCoa.create(I_ACTOR, {
          code: "4920",
          name: "Inventory appreciation",
          nameAr: "زيادة قيمة المخزون",
          type: "REVENUE",
          parentId: (await findAccountByCode("4000"))!.id,
          currencyCode: null,
          isGroup: false,
        });
      }
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }

    // Fiscal year spanning the whole inventory timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (
        await iPeriods.createYear(I_ACTOR, {
          name: "FY2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        })
      ).id;

    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await findActivePurpose(key);
      if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
      return mapping.accountId;
    };
    glIds.glInventory = await byPurpose("INVENTORY");
    glIds.glShrinkage = await byPurpose("INVENTORY_SHRINKAGE");
    glIds.glAppreciation = await byPurpose("INVENTORY_APPRECIATION");
    glIds.glOpeningEquity = await byPurpose("OPENING_EQUITY");
    glIds.glCogs = await byPurpose("COGS");

    // A second INVENTORY-mapped account (1135 "Branch stock") — the
    // second warehouse's override so G-15's distinct-accounts branch has
    // a real branch-distinct mapping.
    let branchStock = await findAccountByCode("1135");
    if (branchStock === undefined) {
      branchStock = await iCoa.create(I_ACTOR, {
        code: "1135",
        name: "Branch stock",
        nameAr: "مخزون الفرع",
        type: "ASSET",
        parentId: (await findAccountByCode("1100"))!.id,
        currencyCode: null,
        isGroup: false,
      });
    }
    glIds.glInventorySecond = branchStock.id;

    // Warehouses need a branch: create the MAIN branch when the tenant has
    // none yet (onboarding provisions one in production; the db fixture
    // tenant starts bare).
    const branches = await tenancyStore.listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await tenancyStore.insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const existing = await warehouses.list({ limit: 10 });
    const main =
      existing.find((w) => w.code === "MAIN-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "MAIN-WH",
        name: "Main warehouse",
        nameAr: "المستودع الرئيسي",
        inventoryAccountId: null,
        note: null,
        actorId: I_ACTOR,
      }));
    warehouseMain = main.id;
    const second =
      existing.find((w) => w.code === "BRANCH-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "BRANCH-WH",
        name: "Branch warehouse",
        nameAr: "مستودع الفرع",
        inventoryAccountId: glIds.glInventorySecond,
        note: null,
        actorId: I_ACTOR,
      }));
    warehouseSecond = second.id;

    // Items: plain WAC, plain FIFO, perishable (batch+expiry), device
    // (serial+IMEI). The uoms seed (PCS) supplies the base unit.
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (
      key: keyof InventoryItemIds,
      sku: string,
      name: string,
      extra: { costingMethod?: string; trackBatch?: boolean; trackSerial?: boolean; hasExpiry?: boolean },
    ) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) {
        (items as unknown as Record<string, string>)[key] = found.id;
        return;
      }
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: extra.costingMethod ?? "WAC",
        trackBatch: extra.trackBatch ?? false,
        trackSerial: extra.trackSerial ?? false,
        trackImei: extra.trackSerial ?? false,
        hasExpiry: extra.hasExpiry ?? false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      (items as unknown as Record<string, string>)[key] = created.id;
    };
    await ensureItem("wac", "INV-WAC", "WAC fixture item", {});
    await ensureItem("fifo", "INV-FIFO", "FIFO fixture item", { costingMethod: "FIFO" });
    await ensureItem("perishable", "INV-PERISH", "Perishable fixture item", {
      trackBatch: true,
      hasExpiry: true,
    });
    await ensureItem("device", "INV-DEVICE", "Serial device fixture item", { trackSerial: true });
  });

  fixture = {
    fiscalYearId,
    warehouseMain,
    warehouseSecond,
    ...glIds,
    items,
  };
  return fixture;
}

/** The app-role client bound to tenant I (attack-suite ergonomics). */
export async function inventoryAppClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_I]);
  return client;
}

/**
 * On-demand dedicated item (spec-owned substrate — every spec creates its
 * own items so the suite stays deterministic regardless of file order):
 * idempotent per SKU, created under tenant I with the PCS base unit.
 */
export async function ensureInventoryItem(
  sku: string,
  name: string,
  extra: {
    costingMethod?: string;
    trackBatch?: boolean;
    trackSerial?: boolean;
    hasExpiry?: boolean;
  } = {},
): Promise<string> {
  await setupInventoryFixture();
  return withTenant(TENANT_I, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const found = await itemsStore.findItemBySku(sku);
    if (found !== undefined) return found.id;
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const created = await itemsStore.insertItem({
      sku,
      name,
      nameAr: null,
      kind: "STOCK",
      uomId: pcs.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: extra.costingMethod ?? "WAC",
      trackBatch: extra.trackBatch ?? false,
      trackSerial: extra.trackSerial ?? false,
      trackImei: extra.trackSerial ?? false,
      hasExpiry: extra.hasExpiry ?? false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: null,
    });
    return created.id;
  });
}
