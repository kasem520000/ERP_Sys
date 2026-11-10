import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  EmployeeNotFoundError,
  EmployeeStatusError,
  PayrollCodeConflictError,
  StructureNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { EmployeeRow } from "../infrastructure/payroll.store";

/**
 * Employee service (PHASE-029 T2): CRUD + the status lifecycle + the C-PII
 * discipline. Reads are AUDIT EVENTS (every employee read records
 * payroll.employee_read — the restricted-read trail the attack rows probe);
 * responses mask national_id/bank fields unless the caller holds the
 * restricted permission AND the field is required by the screen context
 * (the controller decides; this service exposes both raw + masked shapes).
 *
 * Status machine (employee_status §9): ACTIVE ⇄ SUSPENDED;
 * ACTIVE/SUSPENDED → TERMINATED (date + reason required); TERMINATED is
 * terminal (EOS settlement reads the frozen row — reactivate is
 * deliberately absent, the honest lifecycle).
 */

/** The masked response shape (C-PII fields never leave unmasked by default). */
export interface EmployeeView {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  nationalIdMasked: string | null;
  hireDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  contractType: string;
  basicSalary: string;
  salaryStructureId: string | null;
  branchId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  bankMasked: { name: string | null; ibanTail: string | null; accountTail: string | null };
  status: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
}

