import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Payroll store (PHASE-029): the ONLY writer of the seven payroll tables
 * (employees, salary_structures, salary_components, payroll_runs,
 * payroll_run_lines, employee_loans, employee_loan_lines). Every statement
 * runs in the caller's ambient tenant UoW so a failure anywhere rolls the
 * whole business operation back.
 *
 * LEDGER WRITES GO THROUGH THE POSTING ENGINE ONLY (ADR-0007): this store
 * never touches journal_entries/journal_lines — the run-posting service
 * posts the one G-29 JournalSpec, the payout service posts G-30, loans
 * post their control-account journal, EOS posts G-31. cash_movements is
 * written ONLY through the treasury store API (treasury-owned, INV-019).
 *
 * payroll_run_lines discipline (INV-003): INSERT + DELETE (DRAFT recalc
 * resets only — the erp.payroll_run_lines_guard trigger owns the DELETE
 * policy) + SELECT. There is NO updateRunLine in this file by construction.
 *
 * C-PII (national_id + bank fields): rows travel typed and whole INSIDE
 * the service boundary; the controller masks responses (restricted
 * permission + screen context) and audits reads. This store never logs.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("payroll access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The ambient tx for spec-level probes (read-only discipline). */
export function requireAmbientTx(): TenantDb {
  return tenantTx();
}

// -- employees -----------------------------------------------------------------------

export type EmployeeStatus = "ACTIVE" | "SUSPENDED" | "TERMINATED";
export type ContractType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR";

export interface EmployeeRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  nationalId: string | null;
  hireDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  contractType: ContractType;
  basicSalary: string;
  salaryStructureId: string | null;
  branchId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  bankName: string | null;
  bankIban: string | null;
  bankAccount: string | null;
  eosSettledAmount: string | null;
  eosSettlementJournalEntryId: string | null;
  eosSettledAt: string | null;
  status: EmployeeStatus;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface EmployeeSqlRow {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  national_id: string | null;
  hire_date: string;
  termination_date: string | null;
  termination_reason: string | null;
  contract_type: ContractType;
  basic_salary: string;
  salary_structure_id: string | null;
  branch_id: string | null;
  cost_center_id: string | null;
  project_id: string | null;
  bank_name: string | null;
  bank_iban: string | null;
  bank_account: string | null;
  eos_settled_amount: string | null;
  eos_settlement_journal_entry_id: string | null;
  eos_settled_at: string | null;
  status: EmployeeStatus;
  note: string | null;
  note_ar: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapEmployee(row: EmployeeSqlRow): EmployeeRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    nationalId: row.national_id,
    hireDate: typeof row.hire_date === "string" ? row.hire_date.slice(0, 10) : String(row.hire_date).slice(0, 10),
    terminationDate:
      row.termination_date === null
        ? null
        : typeof row.termination_date === "string"
          ? row.termination_date.slice(0, 10)
          : String(row.termination_date).slice(0, 10),
    terminationReason: row.termination_reason,
    contractType: row.contract_type,
    basicSalary: row.basic_salary,
    salaryStructureId: row.salary_structure_id,
    branchId: row.branch_id,
    costCenterId: row.cost_center_id,
    projectId: row.project_id,
    bankName: row.bank_name,
    bankIban: row.bank_iban,
    bankAccount: row.bank_account,
    eosSettledAmount: row.eos_settled_amount,
    eosSettlementJournalEntryId: row.eos_settlement_journal_entry_id,
    eosSettledAt: row.eos_settled_at,
    status: row.status,
    note: row.note,
    noteAr: row.note_ar,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

const EMPLOYEE_COLUMNS = sql`id, code, name, name_ar, national_id, hire_date, termination_date,
  termination_reason, contract_type, basic_salary, salary_structure_id, branch_id, cost_center_id,
  project_id, bank_name, bank_iban, bank_account, eos_settled_amount,
  eos_settlement_journal_entry_id, eos_settled_at, status, note, note_ar,
  created_by, created_at, updated_at, version`;

export interface CreateEmployeeInput {
  code: string;
  name: string;
  nameAr?: string | null;
  nationalId?: string | null;
  hireDate: string;
  contractType: ContractType;
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
  createdBy: string | null;
}

export async function insertEmployee(input: CreateEmployeeInput): Promise<EmployeeRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO employees (id, tenant_id, code, name, name_ar, national_id, hire_date,
      contract_type, basic_salary, salary_structure_id, branch_id, cost_center_id, project_id,
      bank_name, bank_iban, bank_account, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
      ${input.nameAr ?? null}, ${input.nationalId ?? null}, ${input.hireDate}, ${input.contractType},
      ${input.basicSalary}, ${input.salaryStructureId ?? null}, ${input.branchId ?? null},
      ${input.costCenterId ?? null}, ${input.projectId ?? null}, ${input.bankName ?? null},
      ${input.bankIban ?? null}, ${input.bankAccount ?? null}, ${input.note ?? null},
      ${input.noteAr ?? null}, ${input.createdBy})
    RETURNING ${EMPLOYEE_COLUMNS}
  `);
  return mapEmployee((rows.rows as unknown as EmployeeSqlRow[])[0]!);
}

export async function findEmployeeById(id: string): Promise<EmployeeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as EmployeeSqlRow[])[0] === undefined
    ? undefined
    : mapEmployee((rows.rows as unknown as EmployeeSqlRow[])[0]!);
}

export async function findEmployeeByCode(code: string): Promise<EmployeeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as EmployeeSqlRow[])[0] === undefined
    ? undefined
    : mapEmployee((rows.rows as unknown as EmployeeSqlRow[])[0]!);
}

export interface EmployeeUpdatePatch {
  eosSettledAmount?: string | null;
  eosSettlementJournalEntryId?: string | null;
  eosSettledAt?: string | null;
  name?: string;
  nameAr?: string | null;
  nationalId?: string | null;
  contractType?: ContractType;
  basicSalary?: string;
  salaryStructureId?: string | null;
  branchId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
  bankName?: string | null;
  bankIban?: string | null;
  bankAccount?: string | null;
  note?: string | null;
  noteAr?: string | null;
  status?: EmployeeStatus;
  terminationDate?: string | null;
  terminationReason?: string | null;
}

export async function updateEmployee(
  id: string,
  patch: EmployeeUpdatePatch,
): Promise<EmployeeRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE employees SET
      eos_settled_amount = ${patch.eosSettledAmount === undefined ? sql`eos_settled_amount` : sql`${patch.eosSettledAmount}`},
      eos_settlement_journal_entry_id = ${patch.eosSettlementJournalEntryId === undefined ? sql`eos_settlement_journal_entry_id` : sql`${patch.eosSettlementJournalEntryId}`},
      eos_settled_at = coalesce(${patch.eosSettledAt ?? null}, eos_settled_at),
      name = coalesce(${patch.name ?? null}, name),
      name_ar = ${patch.nameAr === undefined ? sql`name_ar` : sql`${patch.nameAr}`},
      national_id = ${patch.nationalId === undefined ? sql`national_id` : sql`${patch.nationalId}`},
      contract_type = coalesce(${patch.contractType ?? null}, contract_type),
      basic_salary = coalesce(${patch.basicSalary ?? null}, basic_salary),
      salary_structure_id = ${patch.salaryStructureId === undefined ? sql`salary_structure_id` : sql`${patch.salaryStructureId}`},
      branch_id = ${patch.branchId === undefined ? sql`branch_id` : sql`${patch.branchId}`},
      cost_center_id = ${patch.costCenterId === undefined ? sql`cost_center_id` : sql`${patch.costCenterId}`},
      project_id = ${patch.projectId === undefined ? sql`project_id` : sql`${patch.projectId}`},
      bank_name = ${patch.bankName === undefined ? sql`bank_name` : sql`${patch.bankName}`},
      bank_iban = ${patch.bankIban === undefined ? sql`bank_iban` : sql`${patch.bankIban}`},
      bank_account = ${patch.bankAccount === undefined ? sql`bank_account` : sql`${patch.bankAccount}`},
      note = ${patch.note === undefined ? sql`note` : sql`${patch.note}`},
      note_ar = ${patch.noteAr === undefined ? sql`note_ar` : sql`${patch.noteAr}`},
      status = coalesce(${patch.status ?? null}, status),
      termination_date = ${patch.terminationDate === undefined ? sql`termination_date` : sql`${patch.terminationDate}`},
      termination_reason = ${patch.terminationReason === undefined ? sql`termination_reason` : sql`${patch.terminationReason}`},
      updated_at = now(),
      version = version + 1
    WHERE id = ${id}
    RETURNING ${EMPLOYEE_COLUMNS}
  `);
  return mapEmployee((rows.rows as unknown as EmployeeSqlRow[])[0]!);
}

