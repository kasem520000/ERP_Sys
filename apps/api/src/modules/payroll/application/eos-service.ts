import { Inject, Injectable } from "@nestjs/common";

import { sql } from "drizzle-orm";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  EosBasisRequiredError,
  EosSettlementExceedsBalanceError,
  EmployeeNotFoundError,
  PayrollStateError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import {
  insertCashMovement,
  findCashAccountById,
} from "../../treasury/infrastructure/treasury.store";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";

/**
 * EOS service (PHASE-029 T9 — BR-055 + G-31): the tenant-policy accrual
 * (computed inside the run by the calculation service — Σ is_eos_base
 * values × basis days / 30, posted as the run journal's EOS legs) and
 * the termination settlement.
 *
 * G-31 settlement at termination: DR EOS_PROVISION (the employee's
 * provision balance) · CR CASH (settled) · CR EOS_PROVISION_EXPENSE (the
 * residual release). Settling above the balance dies typed (the mirror
 * case). The settlement stamps the employee row (eos_settled_amount +
 * journal linkage — one settlement per terminated employee, terminal).
 *
 * NO jurisdiction rates exist anywhere in this file (BR-055 — the grep
 * proof's second target after the settings defaults): the basis is the
 * tenant's explicit policy value, nothing else.
 */

@Injectable()
export class EosService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /**
   * The tenant's EOS policy (validated): enabled requires an explicit
   * basis — enabling without one is the typed EOS_BASIS_REQUIRED error.
   */
  async policy(): Promise<{ enabled: boolean; basisDays: number | null }> {
    const enabled = (await readEffectiveSetting<boolean>("payroll.eos.enabled")) ?? false;
    const basisDays =
      await readEffectiveSetting<number | null>("payroll.eos.accrual_days_per_service_year");
    if (enabled && (basisDays === null || basisDays === undefined)) {
      throw new EosBasisRequiredError();
    }
    return { enabled, basisDays: basisDays ?? null };
  }

  /**
   * The per-employee provision view: accrued = Σ eos_accrual over the
   * employee's POSTED-run lines; settled = the cash amount stamped at the
   * one-shot settlement; balance = accrued while unsettled, 0 after (the
   * G-31 extinguishes the FULL balance — the residual above the cash
   * settled releases to EOS_PROVISION_EXPENSE, so a settled employee
   * carries no residual provision).
   */
  async balanceFor(employeeId: string): Promise<{
    accrued: string;
    settled: string | null;
    balance: string;
  }> {
    const employee = await store.findEmployeeById(employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(employeeId);
    const lines = await listEmployeeRunLines(employeeId);
    let accrued = "0.0000";
    for (const line of lines) {
      accrued = addExact(accrued, line.eosAccrual);
    }
    const settled = employee.eosSettledAmount;
    const balance = settled === null ? accrued : "0.0000";
    return { accrued, settled, balance };
  }

  /**
   * G-31 settlement at termination: settled ≤ balance (typed mirror
   * rejection above); the residual releases to EOS_PROVISION_EXPENSE.
   * DR EOS_PROVISION balance · CR CASH settled · CR EOS_PROVISION_EXPENSE
   * residual. One settlement per employee (terminal — the row stamps).
   */
  async settle(
    employeeId: string,
    input: {
      settledAmount: string;
      cashAccountId: string;
      entryDate?: string;
      actorId: string | null;
    },
  ): Promise<{ journalEntryId: string; settled: string; residual: string }> {
    const employee = await store.findEmployeeById(employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(employeeId);
    if (employee.status !== "TERMINATED") {
      throw new PayrollStateError({
        entity: "employee",
        id: employeeId,
        from: employee.status,
        to: "EOS settlement",
        reason: "settle at termination (terminate the employee first)",
      });
    }
    if (employee.eosSettledAmount !== null) {
      throw new PayrollStateError({
        entity: "employee",
        id: employeeId,
        from: "TERMINATED",
        to: "EOS settlement",
        reason: "already settled (one settlement per employee — terminal)",
      });
    }
    const { balance } = await this.balanceFor(employeeId);
    if (compareExact(input.settledAmount, balance) > 0 || compareExact(input.settledAmount, "0.0000") < 0) {
      throw new EosSettlementExceedsBalanceError({
        employeeId,
        settled: input.settledAmount,
        balance,
      });
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      const { CashAccountNotFoundError } = await import("../../treasury/domain/treasury-errors");
      throw new CashAccountNotFoundError(input.cashAccountId);
    }
    const residual = subExact(balance, input.settledAmount);
    const base = await ownTenantBaseCurrency();
    const entryDate =
      input.entryDate === undefined ? new Date().toISOString().slice(0, 10) : input.entryDate;

    const lines: JournalLineSpec[] = [
      {
        purpose: "EOS_PROVISION",
        direction: "DEBIT",
        amount: balance,
        memo: { en: "EOS provision release (G-31)", ar: "إطفاء مخصص نهاية الخدمة (G-31)" },
      },
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount: input.settledAmount,
        memo: { en: `EOS settlement via ${account.name}`, ar: `تسوية نهاية الخدمة عبر ${account.name}` },
      },
    ];
    if (compareExact(residual, "0.0000") !== 0) {
      lines.push({
        purpose: "EOS_PROVISION_EXPENSE",
        direction: "CREDIT",
        amount: residual,
        memo: { en: "EOS residual release (G-31)", ar: "تحرير الفرق من مخصص نهاية الخدمة (G-31)" },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "employee", docId: employeeId, operation: "eos_settle" },
      entryDate,
      description: {
        en: `EOS settlement — ${employee.code} (G-31)`,
        ar: `تسوية نهاية الخدمة — ${employee.code} (G-31)`,
      },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    if (compareExact(input.settledAmount, "0.0000") > 0) {
      await insertCashMovement({
        cashAccountId: account.id,
        direction: "OUT",
        amount: input.settledAmount,
        currencyCode: base,
        exchangeRate: "1",
        baseAmount: input.settledAmount,
        sourceType: "payroll_payout",
        sourceId: employeeId,
        valueDate: entryDate,
        memo: `EOS settlement ${employee.code}`,
        memoAr: `تسوية نهاية الخدمة ${employee.code}`,
      });
    }

    await store.updateEmployee(employeeId, {
      eosSettledAmount: input.settledAmount,
      eosSettlementJournalEntryId: result.journalEntryId,
      eosSettledAt: new Date().toISOString(),
    });
    await this.audit.record({
      action: "payroll.eos_settled",
      entityType: "employee",
      entityId: employeeId,
      actorId: input.actorId ?? undefined,
      after: {
        settled: input.settledAmount,
        residual,
        balance,
        journalEntryId: result.journalEntryId,
      },
    });
    return { journalEntryId: result.journalEntryId, settled: input.settledAmount, residual };
  }
}

/** The employee's POSTED-run lines (the accrual source of truth). */
async function listEmployeeRunLines(employeeId: string) {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("payroll access requires an ambient tenant scope");
  }
  const rows = await context.tx.execute(sql`
    SELECT l.eos_accrual AS "eosAccrual"
    FROM payroll_run_lines l
    JOIN payroll_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
    WHERE l.employee_id = ${employeeId} AND r.status = 'POSTED'
  `);
  return rows.rows as unknown as { eosAccrual: string }[];
}
