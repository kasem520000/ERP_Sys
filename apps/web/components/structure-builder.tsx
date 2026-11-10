"use client";

/**
 * PHASE-029 (T11) — the salary-structure builder (PAGE_ARCHETYPES §4,
 * the grid-workspace pattern): the component rows editor (key / bilingual
 * name / kind / calc / amount / rate / GL account / EOS-base flag — array
 * order IS the seq). Save = PUT components (replace; server rejects when
 * a posted run snapshotted the structure — BR-052); version = POST
 * version with the on-screen draft (the successor starts editable, the
 * predecessor archives pointing at it). ARCHIVED rows render read-only.
 * Accounts resolve through the postable ACTIVE pool only (the server's
 * own fail-closed precheck).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
  useToast,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AccountRow, SalaryComponentRow, SalaryStructureRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";

const KINDS = ["ALLOWANCE", "DEDUCTION", "EMPLOYER_CONTRIBUTION"] as const;
const CALCS = ["FIXED", "PERCENT_OF_BASIC", "PERCENT_OF_GROSS"] as const;

const CODE_SHAPE = /^[A-Za-z0-9._/-]{1,40}$/;
const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

interface ComponentDraft {
  key: string;
  name: string;
  nameAr: string;
  kind: (typeof KINDS)[number];
  calc: (typeof CALCS)[number];
  amount: string;
  rate: string;
  glAccountId: string;
  isEosBase: boolean;
}

function toDraft(row: SalaryComponentRow): ComponentDraft {
  return {
    key: row.key,
    name: row.name,
    nameAr: row.nameAr ?? "",
    kind: row.kind,
    calc: row.calc,
    amount: row.amount ?? "",
    rate: row.rate ?? "",
    glAccountId: row.glAccountId,
    isEosBase: row.isEosBase,
  };
}

export function StructureBuilder({
  locale,
  structure,
  components,
  accounts,
  currency,
}: {
  locale: Locale;
  structure: SalaryStructureRow;
  components: readonly SalaryComponentRow[];
  accounts: readonly AccountRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const editable = structure.status === "ACTIVE";
  const postableAccounts = accounts.filter((account) => account.isPostable && account.status === "ACTIVE");

  const [rows, setRows] = useState<readonly ComponentDraft[]>(components.map(toDraft));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [versionCode, setVersionCode] = useState("");

  function updateRow(index: number, patch: Partial<ComponentDraft>): void {
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow(): void {
    setRows((current) => [
      ...current,
      {
        key: "",
        name: "",
        nameAr: "",
        kind: "ALLOWANCE",
        calc: "FIXED",
        amount: "",
        rate: "",
        glAccountId: postableAccounts[0]?.id ?? "",
        isEosBase: false,
      },
    ]);
  }

  function removeRow(index: number): void {
    setRows((current) => current.filter((_, position) => position !== index));
  }

  /** Client-side mirror of the wire schema (the honest precheck). */
  function validate(): string | null {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!CODE_SHAPE.test(row.key)) {
        return d.budgetFormInvalid;
      }
      if (seen.has(row.key)) {
        return d.payErrCodeConflict;
      }
      seen.add(row.key);
      if (row.name.trim() === "" || row.glAccountId === "") {
        return d.budgetFormInvalid;
      }
      if (row.calc === "FIXED" && !MONEY_SHAPE.test(row.amount)) {
        return d.budgetFormInvalid;
      }
      if (row.calc !== "FIXED" && !MONEY_SHAPE.test(row.rate)) {
        return d.budgetFormInvalid;
      }
    }
    return null;
  }

  function wireRows(): Record<string, unknown>[] {
    return rows.map((row, index) => ({
      key: row.key.trim(),
      name: row.name.trim(),
      nameAr: row.nameAr.trim() === "" ? null : row.nameAr.trim(),
      kind: row.kind,
      calc: row.calc,
      amount: row.amount === "" ? null : row.amount,
      rate: row.rate === "" ? null : row.rate,
      glAccountId: row.glAccountId,
      isEosBase: row.isEosBase,
      seq: index + 1,
    }));
  }

  async function save(): Promise<void> {
    setError(null);
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setBusy("save");
    const result = await bffFetch<{ components: SalaryComponentRow[] }>(
      `payroll/salary-structures/${structure.id}/components`,
      {
        method: "PUT",
        body: { components: wireRows() },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: formatMessage(d.payStructureSavedToast, {}) });
    router.refresh();
  }

  async function version(): Promise<void> {
    setError(null);
    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    if (!CODE_SHAPE.test(versionCode)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("version");
    const result = await bffFetch<SalaryStructureRow>(
      `payroll/salary-structures/${structure.id}/version`,
      {
        method: "POST",
        body: {
          code: versionCode.trim(),
          components: wireRows(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.payStructureVersionedToast, { code: result.data.code }),
    });
    router.push(`/${locale}/payroll/structures/${result.data.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <Card
        title={`${structure.code} — ${localizedName(structure.name, structure.nameAr, locale)}`}
        description={structure.status === "ACTIVE" ? undefined : d.payStructureInUseNote}
        actions={
          <Badge tone={structure.status === "ACTIVE" ? "primary" : "neutral"}>
            {structure.status === "ACTIVE" ? d.payStatusActive : d.payStructureArchived}
          </Badge>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6 text-sm">
            <span className="font-mono" dir="ltr">
              {d.payStructureCurrency}: {structure.currency}
            </span>
            <span>{`${d.payStructureComponents}: ${rows.length}`}</span>
          </div>
          {rows.length === 0 && <InfoNotice>{d.payRunEmptyLines}</InfoNotice>}
          <div className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-md border border-subtle p-3 lg:grid-cols-12"
              >
                <div className="lg:col-span-2">
                  <Input
                    id={`component-${index}-key`}
                    label={d.payComponentKey}
                    value={row.key}
                    onValueChange={(value) => updateRow(index, { key: value })}
                    mono
                    bidiIsolate
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Input
                    id={`component-${index}-name`}
                    label={d.payEmployeeName}
                    value={row.name}
                    onValueChange={(value) => updateRow(index, { name: value })}
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Input
                    id={`component-${index}-name-ar`}
                    label={d.budgetFormNameAr}
                    value={row.nameAr}
                    onValueChange={(value) => updateRow(index, { nameAr: value })}
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Select
                    id={`component-${index}-kind`}
                    label={d.payComponentKind}
                    value={row.kind}
                    onValueChange={(value) => {
                      const next = KINDS.find((entry) => entry === value);
                      if (next !== undefined) {
                        updateRow(index, { kind: next });
                      }
                    }}
                    options={KINDS.map((entry) => ({
                      value: entry,
                      label:
                        entry === "ALLOWANCE"
                          ? d.payKindAllowance
                          : entry === "DEDUCTION"
                            ? d.payKindDeduction
                            : d.payKindEmployer,
                    }))}
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Select
                    id={`component-${index}-calc`}
                    label={d.payComponentCalc}
                    value={row.calc}
                    onValueChange={(value) => {
                      const next = CALCS.find((entry) => entry === value);
                      if (next !== undefined) {
                        updateRow(index, { calc: next });
                      }
                    }}
                    options={CALCS.map((entry) => ({
                      value: entry,
                      label:
                        entry === "FIXED"
                          ? d.payCalcFixed
                          : entry === "PERCENT_OF_BASIC"
                            ? d.payCalcPercentBasic
                            : d.payCalcPercentGross,
                    }))}
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Select
                    id={`component-${index}-account`}
                    label={d.payComponentAccount}
                    value={row.glAccountId}
                    onValueChange={(value) => updateRow(index, { glAccountId: value })}
                    options={postableAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.code} — ${localizedName(account.name, account.nameAr, locale)}`,
                    }))}
                    disabled={!editable}
                  />
                </div>
                <div className="lg:col-span-3">
                  <MoneyInput
                    id={`component-${index}-amount`}
                    label={d.payComponentAmount}
                    amount={row.amount}
                    onAmountChange={(value) => updateRow(index, { amount: value })}
                    currency={currency}
                    disabled={!editable}
                    hint={row.calc === "FIXED" ? undefined : d.payCalcPercentBasic}
                  />
                </div>
                <div className="lg:col-span-2">
                  <Input
                    id={`component-${index}-rate`}
                    label={d.payComponentRate}
                    value={row.rate}
                    onValueChange={(value) => updateRow(index, { rate: value })}
                    inputMode="decimal"
                    mono
                    bidiIsolate
                    disabled={!editable || row.calc === "FIXED"}
                  />
                </div>
                <div className="lg:col-span-4 flex items-center gap-2">
                  <Checkbox
                    checked={row.isEosBase}
                    onCheckedChange={(checked) => updateRow(index, { isEosBase: checked === true })}
                    disabled={!editable}
                  />
                  <span className="text-sm text-gray-700">{d.payComponentEosBase}</span>
                  {row.amount !== "" && row.calc === "FIXED" && (
                    <span className="ms-auto font-mono tabular-nums text-sm text-gray-500" dir="ltr">
                      {formatMoneyDisplay(row.amount, 2)}
                    </span>
                  )}
                  {editable && (
                    <Button
                      variant="ghost"
                      onClick={() => removeRow(index)}
                      className="ms-auto"
                      aria-label={d.payStructureRemoveComponent}
                    >
                      {d.payStructureRemoveComponent}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {editable && (
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="secondary" onClick={addRow} disabled={busy !== null}>
                {d.payStructureAddComponent}
              </Button>
              <div className="ms-auto flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Input
                    id="structure-version-code"
                    label={d.payStructureVersion}
                    value={versionCode}
                    onValueChange={setVersionCode}
                    mono
                    bidiIsolate
                    hint="V2"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void version()}
                  loading={busy === "version"}
                >
                  {d.payStructureVersion}
                </Button>
                <Button variant="primary" onClick={() => void save()} loading={busy === "save"}>
                  {d.payStructureSave}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