export interface EmployeeListFilter {
  status?: EmployeeStatus;
  branchId?: string;
  limit: number;
}

/** List employees (NO PII columns selected — the register reads masked by construction). */
export async function listEmployees(filter: EmployeeListFilter): Promise<EmployeeRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${EMPLOYEE_COLUMNS} FROM employees
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.branchId ?? null}::uuid IS NULL OR branch_id = ${filter.branchId ?? null})
    ORDER BY code
    LIMIT ${filter.limit}
  `);
  return (rows.rows as unknown as EmployeeSqlRow[]).map(mapEmployee);
}

/** Count journal-free probe: employees with ACTIVE status (the run population). */
export async function countActiveEmployees(): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM employees WHERE status = 'ACTIVE'
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

// -- salary structures + components ---------------------------------------------------

export type StructureStatus = "ACTIVE" | "ARCHIVED";
export type ComponentKind = "ALLOWANCE" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
export type ComponentCalc = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS";

export interface StructureRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  currency: string;
  status: StructureStatus;
  supersededById: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface StructureSqlRow {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  currency: string;
  status: StructureStatus;
  superseded_by_id: string | null;
  note: string | null;
  note_ar: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapStructure(row: StructureSqlRow): StructureRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    currency: row.currency,
    status: row.status,
    supersededById: row.superseded_by_id,
    note: row.note,
    noteAr: row.note_ar,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

const STRUCTURE_COLUMNS = sql`id, code, name, name_ar, currency, status, superseded_by_id,
  note, note_ar, created_by, created_at, updated_at, version`;

export interface CreateStructureInput {
  code: string;
  name: string;
  nameAr?: string | null;
  currency: string;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}

export async function insertStructure(input: CreateStructureInput): Promise<StructureRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO salary_structures (id, tenant_id, code, name, name_ar, currency, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
      ${input.nameAr ?? null}, ${input.currency}, ${input.note ?? null}, ${input.noteAr ?? null},
      ${input.createdBy})
    RETURNING ${STRUCTURE_COLUMNS}
  `);
  return mapStructure((rows.rows as unknown as StructureSqlRow[])[0]!);
}

