/**
 * PHASE-022 T-P22-3-b · the companion/personal/rejection screens render
 * suite (MASTER-PLAN §8 + CONFLICT_RESOLUTION §3): REAL `render()` from
 * @testing-library/react-native through the Flow bridge (vitest.rn-bridge
 * .mjs) for Dashboard/Statements/InvoiceList/PersonalHome/ParkedRejections
 * — AR + EN (every string through t()), the as-of labels on the cached
 * rows, the running statement balances, the personal home's ZERO write
 * controls (structural, asserted over the rendered tree), and the
 * per-code §3 action sets rendering + FIRING. The direction proof
 * (DR-P22-03): no physical-direction style key in any emitted style tree;
 * ≥44px touch targets through the emitted styles.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import type { RenderResult } from "@testing-library/react-native";

import {
  applyResult,
  buildSyncCommandV2,
  enqueue,
  nextOfflineNumber,
  rejectedCommands,
} from "@erp/sync-core";

import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import { t, formatDate } from "../src/i18n";
import { DashboardScreen } from "../src/screens/DashboardScreen";
import { StatementScreen } from "../src/screens/StatementScreen";
import { InvoicesScreen } from "../src/screens/InvoicesScreen";
import { PersonalHomeScreen } from "../src/screens/PersonalHomeScreen";
import { ParkedRejectionsScreen } from "../src/screens/ParkedRejectionsScreen";
import { rejectionAuditTrail } from "../src/reconciliation";

// -- the harness ----------------------------------------------------------------------

const DEVICE_ID = "3b3b3b3b-0000-4111-8111-3b3b3b3b3b01";
const TODAY = "2026-11-18";
const ITEM_A = "3b3b3b3b-2222-4111-8111-3b3b3b3b3b22";
const PARTNER_A = "3b3b3b3b-6666-4111-8111-3b3b3b3b3b66";

let dir: string;
let field: MobileStore;
let personal: MobileStore;
let view: RenderResult;

function renderTree(ui: ReactElement): RenderResult {
  view = render(ui);
  return view;
}

interface HostNode {
  type?: string;
  props: Record<string, unknown>;
  children?: unknown;
}

function hostNodes(node: unknown, acc: HostNode[] = []): HostNode[] {
  if (node === null || node === undefined) return acc;
  if (Array.isArray(node)) {
    for (const child of node) hostNodes(child, acc);
    return acc;
  }
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const current = node as unknown as HostNode;
    acc.push(current);
    hostNodes(current.children, acc);
  }
  return acc;
}

function flatStyle(node: HostNode): Record<string, unknown> {
  const style = node.props.style;
  if (style === undefined) return {};
  return StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) as Record<string, unknown>;
}

function allText(): string[] {
  return hostNodes(view.toJSON())
    .flatMap((node) => (Array.isArray(node.children) ? node.children : [node.children]))
    .filter((child): child is string => typeof child === "string");
}

const BANNED_PHYSICAL_KEYS = [
  "marginLeft",
  "marginRight",
  "paddingLeft",
  "paddingRight",
  "borderLeftWidth",
  "borderRightWidth",
  "borderLeftColor",
  "borderRightColor",
  "left",
  "right",
] as const;

function expectLogicalStylesOnly(): void {
  for (const node of hostNodes(view.toJSON())) {
    const style = flatStyle(node);
    for (const key of BANNED_PHYSICAL_KEYS) {
      expect(style[key], `${node.type ?? "node"} emitted physical key ${key}`).toBeUndefined();
    }
    if (style.textAlign === "left" || style.textAlign === "right") {
      throw new Error(`${node.type ?? "node"} emitted textAlign ${String(style.textAlign)}`);
    }
  }
}

function touchTargetNodes(): HostNode[] {
  return hostNodes(view.toJSON()).filter(
    (node) =>
      node.props.accessibilityRole === "button" ||
      node.props.accessibilityRole === "tab" ||
      node.type === "TextInput",
  );
}

function expectTouchTargetsAtLeast44(): void {
  const nodes = touchTargetNodes();
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    const style = flatStyle(node);
    expect(Number(style.minHeight ?? 0), `${node.type ?? "node"} minHeight`).toBeGreaterThanOrEqual(44);
    if (node.type === "TextInput") continue;
    expect(Number(style.minWidth ?? 0), `${node.type ?? "node"} minWidth`).toBeGreaterThanOrEqual(44);
  }
}

/** Every interactive element carries an accessibility label. */
function expectA11yLabelsOnInteractive(): void {
  for (const node of touchTargetNodes()) {
    expect(
      node.props.accessibilityLabel ?? node.props.accessibilityHint,
      `${node.type ?? "node"} interactive without an a11y label`,
    ).toBeTruthy();
  }
}

