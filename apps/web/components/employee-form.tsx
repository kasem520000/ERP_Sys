"use client";

/**
 * PHASE-029 (T11) — employee create/edit form (PAGE_ARCHETYPES §3, the
 * budget-form pattern): bilingual identity + employment fields → POST
 * payroll/employees (create; the server mints the code sequence) or PUT
 * payroll/employees/:id (edit; patch semantics — only changed fields
 * cross the wire). PII discipline on the edit surface: the masked
 * national-id/bank values NEVER prefill (they never crossed the wire in
 * clear); empty inputs mean "unchanged", a typed value means "replace".
 * TERMINATED rows render read-only except the note fields (the frozen-row
 * law). Structure/branch/cost-center/project selects ride the
 * server-fetched reference pools.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, MoneyInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  CostCenterRow,
  EmployeeListRow,
  ProjectRow,
  SalaryStructureRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

const CONTRACTS = ["FULL_TIME", "PART_TIME", "CONTRACTOR"] as const;

const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

export function EmployeeForm({
  locale,
  mode,
  employee,
  structures,
  branches,
  costCenters,
  projects,
  currency,
}: {
  locale: Locale;
  mode: "create" | "edit";
  employee?: EmployeeListRow;
  structures: readonly SalaryStructureRow[];
  branches: readonly BranchRow[];
  costCenters: readonly CostCenterRow[];
  projects: readonly ProjectRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const terminated = employee?.status === "TERMINATED";
  const frozen = mode === "edit" && terminated;

  const [code, setCode] = useState("");
  const [name, setName] = useState(employee?.name ?? "");
  const [nameAr, setNameAr] = useState(employee?.nameAr ?? "");
  const [nationalId, setNationalId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [contractType, setContractType] = useState<(typeof CONTRACTS)[number]>(
    employee?.contractType ?? "FULL_TIME",
  );
  const [basicSalary, setBasicSalary] = useState(employee?.basicSalary ?? "");
  const [salaryStructureId, setSalaryStructureId] = useState(employee?.salaryStructureId ?? "");
  const [branchId, setBranchId] = useState(employee?.branchId ?? "");
  const [costCenterId, setCostCenterId] = useState(employee?.costCenterId ?? "");
  const [projectId, setProjectId] = useState(employee?.projectId ?? "");
  const [bankName, setBankName] = useState("");
  const [bankIban, setBankIban] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [note, setNote] = useState(employee?.note ?? "");
  const [noteAr, setNoteAr] = useState(employee?.noteAr ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const structureOptions = structures
    .filter((structure) => structure.status === "ACTIVE")
    .map((structure) => ({
      value: structure.id,
      label: localizedName(structure.name, structure.nameAr, locale),
    }));

  async function save(): Promise<void> {
    setError(null);
    if (mode === "create") {
      if (code.trim() === "" || name.trim() === "" || hireDate === "") {
        setError(d.budgetFormInvalid);
        return;
      }
      if (!MONEY_SHAPE.test(basicSalary)) {
        setError(d.budgetFormInvalid);
        return;
      }
    } else if (name.trim() === "" || !MONEY_SHAPE.test(basicSalary)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(true);
    if (mode === "create") {
      const created = await bffFetch<EmployeeListRow>("payroll/employees", {
        method: "POST",
        body: {
          code: code.trim(),
          name: name.trim(),
          nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
          nationalId: nationalId.trim() === "" ? null : nationalId.trim(),
          hireDate,
          contractType,
          basicSalary,
          salaryStructureId: salaryStructureId === "" ? null : salaryStructureId,
          branchId: branchId === "" ? null : branchId,
          costCenterId: costCenterId === "" ? null : costCenterId,
          projectId: projectId === "" ? null : projectId,
          bankName: bankName.trim() === "" ? null : bankName.trim(),
          bankIban: bankIban.trim() === "" ? null : bankIban.trim(),
          bankAccount: bankAccount.trim() === "" ? null : bankAccount.trim(),
          note: note.trim() === "" ? null : note.trim(),
          noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
        },
      });
      setBusy(false);
      if (!created.ok) {
        setError(localizedPayrollError(d, created.error, created.retryAfterSeconds));
        return;
      }
      toast({
        tone: "success",
        title: formatMessage(d.payEmployeeCreatedToast, { code: created.data.code }),
      });
      router.push(`/${locale}/payroll/employees/${created.data.id}`);
      return;
    }

    // Edit — patch semantics: only fields whose value actually moved (the
    // reference/PII law — masked PII never prefills, so an untouched input
    // sends nothing; a typed value replaces).
    const body: Record<string, unknown> = {};
    if (!frozen) {
      if (name.trim() !== (employee?.name ?? "")) body.name = name.trim();
      if (nameAr.trim() !== (employee?.nameAr ?? "")) {
        body.nameAr = nameAr.trim() === "" ? null : nameAr.trim();
      }
      if (basicSalary !== (employee?.basicSalary ?? "")) body.basicSalary = basicSalary;
      if (contractType !== employee?.contractType) body.contractType = contractType;
      if (salaryStructureId !== (employee?.salaryStructureId ?? "")) {
        body.salaryStructureId = salaryStructureId === "" ? null : salaryStructureId;
      }
      if (branchId !== (employee?.branchId ?? "")) {
        body.branchId = branchId === "" ? null : branchId;
      }
      if (costCenterId !== (employee?.costCenterId ?? "")) {
        body.costCenterId = costCenterId === "" ? null : costCenterId;
      }
      if (projectId !== (employee?.projectId ?? "")) {
        body.projectId = projectId === "" ? null : projectId;
      }
      if (nationalId.trim() !== "") body.nationalId = nationalId.trim();
      if (bankName.trim() !== "") body.bankName = bankName.trim();
      if (bankIban.trim() !== "") body.bankIban = bankIban.trim();
      if (bankAccount.trim() !== "") body.bankAccount = bankAccount.trim();
    }
    if (note.trim() !== (employee?.note ?? "")) {
      body.note = note.trim() === "" ? null : note.trim();
    }
    if (noteAr.trim() !== (employee?.noteAr ?? "")) {
      body.noteAr = noteAr.trim() === "" ? null : noteAr.trim();
    }
    if (Object.keys(body).length === 0) {
      setBusy(false);
      router.push(`/${locale}/payroll/employees/${employee?.id ?? ""}`);
      return;
    }
    const updated = await bffFetch<EmployeeListRow>(`payroll/employees/${employee?.id ?? ""}`, {
      method: "PUT",
      body,
    });
    setBusy(false);
    if (!updated.ok) {
      setError(localizedPayrollError(d, updated.error, updated.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.payEmployeeUpdatedToast, { code: updated.data.code }),
    });
    router.refresh();
  }

  return (
    <Card
      title={mode === "create" ? d.payEmployeeCreateTitle : d.payEmployeeEditTitle}
      description={mode === "edit" && terminated ? d.payEmployeeTerminatedNote : undefined}
    >
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mode === "create" && (
            <Input
              id="employee-form-code"
              label={d.payEmployeeCode}
              value={code}
              onValueChange={setCode}
              mono
              bidiIsolate
              required
            />
          )}
          <Input
            id="employee-form-name"
            label={d.payEmployeeName}
            value={name}
            onValueChange={setName}
            disabled={frozen}
            required
          />
          <Input
            id="employee-form-name-ar"
            label={d.budgetFormNameAr}
            value={nameAr}
            onValueChange={setNameAr}
            disabled={frozen}
          />
          <Input
            id="employee-form-national-id"
            label={d.payEmployeeNationalId}
            value={nationalId}
            onValueChange={setNationalId}
            hint={
              mode === "edit"
                ? (employee?.nationalIdMasked ?? "—")
                : undefined
            }
            mono
            bidiIsolate
            disabled={frozen}
          />
          {mode === "create" && (
            <Input
              id="employee-form-hire-date"
              label={d.payEmployeeHireDate}
              value={hireDate}
              onValueChange={setHireDate}
              hint="YYYY-MM-DD"
              mono
              bidiIsolate
              required
            />
          )}
          <Select
            id="employee-form-contract"
            label={d.payEmployeeContract}
            value={contractType}
            onValueChange={(value) => {
              const next = CONTRACTS.find((entry) => entry === value);
              if (next !== undefined) {
                setContractType(next);
              }
            }}
            options={CONTRACTS.map((entry) => ({
              value: entry,
              label:
                entry === "FULL_TIME"
                  ? d.payContractFullTime
                  : entry === "PART_TIME"
                    ? d.payContractPartTime
                    : d.payContractContractor,
            }))}
            disabled={frozen}
          />
          <MoneyInput
            id="employee-form-basic-salary"
            label={d.payEmployeeBasicSalary}
            amount={basicSalary}
            onAmountChange={setBasicSalary}
            currency={currency}
            disabled={frozen}
            required
          />
          <Select
            id="employee-form-structure"
            label={d.payEmployeeStructure}
            value={salaryStructureId}
            onValueChange={setSalaryStructureId}
            options={[
              { value: "", label: "—" },
              ...structureOptions,
            ]}
            disabled={frozen}
          />
          <Select
            id="employee-form-branch"
            label={d.payEmployeeBranch}
            value={branchId}
            onValueChange={setBranchId}
            options={[
              { value: "", label: "—" },
              ...branches.map((branch) => ({
                value: branch.id,
                label: localizedName(branch.name, branch.nameAr, locale),
              })),
            ]}
            disabled={frozen}
          />
          <Select
            id="employee-form-cost-center"
            label={d.payEmployeeCostCenter}
            value={costCenterId}
            onValueChange={setCostCenterId}
            options={[
              { value: "", label: "—" },
              ...costCenters.map((center) => ({
                value: center.id,
                label: localizedName(center.name, center.nameAr, locale),
              })),
            ]}
            disabled={frozen}
          />
          <Select
            id="employee-form-project"
            label={d.payEmployeeProject}
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: "", label: "—" },
              ...projects.map((project) => ({
                value: project.id,
                label: localizedName(project.name, project.nameAr, locale),
              })),
            ]}
            disabled={frozen}
          />
          <Input
            id="employee-form-bank-name"
            label={d.payEmployeeBank}
            value={bankName}
            onValueChange={setBankName}
            hint={mode === "edit" ? (employee?.bankMasked.name ?? "—") : undefined}
            disabled={frozen}
          />
          <Input
            id="employee-form-bank-iban"
            label="IBAN"
            value={bankIban}
            onValueChange={setBankIban}
            hint={mode === "edit" ? (employee?.bankMasked.ibanTail ?? "—") : undefined}
            mono
            bidiIsolate
            disabled={frozen}
          />
          <Input
            id="employee-form-bank-account"
            label="Account"
            value={bankAccount}
            onValueChange={setBankAccount}
            hint={mode === "edit" ? (employee?.bankMasked.accountTail ?? "—") : undefined}
            mono
            bidiIsolate
            disabled={frozen}
          />
          <Input
            id="employee-form-note"
            label={d.budgetFormNote}
            value={note}
            onValueChange={setNote}
          />
          <Input
            id="employee-form-note-ar"
            label={d.budgetFormNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {d.payEmployeeSave}
          </Button>
        </div>
      </div>
    </Card>
  );
}