export async function findStructureById(id: string): Promise<StructureRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${STRUCTURE_COLUMNS} FROM salary_structures WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as StructureSqlRow[])[0] === undefined
    ? undefined
    : mapStructure((rows.rows as unknown as StructureSqlRow[])[0]!);
}

export async function findStructureByCode(code: string): Promise<StructureRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${STRUCTURE_COLUMNS} FROM salary_structures WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as StructureSqlRow[])[0] === undefined
    ? undefined
    : mapStructure((rows.rows as unknown as StructureSqlRow[])[0]!);
}

export async function listStructures(limit: number): Promise<StructureRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${STRUCTURE_COLUMNS} FROM salary_structures ORDER BY code LIMIT ${limit}
  `);
  return (rows.rows as unknown as StructureSqlRow[]).map(mapStructure);
}

/** The BR-052 supersede flip: predecessor → ARCHIVED pointing at the successor (one statement). */
export async function archiveStructure(predecessorId: string, successorId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE salary_structures SET status = 'ARCHIVED', superseded_by_id = ${successorId},
      updated_at = now(), version = version + 1
    WHERE id = ${predecessorId}
  `);
}

/** Has ANY run line snapshotted this structure? (the BR-052 freeze probe). */
export async function structureUsedInRun(structureId: string): Promise<string | null> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id AS run_id
    FROM payroll_run_lines l
    JOIN payroll_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
    WHERE l.component_snapshot -> 'structure' ->> 'id' = ${structureId}
    LIMIT 1
  `);
  return (rows.rows as unknown as { run_id: string }[])[0]?.run_id ?? null;
}

export interface ComponentRow {
  id: string;
  structureId: string;
  key: string;
  name: string;
  nameAr: string | null;
  kind: ComponentKind;
  calc: ComponentCalc;
  amount: string | null;
  rate: string | null;
  glAccountId: string;
  isEosBase: boolean;
  seq: number;
}

interface ComponentSqlRow {
  id: string;
  structure_id: string;
  key: string;
  name: string;
  name_ar: string | null;
  kind: ComponentKind;
  calc: ComponentCalc;
  amount: string | null;
  rate: string | null;
  gl_account_id: string;
  is_eos_base: boolean;
  seq: number;
}

function mapComponent(row: ComponentSqlRow): ComponentRow {
  return {
    id: row.id,
    structureId: row.structure_id,
    key: row.key,
    name: row.name,
    nameAr: row.name_ar,
    kind: row.kind,
    calc: row.calc,
    amount: row.amount,
    rate: row.rate,
    glAccountId: row.gl_account_id,
    isEosBase: row.is_eos_base,
    seq: Number(row.seq),
  };
}

const COMPONENT_COLUMNS = sql`id, structure_id, key, name, name_ar, kind, calc, amount, rate,
  gl_account_id, is_eos_base, seq`;

export interface CreateComponentInput {
  structureId: string;
  key: string;
  name: string;
  nameAr?: string | null;
  kind: ComponentKind;
  calc: ComponentCalc;
  amount?: string | null;
  rate?: string | null;
  glAccountId: string;
  isEosBase?: boolean;
  seq?: number;
}

export async function insertComponent(input: CreateComponentInput): Promise<ComponentRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO salary_components (id, tenant_id, structure_id, key, name, name_ar, kind, calc,
      amount, rate, gl_account_id, is_eos_base, seq)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.structureId}, ${input.key},
      ${input.name}, ${input.nameAr ?? null}, ${input.kind}, ${input.calc}, ${input.amount ?? null},
      ${input.rate ?? null}, ${input.glAccountId}, ${input.isEosBase ?? false}, ${input.seq ?? 1})
    RETURNING ${COMPONENT_COLUMNS}
  `);
  return mapComponent((rows.rows as unknown as ComponentSqlRow[])[0]!);
}

