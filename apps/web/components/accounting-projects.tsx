"use client";

/**
 * PHASE-019 T50 — the projects dimension (the cost-center mirror):
 *
 * - the list (code / name / parent / status) ordered by code;
 * - the create dialog (code `^[A-Za-z0-9_-]{1,20}$`, name, Arabic name,
 *   parent select — the parent pool is the fetched list itself);
 * - the patch surface: rename (name/nameAr) + the status flip
 *   OPEN↔CLOSED with a confirm dialog (a CLOSED project rejects new
 *   journal-line stamps; posted history stays).
 *
 * The GET rides accounting.journal_entries.view; the writes ride
 * accounting.projects.manage — a 403 on a write surfaces honestly through
 * the localized accounting mapper (PROJECT_NOT_FOUND/PROJECT_CODE_TAKEN
 * are the T44 typed codes).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ProjectRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedAccountingError,
  localizedProjectStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

export function AccountingProjects({
  locale,
  initialRows,
}: {
  locale: Locale;
  initialRows: readonly ProjectRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly ProjectRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState("");
  const [createName, setCreateName] = useState("");
  const [createNameAr, setCreateNameAr] = useState("");
  const [createParentId, setCreateParentId] = useState("");

  // Edit dialog state (rename).
  const [editTarget, setEditTarget] = useState<ProjectRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");

  // Status-flip confirm dialog.
  const [closeTarget, setCloseTarget] = useState<ProjectRow | null>(null);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of rows) {
      map.set(project.id, `${project.code} · ${localizedName(project.name, project.nameAr, locale)}`);
    }
    return map;
  }, [rows, locale]);

  const createReady =
    CODE_RE.test(createCode) && createName.trim() !== "" && (createParentId === "" || createParentId !== undefined);
  const editReady = editTarget !== null && editName.trim() !== "";

  function replaceRow(next: ProjectRow): void {
    setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
  }

  async function reload(): Promise<void> {
    const result = await bffFetch<readonly ProjectRow[]>("accounting/projects");
    if (result.ok) {
      setRows(result.data);
    }
  }

  // -- create -----------------------------------------------------------------------

  async function createProject(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ProjectRow>("accounting/projects", {
      method: "POST",
      body: {
        code: createCode.trim(),
        name: createName.trim(),
        nameAr: createNameAr.trim() === "" ? null : createNameAr.trim(),
        parentId: createParentId === "" ? null : createParentId,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setCreateCode("");
    setCreateName("");
    setCreateNameAr("");
    setCreateParentId("");
    setNotice(d.accountingProjectCreatedToast);
    await reload();
  }

  // -- rename (PATCH) ------------------------------------------------------------------

  async function saveEdit(): Promise<void> {
    if (editTarget === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<ProjectRow>(`accounting/projects/${editTarget.id}`, {
      method: "PATCH",
      body: {
        name: editName.trim(),
        nameAr: editNameAr.trim() === "" ? null : editNameAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    replaceRow(result.data);
    setEditTarget(null);
    setNotice(d.accountingProjectSavedToast);
  }

  // -- the status flip (with confirm) -----------------------------------------------------

  async function flipStatus(): Promise<void> {
    if (closeTarget === null) return;
    setBusy("flip");
    setError(null);
    const nextStatus = closeTarget.status === "OPEN" ? "CLOSED" : "OPEN";
    const result = await bffFetch<ProjectRow>(`accounting/projects/${closeTarget.id}`, {
      method: "PATCH",
      body: { status: nextStatus },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedAccountingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCloseTarget(null);
    setNotice(d.accountingProjectStatusToast);
    await reload();
  }

  // -- render -----------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.accountingProjectsTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.accountingProjectsNew}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.accountingColCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.accountingColName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
              render: (row) => (
                <span className="font-medium text-gray-900">
                  {localizedName(row.name, row.nameAr, locale)}
                </span>
              ),
            },
            {
              id: "parent",
              header: activeLocaleHeader(d.accountingProjectColParent),
              accessor: (row) => row.parentId ?? "",
              render: (row) =>
                row.parentId === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  (labelById.get(row.parentId) ?? row.parentId)
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "OPEN" ? "primary" : undefined}>
                  {localizedProjectStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "edit",
              label: d.commonSave,
              onSelect: (row) => {
                setEditTarget(row);
                setEditName(row.name);
                setEditNameAr(row.nameAr ?? "");
              },
            },
            {
              id: "close",
              label: d.accountingProjectClose,
              onSelect: (row) => {
                if (row.status === "OPEN") {
                  setCloseTarget(row);
                }
              },
            },
            {
              id: "reopen",
              label: d.accountingProjectReopen,
              onSelect: (row) => {
                if (row.status === "CLOSED") {
                  setCloseTarget(row);
                }
              },
            },
          ]}
          empty={{ title: d.accountingProjectsEmpty }}
        />
      </Card>

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.accountingProjectCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.accountingProjectCode}
            value={createCode}
            onValueChange={setCreateCode}
            mono
            bidiIsolate
            hint={d.accountingProjectCodeHint}
            required
            error={createCode !== "" && !CODE_RE.test(createCode) ? d.errorsValidation : undefined}
          />
          <Input
            label={d.accountingColName}
            value={createName}
            onValueChange={setCreateName}
            required
            error={createName.trim() === "" ? d.errorsValidation : undefined}
          />
          <Input label={d.accountingProjectNameAr} value={createNameAr} onValueChange={setCreateNameAr} />
          <Select
            label={d.accountingProjectParent}
            value={createParentId}
            onValueChange={setCreateParentId}
            placeholder="—"
            options={[
              { value: "", label: d.accountingProjectParent },
              ...rows.map((project) => ({
                value: project.id,
                label: labelById.get(project.id) ?? project.code,
              })),
            ]}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createProject()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- rename dialog ------------------------------------------------------------- */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.accountingProjectEditTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.accountingColName}
            value={editName}
            onValueChange={setEditName}
            required
            error={editName.trim() === "" ? d.errorsValidation : undefined}
          />
          <Input label={d.accountingProjectNameAr} value={editNameAr} onValueChange={setEditNameAr} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "edit"}
            disabled={!editReady}
            onClick={() => void saveEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- the status-flip confirm -------------------------------------------------- */}
      <Dialog
        open={closeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
        title={
          closeTarget !== null && closeTarget.status === "OPEN"
            ? d.accountingProjectCloseTitle
            : d.accountingProjectReopen
        }
        description={d.accountingProjectCloseHint}
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "flip"}
            onClick={() => void flipStatus()}
          >
            {d.commonConfirm}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
