import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { findEntryBySourceKey } from "../../accounting/infrastructure/journal.store";
import { findSupplierInvoiceById } from "../../purchasing/infrastructure/purchasing.store";
import { SupplierInvoiceNotFoundError } from "../../purchasing/domain/purchasing-errors";
import { findBranchById } from "../../tenancy/infrastructure/tenancy.store";
import { findMembershipForUserInTenant } from "../../identity/api/identity";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/fixed-assets.store";
import { assertCategoryUsable, DEPRECIATION_METHODS } from "./category-service";
import {
  AssetCategoryNotFoundError,
  AssetCodeConflictError,
  BranchNotFoundError,
  CapitalizationError,
  InvalidAssetInputError,
  UserNotFoundError,
} from "../domain/fixed-assets-errors";

/**
 * Purchasing capitalization hook (PHASE-026 T5) — the SECOND acquisition
 * path (reusing the PHASE-011 documents per the phase spec §2.4).
 *
 * ══════════════════════════════════════════════════════════════════════
 * HONEST-PORT DESIGN (no purchasing changes in this phase)
 * ══════════════════════════════════════════════════════════════════════
 * The full GRN-flagged chain wants a `capital_expense` boolean +
 * `asset_category_id` uuid on `goods_receipt_lines` so a flagged line's
 * GRN debit routes to the category's FIXED_ASSET account instead of
 * inventory (`DR FIXED_ASSET · CR GRNI`; the supplier invoice then clears
 * GRNI → AP_CONTROL with recoverable VAT, netting to G-21). Those columns
 * do NOT exist in the PHASE-011 schema and adding them is a purchasing-
 * owned schema change — deliberately out of this phase's minimal-invasion
 * scope. This file therefore exports the PORT instead:
 *
 *   - {@link CapitalExpenseLineEffect} + {@link buildCapitalExpenseJournalLine}:
 *     the line-builder purchasing WILL call per flagged GRN line at its
 *     adoption point (additive columns + one call in
 *     purchasing/application/goods-receipts.ts where the per-line debit is
 *     composed — no other purchasing change).
 *   - {@link PurchaseCapitalizationPort} / {@link purchaseCapitalizationPort}:
 *     the injectable port object.
 *   - {@link PurchaseCapitalizationService.createFromPurchase}: the direct
 *     invoice-side acquisition available TODAY — creates + capitalizes an
 *     asset straight off a POSTED supplier invoice (G-21 credit shape),
 *     binding PO/GRN/invoice refs. The chain fixture proof (GRN → supplier
 *     invoice → asset ACTIVE; net posting = G-21; inventory untouched)
 *     lives in the orchestrator-owned DB suite.
 *
 * Double-count guard (documented contract): `createFromPurchase` posts its
 * OWN G-21 journal (`DR FIXED_ASSET · CR AP_CONTROL`). The referenced
 * supplier invoice must NOT also carry an asset-account line for the same
 * cost — direct invoice-capitalization replaces the inventory/expense leg,
 * it does not ride one. When the GRN-flag adoption lands, flagged lines
 * will carry the FIXED_ASSET debit in the GRN journal and the register
 * binding will be register-only (no second posting) — that wire-up is the
 * purchasing-side adoption point, not this file.
 *
 * Money is base-currency decimal strings (the register is base-denominated
 * per DR-002 — no FX dimension); the capitalizable cost is the net-of-
 * recoverable-VAT value (recoverable VAT completes cost via the invoice's
 * own PHASE-009 legs, not here).
 */

// -- the GRN-line port (purchasing-side adoption point) ------------------------------

/** What purchasing will pass per flagged capital-expense GRN line. */
export interface CapitalExpenseLineEffect {
  grnLineId: string;
  assetCategoryId: string;
  /** Line value in base currency (qty × unit cost, 4dp). */
  amount: string;
}

/**
 * Build the GRN journal line for a capital-expense GRN line: the debit
 * routes to the category's FIXED_ASSET purpose instead of inventory.
 * Fail-closed: an unknown category (A7 typed 404) or a BR-041-unusable
 * category THROWS — a flagged line must never silently fall back to
 * inventory (double-count risk, PHASE-026 §7). Returns null only for a
 * zero amount (nothing to post — mirrors the GRN builder's skip).
 */