export async function listComponents(structureId: string): Promise<ComponentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COMPONENT_COLUMNS} FROM salary_components
    WHERE structure_id = ${structureId}
    ORDER BY seq, key
  `);
  return (rows.rows as unknown as ComponentSqlRow[]).map(mapComponent);
}

export async function deleteComponentsOfStructure(structureId: string): Promise<void> {
  await tenantTx().execute(sql`
    DELETE FROM salary_components WHERE structure_id = ${structureId}
  `);
}

export async function countComponents(structureId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM salary_components WHERE structure_id = ${structureId}
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

// -- payroll runs ---------------------------------------------------------------------

export type RunStatus = "DRAFT" | "PENDING_APPROVAL" | "POSTED";

export interface RunRow {
  id: string;
  runNo: string | null;
  fiscalPeriodId: string;
  status: RunStatus;
  grossTotal: string;
  deductionsTotal: string;
  netTotal: string;
  paidNetTotal: string;
  employerContributionsTotal: string;
  eosAccrualTotal: string;
  journalEntryId: string | null;
  entryNo: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  reversalJournalEntryId: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface RunSqlRow {
  id: string;
  run_no: string | null;
  fiscal_period_id: string;
  status: RunStatus;
  gross_total: string;
  deductions_total: string;
  net_total: string;
  paid_net_total: string;
  employer_contributions_total: string;
  eos_accrual_total: string;
  journal_entry_id: string | null;
  entry_no: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  posted_at: string | null;
  posted_by: string | null;
  reversal_journal_entry_id: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  note: string | null;
  note_ar: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapRun(row: RunSqlRow): RunRow {
  return {
    id: row.id,
    runNo: row.run_no,
    fiscalPeriodId: row.fiscal_period_id,
    status: row.status,
    grossTotal: row.gross_total,
    deductionsTotal: row.deductions_total,
    netTotal: row.net_total,
    paidNetTotal: row.paid_net_total,
    employerContributionsTotal: row.employer_contributions_total,
    eosAccrualTotal: row.eos_accrual_total,
    journalEntryId: row.journal_entry_id,
    entryNo: row.entry_no,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    postedAt: row.posted_at,
    postedBy: row.posted_by,
    reversalJournalEntryId: row.reversal_journal_entry_id,
    reversedAt: row.reversed_at,
    reversedBy: row.reversed_by,
    note: row.note,
    noteAr: row.note_ar,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

const RUN_COLUMNS = sql`id, run_no, fiscal_period_id, status, gross_total, deductions_total,
  net_total, paid_net_total, employer_contributions_total, eos_accrual_total, journal_entry_id, entry_no,
  submitted_at, submitted_by, approved_at, approved_by, posted_at, posted_by,
  reversal_journal_entry_id, reversed_at, reversed_by, note, note_ar,
  created_by, created_at, updated_at, version`;

export async function insertRun(input: {
  fiscalPeriodId: string;
  createdBy: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<RunRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO payroll_runs (id, tenant_id, fiscal_period_id, status, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.fiscalPeriodId}, 'DRAFT',
      ${input.note ?? null}, ${input.noteAr ?? null}, ${input.createdBy})
    RETURNING ${RUN_COLUMNS}
  `);
  return mapRun((rows.rows as unknown as RunSqlRow[])[0]!);
}

