"use client";

/**
 * PHASE-029 (T11) — the salary-structures register (PAGE_ARCHETYPES §2,
 * the settings archetype — the accounting-periods pattern): inline create
 * (code + bilingual name; the server stamps the tenant currency) + the
 * BR-052 version register table (status/supersede chain). Rows link to
 * the builder surface (payroll/structures/:id); the register re-fetches
 * through the BFF after create.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, Input, useToast, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { SalaryStructureRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedPayrollError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export function SalaryStructures({
  locale,
  initialRows,
}: {
  locale: Locale;
  initialRows: readonly SalaryStructureRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();

  const [rows, setRows] = useState<readonly SalaryStructureRow[]>(initialRows);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const runRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    const result = await bffFetch<readonly SalaryStructureRow[]>("payroll/salary-structures");
    if (run !== runRef.current) {
      return;
    }
    if (!result.ok) {
      setError(localizedPayrollError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d]);

  async function create(): Promise<void> {
    setError(null);
    setNotice(null);
    if (code.trim() === "" || name.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(true);
    const created = await bffFetch<SalaryStructureRow>("payroll/salary-structures", {
      method: "POST",
      body: {
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedPayrollError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.payStructureSavedToast, {}));
    toast({
      tone: "success",
      title: formatMessage(d.payEmployeeCreatedToast, { code: created.data.code }),
    });
    setCode("");
    setName("");
    setNameAr("");
    await reload();
    router.refresh();
  }

  const structureLabel = useCallback(
    (row: SalaryStructureRow): string => localizedName(row.name, row.nameAr, locale),
    [locale],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.payStructureNew} description={d.payStructureInUseNote}>
        <div className="flex flex-col gap-3">
          {error !== null && <ErrorNotice>{error}</ErrorNotice>}
          {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              id="structure-form-code"
              label={d.payStructureCode}
              value={code}
              onValueChange={setCode}
              mono
              bidiIsolate
              required
            />
            <Input
              id="structure-form-name"
              label={d.payStructureName}
              value={name}
              onValueChange={setName}
              required
            />
            <Input
              id="structure-form-name-ar"
              label={d.budgetFormNameAr}
              value={nameAr}
              onValueChange={setNameAr}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void create()} loading={busy}>
              {d.payStructureNew}
            </Button>
          </div>
        </div>
      </Card>
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.payStructureCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "10rem",
            render: (row) => (
              <a
                href={`/${locale}/payroll/structures/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.code}
              </a>
            ),
          },
          {
            id: "name",
            header: activeLocaleHeader(d.payStructureName),
            accessor: (row) => structureLabel(row),
            sortable: true,
            render: (row) => structureLabel(row),
          },
          {
            id: "currency",
            header: activeLocaleHeader(d.payStructureCurrency),
            accessor: (row) => row.currency,
            render: (row) => (
              <span className="font-mono" dir="ltr">
                {row.currency}
              </span>
            ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.payStructureStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {row.status === "ACTIVE" ? d.payStatusActive : d.payStructureArchived}
              </Badge>
            ),
          },
          {
            id: "supersededBy",
            header: activeLocaleHeader(d.payStructureVersion),
            accessor: (row) => row.supersededById ?? "—",
            render: (row) =>
              row.supersededById === null ? (
                "—"
              ) : (
                <a
                  href={`/${locale}/payroll/structures/${row.supersededById}`}
                  className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                  dir="ltr"
                >
                  → {row.supersededById.slice(0, 8)}
                </a>
              ),
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        empty={{ title: d.budgetsEmpty }}
      />
    </div>
  );
}