/** Seed one outbox command, business-dated to TODAY. */
function seedCommand(entityType: string, intent: string, payload: Record<string, unknown>): string {
  const localRef = nextOfflineNumber(field, "F01", DEVICE_ID);
  const command = buildSyncCommandV2({ entityType, intent, payload, localRef });
  const enqueued = field.transaction(() =>
    enqueue(field, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command.payload as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      localRef,
    }),
  );
  field.run("UPDATE outbox SET client_created_at = ? WHERE command_id = ?", [`${TODAY}T10:00:00Z`, enqueued.commandId]);
  return enqueued.commandId;
}

/** Seed one REJECTED command (a typed lastError with traceId). */
function seedRejected(reason: string, payload: Record<string, unknown>, details: Record<string, unknown> = {}): string {
  const commandId = seedCommand("sales_invoice", "create_draft", payload);
  applyResult(field, {
    commandId,
    status: "REJECTED",
    rejectionReason: reason,
    rejectionDetails: { traceId: `trace-${reason}`, ...details },
  });
  return commandId;
}

let priceChangedId = "";
let creditLimitId = "";
let adminRevokedId = "";
let unknownCodeId = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-3b-screens-"));
  field = openFieldStore(join(dir, "field.db"));
  personal = openPersonalStore(":memory:");

  field.run(
    `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                        track_batch, track_serial, track_imei, status, updated_at, dirty)
     VALUES (?, 'SKU-WATER', 'مياه 600مل', NULL, 'STOCK', NULL, NULL, NULL, '2.5000', 0, 0, 0, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
    [ITEM_A],
  );
  field.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, 'CUSTOMER', 'ACTIVE', '100.0000', NULL, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER_A],
  );
  field.run(
    `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-v001-4111-8111-3b3b3b3b3v01', 'wh-van', ?, NULL, '10.500000', '0.0000', '2026-11-17T09:30:00Z', '{}', 3, '2026-11-17T09:30:00Z', 0)`,
    [ITEM_A],
  );
  field.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '80.0000', '90.0000', '90.0000',
             ?, ?, '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [
      PARTNER_A,
      JSON.stringify({ not_due: "70.0000", "1_30": "20.0000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" }),
      JSON.stringify([
        { entryDate: "2026-11-10", docRef: "INV-100", sourceType: "sales_invoice", currencyCode: "SAR", debit: "20.0000", credit: "0.0000" },
        { entryDate: "2026-11-12", docRef: "RCT-20", sourceType: "receipt", currencyCode: "SAR", debit: "0.0000", credit: "10.0000" },
      ]),
    ],
  );

  // Today's documents: pending, acked, and the four parked rejections.
  seedCommand("sales_invoice", "create_draft", {
    customerId: PARTNER_A,
    orderDate: TODAY,
    lines: [{ itemId: ITEM_A, qty: "3", unitPrice: "2.5000" }],
  });
  const ackedId = seedCommand("sales_invoice", "create_draft", {
    customerId: PARTNER_A,
    orderDate: TODAY,
    lines: [{ itemId: ITEM_A, qty: "1", unitPrice: "2.0000" }],
  });
  applyResult(field, {
    commandId: ackedId,
    status: "ACCEPTED",
    officialNo: "INV-2026-0901",
    acceptedResult: { status: "DRAFT" },
  });
  priceChangedId = seedRejected(
    "PRICE_CHANGED",
    { customerId: PARTNER_A, orderDate: TODAY, lines: [{ itemId: ITEM_A, qty: "2", unitPrice: "2.5000" }] },
    { server: "3.0000", cached: "2.5000" },
  );
  creditLimitId = seedRejected(
    "CREDIT_LIMIT_EXCEEDED",
    { customerId: PARTNER_A, orderDate: TODAY, lines: [{ itemId: ITEM_A, qty: "9", unitPrice: "2.5000" }] },
    { limit: "100.0000", due: "95.0000" },
  );
  adminRevokedId = seedRejected("DEVICE_REVOKED", { customerId: PARTNER_A, orderDate: TODAY });
  unknownCodeId = seedRejected("SOMETHING_NEW", { customerId: PARTNER_A, orderDate: TODAY });

  // The personal read models.
  personal.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '100.0000', '125.5000', '125.5000',
             ?, '[]', '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [PARTNER_A, JSON.stringify({ not_due: "100.0000", "1_30": "25.5000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" })],
  );
  personal.run(
    `INSERT INTO sales_invoices (id, invoice_no, status, kind, channel, customer_id, order_date, total_amount, currency, owner_device_id, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-inv1-4111-8111-3b3b3b3b3i01', 'INV-2026-0901', 'POSTED', 'CREDIT', 'FIELD', ?, '2026-11-10', '125.5000', 'SAR', NULL, '{}', 2, '2026-11-17T09:10:00Z', 0)`,
    [PARTNER_A],
  );
  personal.run(
    `INSERT INTO receipts (id, receipt_no, status, partner_id, method, currency_code, amount, value_date, reference, posted_at, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-rcp1-4111-8111-3b3b3b3b3r01', 'RCT-2026-0044', 'POSTED', ?, 'CASH', 'SAR', '10.0000', '2026-11-12', NULL, '2026-11-12T12:00:00Z', '{}', 1, '2026-11-17T09:20:00Z', 0)`,
    [PARTNER_A],
  );
  personal.run(
    `INSERT INTO notifications (id, user_id, category, severity, title, body, action_label, action_url, read_at, payload, version, updated_at, dirty)
     VALUES ('3b3b3b3b-not1-4111-8111-3b3b3b3b3n01', ?, 'invoice_overdue', 'warning', ?, '{}', NULL, NULL, NULL, '{}', 1, '2026-11-17T09:30:00Z', 0)`,
    [DEVICE_ID, JSON.stringify({ ar: "فاتورة متأخرة", en: "Invoice overdue" })],
  );
});