export async function findRunById(id: string): Promise<RunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM payroll_runs WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RunSqlRow[])[0] === undefined
    ? undefined
    : mapRun((rows.rows as unknown as RunSqlRow[])[0]!);
}

export async function findLiveRunOfPeriod(fiscalPeriodId: string): Promise<RunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM payroll_runs
    WHERE fiscal_period_id = ${fiscalPeriodId} AND status IN ('PENDING_APPROVAL', 'POSTED')
    LIMIT 1
  `);
  return (rows.rows as unknown as RunSqlRow[])[0] === undefined
    ? undefined
    : mapRun((rows.rows as unknown as RunSqlRow[])[0]!);
}

export async function listRuns(filter: {
  fiscalYearId?: string;
  status?: RunStatus;
  limit: number;
}): Promise<RunRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM payroll_runs r
    WHERE (${filter.status ?? null}::text IS NULL OR r.status = ${filter.status ?? null})
      AND (${filter.fiscalYearId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM fiscal_periods p WHERE p.id = r.fiscal_period_id
          AND p.fiscal_year_id = ${filter.fiscalYearId ?? null}))
    ORDER BY r.created_at DESC
    LIMIT ${filter.limit}
  `);
  return (rows.rows as unknown as RunSqlRow[]).map(mapRun);
}

export interface RunPatch {
  status?: RunStatus;
  runNo?: string | null;
  grossTotal?: string;
  deductionsTotal?: string;
  netTotal?: string;
  paidNetTotal?: string;
  employerContributionsTotal?: string;
  eosAccrualTotal?: string;
  journalEntryId?: string | null;
  entryNo?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  postedAt?: string | null;
  postedBy?: string | null;
  reversalJournalEntryId?: string | null;
  reversedAt?: string | null;
  reversedBy?: string | null;
}

export async function updateRun(id: string, patch: RunPatch): Promise<RunRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE payroll_runs SET
      status = coalesce(${patch.status ?? null}, status),
      run_no = coalesce(${patch.runNo ?? null}, run_no),
      gross_total = coalesce(${patch.grossTotal ?? null}, gross_total),
      deductions_total = coalesce(${patch.deductionsTotal ?? null}, deductions_total),
      net_total = coalesce(${patch.netTotal ?? null}, net_total),
      paid_net_total = coalesce(${patch.paidNetTotal ?? null}, paid_net_total),
      employer_contributions_total = coalesce(${patch.employerContributionsTotal ?? null}, employer_contributions_total),
      eos_accrual_total = coalesce(${patch.eosAccrualTotal ?? null}, eos_accrual_total),
      journal_entry_id = ${patch.journalEntryId === undefined ? sql`journal_entry_id` : sql`${patch.journalEntryId}`},
      entry_no = ${patch.entryNo === undefined ? sql`entry_no` : sql`${patch.entryNo}`},
      submitted_at = coalesce(${patch.submittedAt ?? null}, submitted_at),
      submitted_by = ${patch.submittedBy === undefined ? sql`submitted_by` : sql`${patch.submittedBy}`},
      approved_at = coalesce(${patch.approvedAt ?? null}, approved_at),
      approved_by = ${patch.approvedBy === undefined ? sql`approved_by` : sql`${patch.approvedBy}`},
      posted_at = coalesce(${patch.postedAt ?? null}, posted_at),
      posted_by = ${patch.postedBy === undefined ? sql`posted_by` : sql`${patch.postedBy}`},
      reversal_journal_entry_id = ${patch.reversalJournalEntryId === undefined ? sql`reversal_journal_entry_id` : sql`${patch.reversalJournalEntryId}`},
      reversed_at = coalesce(${patch.reversedAt ?? null}, reversed_at),
      reversed_by = ${patch.reversedBy === undefined ? sql`reversed_by` : sql`${patch.reversedBy}`},
      updated_at = now(),
      version = version + 1
    WHERE id = ${id}
    RETURNING ${RUN_COLUMNS}
  `);
  return mapRun((rows.rows as unknown as RunSqlRow[])[0]!);
}

// -- payroll run lines (append-only: INSERT + DRAFT-reset DELETE + SELECT) --------------

export interface RunLineRow {
  id: string;
  runId: string;
  employeeId: string;
  componentSnapshot: ComponentSnapshotValue;
  grossAmount: string;
  deductionsAmount: string;
  netAmount: string;
  employerContributions: string;
  eosAccrual: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
  createdAt: string;
}

/** The frozen calculation basis (DATA_DICTIONARY style, jsonb shape). */
export interface ComponentSnapshotValue {
  structure: { id: string; code: string; name: string };
  components: readonly {
    key: string;
    kind: ComponentKind;
    calc: ComponentCalc;
    amount: string | null;
    rate: string | null;
    glAccountId: string;
    isEosBase: boolean;
    computed: string;
  }[];
  loanDeductions: readonly { loanId: string; lineId: string; amount: string }[];
  eos: { enabled: boolean; accrual: string };
  basicSalary: string;
}

interface RunLineSqlRow {
  id: string;
  run_id: string;
  employee_id: string;
  component_snapshot: ComponentSnapshotValue;
  gross_amount: string;
  deductions_amount: string;
  net_amount: string;
  employer_contributions: string;
  eos_accrual: string;
  cost_center_id: string | null;
  project_id: string | null;
  branch_id: string | null;
  created_at: string;
}

function mapRunLine(row: RunLineSqlRow): RunLineRow {
  return {
    id: row.id,
    runId: row.run_id,
    employeeId: row.employee_id,
    componentSnapshot: row.component_snapshot,
    grossAmount: row.gross_amount,
    deductionsAmount: row.deductions_amount,
    netAmount: row.net_amount,
    employerContributions: row.employer_contributions,
    eosAccrual: row.eos_accrual,
    costCenterId: row.cost_center_id,
    projectId: row.project_id,
    branchId: row.branch_id,
    createdAt: row.created_at,
  };
}

export async function insertRunLine(input: {
  runId: string;
  employeeId: string;
  componentSnapshot: ComponentSnapshotValue;
  grossAmount: string;
  deductionsAmount: string;
  netAmount: string;
  employerContributions: string;
  eosAccrual: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
}): Promise<RunLineRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO payroll_run_lines (id, tenant_id, run_id, employee_id, component_snapshot,
      gross_amount, deductions_amount, net_amount, employer_contributions, eos_accrual,
      cost_center_id, project_id, branch_id)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.runId}, ${input.employeeId},
      ${JSON.stringify(input.componentSnapshot)}::jsonb, ${input.grossAmount},
      ${input.deductionsAmount}, ${input.netAmount}, ${input.employerContributions},
      ${input.eosAccrual}, ${input.costCenterId}, ${input.projectId}, ${input.branchId})
    RETURNING id, run_id, employee_id, component_snapshot, gross_amount, deductions_amount,
      net_amount, employer_contributions, eos_accrual, cost_center_id, project_id, branch_id, created_at
  `);
  return mapRunLine((rows.rows as unknown as RunLineSqlRow[])[0]!);
}

