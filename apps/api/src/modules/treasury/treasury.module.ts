import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { TaxModule } from "../tax/tax.module";
import { AccountService } from "./application/account-service";
import { AllocationService } from "./application/allocation-service";
import { ReceiptService } from "./application/receipt-service";
import { PaymentService } from "./application/payment-service";
import { PettyCashGuard } from "./application/petty-cash-service";
import { TransferService } from "./application/transfer-service";
import { ExpenseService } from "./application/expense-service";
import { ShiftService } from "./application/shift-service";
import { StatementImportService } from "./application/statement-import-service";
import { BankRecService } from "./application/bank-rec-service";
import { TreasuryReconciliationService } from "./application/treasury-reconciliation-service";
import { SettlementCore } from "./application/fx-settlement";
import { TreasuryController } from "./presentation/treasury.controller";

/**
 * Treasury module (PHASE-008): cash/bank/petty accounts, receipts &
 * payments with partner allocations, petty cash, transfers with charges,
 * expenses, cashier shifts, bank statement import + matching + the
 * per-account period lock, and the INV-019 reconciliation check registered
 * into the PHASE-007 framework.
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (posting
 * engine, periods, numbering, reconciliation framework) + audit — treasury
 * never writes GL tables directly; every journal flows through
 * PostingEngine.post/reverse (ADR-0007). cash_movements is written ONLY by
 * treasury services (MODULE_BOUNDARIES write matrix).
 */
@Module({
  // PHASE-009: + TaxModule (the G-11 expense VAT leg consumes the resolver
  // + posting adapter — the phase doc §4's "consumed by treasury" edge).
  imports: [AccountingModule, AuditModule, TaxModule],
  controllers: [TreasuryController],
  providers: [
    SettlementCore,
    AccountService,
    AllocationService,
    ReceiptService,
    PaymentService,
    PettyCashGuard,
    TransferService,
    ExpenseService,
    ShiftService,
    StatementImportService,
    BankRecService,
    TreasuryReconciliationService,
  ],
  exports: [
    AccountService,
    AllocationService,
    ReceiptService,
    PaymentService,
    TransferService,
    ExpenseService,
    ShiftService,
    PettyCashGuard,
  ],
})
export class TreasuryModule {}
