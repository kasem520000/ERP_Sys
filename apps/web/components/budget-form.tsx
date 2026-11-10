"use client";

/**
 * PHASE-028 (T9) — budget create form (PAGE_ARCHETYPES §3, the note-form
 * pattern): fiscal year + scope + bilingual name (+ optional bilingual
 * note) → POST budgeting/budgets creates the DRAFT version (the server
 * mints the BUD-<year>-<seq> code — DATA_DICTIONARY §12; planning data,
 * never a document, ADR-0006). The scope select drives the grid's
 * grouping dimension afterwards (scope is a filter, not a fork — §10).
 * On success the form routes to the workspace for the grid entry.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { FiscalYearRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedBudgetsError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";

const SCOPES = ["ACCOUNTS", "COST_CENTERS", "PROJECTS", "BRANCHES"] as const;

export function BudgetForm({
  locale,
  years,
}: {
  locale: Locale;
  years: readonly FiscalYearRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [fiscalYearId, setFiscalYearId] = useState(years[0]?.id ?? "");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("ACCOUNTS");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formReady = fiscalYearId !== "" && name.trim() !== "";

  async function save(): Promise<void> {
    setError(null);
    if (!formReady) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(true);
    const created = await bffFetch<{ id: string; code: string }>("budgeting/budgets", {
      method: "POST",
      body: {
        fiscalYearId,
        scope,
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        note: note.trim() === "" ? null : note.trim(),
        noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedBudgetsError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.budgetFormCreatedToast, { code: created.data.code }),
    });
    router.push(`/${locale}/budgeting/${created.data.id}`);
  }

  return (
    <Card title={d.budgetsNewTitle} description={d.budgetFormScopeHint}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            id="budget-form-year"
            label={d.budgetFormFiscalYear}
            value={fiscalYearId}
            onValueChange={setFiscalYearId}
            options={years.map((year) => ({ value: year.id, label: year.name }))}
            required
          />
          <Select
            id="budget-form-scope"
            label={d.budgetFormScope}
            value={scope}
            onValueChange={(value) => {
              const next = SCOPES.find((entry) => entry === value);
              if (next !== undefined) {
                setScope(next);
              }
            }}
            options={SCOPES.map((entry) => ({
              value: entry,
              label:
                entry === "ACCOUNTS"
                  ? d.budgetScopeAccounts
                  : entry === "COST_CENTERS"
                    ? d.budgetScopeCostCenters
                    : entry === "PROJECTS"
                      ? d.budgetScopeProjects
                      : d.budgetScopeBranches,
            }))}
            required
          />
          <Input
            id="budget-form-name"
            label={d.budgetFormName}
            value={name}
            onValueChange={setName}
            required
          />
          <Input
            id="budget-form-name-ar"
            label={d.budgetFormNameAr}
            value={nameAr}
            onValueChange={setNameAr}
          />
          <Input id="budget-form-note" label={d.budgetFormNote} value={note} onValueChange={setNote} />
          <Input
            id="budget-form-note-ar"
            label={d.budgetFormNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {d.budgetFormSubmit}
          </Button>
        </div>
      </div>
    </Card>
  );
}