export async function listRunLines(runId: string): Promise<RunLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, run_id, employee_id, component_snapshot, gross_amount, deductions_amount,
      net_amount, employer_contributions, eos_accrual, cost_center_id, project_id, branch_id, created_at
    FROM payroll_run_lines WHERE run_id = ${runId}
    ORDER BY created_at, id
  `);
  return (rows.rows as unknown as RunLineSqlRow[]).map(mapRunLine);
}

/**
 * DRAFT-recalculation reset (the guard trigger's sanctioned DELETE): wipes
 * the DRAFT run's lines so the calculation re-inserts fresh. Throws at the
 * DB level (500-shape) on a non-DRAFT run — the service checks first.
 */
export async function deleteRunLines(runId: string): Promise<void> {
  await tenantTx().execute(sql`
    DELETE FROM payroll_run_lines WHERE run_id = ${runId}
  `);
}

/** Σ already-paid net per run (the payout idempotency + remainder probe). */
export async function sumPayoutsForRun(runId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT coalesce(sum(base_amount), 0)::text AS total FROM cash_movements
    WHERE source_type = 'payroll_payout' AND source_id = ${runId}
  `);
  return (rows.rows as unknown as { total: string }[])[0]?.total ?? "0";
}

// -- employee loans + lines -------------------------------------------------------------

export type LoanStatus = "ACTIVE" | "CLOSED" | "WRITE_OFF";
export type LoanLineStatus = "PENDING" | "DEDUCTED" | "WAIVED";

