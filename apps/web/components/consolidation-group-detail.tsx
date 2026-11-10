"use client";

/**
 * PHASE-034 (T11) — the group Settings surface (PAGE_ARCHETYPES §8): the
 * group header/settings form (name/nameAr + FX method via PUT groups/:id;
 * base currency immutable after create; archive/reactivate rides the same
 * PUT's status), the members table with the add-member form (uuid +
 * ownership percent + includeFrom + note — the API's own create contract)
 * and the per-member update dialog (percent / REMOVED status via
 * PUT groups/:id/members/:memberTenantId), plus the group's eliminations +
 * runs strips (deep links into the module surfaces). The archived-group
 * warning banner renders above everything (a product state, role="status").
 */
import { useCallback, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  EliminationRow,
  FiscalPeriodRow,
  GroupMemberRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { compareExact } from "../lib/exact-money";
import { localizedDocumentStatus, localizedApiError } from "../lib/messages";
import { runStatusLabel } from "./consolidation-groups";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { LinkButton } from "./link-button";
import { activeLocaleHeader } from "./table-header";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERCENT_RE = /^\d+(\.\d{1,4})?$/;

export function ConsolidationGroupDetail({
  locale,
  initialGroup,
  initialMembers,
  initialEliminations,
  initialRuns,
  periods,
}: {
  locale: Locale;
  initialGroup: ConsolidationGroupRow;
  initialMembers: readonly GroupMemberRow[];
  initialEliminations: readonly EliminationRow[];
  initialRuns: readonly ConsolidationRunRow[];
  periods: readonly FiscalPeriodRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [group, setGroup] = useState<ConsolidationGroupRow>(initialGroup);
  const [members, setMembers] = useState<readonly GroupMemberRow[]>(initialMembers);
  const [eliminations] = useState<readonly EliminationRow[]>(initialEliminations);
  const [runs] = useState<readonly ConsolidationRunRow[]>(initialRuns);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Group settings form state (name/nameAr/FX method — base currency immutable).
  const [name, setName] = useState(initialGroup.name);
  const [nameAr, setNameAr] = useState(initialGroup.nameAr);
  const [fxTranslationMethod, setFxTranslationMethod] = useState<string>(initialGroup.fxTranslationMethod);

  // Add-member form state.
  const [memberTenantId, setMemberTenantId] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  const [includeFrom, setIncludeFrom] = useState("");
  const [memberNote, setMemberNote] = useState("");

  // Update-member dialog state.
  const [editMember, setEditMember] = useState<GroupMemberRow | null>(null);
  const [editPercent, setEditPercent] = useState("");
  const [editStatus, setEditStatus] = useState<string>("ACTIVE");
  const [editNote, setEditNote] = useState("");

  const archived = group.status === "ARCHIVED";
  const activeMembers = members.filter((member) => member.status === "ACTIVE");

  const refreshMembers = useCallback(async (): Promise<void> => {
    const refreshed = await bffFetch<readonly GroupMemberRow[]>(
      `consolidation/groups/${group.id}/members`,
    );
    if (refreshed.ok) {
      setMembers(refreshed.data);
    }
  }, [group.id]);

  async function saveGroup(nextStatus?: string): Promise<void> {
    setError(null);
    if (name.trim() === "" || nameAr.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(nextStatus === undefined ? "group" : "status");
    const body: Record<string, unknown> = {
      name: name.trim(),
      nameAr: nameAr.trim(),
      fxTranslationMethod,
    };
    if (nextStatus !== undefined) {
      body.status = nextStatus;
    }
    const saved = await bffFetch<ConsolidationGroupRow>(`consolidation/groups/${group.id}`, {
      method: "PUT",
      body,
    });
    setBusy(null);
    if (!saved.ok) {
      setError(localizedApiError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setGroup(saved.data);
    setNotice(nextStatus === undefined ? d.commonSave : d.consolidationGroupStatusToast);
  }

  async function addMember(): Promise<void> {
    setError(null);
    if (!UUID_RE.test(memberTenantId.trim())) {
      setError(d.errorsValidation);
      return;
    }
    if (
      !PERCENT_RE.test(ownershipPercent.trim()) ||
      compareExact(ownershipPercent.trim(), "0") <= 0 ||
      compareExact(ownershipPercent.trim(), "100") > 0
    ) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("member");
    const body: Record<string, unknown> = {
      memberTenantId: memberTenantId.trim(),
      ownershipPercent: ownershipPercent.trim(),
      includeFrom: includeFrom === "" ? null : includeFrom,
    };
    if (memberNote.trim() !== "") body.note = memberNote.trim();
    const created = await bffFetch<GroupMemberRow>(`consolidation/groups/${group.id}/members`, {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!created.ok) {
      setError(localizedApiError(d, created.error, created.retryAfterSeconds));
      return;
    }
    setMemberTenantId("");
    setOwnershipPercent("");
    setIncludeFrom("");
    setMemberNote("");
    setNotice(d.consolidationMemberAddedToast);
    await refreshMembers();
  }

  function openEditMember(member: GroupMemberRow): void {
    setEditMember(member);
    setEditPercent(member.ownershipPercent);
    setEditStatus(member.status);
    setEditNote(member.note ?? "");
  }

  async function updateMember(
    member: GroupMemberRow,
    patch: { percent?: string; status?: string; note?: string },
  ): Promise<void> {
    setError(null);
    if (patch.percent !== undefined && !PERCENT_RE.test(patch.percent)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("update");
    const body: Record<string, unknown> = {};
    if (patch.percent !== undefined) {
      body.ownershipPercent = patch.percent;
    }
    if (patch.status !== undefined) {
      body.status = patch.status;
    }
    if (patch.note !== undefined) {
      body.note = patch.note;
    }
    const saved = await bffFetch<GroupMemberRow>(
      `consolidation/groups/${group.id}/members/${member.memberTenantId}`,
      { method: "PUT", body },
    );
    setBusy(null);
    if (!saved.ok) {
      setError(localizedApiError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setEditMember(null);
    setNotice(d.consolidationMemberUpdatedToast);
    await refreshMembers();
  }

  const periodLabel = useCallback(
    (id: string): string => {
      const period = periods.find((row) => row.id === id);
      return period === undefined ? id : period.name;
    },
    [periods],
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      {archived && (
        <div
          role="status"
          className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
        >
          {d.consolidationGroupArchivedWarning}
        </div>
      )}

      <Card
        title={d.consolidationGroupSettingsCard}
        actions={
          <Badge tone={archived ? "neutral" : "primary"} bidiIsolate>
            {archived ? d.consolidationStatusArchived : d.consolidationStatusActive}
          </Badge>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            id="consolidation-settings-name"
            label={d.consolidationGroupName}
            value={name}
            onValueChange={setName}
            required
          />
          <Input
            id="consolidation-settings-name-ar"
            label={d.consolidationGroupNameAr}
            value={nameAr}
            onValueChange={setNameAr}
            required
          />
          <Select
            id="consolidation-settings-fx"
            label={d.consolidationGroupFxMethod}
            value={fxTranslationMethod}
            onValueChange={setFxTranslationMethod}
            options={[
              { value: "CLOSING_RATE", label: d.consolidationFxMethodClosingRate },
              { value: "TEMPORARY", label: d.consolidationFxMethodTemporary },
            ]}
          />
          <div className="flex items-end">
            <p className="text-sm text-gray-700">
              {d.consolidationGroupBaseCurrency}:{" "}
              <span className="font-mono" dir="ltr">
                {group.baseCurrency}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
          <Button variant="secondary" onClick={() => void saveGroup()} loading={busy === "group"}>
            {d.commonSave}
          </Button>
          {archived ? (
            <Button
              variant="primary"
              onClick={() => void saveGroup("ACTIVE")}
              loading={busy === "status"}
            >
              {d.consolidationReactivateGroupAction}
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => void saveGroup("ARCHIVED")}
              loading={busy === "status"}
            >
              {d.consolidationArchiveGroupAction}
            </Button>
          )}
        </div>
      </Card>

      <Card
        title={d.consolidationMembersCard}
        description={`${d.consolidationGroupMembersLabel}: ${activeMembers.length}`}
      >
        <DataTable
          columns={[
            {
              id: "member",
              header: activeLocaleHeader(d.consolidationMemberTenantId),
              accessor: (row) => row.memberTenantId,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.memberTenantId}
                </span>
              ),
            },
            {
              id: "ownership",
              header: activeLocaleHeader(d.consolidationMemberOwnershipPercent),
              accessor: (row) => row.ownershipPercent,
              numeric: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.ownershipPercent}%
                </span>
              ),
            },
            {
              id: "includeFrom",
              header: activeLocaleHeader(d.consolidationMemberIncludeFrom),
              accessor: (row) => row.includeFrom ?? "",
              mono: true,
              render: (row) =>
                row.includeFrom === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.includeFrom}
                  </span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                  {row.status === "ACTIVE"
                    ? d.consolidationStatusActive
                    : d.consolidationMemberStatusRemoved}
                </Badge>
              ),
            },
            {
              id: "note",
              header: activeLocaleHeader(d.consolidationNoteEn),
              accessor: (row) => row.note ?? "",
              render: (row) => (
                <span className="truncate text-xs text-gray-600">{row.note ?? "—"}</span>
              ),
            },
          ]}
          rows={[...members]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "update",
              label: d.consolidationMemberUpdateAction,
              onSelect: (row) => openEditMember(row),
            },
            {
              id: "remove",
              label: d.consolidationMemberRemoveAction,
              danger: true,
              onSelect: (row) => void updateMember(row, { status: "REMOVED" }),
            },
          ]}
          empty={{ title: d.consolidationAddMemberTitle }}
        />

        <div className="mt-4 border-t border-subtle pt-3">
          <h3 className="text-sm font-semibold text-gray-900">{d.consolidationAddMemberTitle}</h3>
          <p className="mt-1 text-xs text-gray-600">{d.consolidationMemberTenantIdHint}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="consolidation-member-uuid"
              label={d.consolidationMemberTenantId}
              value={memberTenantId}
              onValueChange={setMemberTenantId}
              placeholder="00000000-0000-0000-0000-000000000000"
              mono
              bidiIsolate
              required
            />
            <Input
              id="consolidation-member-percent"
              label={d.consolidationMemberOwnershipPercent}
              value={ownershipPercent}
              onValueChange={setOwnershipPercent}
              placeholder="80.0000"
              inputMode="decimal"
              mono
              bidiIsolate
              required
            />
            <DatePicker
              id="consolidation-member-include-from"
              locale={locale}
              value={includeFrom}
              onSelect={setIncludeFrom}
              label={d.consolidationMemberIncludeFrom}
            />
            <Input
              id="consolidation-member-note"
              label={d.consolidationNoteEn}
              value={memberNote}
              onValueChange={setMemberNote}
            />
          </div>
          <div className="mt-3">
            <Button
              variant="primary"
              onClick={() => void addMember()}
              loading={busy === "member"}
              disabled={archived}
            >
              {d.consolidationAddMemberButton}
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={d.consolidationGroupEliminationsCard}
        actions={
          <span className="flex flex-wrap gap-2">
            <LinkButton
              href={`/${locale}/consolidation/eliminations?groupId=${group.id}`}
              variant="secondary"
            >
              {d.consolidationViewEliminations}
            </LinkButton>
            <LinkButton
              href={`/${locale}/consolidation/eliminations/new?groupId=${group.id}`}
              variant="primary"
            >
              {d.consolidationNewElimination}
            </LinkButton>
          </span>
        }
      >
        <DataTable
          columns={[
            {
              id: "no",
              header: activeLocaleHeader(d.eliminationsColNo),
              accessor: (row) => row.eliminationNo ?? "",
              mono: true,
              render: (row) =>
                row.eliminationNo === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.eliminationNo}
                  </span>
                ),
            },
            {
              id: "kind",
              header: activeLocaleHeader(d.eliminationsFilterKind),
              accessor: (row) => row.kind,
              render: (row) =>
                row.kind === "INTERCOMPANY"
                  ? d.eliminationsKindIntercompany
                  : d.eliminationsKindInvestmentEquity,
            },
            {
              id: "description",
              header: activeLocaleHeader(d.eliminationsColDescription),
              accessor: (row) => row.description,
              render: (row) => <span className="truncate">{row.description}</span>,
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.status === "POSTED" ? "primary" : "neutral"}>
                    {localizedDocumentStatus(d, row.status)}
                  </Badge>
                  {row.approvedAt !== null && (
                    <Badge tone="neutral">{d.eliminationsApprovedBadge}</Badge>
                  )}
                </span>
              ),
            },
          ]}
          rows={[...eliminations]}
          rowKey={(row) => row.id}
          empty={{ title: d.eliminationsEmpty }}
        />
      </Card>

      <Card
        title={d.consolidationGroupRunsCard}
        actions={
          <LinkButton href={`/${locale}/consolidation/runs?groupId=${group.id}`} variant="primary">
            {d.consolidationNewRun}
          </LinkButton>
        }
      >
        <DataTable
          columns={[
            {
              id: "period",
              header: activeLocaleHeader(d.consolidationFiscalPeriod),
              accessor: (row) => periodLabel(row.fiscalPeriodId),
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {periodLabel(row.fiscalPeriodId)}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "COMPLETED" ? "primary" : "neutral"}>
                  {runStatusLabel(d, row.status)}
                </Badge>
              ),
            },
            {
              id: "errorCode",
              header: activeLocaleHeader(d.consolidationRunErrorCodeCol),
              accessor: (row) => row.errorCode ?? "",
              render: (row) =>
                row.errorCode === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.errorCode}
                  </span>
                ),
            },
            {
              id: "created",
              header: activeLocaleHeader(d.consolidationColCreated),
              accessor: (row) => row.createdAt,
              mono: true,
              render: (row) => (
                <span className="font-mono text-xs" dir="ltr">
                  {row.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          empty={{ title: d.consolidationRunsEmpty }}
        />
        <p className="mt-3 text-xs text-gray-600">{d.consolidationDisclaimer}</p>
      </Card>

      <Dialog
        open={editMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditMember(null);
          }
        }}
        title={d.consolidationUpdateMemberTitle}
        size="sm"
      >
        {editMember !== null && (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs text-gray-600" dir="ltr">
              {editMember.memberTenantId}
            </p>
            <Input
              id="consolidation-member-edit-percent"
              label={d.consolidationMemberOwnershipPercent}
              value={editPercent}
              onValueChange={setEditPercent}
              inputMode="decimal"
              mono
              bidiIsolate
              required
            />
            <Select
              id="consolidation-member-edit-status"
              label={d.colStatus}
              value={editStatus}
              onValueChange={setEditStatus}
              options={[
                { value: "ACTIVE", label: d.consolidationStatusActive },
                { value: "REMOVED", label: d.consolidationMemberStatusRemoved },
              ]}
            />
            <Input
              id="consolidation-member-edit-note"
              label={d.consolidationNoteEn}
              value={editNote}
              onValueChange={setEditNote}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditMember(null)}>
                {d.commonCancel}
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  void updateMember(editMember, {
                    percent: editPercent.trim(),
                    status: editStatus,
                    note: editNote.trim() === "" ? null : editNote.trim(),
                  })
                }
                loading={busy === "update"}
              >
                {d.consolidationMemberUpdateAction}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
