"use client";

/**
 * PHASE-016 T2 — the POS terminal registry (admin): the terminal table
 * (code, name, branch, till, receipt size, status, bound device, last seen),
 * register with validation (code pattern ^[A-Za-z0-9._-]{2,30}$, till +
 * branch required), activate/deactivate, device enrollment (device name +
 * a locally generated key shown ONCE), and device revocation.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  CashAccountRow,
  PosDeviceEnrollResult,
  PosTerminalRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedName, localizedPosError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const CODE_RE = /^[A-Za-z0-9._-]{2,30}$/;

/** A locally generated device key (48 hex chars — the client owns generation). */
function generateDeviceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function PosTerminals({
  locale,
  initialRows,
  branches,
  cashAccounts,
  warehouses,
}: {
  locale: Locale;
  initialRows: readonly PosTerminalRow[];
  branches: readonly BranchRow[];
  cashAccounts: readonly CashAccountRow[];
  warehouses: readonly WarehouseRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly PosTerminalRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Register dialog.
  const [registerOpen, setRegisterOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [branchId, setBranchId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptSize, setReceiptSize] = useState<"80mm" | "58mm">("80mm");

  // Enroll dialog.
  const [enrollTerminal, setEnrollTerminal] = useState<PosTerminalRow | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceKey, setDeviceKey] = useState("");

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) {
      map.set(branch.id, localizedName(branch.name, branch.nameAr, locale));
    }
    return map;
  }, [branches, locale]);
  const tillNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`);
    }
    return map;
  }, [cashAccounts, locale]);

  const codeValid = CODE_RE.test(code.trim());
  const registerReady =
    codeValid && name.trim() !== "" && branchId !== "" && cashAccountId !== "";

  async function register(): Promise<void> {
    if (!registerReady) {
      setError(codeValid ? d.errorsValidation : d.posTerminalsErrCodePattern);
      return;
    }
    setBusy("register");
    setError(null);
    const result = await bffFetch<PosTerminalRow>("pos/terminals", {
      method: "POST",
      body: {
        code: code.trim(),
        name: name.trim(),
        nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
        branchId,
        cashAccountId,
        warehouseId: warehouseId === "" ? null : warehouseId,
        receiptSize,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setRegisterOpen(false);
    setCode("");
    setName("");
    setNameAr("");
    setBranchId("");
    setCashAccountId("");
    setWarehouseId("");
    setReceiptSize("80mm");
    setNotice(formatMessage(d.posTerminalsRegistered, { code: result.data.code }));
  }

  async function toggleStatus(row: PosTerminalRow): Promise<void> {
    setBusy(row.id);
    setError(null);
    const result = await bffFetch<PosTerminalRow>(`pos/terminals/${row.id}/${row.status === "ACTIVE" ? "deactivate" : "activate"}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((entry) => (entry.id === row.id ? result.data : entry)));
    setNotice(result.data.status === "ACTIVE" ? d.posTerminalsActivated : d.posTerminalsDeactivated);
  }

  async function enroll(): Promise<void> {
    if (enrollTerminal === null || deviceName.trim() === "" || deviceKey.length < 16) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("enroll");
    setError(null);
    const result = await bffFetch<PosDeviceEnrollResult>(`pos/terminals/${enrollTerminal.id}/devices`, {
      method: "POST",
      body: { deviceName: deviceName.trim(), deviceKey },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((entry) => (entry.id === result.data.terminal.id ? result.data.terminal : entry)));
    setEnrollTerminal(null);
    setDeviceName("");
    setDeviceKey("");
    setNotice(d.posTerminalsEnrolled);
  }

  async function revoke(row: PosTerminalRow): Promise<void> {
    setBusy(`revoke-${row.id}`);
    setError(null);
    const result = await bffFetch<PosTerminalRow>(`pos/terminals/${row.id}/devices/revoke`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => current.map((entry) => (entry.id === row.id ? result.data : entry)));
    setNotice(d.posTerminalsRevoked);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.posTerminalsTitle}
        actions={
          <Button variant="primary" onClick={() => setRegisterOpen(true)}>
            {d.posTerminalsRegister}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.posTerminalsCode),
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
              header: activeLocaleHeader(d.posTerminalsName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "branch",
              header: activeLocaleHeader(d.posTerminalsBranch),
              accessor: (row) => branchNameById.get(row.branchId) ?? row.branchId,
            },
            {
              id: "till",
              header: activeLocaleHeader(d.posTerminalsTill),
              accessor: (row) => tillNameById.get(row.cashAccountId) ?? row.cashAccountId,
            },
            {
              id: "receiptSize",
              header: activeLocaleHeader(d.posTerminalsReceiptSize),
              accessor: (row) => row.receiptSize,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.receiptSize}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.posTerminalsStatus),
              accessor: (row) => row.status,
              render: (row) =>
                row.status === "ACTIVE" ? (
                  <Badge tone="primary">{d.posTerminalsActive}</Badge>
                ) : (
                  <Badge>{d.posTerminalsInactive}</Badge>
                ),
            },
            {
              id: "device",
              header: activeLocaleHeader(d.posTerminalsDevice),
              accessor: (row) => row.deviceId ?? "—",
              mono: true,
              render: (row) =>
                row.deviceId === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.deviceId.slice(0, 8)}
                  </span>
                ),
            },
            {
              id: "lastSeen",
              header: activeLocaleHeader(d.posTerminalsLastSeen),
              accessor: (row) => row.lastSeenAt ?? "",
              sortable: true,
              render: (row) =>
                row.lastSeenAt === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatDateTime(row.lastSeenAt, locale)
                ),
            },
          ]}
          rows={[...rows]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "deactivate",
              label: d.posTerminalsDeactivate,
              danger: true,
              onSelect: (row: PosTerminalRow) => {
                if (row.status !== "ACTIVE") return;
                void toggleStatus(row);
              },
            },
            {
              id: "activate",
              label: d.posTerminalsActivate,
              onSelect: (row: PosTerminalRow) => {
                if (row.status === "ACTIVE") return;
                void toggleStatus(row);
              },
            },
            {
              id: "enroll",
              label: d.posTerminalsEnrollDevice,
              onSelect: (row: PosTerminalRow) => {
                setDeviceName("");
                setDeviceKey(generateDeviceKey());
                setEnrollTerminal(row);
              },
            },
            {
              id: "revoke",
              label: d.posTerminalsRevoke,
              danger: true,
              onSelect: (row: PosTerminalRow) => {
                if (row.deviceId !== null) {
                  void revoke(row);
                }
              },
            },
          ]}
          empty={{ title: d.posTerminalsEmpty }}
        />
      </Card>

      {/* -- register dialog ------------------------------------------------------------- */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen} title={d.posTerminalsRegister} size="lg">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.posTerminalsCode}
            value={code}
            onValueChange={setCode}
            error={code !== "" && !codeValid ? d.posTerminalsErrCodePattern : undefined}
            mono
            bidiIsolate
            required
          />
          <Input label={d.posTerminalsName} value={name} onValueChange={setName} required />
          <Input label={`${d.posTerminalsName} (AR)`} value={nameAr} onValueChange={setNameAr} />
          <Select
            label={d.posTerminalsBranch}
            value={branchId}
            onValueChange={setBranchId}
            options={branches
              .filter((branch) => branch.isActive)
              .map((branch) => ({ value: branch.id, label: branchNameById.get(branch.id) ?? branch.code }))}
            placeholder="—"
            required
          />
          <Select
            label={d.posTerminalsTill}
            value={cashAccountId}
            onValueChange={setCashAccountId}
            options={cashAccounts
              .filter((account) => account.status === "ACTIVE")
              .map((account) => ({ value: account.id, label: tillNameById.get(account.id) ?? account.id }))}
            placeholder="—"
            required
          />
          <Select
            label={d.posTerminalsWarehouse}
            value={warehouseId}
            onValueChange={setWarehouseId}
            options={warehouses
              .filter((warehouse) => warehouse.isActive)
              .map((warehouse) => ({ value: warehouse.id, label: localizedName(warehouse.name, warehouse.nameAr, locale) }))}
            placeholder="—"
          />
          <Select
            label={d.posTerminalsReceiptSize}
            value={receiptSize}
            onValueChange={(value) => setReceiptSize(value === "58mm" ? "58mm" : "80mm")}
            options={[
              { value: "80mm", label: "80mm" },
              { value: "58mm", label: "58mm" },
            ]}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRegisterOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button variant="primary" loading={busy === "register"} disabled={!registerReady} onClick={() => void register()}>
            {d.posTerminalsRegisterAction}
          </Button>
        </div>
      </Dialog>

      {/* -- enroll device dialog --------------------------------------------------------- */}
      <Dialog
        open={enrollTerminal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEnrollTerminal(null);
          }
        }}
        title={`${d.posTerminalsEnrollDevice} · ${enrollTerminal?.code ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Input label={d.posTerminalsDeviceName} value={deviceName} onValueChange={setDeviceName} required />
          <Input
            label={d.posTerminalsDeviceKey}
            value={deviceKey}
            onValueChange={setDeviceKey}
            hint={d.posTerminalsDeviceKeyNote}
            mono
            bidiIsolate
            readOnly
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnrollTerminal(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy === "enroll"}
              disabled={deviceName.trim() === "" || deviceKey.length < 16}
              onClick={() => void enroll()}
            >
              {d.posTerminalsEnrollAction}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