export interface LoanRow {
  id: string;
  code: string;
  employeeId: string;
  amount: string;
  installmentsCount: number;
  startPeriodId: string;
  status: LoanStatus;
  cashAccountId: string | null;
  disbursementJournalEntryId: string | null;
  disbursedAt: string | null;
  disbursedBy: string | null;
  writeOffReason: string | null;
  writeOffAt: string | null;
  writeOffBy: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface LoanSqlRow {
  id: string;
  code: string;
  employee_id: string;
  amount: string;
  installments_count: number;
  start_period_id: string;
  status: LoanStatus;
  cash_account_id: string | null;
  disbursement_journal_entry_id: string | null;
  disbursed_at: string | null;
  disbursed_by: string | null;
  write_off_reason: string | null;
  write_off_at: string | null;
  write_off_by: string | null;
  note: string | null;
  note_ar: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapLoan(row: LoanSqlRow): LoanRow {
  return {
    id: row.id,
    code: row.code,
    employeeId: row.employee_id,
    amount: row.amount,
    installmentsCount: Number(row.installments_count),
    startPeriodId: row.start_period_id,
    status: row.status,
    cashAccountId: row.cash_account_id,
    disbursementJournalEntryId: row.disbursement_journal_entry_id,
    disbursedAt: row.disbursed_at,
    disbursedBy: row.disbursed_by,
    writeOffReason: row.write_off_reason,
    writeOffAt: row.write_off_at,
    writeOffBy: row.write_off_by,
    note: row.note,
    noteAr: row.note_ar,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

const LOAN_COLUMNS = sql`id, code, employee_id, amount, installments_count, start_period_id,
  status, cash_account_id, disbursement_journal_entry_id, disbursed_at, disbursed_by,
  write_off_reason, write_off_at, write_off_by, note, note_ar,
  created_by, created_at, updated_at, version`;

export async function insertLoan(input: {
  id?: string;
  code: string;
  employeeId: string;
  amount: string;
  installmentsCount: number;
  startPeriodId: string;
  cashAccountId: string;
  disbursementJournalEntryId: string;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<LoanRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO employee_loans (id, tenant_id, code, employee_id, amount, installments_count,
      start_period_id, status, cash_account_id, disbursement_journal_entry_id, disbursed_at,
      disbursed_by, note, note_ar, created_by)
    VALUES (${input.id ?? generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.employeeId},
      ${input.amount}, ${input.installmentsCount}, ${input.startPeriodId}, 'ACTIVE',
      ${input.cashAccountId}, ${input.disbursementJournalEntryId}, now(), ${input.createdBy},
      ${input.note ?? null}, ${input.noteAr ?? null}, ${input.createdBy})
    RETURNING ${LOAN_COLUMNS}
  `);
  return mapLoan((rows.rows as unknown as LoanSqlRow[])[0]!);
}

export async function findLoanById(id: string): Promise<LoanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LOAN_COLUMNS} FROM employee_loans WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LoanSqlRow[])[0] === undefined
    ? undefined
    : mapLoan((rows.rows as unknown as LoanSqlRow[])[0]!);
}

export async function findLoanByCode(code: string): Promise<LoanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LOAN_COLUMNS} FROM employee_loans WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as LoanSqlRow[])[0] === undefined
    ? undefined
    : mapLoan((rows.rows as unknown as LoanSqlRow[])[0]!);
}

export async function listLoans(filter: {
  employeeId?: string;
  status?: LoanStatus;
  limit: number;
}): Promise<LoanRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LOAN_COLUMNS} FROM employee_loans
    WHERE (${filter.employeeId ?? null}::uuid IS NULL OR employee_id = ${filter.employeeId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${filter.limit}
  `);
  return (rows.rows as unknown as LoanSqlRow[]).map(mapLoan);
}

export async function updateLoan(id: string, patch: {
  status?: LoanStatus;
  writeOffReason?: string | null;
  writeOffAt?: string | null;
  writeOffBy?: string | null;
}): Promise<LoanRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE employee_loans SET
      status = coalesce(${patch.status ?? null}, status),
      write_off_reason = ${patch.writeOffReason === undefined ? sql`write_off_reason` : sql`${patch.writeOffReason}`},
      write_off_at = coalesce(${patch.writeOffAt ?? null}, write_off_at),
      write_off_by = ${patch.writeOffBy === undefined ? sql`write_off_by` : sql`${patch.writeOffBy}`},
      updated_at = now(),
      version = version + 1
    WHERE id = ${id}
    RETURNING ${LOAN_COLUMNS}
  `);
  return mapLoan((rows.rows as unknown as LoanSqlRow[])[0]!);
}

export interface LoanLineRow {
  id: string;
  loanId: string;
  fiscalPeriodId: string;
  amount: string;
  status: LoanLineStatus;
  payrollRunId: string | null;
  waivedReason: string | null;
  waivedAt: string | null;
  waivedBy: string | null;
}

interface LoanLineSqlRow {
  id: string;
  loan_id: string;
  fiscal_period_id: string;
  amount: string;
  status: LoanLineStatus;
  payroll_run_id: string | null;
  waived_reason: string | null;
  waived_at: string | null;
  waived_by: string | null;
}

function mapLoanLine(row: LoanLineSqlRow): LoanLineRow {
  return {
    id: row.id,
    loanId: row.loan_id,
    fiscalPeriodId: row.fiscal_period_id,
    amount: row.amount,
    status: row.status,
    payrollRunId: row.payroll_run_id,
    waivedReason: row.waived_reason,
    waivedAt: row.waived_at,
    waivedBy: row.waived_by,
  };
}

const LOAN_LINE_COLUMNS = sql`id, loan_id, fiscal_period_id, amount, status, payroll_run_id,
  waived_reason, waived_at, waived_by`;

export async function insertLoanLine(input: {
  loanId: string;
  fiscalPeriodId: string;
  amount: string;
}): Promise<LoanLineRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO employee_loan_lines (id, tenant_id, loan_id, fiscal_period_id, amount, status)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.loanId}, ${input.fiscalPeriodId},
      ${input.amount}, 'PENDING')
    RETURNING ${LOAN_LINE_COLUMNS}
  `);
  return mapLoanLine((rows.rows as unknown as LoanLineSqlRow[])[0]!);
}

export async function listLoanLines(loanId: string): Promise<LoanLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LOAN_LINE_COLUMNS} FROM employee_loan_lines
    WHERE loan_id = ${loanId}
    ORDER BY created_at, id
  `);
  return (rows.rows as unknown as LoanLineSqlRow[]).map(mapLoanLine);
}

export async function findLoanLineById(id: string): Promise<LoanLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LOAN_LINE_COLUMNS} FROM employee_loan_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LoanLineSqlRow[])[0] === undefined
    ? undefined
    : mapLoanLine((rows.rows as unknown as LoanLineSqlRow[])[0]!);
}

/** The run-calculation population: this period's PENDING lines of ACTIVE loans. */
export async function listPendingLoanLinesForPeriod(fiscalPeriodId: string): Promise<LoanLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.loan_id, l.fiscal_period_id, l.amount, l.status, l.payroll_run_id,
           l.waived_reason, l.waived_at, l.waived_by
    FROM employee_loan_lines l
    JOIN employee_loans lo ON lo.id = l.loan_id AND lo.tenant_id = l.tenant_id
    WHERE l.fiscal_period_id = ${fiscalPeriodId} AND l.status = 'PENDING' AND lo.status = 'ACTIVE'
    ORDER BY l.created_at, l.id
  `);
  return (rows.rows as unknown as LoanLineSqlRow[]).map(mapLoanLine);
}