export async function buildCapitalExpenseJournalLine(
  effect: CapitalExpenseLineEffect,
): Promise<JournalLineSpec | null> {
  const amount = new Decimal(effect.amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  if (new Decimal(amount).lte(0)) return null;
  const category = await store.findAssetCategoryById(effect.assetCategoryId);
  if (category === undefined) throw new AssetCategoryNotFoundError(effect.assetCategoryId);
  await assertCategoryUsable(category);
  return {
    purpose: category.assetPurposeKey,
    direction: "DEBIT",
    amount,
    memo: {
      en: `Capital expense — GRN line ${effect.grnLineId}`,
      ar: `مصروف رأسمالي — سطر استلام ${effect.grnLineId}`,
    },
  };
}

/** The port purchasing can inject/call when it adopts capital-expense flags. */
export interface PurchaseCapitalizationPort {
  buildCapitalExpenseJournalLine(effect: CapitalExpenseLineEffect): Promise<JournalLineSpec | null>;
}

/** Default binding (pure functions — no DI state needed). */
export const purchaseCapitalizationPort: PurchaseCapitalizationPort = {
  buildCapitalExpenseJournalLine,
};

// -- direct invoice-side acquisition (available today) --------------------------------

export interface CreateFromPurchaseInput {
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  /** Capitalizable cost (base currency, net of recoverable VAT), 4dp. */
  cost: string;
  /** The POSTED supplier invoice that funds the acquisition (A7 typed 404). */
  supplierInvoiceId: string;
  /** Optional chain refs — recorded on the binding audit event + note. */
  grnId?: string | null;
  poId?: string | null;
  branchId?: string;
  acquisitionDate?: string;
  salvageValue?: string;
  openingAccumulated?: string;
  usefulLifeMonths?: number;
  depreciationMethod?: string;
  totalEstimatedUnits?: string | null;
  custodianUserId?: string | null;
  postingDate?: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const UNITS_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

@Injectable()
export class PurchaseCapitalizationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /**
   * Create + capitalize an asset directly off a POSTED supplier invoice
   * (G-21 credit): the register row is born with source_type
   * `supplier_invoice` / source_id = the invoice id, and the journal
   * `DR FIXED_ASSET (category purpose) cost · CR AP_CONTROL (the
   * invoice's supplier — INV-009 partner line) cost` posts through the
   * engine with source (FIXED_ASSET_CAPITALIZATION, assetId, post) —
   * INV-013 idempotent per asset.
   *
   * Call-level idempotency: retrying with the SAME (code, supplier
   * invoice) pair replays the stored asset + its journal (no second
   * register row, no second entry — S-04 zero residue); the same code on
   * a different source is an ASSET_CODE_CONFLICT. Everything runs in the
   * caller's ambient tenant UoW — an engine rejection rolls the whole
   * creation back.
   */
  async createFromPurchase(input: CreateFromPurchaseInput): Promise<{
    asset: store.AssetRow;
    journalEntryId: string | null;
    idempotentReplay: boolean;
  }> {
    const code = input.code.trim();
    if (code === "") {
      throw new InvalidAssetInputError("asset code is required (tenant-scoped natural key, ADR-0006)");
    }
    if (input.name.trim() === "" || input.nameAr.trim() === "") {
      throw new InvalidAssetInputError("asset name and nameAr are both required (§3 bilingual rules)");
    }
    if (!MONEY_RE.test(input.cost)) {
      throw new InvalidAssetInputError(
        `cost must be a non-negative decimal string with ≤ 4 decimals (ADR-0009): ${input.cost}`,
        { cost: input.cost },
      );
    }
    if (new Decimal(input.cost).lte(0)) {
      throw new CapitalizationError(
        `purchase capitalization requires a positive cost (journal lines must be > 0): ${input.cost}`,
        { cost: input.cost },
      );
    }

    // The funding invoice (A7 typed 404 via purchasing's own stable error)
    // — must be POSTED: the AP leg it funds is already in the ledger.
    const invoice = await findSupplierInvoiceById(input.supplierInvoiceId);
    if (invoice === undefined) throw new SupplierInvoiceNotFoundError(input.supplierInvoiceId);
    if (invoice.status !== "POSTED") {
      throw new CapitalizationError(
        `supplier invoice ${input.supplierInvoiceId} (${invoice.invoiceNo}) is ${invoice.status} — purchase capitalization binds POSTED invoices only (the AP leg must already be booked)`,
        { supplierInvoiceId: input.supplierInvoiceId, status: invoice.status },
      );
    }

    // Category (A7 typed 404) + BR-041 at the posting boundary.
    const category = await store.findAssetCategoryById(input.categoryId);
    if (category === undefined) throw new AssetCategoryNotFoundError(input.categoryId);
    if (!category.active) {
      throw new InvalidAssetInputError(
        `asset category ${category.code} is inactive — new assets register under active categories only (INV-015)`,
        { categoryId: input.categoryId, code: category.code },
      );
    }
    await assertCategoryUsable(category);

    // Life / method defaults from the category.
    const life = input.usefulLifeMonths ?? category.usefulLifeMonthsDefault;
    if (!Number.isInteger(life) || life < 1 || life > 1200) {
      throw new InvalidAssetInputError(
        `usefulLifeMonths must be an integer between 1 and 1200 (got ${String(life)})`,
        { usefulLifeMonths: life },
      );
    }
    const method = input.depreciationMethod ?? category.depreciationMethodDefault;
    if (!(DEPRECIATION_METHODS as readonly string[]).includes(method)) {
      throw new InvalidAssetInputError(
        `depreciationMethod must be one of ${DEPRECIATION_METHODS.join(" | ")} (DATA_DICTIONARY §9)`,
        { depreciationMethod: method },
      );
    }

    // Money shape (INV-023 preconditions, service-side typed pack).
    const salvage = input.salvageValue ?? "0";
    const opening = input.openingAccumulated ?? "0";
    if (!MONEY_RE.test(salvage)) {
      throw new InvalidAssetInputError(`salvageValue must be a non-negative decimal (≤ 4dp): ${salvage}`);
    }
    if (!MONEY_RE.test(opening)) {
      throw new InvalidAssetInputError(`openingAccumulated must be a non-negative decimal (≤ 4dp): ${opening}`);
    }
    const costD = new Decimal(input.cost);
    const salvageD = new Decimal(salvage);
    const openingD = new Decimal(opening);
    if (salvageD.comparedTo(costD) > 0) {
      throw new InvalidAssetInputError(
        `salvageValue ${salvage} cannot exceed cost ${input.cost} (INV-023)`,
        { cost: input.cost, salvageValue: salvage },
      );
    }
    if (openingD.comparedTo(costD.minus(salvageD)) > 0) {
      throw new InvalidAssetInputError(
        `openingAccumulated ${opening} cannot exceed the depreciable base cost − salvage (INV-023)`,
        { cost: input.cost, salvageValue: salvage, openingAccumulated: opening },
      );
    }

    // UoP total units (DB CHECK parity).
    let totalEstimatedUnits: string | null = null;
    if (method === "UNITS_OF_PRODUCTION") {
      if (input.totalEstimatedUnits === undefined || input.totalEstimatedUnits === null) {
        throw new InvalidAssetInputError(
          "UNITS_OF_PRODUCTION assets require totalEstimatedUnits > 0",
          { depreciationMethod: method },
        );
      }
      if (!UNITS_RE.test(input.totalEstimatedUnits) || new Decimal(input.totalEstimatedUnits).lte(0)) {
        throw new InvalidAssetInputError(
          `totalEstimatedUnits must be a positive decimal (≤ 6dp): ${input.totalEstimatedUnits}`,
          { totalEstimatedUnits: input.totalEstimatedUnits },
        );
      }
      totalEstimatedUnits = new Decimal(input.totalEstimatedUnits).toFixed(6);
    }

    // FK bindings (A7 typed 404s; membership-scoped custodian).
    const branchId = input.branchId ?? invoice.branchId;
    if ((await findBranchById(branchId)) === undefined) {
      throw new BranchNotFoundError(branchId);
    }
    if (input.custodianUserId !== undefined && input.custodianUserId !== null) {
      const { tenantId } = requireTenantContext();
      const membership = await findMembershipForUserInTenant(input.custodianUserId, tenantId);
      if (membership === undefined) throw new UserNotFoundError(input.custodianUserId);
    }

    // Call-level idempotency: same (code, invoice) → replay.
    const existing = await store.findAssetByCode(code);
    if (existing !== undefined) {
      if (existing.sourceType === "supplier_invoice" && existing.sourceId === input.supplierInvoiceId) {
        const entry = await findEntryBySourceKey("FIXED_ASSET_CAPITALIZATION", existing.id, "post");
        return {
          asset: existing,
          journalEntryId: entry?.id ?? null,
          idempotentReplay: true,
        };
      }
      throw new AssetCodeConflictError({ code, existingId: existing.id });
    }

    const acquisitionDate = input.acquisitionDate ?? invoice.invoiceDate;
    if (!DATE_RE.test(acquisitionDate)) {
      throw new InvalidAssetInputError(
        `acquisitionDate must be an ISO date (yyyy-mm-dd): ${acquisitionDate}`,
        { acquisitionDate },
      );
    }
    const postingDate = input.postingDate ?? invoice.postingDate ?? invoice.invoiceDate;
    if (!DATE_RE.test(postingDate)) {
      throw new InvalidAssetInputError(
        `postingDate must be an ISO date (yyyy-mm-dd): ${postingDate}`,
        { postingDate },
      );
    }

    // Register row first (status ACTIVE, source bound at INSERT): a later
    // engine rejection rolls the whole UoW back — zero partial creation.
    const created = await store.insertAsset({
      code,
      name: input.name.trim(),
      nameAr: input.nameAr.trim(),
      categoryId: input.categoryId,
      acquisitionDate,
      cost: money4(input.cost),
      salvageValue: money4(salvage),
      openingAccumulated: money4(opening),
      usefulLifeMonths: life,
      depreciationMethod: method,
      totalEstimatedUnits,
      branchId,
      custodianUserId: input.custodianUserId ?? null,
      status: "ACTIVE",
      sourceType: "supplier_invoice",
      sourceId: input.supplierInvoiceId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });

    // G-21 credit journal (INV-009 partner line on AP_CONTROL).
    const base = await ownTenantBaseCurrency();
    const cost = money4(input.cost);
    const memo = {
      en: `Purchase capitalization ${created.code} — invoice ${invoice.invoiceNo}`,
      ar: `رسملة شراء ${created.code} — فاتورة ${invoice.invoiceNo}`,
    };
    const result = await this.posting.post(
      {
        source: { docType: "fixed_asset_capitalization", docId: created.id, operation: "post" },
        entryDate: postingDate,
        description: {
          en: `Fixed-asset acquisition ${created.code} via supplier invoice ${invoice.invoiceNo}`,
          ar: `اقتناء أصل ثابت ${created.code} عبر فاتورة مورد ${invoice.invoiceNo}`,
        },
        currency: base,
        lines: [
          { purpose: category.assetPurposeKey, direction: "DEBIT", amount: cost, memo },
          {
            purpose: "AP_CONTROL",
            direction: "CREDIT",
            amount: cost,
            partnerId: invoice.supplierId,
            memo,
          },
        ],
      },
      { postedBy: input.actorId },
    );

    const current = (await store.findAssetById(created.id)) ?? created;
    if (!result.idempotentReplay) {
      await this.audit.record({
        action: "fixed_assets.asset_created_from_purchase",
        entityType: "asset",
        entityId: created.id,
        actorId: input.actorId ?? undefined,
        after: {
          code: created.code,
          categoryId: created.categoryId,
          supplierInvoiceId: input.supplierInvoiceId,
          supplierId: invoice.supplierId,
          grnId: input.grnId ?? null,
          poId: input.poId ?? invoice.poId,
          cost,
          journalEntryId: result.journalEntryId,
          postingDate,
        },
      });
    }
    return { asset: current, journalEntryId: result.journalEntryId, idempotentReplay: result.idempotentReplay };
  }
}
