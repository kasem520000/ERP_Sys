import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { RouteService } from "./application/route-service";
import { VisitService } from "./application/visit-service";
import { VanStockService } from "./application/van-stock-service";
import { SettlementService } from "./application/settlement-service";
import { TierService } from "./application/tier-service";
import { FreeGoodsService } from "./application/free-goods-service";
import { DistributionController } from "./presentation/distribution.controller";

/**
 * Distribution module (PHASE-017 T7/T8/T10/T11): routes + visits (planning-
 * only — drives no posting, CAPABILITY_MATRIX §2.4), van stock (VAN-typed
 * warehouses fed by ordinary two-leg stock transfers wrapped from
 * inventory's TransferService — DRAFT → IN_TRANSIT → POSTED, BR-016
 * in-transit never sellable), the day-end rep settlements (STL-,
 * BR-021 variance always posts), and the T11 customer price tiers +
 * free-goods rules (BR-003 tier price lists / BR-008 zero-price FOC
 * lines — the sale-time application runs through the sales pricing seam
 * and FreeGoodsService.appendFocLines, never a journal of its own).
 *
 * Dependencies: audit + inventory (the TransferService export — the ONLY
 * stock_moves writer, INV-010) + accounting (PostingService/NumberingService
 * for the settlement's variance/deposit journals and the STL- series —
 * ADR-0007: every journal flows through the centralized engine). The tier
 * service writes partners.customer_tier_id through the partners store's
 * additive updatePartnerTier (the documented tier-slice exception).
 */
@Module({
  imports: [AccountingModule, AuditModule, InventoryModule],
  controllers: [DistributionController],
  providers: [RouteService, VisitService, VanStockService, SettlementService, TierService, FreeGoodsService],
  exports: [RouteService, VisitService, VanStockService, SettlementService, TierService, FreeGoodsService],
})
export class DistributionModule {}