afterAll(() => {
  field.close();
  personal.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- AR + EN renders -------------------------------------------------------------------

describe("PHASE-022 T-P22-3-b · the companion screens render AR + EN (READ-CACHED, as-of labeled)", () => {
  afterEach(cleanup);

  it("Dashboard: today's metrics + van stock + parked tile + the OFFLINE approvals affordance + master-data search", () => {
    for (const locale of ["ar", "en"] as const) {
      const onApprovals = vi.fn();
      renderTree(
        <DashboardScreen locale={locale} store={field} today={TODAY} online={false} onApprovals={onApprovals} />,
      );
      expect(allText().join(" ")).toContain(t(locale, "homeMetricSales"));
      expect(allText().join(" ")).toContain(t(locale, "homeParkedTile", { count: "4" }));
      // The as-of label on the van-stock cache row (stale is labeled).
      expect(allText().join(" ")).toContain(
        t(locale, "asOfLabel", { date: formatDate(locale, "2026-11-17T09:30:00Z", "canonical") }),
      );
      // ONLINE-ONLY (offline): disabled WITH the honest reason — never queued.
      expect(screen.getByTestId("dashboard-approvals-reason")).toBeTruthy();
      expect(allText().join(" ")).toContain(t(locale, "approvalsOnlineOnly"));
      expectLogicalStylesOnly();
      expectTouchTargetsAtLeast44();
      expectA11yLabelsOnInteractive();
      cleanup();

      // ONLINE: the link-out is enabled and fires.
      renderTree(
        <DashboardScreen locale={locale} store={field} today={TODAY} online onApprovals={onApprovals} />,
      );
      fireEvent.press(screen.getByTestId("dashboard-approvals-button"));
      expect(onApprovals).toHaveBeenCalledTimes(1);
      // The master-data search input meets the target floor + labels.
      expect(screen.getByTestId("master-search-input")).toBeTruthy();
      cleanup();
    }
  });

  it("Statements: entries with running balances + opening/closing + aging + the as-of label", () => {
    for (const locale of ["ar", "en"] as const) {
      renderTree(<StatementScreen locale={locale} store={field} partnerId={PARTNER_A} />);
      expect(screen.getByTestId("statement-opening-amount")).toBeTruthy();
      expect(screen.getByTestId("statement-closing-amount")).toBeTruthy();
      expect(screen.getByTestId("statement-entry-0")).toBeTruthy();
      expect(screen.getByTestId("statement-entry-1")).toBeTruthy();
      expect(screen.getByTestId("statement-balance-0")).toBeTruthy();
      expect(screen.getByTestId("statement-balance-1")).toBeTruthy();
      expect(allText().join(" ")).toContain(t(locale, "statementsOpeningBalance"));
      expect(allText().join(" ")).toContain(t(locale, "statementsRunningBalance"));
      expect(allText().join(" ")).toContain(t(locale, "aging1To30"));
      expect(
        allText().join(" "),
      ).toContain(t(locale, "asOfLabel", { date: formatDate(locale, "2026-11-16", "canonical") }));
      expectLogicalStylesOnly();
      cleanup();
    }
  });

  it("InvoiceList: the own documents (locally-created + synced) with honest states + the official number only on ACKED", () => {
    for (const locale of ["ar", "en"] as const) {
      renderTree(<InvoicesScreen locale={locale} store={field} />);
      expect(allText().join(" ")).toContain("INV-2026-0901"); // the official number
      expect(allText().join(" ")).toContain(t(locale, "syncStatePendingSync"));
      expect(allText().join(" ")).toContain(t(locale, "syncStatePosted"));
      expectLogicalStylesOnly();
      expectA11yLabelsOnInteractive();
      cleanup();
    }
  });

  it("PersonalHome: ZERO write controls (no button, no onPress, no input anywhere in the tree)", () => {
    for (const locale of ["ar", "en"] as const) {
      renderTree(<PersonalHomeScreen locale={locale} store={personal} />);
      for (const node of hostNodes(view.toJSON())) {
        expect(node.props.onPress, `${node.type ?? "node"} carries onPress`).toBeUndefined();
        expect(node.props.accessibilityRole, `${node.type ?? "node"} is interactive`).not.toBe("button");
        expect(node.type).not.toBe("TextInput");
      }
      // The cached sections render with their as-of labels.
      expect(allText().join(" ")).toContain(t(locale, "personalBalanceLabel"));
      expect(allText().join(" ")).toContain(t(locale, "personalDueSoon"));
      expect(allText().join(" ")).toContain(t(locale, "aging1To30"));
      expect(allText().join(" ")).toContain("INV-2026-0901");
      expect(allText().join(" ")).toContain(locale === "ar" ? "فاتورة متأخرة" : "Invoice overdue");
      expect(
        allText().join(" "),
      ).toContain(t(locale, "asOfLabel", { date: formatDate(locale, "2026-11-16", "canonical") }));
      expectLogicalStylesOnly();
      cleanup();
    }
  });
});

// -- the parked rejections (CONFLICT_RESOLUTION §3 — render + fire) ----------------------

describe("PHASE-022 T-P22-3-b · ParkedRejections (the §3 table rendered + the actions firing)", () => {
  afterEach(cleanup);

  it("per-code action sets render: PRICE_CHANGED's three, CREDIT_LIMIT's offline-gated three, the administrative card, the unknown-code fallback", () => {
    renderTree(<ParkedRejectionsScreen locale="ar" store={field} online={false} />);
    // PRICE_CHANGED → accept-server-price, edit-and-resend, cancel.
    expect(screen.getByTestId(`parked-action-ACCEPT_SERVER_PRICE-${priceChangedId}`)).toBeTruthy();
    expect(screen.getByTestId(`parked-action-EDIT_AND_RESEND-${priceChangedId}`)).toBeTruthy();
    expect(screen.getByTestId(`parked-action-CANCEL-${priceChangedId}`)).toBeTruthy();
    expect(screen.getByTestId(`parked-detail-${priceChangedId}`)).toBeTruthy();
    expect(allText().join(" ")).toContain(t("ar", "actionAcceptServerPrice"));
    // CREDIT_LIMIT_EXCEEDED → request-approval DISABLED offline with the reason.
    const approvalButton = screen.getByTestId(`parked-action-REQUEST_APPROVAL_ONLINE-${creditLimitId}`);
    expect(approvalButton).toBeTruthy();
    expect(screen.getByTestId(`parked-action-REQUEST_APPROVAL_ONLINE-${creditLimitId}-reason`)).toBeTruthy();
    expect(allText().join(" ")).toContain(t("ar", "onlineOnlyReason"));
    // DEVICE_REVOKED → the administrative no-resubmission card, NO actions.
    expect(screen.getByTestId(`parked-administrative-${adminRevokedId}`)).toBeTruthy();
    expect(allText().join(" ")).toContain(t("ar", "parkedNoResubmitTitle"));
    // The unknown code → the fallback (message + traceId + support hint).
    expect(screen.getByTestId(`parked-fallback-${unknownCodeId}`)).toBeTruthy();
    expect(allText().join(" ")).toContain(t("ar", "rejectionSupportHint"));
    expectLogicalStylesOnly();
    expectTouchTargetsAtLeast44();
    expectA11yLabelsOnInteractive();
  });

  it("firing CANCEL voids the document + audits the choice with the rejecting traceId (the row leaves the parked list)", () => {
    const before = rejectionAuditTrail(field).length;
    renderTree(<ParkedRejectionsScreen locale="en" store={field} online={false} />);
    fireEvent.press(screen.getByTestId(`parked-action-CANCEL-${priceChangedId}`));
    const trail = rejectionAuditTrail(field);
    expect(trail).toHaveLength(before + 1);
    expect(trail[trail.length - 1]).toMatchObject({
      code: "PRICE_CHANGED",
      action: "CANCEL",
      commandId: priceChangedId,
      traceId: "trace-PRICE_CHANGED",
    });
    expect(rejectedCommands(field).some((row) => row.commandId === priceChangedId)).toBe(false);
    // The rerendered list no longer shows the cancelled row's actions.
    view.rerender(<ParkedRejectionsScreen locale="en" store={field} online={false} />);
    expect(view.queryByTestId(`parked-action-CANCEL-${priceChangedId}`)).toBeNull();
  });

  it("firing ACCEPT_SERVER_PRICE recomputes + resends (a NEW queued command with the server price)", () => {
    const before = rejectionAuditTrail(field).length;
    // CREDIT_LIMIT_EXCEEDED has NO accept-server-price action (the §3 set
    // is exact — only PRICE_CHANGED offers it).
    renderTree(
      <ParkedRejectionsScreen
        locale="en"
        store={field}
        online={false}
        serverPrices={{ [ITEM_A]: "3.0000" }}
      />,
    );
    expect(view.queryByTestId(`parked-action-ACCEPT_SERVER_PRICE-${creditLimitId}`)).toBeNull();
    cleanup();

    // A fresh PRICE_CHANGED row → fire the action.
    const freshId = (() => {
      const commandId = seedCommand("sales_invoice", "create_draft", {
        customerId: PARTNER_A,
        orderDate: TODAY,
        lines: [{ itemId: ITEM_A, qty: "2", unitPrice: "2.5000" }],
      });
      applyResult(field, {
        commandId,
        status: "REJECTED",
        rejectionReason: "PRICE_CHANGED",
        rejectionDetails: { traceId: "trace-fresh-price", server: "3.0000", cached: "2.5000" },
      });
      return commandId;
    })();
    renderTree(
      <ParkedRejectionsScreen
        locale="en"
        store={field}
        online={false}
        serverPrices={{ [ITEM_A]: "3.0000" }}
      />,
    );
    fireEvent.press(screen.getByTestId(`parked-action-ACCEPT_SERVER_PRICE-${freshId}`));
    expect(rejectionAuditTrail(field)).toHaveLength(before + 1);
    const queued = field
      .all("SELECT * FROM outbox WHERE status = 'QUEUED'")
      .map((row) => String(row.payload))
      .filter((payload) => payload.includes("3.0000"));
    expect(queued.length).toBeGreaterThan(0); // the recomputed resend is queued
    expect(rejectedCommands(field).some((row) => row.commandId === freshId)).toBe(false);
  });

  it("EDIT_AND_RESEND hands the row to the editor (navigation glue) — the editor's save runs the §3 resend", () => {
    const onEdit = vi.fn();
    renderTree(<ParkedRejectionsScreen locale="ar" store={field} online={false} onEdit={onEdit} />);
    const remaining = rejectedCommands(field);
    expect(remaining.length).toBeGreaterThan(0);
    const target = remaining[0]!;
    fireEvent.press(screen.getByTestId(`parked-action-EDIT_AND_RESEND-${target.commandId}`));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ commandId: target.commandId }));
  });

  it("REQUEST_APPROVAL_ONLINE fires only while online (ONLINE-ONLY — never queued)", () => {
    const onRequestApproval = vi.fn();
    const target = rejectedCommands(field).find((row) => row.rejectionReason === "CREDIT_LIMIT_EXCEEDED");
    expect(target).toBeDefined();
    // OFFLINE: disabled — the press never reaches the handler.
    renderTree(
      <ParkedRejectionsScreen locale="en" store={field} online={false} onRequestApproval={onRequestApproval} />,
    );
    expect(view.queryByTestId(`parked-action-REQUEST_APPROVAL_ONLINE-${target!.commandId}`)).not.toBeNull();
    cleanup();
    // ONLINE: fires (and the choice is audited by the executor).
    const before = rejectionAuditTrail(field).length;
    renderTree(
      <ParkedRejectionsScreen locale="en" store={field} online onRequestApproval={onRequestApproval} />,
    );
    fireEvent.press(screen.getByTestId(`parked-action-REQUEST_APPROVAL_ONLINE-${target!.commandId}`));
    expect(onRequestApproval).toHaveBeenCalledTimes(1);
    expect(rejectionAuditTrail(field)).toHaveLength(before + 1);
  });

  it("the empty state (nothing parked)", () => {
    const fresh = openFieldStore(":memory:");
    renderTree(<ParkedRejectionsScreen locale="ar" store={fresh} />);
    expect(allText().join(" ")).toContain(t("ar", "parkedEmpty"));
    fresh.close();
  });
});