/** Mask a national id: keep the first 2 + last 2 characters only. */
function maskNationalId(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 10))}${value.slice(-2)}`;
}

function maskTail(value: string | null, keep = 4): string | null {
  if (value === null || value.length === 0) return null;
  if (value.length <= keep) return "****";
  return `****${value.slice(-keep)}`;
}

export function toEmployeeView(row: EmployeeRow): EmployeeView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.nameAr,
    nationalIdMasked: maskNationalId(row.nationalId),
    hireDate: row.hireDate,
    terminationDate: row.terminationDate,
    terminationReason: row.terminationReason,
    contractType: row.contractType,
    basicSalary: row.basicSalary,
    salaryStructureId: row.salaryStructureId,
    branchId: row.branchId,
    costCenterId: row.costCenterId,
    projectId: row.projectId,
    bankMasked: {
      name: row.bankName === null ? null : maskTail(row.bankName, 3),
      ibanTail: maskTail(row.bankIban),
      accountTail: maskTail(row.bankAccount),
    },
    status: row.status,
    note: row.note,
    noteAr: row.noteAr,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class EmployeeService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { status?: store.EmployeeStatus; branchId?: string; limit?: number }) {
    return store.listEmployees({
      status: filter.status,
      branchId: filter.branchId,
      limit: Math.min(filter.limit ?? 200, 500),
    });
  }

  /**
   * The restricted read: EVERY read audits (payroll.employee_read — the
   * PII access trail). The controller wraps the result in masking; the
   * audit event happens here regardless of masking (the access itself is
   * the event).
   */
  async get(id: string, actorId: string | null): Promise<EmployeeRow> {
    const employee = await store.findEmployeeById(id);
    if (employee === undefined) throw new EmployeeNotFoundError(id);
    await this.audit.record({
      action: "payroll.employee_read",
      entityType: "employee",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { code: employee.code, status: employee.status },
    });
    return employee;
  }

  async create(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    nationalId?: string | null;
    hireDate: string;
    contractType: store.ContractType;
    basicSalary: string;
    salaryStructureId?: string | null;
    branchId?: string | null;
    costCenterId?: string | null;
    projectId?: string | null;
    bankName?: string | null;
    bankIban?: string | null;
    bankAccount?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<EmployeeRow> {
    if ((await store.findEmployeeByCode(input.code)) !== undefined) {
      throw new PayrollCodeConflictError({ entity: "employee", code: input.code });
    }
    if (input.salaryStructureId !== undefined && input.salaryStructureId !== null) {
      const structure = await store.findStructureById(input.salaryStructureId);
      if (structure === undefined) throw new StructureNotFoundError(input.salaryStructureId);
    }
    const created = await store.insertEmployee({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "payroll.employee_created",
      entityType: "employee",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, contractType: created.contractType, basicSalary: created.basicSalary },
    });
    return created;
  }

  async update(
    id: string,
    patch: store.EmployeeUpdatePatch,
    actorId: string | null,
  ): Promise<EmployeeRow> {
    const employee = await store.findEmployeeById(id);
    if (employee === undefined) throw new EmployeeNotFoundError(id);
    if (employee.status === "TERMINATED" && patch.status === undefined) {
      // TERMINATED rows are frozen except the note fields (the audit/EOS
      // history — the honest lifecycle; no reactivate exists).
      const noteOnly =
        Object.keys(patch).every((key) => key === "note" || key === "noteAr") &&
        Object.keys(patch).length > 0;
      if (!noteOnly) {
        throw new EmployeeStatusError({
          employeeId: id,
          from: employee.status,
          to: "(edit)",
          reason: "TERMINATED employees are frozen (note edits only)",
        });
      }
    }
    if (patch.salaryStructureId !== undefined && patch.salaryStructureId !== null) {
      const structure = await store.findStructureById(patch.salaryStructureId);
      if (structure === undefined) throw new StructureNotFoundError(patch.salaryStructureId);
    }
    if (patch.status !== undefined && patch.status !== employee.status) {
      this.assertStatusTransition(employee.status, patch.status);
    }
    const updated = await store.updateEmployee(id, patch);
    await this.audit.record({
      action: "payroll.employee_updated",
      entityType: "employee",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: employee.status, basicSalary: employee.basicSalary },
      after: { status: updated.status, basicSalary: updated.basicSalary },
    });
    return updated;
  }

  /** ACTIVE ⇄ SUSPENDED; → TERMINATED (date + reason required); TERMINATED terminal. */
  private assertStatusTransition(from: store.EmployeeStatus, to: store.EmployeeStatus): void {
    if (from === "TERMINATED") {
      throw new EmployeeStatusError({
        employeeId: "",
        from,
        to,
        reason: "TERMINATED is terminal (the EOS/audit history stays frozen)",
      });
    }
    if (to === "TERMINATED") return; // validated by the caller (date + reason)
    if (from === "ACTIVE" && to === "SUSPENDED") return;
    if (from === "SUSPENDED" && to === "ACTIVE") return;
    throw new EmployeeStatusError({ employeeId: "", from, to });
  }

  async suspend(id: string, actorId: string | null): Promise<EmployeeRow> {
    const employee = await store.findEmployeeById(id);
    if (employee === undefined) throw new EmployeeNotFoundError(id);
    if (employee.status !== "ACTIVE") {
      throw new EmployeeStatusError({ employeeId: id, from: employee.status, to: "SUSPENDED" });
    }
    const updated = await store.updateEmployee(id, { status: "SUSPENDED" });
    await this.audit.record({
      action: "payroll.employee_suspended",
      entityType: "employee",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "ACTIVE" },
      after: { status: "SUSPENDED" },
    });
    return updated;
  }

  async reactivate(id: string, actorId: string | null): Promise<EmployeeRow> {
    const employee = await store.findEmployeeById(id);
    if (employee === undefined) throw new EmployeeNotFoundError(id);
    if (employee.status !== "SUSPENDED") {
      throw new EmployeeStatusError({ employeeId: id, from: employee.status, to: "ACTIVE" });
    }
    const updated = await store.updateEmployee(id, { status: "ACTIVE" });
    await this.audit.record({
      action: "payroll.employee_reactivated",
      entityType: "employee",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: "SUSPENDED" },
      after: { status: "ACTIVE" },
    });
    return updated;
  }

  /**
   * TERMINATE (the G-31 trigger): stamps the date + reason, status →
   * TERMINATED. The EOS settlement itself is the eos-service's separate,
   * audited step (settle or explicitly skip — never silent).
   */
  async terminate(
    id: string,
    input: { terminationDate: string; reason?: string | null; actorId: string | null },
  ): Promise<EmployeeRow> {
    const employee = await store.findEmployeeById(id);
    if (employee === undefined) throw new EmployeeNotFoundError(id);
    if (employee.status === "TERMINATED") {
      throw new EmployeeStatusError({
        employeeId: id,
        from: employee.status,
        to: "TERMINATED",
        reason: "already terminated",
      });
    }
    if (input.terminationDate < employee.hireDate) {
      throw new EmployeeStatusError({
        employeeId: id,
        from: employee.status,
        to: "TERMINATED",
        reason: "termination date precedes the hire date",
      });
    }
    const updated = await store.updateEmployee(id, {
      status: "TERMINATED",
      terminationDate: input.terminationDate,
      terminationReason: input.reason ?? null,
    });
    await this.audit.record({
      action: "payroll.employee_terminated",
      entityType: "employee",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: employee.status },
      after: {
        status: "TERMINATED",
        terminationDate: input.terminationDate,
        reason: input.reason ?? null,
      },
    });
    return updated;
  }
}
