"use client";

/**
 * PHASE-019 T50 — the lead pipeline board:
 *
 * - status tabs (NEW/QUALIFIED/CONVERTED/LOST) with per-status counts
 *   (client-side filter over the fetched rows — counts need the full set);
 * - the create dialog (name/nameAr, phone/email, company, source, owner
 *   rep, note);
 * - the convert wizard dialog (mode NEW_PARTNER | MERGE with the partner
 *   select + kind) — conversion is FINAL (the partner link is provenance);
 * - the lose dialog (reason 1..200 required);
 * - edit (PUT) on NEW/QUALIFIED leads only — CONVERTED/LOST are immutable.
 *
 * No money fields, no ledger effects (MASTER-PLAN §2); the wire rows are
 * the crm store's LeadRow verbatim.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { LeadRow, PartnerRow, TenantUserRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedCrmError,
  localizedLeadSource,
  localizedLeadStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PIPELINE_STATUSES = ["NEW", "QUALIFIED", "CONVERTED", "LOST"] as const;

const SOURCE_VALUES = ["WALK_IN", "REFERRAL", "WEBSITE", "CAMPAIGN", "CALL", "OTHER"] as const;

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function CrmPipeline({
  locale,
  initialRows,
  users,
  partners,
}: {
  locale: Locale;
  initialRows: readonly LeadRow[];
  users: readonly TenantUserRow[];
  partners: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly LeadRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Status tab (client-side; "" = all).
  const [statusFilter, setStatusFilter] = useState("");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createNameAr, setCreateNameAr] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createCompany, setCreateCompany] = useState("");
  const [createSource, setCreateSource] = useState("OTHER");
  const [createOwner, setCreateOwner] = useState("");
  const [createNote, setCreateNote] = useState("");

  // Edit dialog state (NEW/QUALIFIED only).
  const [editTarget, setEditTarget] = useState<LeadRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editSource, setEditSource] = useState("OTHER");
  const [editOwner, setEditOwner] = useState("");
  const [editNote, setEditNote] = useState("");

  // Convert wizard state.
  const [convertTarget, setConvertTarget] = useState<LeadRow | null>(null);
  const [convertMode, setConvertMode] = useState<"NEW_PARTNER" | "MERGE">("NEW_PARTNER");
  const [convertPartnerId, setConvertPartnerId] = useState("");
  const [convertKind, setConvertKind] = useState<"CUSTOMER" | "BOTH">("CUSTOMER");

  // Lose dialog state.
  const [loseTarget, setLoseTarget] = useState<LeadRow | null>(null);
  const [loseReason, setLoseReason] = useState("");

  const userLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.userId, user.fullName !== "" ? `${user.fullName} · ${user.email}` : user.email);
    }
    return map;
  }, [users]);

  const customerPartners = useMemo(
    () =>
      partners.filter(
        (partner) =>
          (partner.kind === "CUSTOMER" || partner.kind === "BOTH") && partner.deletedAt === null,
      ),
    [partners],
  );
  const partnerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      map.set(partner.id, `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`);
    }
    return map;
  }, [partners, locale]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.status, (map.get(row.status) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const visibleRows = useMemo(
    () => (statusFilter === "" ? rows : rows.filter((row) => row.status === statusFilter)),
    [rows, statusFilter],
  );

  const createReady = createName.trim() !== "";
  const editReady = editTarget !== null && editName.trim() !== "";
  const convertReady =
    convertTarget !== null && (convertMode === "NEW_PARTNER" || convertPartnerId !== "");
  const loseReady = loseTarget !== null && loseReason.trim().length >= 1 && loseReason.trim().length <= 200;

  function replaceRow(next: LeadRow): void {
    setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
  }

  // -- create -----------------------------------------------------------------------

  async function createLead(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<LeadRow>("crm/leads", {
      method: "POST",
      body: {
        name: createName.trim(),
        nameAr: createNameAr.trim() === "" ? null : createNameAr.trim(),
        phone: createPhone.trim() === "" ? null : createPhone.trim(),
        email: createEmail.trim() === "" ? null : createEmail.trim(),
        company: createCompany.trim() === "" ? null : createCompany.trim(),
        source: createSource,
        ownerUserId: createOwner === "" ? null : createOwner,
        note: createNote.trim() === "" ? null : createNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateName("");
    setCreateNameAr("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateCompany("");
    setCreateSource("OTHER");
    setCreateOwner("");
    setCreateNote("");
    setNotice(d.crmLeadCreatedToast);
  }

  // -- edit (PUT) -------------------------------------------------------------------

  function openEdit(lead: LeadRow): void {
    setEditTarget(lead);
    setEditName(lead.name);
    setEditNameAr(lead.nameAr ?? "");
    setEditPhone(lead.phone ?? "");
    setEditEmail(lead.email ?? "");
    setEditCompany(lead.company ?? "");
    setEditSource(lead.source);
    setEditOwner(lead.ownerUserId ?? "");
    setEditNote(lead.note ?? "");
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<LeadRow>(`crm/leads/${editTarget.id}`, {
      method: "PUT",
      body: {
        name: editName.trim(),
        nameAr: editNameAr.trim() === "" ? null : editNameAr.trim(),
        phone: editPhone.trim() === "" ? null : editPhone.trim(),
        email: editEmail.trim() === "" ? null : editEmail.trim(),
        company: editCompany.trim() === "" ? null : editCompany.trim(),
        source: editSource,
        ownerUserId: editOwner === "" ? null : editOwner,
        note: editNote.trim() === "" ? null : editNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    replaceRow(result.data);
    setEditTarget(null);
    setNotice(d.crmLeadSavedToast);
  }

  // -- convert ----------------------------------------------------------------------

  async function convertLead(): Promise<void> {
    if (convertTarget === null || !convertReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("convert");
    setError(null);
    const result = await bffFetch<LeadRow>(`crm/leads/${convertTarget.id}/convert`, {
      method: "POST",
      body: {
        mode: convertMode,
        ...(convertMode === "MERGE" ? { partnerId: convertPartnerId } : {}),
        kind: convertKind,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    replaceRow(result.data);
    setConvertTarget(null);
    setConvertPartnerId("");
    setNotice(
      formatMessage(d.crmLeadConvertedToast, {
        partner: partnerLabelById.get(result.data.partnerId ?? "") ?? shortId(result.data.partnerId ?? ""),
      }),
    );
  }

  // -- lose -------------------------------------------------------------------------

  async function loseLead(): Promise<void> {
    if (loseTarget === null || !loseReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("lose");
    setError(null);
    const result = await bffFetch<LeadRow>(`crm/leads/${loseTarget.id}/lose`, {
      method: "POST",
      body: { reason: loseReason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCrmError(d, result.error, result.retryAfterSeconds));
      return;
    }
    replaceRow(result.data);
    setLoseTarget(null);
    setLoseReason("");
    setNotice(d.crmLeadLostToast);
  }

  // -- render -----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.crmPipelineTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.crmLeadsNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-2" aria-label={d.accountingColStatus}>
          <Button
            variant={statusFilter === "" ? "primary" : "secondary"}
            onClick={() => setStatusFilter("")}
          >
            {d.crmLeadsAllStatuses} ({rows.length})
          </Button>
          {PIPELINE_STATUSES.map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "primary" : "secondary"}
              onClick={() => setStatusFilter(status)}
            >
              {localizedLeadStatus(d, status)} ({counts.get(status) ?? 0})
            </Button>
          ))}
        </div>
        <div className="mt-3">
          <DataTable
            columns={[
              {
                id: "name",
                header: activeLocaleHeader(d.crmLeadColName),
                accessor: (row) => row.name,
                render: (row) => (
                  <span className="font-medium text-gray-900">
                    {localizedName(row.name, row.nameAr, locale)}
                  </span>
                ),
              },
              {
                id: "company",
                header: activeLocaleHeader(d.crmLeadColCompany),
                accessor: (row) => row.company ?? "",
                render: (row) => row.company ?? <span className="text-gray-500">—</span>,
              },
              {
                id: "contact",
                header: activeLocaleHeader(d.crmLeadColContact),
                accessor: (row) => `${row.phone ?? ""} ${row.email ?? ""}`.trim(),
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.phone ?? "—"}
                    {row.email !== null ? ` · ${row.email}` : ""}
                  </span>
                ),
              },
              {
                id: "source",
                header: activeLocaleHeader(d.crmLeadColSource),
                accessor: (row) => row.source,
                render: (row) => localizedLeadSource(d, row.source),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "CONVERTED" ? "primary" : undefined}>
                    {localizedLeadStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "owner",
                header: activeLocaleHeader(d.crmLeadColOwner),
                accessor: (row) => row.ownerUserId ?? "",
                render: (row) =>
                  row.ownerUserId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (userLabelById.get(row.ownerUserId) ?? shortId(row.ownerUserId))
                  ),
              },
              {
                id: "partner",
                header: activeLocaleHeader(d.crmLeadColPartner),
                accessor: (row) => row.partnerId ?? "",
                render: (row) =>
                  row.partnerId === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    (partnerLabelById.get(row.partnerId) ?? shortId(row.partnerId))
                  ),
              },
              {
                id: "lostReason",
                header: activeLocaleHeader(d.crmLeadColLostReason),
                accessor: (row) => row.lostReason ?? "",
                render: (row) => row.lostReason ?? <span className="text-gray-500">—</span>,
              },
              {
                id: "created",
                header: activeLocaleHeader(d.crmLeadColCreated),
                accessor: (row) => row.createdAt,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.createdAt.slice(0, 10)}
                  </span>
                ),
              },
            ]}
            rows={[...visibleRows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "edit",
                label: d.commonOpen,
                onSelect: (row) => {
                  if (row.status === "NEW" || row.status === "QUALIFIED") {
                    openEdit(row);
                  }
                },
              },
              {
                id: "convert",
                label: d.crmLeadConvert,
                onSelect: (row) => {
                  if (row.status === "NEW" || row.status === "QUALIFIED") {
                    setConvertMode("NEW_PARTNER");
                    setConvertPartnerId("");
                    setConvertKind("CUSTOMER");
                    setConvertTarget(row);
                  }
                },
              },
              {
                id: "lose",
                label: d.crmLeadLose,
                onSelect: (row) => {
                  if (row.status === "NEW" || row.status === "QUALIFIED") {
                    setLoseReason("");
                    setLoseTarget(row);
                  }
                },
              },
            ]}
            empty={{ title: d.crmLeadsEmpty }}
          />
        </div>
      </Card>

      {/* -- create dialog --------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.crmLeadCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.crmLeadName}
            value={createName}
            onValueChange={setCreateName}
            required
            error={createName.trim() === "" ? d.errorsValidation : undefined}
          />
          <Input label={d.crmLeadNameAr} value={createNameAr} onValueChange={setCreateNameAr} />
          <Input label={d.crmLeadPhone} value={createPhone} onValueChange={setCreatePhone} mono bidiIsolate />
          <Input label={d.crmLeadEmail} value={createEmail} onValueChange={setCreateEmail} bidiIsolate />
          <Input label={d.crmLeadCompany} value={createCompany} onValueChange={setCreateCompany} />
          <Select
            label={d.crmLeadSource}
            value={createSource}
            onValueChange={setCreateSource}
            options={SOURCE_VALUES.map((source) => ({
              value: source,
              label: localizedLeadSource(d, source),
            }))}
          />
          <Select
            label={d.crmLeadOwner}
            value={createOwner}
            onValueChange={setCreateOwner}
            placeholder="—"
            options={[
              { value: "", label: d.crmLeadOwner },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <Input label={d.crmLeadNote} value={createNote} onValueChange={setCreateNote} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createLead()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (NEW/QUALIFIED only) ---------------------------------------- */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.crmLeadEditTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.crmLeadName}
            value={editName}
            onValueChange={setEditName}
            required
            error={editName.trim() === "" ? d.errorsValidation : undefined}
          />
          <Input label={d.crmLeadNameAr} value={editNameAr} onValueChange={setEditNameAr} />
          <Input label={d.crmLeadPhone} value={editPhone} onValueChange={setEditPhone} mono bidiIsolate />
          <Input label={d.crmLeadEmail} value={editEmail} onValueChange={setEditEmail} bidiIsolate />
          <Input label={d.crmLeadCompany} value={editCompany} onValueChange={setEditCompany} />
          <Select
            label={d.crmLeadSource}
            value={editSource}
            onValueChange={setEditSource}
            options={SOURCE_VALUES.map((source) => ({
              value: source,
              label: localizedLeadSource(d, source),
            }))}
          />
          <Select
            label={d.crmLeadOwner}
            value={editOwner}
            onValueChange={setEditOwner}
            placeholder="—"
            options={[
              { value: "", label: d.crmLeadOwner },
              ...users.map((user) => ({
                value: user.userId,
                label: userLabelById.get(user.userId) ?? user.email,
              })),
            ]}
          />
          <Input label={d.crmLeadNote} value={editNote} onValueChange={setEditNote} />
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

      {/* -- convert wizard --------------------------------------------------------- */}
      <Dialog
        open={convertTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConvertTarget(null);
        }}
        title={d.crmLeadConvertTitle}
        description={d.crmLeadConvertHint}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.crmLeadConvertMode}
            value={convertMode}
            onValueChange={(value) => setConvertMode(value === "MERGE" ? "MERGE" : "NEW_PARTNER")}
            options={[
              { value: "NEW_PARTNER", label: d.crmLeadConvertNewPartner },
              { value: "MERGE", label: d.crmLeadConvertMerge },
            ]}
            required
          />
          {convertMode === "MERGE" && (
            <Select
              label={d.crmLeadConvertPartner}
              value={convertPartnerId}
              onValueChange={setConvertPartnerId}
              placeholder="—"
              options={customerPartners.map((partner) => ({
                value: partner.id,
                label: partnerLabelById.get(partner.id) ?? partner.code,
              }))}
              required
            />
          )}
          <Select
            label={d.partnersKindLabel}
            value={convertKind}
            onValueChange={(value) => setConvertKind(value === "BOTH" ? "BOTH" : "CUSTOMER")}
            options={[
              { value: "CUSTOMER", label: d.kindCustomer },
              { value: "BOTH", label: d.kindBoth },
            ]}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConvertTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "convert"}
            disabled={!convertReady}
            onClick={() => void convertLead()}
          >
            {d.crmLeadConvert}
          </Button>
        </div>
      </Dialog>

      {/* -- lose dialog -------------------------------------------------------------- */}
      <Dialog
        open={loseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLoseTarget(null);
        }}
        title={d.crmLeadLoseTitle}
      >
        <Input
          label={d.crmLeadLoseReason}
          value={loseReason}
          onValueChange={setLoseReason}
          required
          error={
            loseReason.trim().length > 200 ||
            (loseTarget !== null && loseReason.trim() === "")
              ? d.errorsValidation
              : undefined
          }
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setLoseTarget(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "lose"}
            disabled={!loseReady}
            onClick={() => void loseLead()}
          >
            {d.crmLeadLose}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