/** PENDING → DEDUCTED with the run stamp (one deduction per line — the shape CHECK). */
export async function markLoanLineDeducted(
  lineId: string,
  payrollRunId: string,
): Promise<LoanLineRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE employee_loan_lines SET status = 'DEDUCTED', payroll_run_id = ${payrollRunId},
      updated_at = now(), version = version + 1
    WHERE id = ${lineId}
    RETURNING ${LOAN_LINE_COLUMNS}
  `);
  return mapLoanLine((rows.rows as unknown as LoanLineSqlRow[])[0]!);
}

/** PENDING → WAIVED (reason required — the shape CHECK + the service discipline). */
export async function markLoanLineWaived(
  lineId: string,
  reason: string,
  waivedBy: string | null,
): Promise<LoanLineRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE employee_loan_lines SET status = 'WAIVED', waived_reason = ${reason},
      waived_at = now(), waived_by = ${waivedBy}, updated_at = now(), version = version + 1
    WHERE id = ${lineId}
    RETURNING ${LOAN_LINE_COLUMNS}
  `);
  return mapLoanLine((rows.rows as unknown as LoanLineSqlRow[])[0]!);
}

/** Flip the loan CLOSED when every line is terminal (the schedule-completion probe). */
export async function maybeCloseLoan(loanId: string): Promise<LoanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE employee_loans lo SET status = 'CLOSED', updated_at = now(), version = version + 1
    WHERE lo.id = ${loanId} AND lo.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM employee_loan_lines l
                      WHERE l.loan_id = lo.id AND l.status = 'PENDING')
    RETURNING ${LOAN_COLUMNS}
  `);
  return (rows.rows as unknown as LoanSqlRow[])[0] === undefined
    ? undefined
    : mapLoan((rows.rows as unknown as LoanSqlRow[])[0]!);
}
