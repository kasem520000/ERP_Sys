import { beforeAll, describe, expect, it } from "vitest";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { findAppliedStateRow } from "../../modules/configuration/application/apply/applied-state.store";
import {
  applyService,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  type PostingSubstrate,
} from "./template-fixtures";

/**
 * PHASE-015 §6 `degraded-entitlement.spec` (industries/README §8 #7): a
 * plan missing an OPTIONAL key hides cleanly (the nav item drops, nothing
 * breaks); a missing REQUIRED key BLOCKS apply with the exact chain named
 * (typed error + bilingual guidance — never silent degradation); and
 * phase-gated keys render "coming with PHASE-016" while the tenant trades
 * immediately in back-office mode (a real invoice posts).
 */

let tenantOptional = ""; // retail minus the OPTIONAL serial tracking key
let ownerOptional = "";
let tenantBlocked = ""; // grocery minus the REQUIRED batch tracking key
let ownerBlocked = "";
let tenantBackOffice = ""; // restaurant, full business plan
let ownerBackOffice = "";
let backOfficeSubstrate: PostingSubstrate;

beforeAll(async () => {
  const optional = await provisionBusinessTenant("degraded-optional", "industry.retail");
  tenantOptional = optional.tenantId;
  ownerOptional = optional.ownerId;
  await revokeEntitlement(tenantOptional, "inventory.serial_tracking");

  const blocked = await provisionBusinessTenant("degraded-blocked", "industry.grocery");
  tenantBlocked = blocked.tenantId;
  ownerBlocked = blocked.ownerId;
  await revokeEntitlement(tenantBlocked, "inventory.batch_tracking");

  const backOffice = await provisionBusinessTenant("degraded-backoffice", "industry.restaurant");
  tenantBackOffice = backOffice.tenantId;
  ownerBackOffice = backOffice.ownerId;
  backOfficeSubstrate = await seedPostingSubstrate(
    tenantBackOffice,
    ownerBackOffice,
    "BACKOFFICE",
  );
});

describe("degraded entitlement (README §8 #7)", () => {
  it("a missing OPTIONAL key hides cleanly — the nav item drops, nothing else degrades", async () => {
    const result = await withTenant(tenantOptional, () =>
      applyService.apply(ownerOptional, { templateKey: "industry.retail", mode: "initial" }),
    );
    expect(result.applied).toBe(true);

    resetConfigurationCache();
    const config = await withTenant(tenantOptional, () =>
      resolver.resolveTenantStatic(tenantOptional),
    );
    // The IMEI nav item (feature_key inventory.serial_tracking) HIDES; the
    // stock group survives with its ungated item (transfers).
    expect(config.ui.navigation).toEqual(["selling", "stock"]);
    const stock = config.ui.navigation_tree.find((group) => group.id === "stock")!;
    expect(stock.items.map((item) => item.id)).toEqual(["transfers"]);
    // The selling group is untouched (POS entitled on business).
    const selling = config.ui.navigation_tree.find((group) => group.id === "selling")!;
    expect(selling.items.map((item) => item.id)).toEqual(["pos", "returns", "receipts"]);
    // The OPTIONAL capability is classified hidden in the applied result.
    const imei = result.prerequisiteCheck.capabilities.find(
      (capability) => capability.capabilityId === "imei_tracking",
    );
    expect(imei).toMatchObject({
      status: "hidden",
      missingKeys: ["inventory.serial_tracking"],
    });
    // L4 reports the missing key (the upgrade-path payload the UI explains).
    expect(config.layers.l4_entitlements.missing).toContain("inventory.serial_tracking");
  });

  it("a missing REQUIRED key BLOCKS apply with the exact chain + AR/EN guidance", async () => {
    await expect(
      withTenant(tenantBlocked, () =>
        applyService.apply(ownerBlocked, { templateKey: "industry.grocery", mode: "initial" }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.grocery",
      missingChain: ["inventory.batch_tracking"],
      guidance: {
        ar: expect.stringContaining("inventory.batch_tracking"),
        en: expect.stringContaining("inventory.batch_tracking"),
      },
    });
    // Never silent AND never partial: zero rows were written.
    expect(await withTenant(tenantBlocked, () => findAppliedStateRow())).toBeUndefined();
    const su = await superuserClient();
    const series = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM numbering_sequences WHERE tenant_id = $1`,
      [tenantBlocked],
    );
    await su.end();
    expect(series.rows[0]!.n).toBe("0");
  });

  it("PHASE-016 shipped the POS set: floor items resolve LIVE, back-office trading works", async () => {
    // Apply restaurant on the full business plan: the POS capabilities
    // (table_service / barcode_pos / composite_kits) are LIVE since 016 —
    // the intake keys registered + granted; the floor nav resolves
    // without gates and apply proceeds fully included.
    const result = await withTenant(tenantBackOffice, () =>
      applyService.apply(ownerBackOffice, { templateKey: "industry.restaurant", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(
      result.prerequisiteCheck.capabilities.find(
        (capability) => capability.capabilityId === "table_service",
      ),
    ).toMatchObject({ status: "included" });
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // The nav items are PRESENT and LIVE (never hidden, never broken):
    resetConfigurationCache();
    const config = await withTenant(tenantBackOffice, () =>
      resolver.resolveTenantStatic(tenantBackOffice),
    );
    const floor = config.ui.navigation_tree.find((group) => group.id === "floor")!;
    const tables = floor.items.find((item) => item.id === "tables")!;
    expect(tables).toMatchObject({
      feature_key: "pos.table_service",
    });
    expect(tables.phase_gated).toBeUndefined();
    expect(floor.items.find((item) => item.id === "kitchen")!.phase_gated).toBeUndefined();

    // Back-office mode WORKS: the tenant posts a real invoice AFTER the
    // apply — the full sales flow (create → submit → approve → post) with
    // the balanced NS journal.
    const invoice = await postServiceInvoice(backOfficeSubstrate, "back-office after apply");
    expect(invoice.invoiceNo).toMatch(/^SAL-2026-\d{6}$/);
    const lines = await withTenant(tenantBackOffice, async () => {
      const journal = await import("../../modules/accounting/infrastructure/journal.store");
      return journal.listLines(invoice.journalEntryId);
    });
    const debits = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    const credits = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    expect(debits).toBe(100);
    expect(credits).toBe(100);
    // The applied template is unaffected by the posting (INV-022).
    const row = await withTenant(tenantBackOffice, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.restaurant");
  });
});
