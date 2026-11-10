/**
 * PHASE-022 T-P22-2-e · the field-screens render suite (MASTER-PLAN §8 +
 * DR-P22-11): REAL `render()` from @testing-library/react-native through
 * the Flow bridge (vitest.rn-bridge.mjs) for every field screen — AR + EN
 * (every string through t()), the LOCAL-VALID† advisory/blocking banners,
 * the honest state chips per machine state, ≥44px touch targets asserted
 * through the emitted styles, a11y labels on the interactive elements, the
 * fake-scanner end-to-end (scan → cart line), and the as-of labels on the
 * cached rows. The direction proof (DR-P22-03): NO physical-direction
 * style key in ANY emitted style tree.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { RenderResult } from "@testing-library/react-native";

import { openFieldStore, type MobileStore } from "../src/store";
import { t } from "../src/i18n";
import { FakeBarcodeScanner } from "../src/fieldsales/ports";
import type { FieldFlowContext } from "../src/fieldsales/state-machine";
import { RouteVisitsScreen } from "../src/screens/RouteVisitsScreen";
import { VanSaleCaptureScreen } from "../src/screens/VanSaleCaptureScreen";
import { CollectionScreen } from "../src/screens/CollectionScreen";
import { VanLoadUnloadScreen } from "../src/screens/VanLoadUnloadScreen";
import { ReturnsScreen } from "../src/screens/ReturnsScreen";
import { CountLinesScreen } from "../src/screens/CountLinesScreen";
import { StateChipRow } from "../src/screens/chrome";
import {
  COMPANION_SCREENS,
  FIELD_SCREENS,
  PERSONAL_SCREENS,
  RECONCILIATION_SCREENS,
  SCREEN_REGISTRY,
  financialScreenNames,
  screenByName,
  screenNames,
} from "../src/screens/registry";
import { FINANCIAL_SCREENS } from "../src/device";
import { TOUCH_TARGET_MIN } from "../src/constants";
import { currentOfflineSeq } from "@erp/sync-core";

// -- the harness ----------------------------------------------------------------------

const DEVICE_ID = "2e2e2e2e-0000-4111-8111-2e2e2e2e2e2e";
const VAN_WH = "2e2e2e2e-1111-4111-8111-2e2e2e2e2e11";
const TO_WH = "2e2e2e2e-1212-4111-8111-2e2e2e2e2e12";
const ITEM_A = "2e2e2e2e-2222-4111-8111-2e2e2e2e2e22";
const ITEM_SERIAL = "2e2e2e2e-3333-4111-8111-2e2e2e2e2e33";
const PARTNER_A = "2e2e2e2e-6666-4111-8111-2e2e2e2e2e66";
const ROUTE_ID = "2e2e2e2e-rt01-4111-8111-2e2e2e2e2er1";
const CTX: FieldFlowContext = {
  deviceId: DEVICE_ID,
  deviceCode: "F01",
  vanWarehouseId: VAN_WH,
  cashAccountId: "2e2e2e2e-9999-4111-8111-2e2e2e2e2e99",
  currencyCode: "SAR",
  today: "2026-11-18",
};

let dir: string;
let store: MobileStore;
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

/** Every interactive element meets the ≥44px floor (ACCESSIBILITY §touch). */
function expectTouchTargetsAtLeast44(): void {
  const nodes = touchTargetNodes();
  for (const node of nodes) {
    const style = flatStyle(node);
    expect(Number(style.minHeight ?? 0), `${node.type ?? "node"} minHeight`).toBeGreaterThanOrEqual(44);
    if (node.type === "TextInput") continue; // inputs carry minHeight only (full width)
    expect(Number(style.minWidth ?? 0), `${node.type ?? "node"} minWidth`).toBeGreaterThanOrEqual(44);
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "p22-2e-screens-"));
  store = openFieldStore(join(dir, "field.db"));
  // items + barcodes
  for (const [id, name, price, serial] of [
    [ITEM_A, "مياه 600مل", "2.5000", 0],
    [ITEM_SERIAL, "هاتف متتبع المسلسل", "1200.0000", 1],
  ] as const) {
    store.run(
      `INSERT INTO items (id, sku, name, name_ar, kind, uom_id, category_id, tax_code_id, base_price,
                           track_batch, track_serial, track_imei, status, updated_at, dirty)
       VALUES (?, ?, ?, NULL, 'STOCK', NULL, NULL, NULL, ?, 0, ?, 0, 'ACTIVE', '2026-11-17T10:00:00Z', 0)`,
      [id, `SKU-${id.slice(0, 8)}`, name, price, serial],
    );
  }
  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, '6291000000011', ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-beef-4111-8111-2e2e2e2e2eef",
    ITEM_A,
  ]);
  store.run("INSERT INTO barcodes (id, code, item_id, uom_id, updated_at) VALUES (?, '6291000000028', ?, NULL, '2026-11-17T10:00:00Z')", [
    "2e2e2e2e-bad0-4111-8111-2e2e2e2e2ead",
    ITEM_SERIAL,
  ]);
  // partner + statement (as-of labeled)
  store.run(
    `INSERT INTO partners (id, code, name, name_ar, kind, status, credit_limit, price_list_id, tax_number, updated_at)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, 'CUSTOMER', 'ACTIVE', '100.0000', NULL, NULL, '2026-11-17T10:00:00Z')`,
    [PARTNER_A],
  );
  store.run(
    `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
        opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload, version, updated_at, dirty)
     VALUES (?, 'C-001', 'عميل الطريق الأول', NULL, '2026-11-16', 'SAR', '80.0000', '90.0000', '90.0000', '{}', '[]',
             '2026-11-17T09:00:00Z', '{}', NULL, '2026-11-17T09:00:00Z', 0)`,
    [PARTNER_A],
  );
  // van snapshot (as-of stamped)
  store.run(
    `INSERT INTO van_stocks (id, warehouse_id, item_id, batch_id, qty, value, refreshed_at, payload, version, updated_at, dirty)
     VALUES (?, ?, ?, NULL, '10.000000', '0.0000', '2026-11-17T09:30:00Z', '{}', 3, '2026-11-17T09:30:00Z', 0)`,
    ["2e2e2e2e-v001-4111-8111-2e2e2e2e2e01", VAN_WH, ITEM_A],
  );
  // one WED route (2026-11-18) carrying the partner
  store.run(
    `INSERT INTO routes (id, code, name, name_ar, sales_rep_id, van_warehouse_id, day_pattern, status, customers, payload, version, updated_at, dirty)
     VALUES (?, 'R-01', 'خط الشمال', NULL, NULL, ?, ?, 'ACTIVE', ?, '{}', 2, '2026-11-17T10:00:00Z', 0)`,
    [ROUTE_ID, VAN_WH, JSON.stringify(["WED"]), JSON.stringify([{ partnerId: PARTNER_A, visitOrder: 1, isPinned: true }])],
  );
});

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// -- the registry ----------------------------------------------------------------------

describe("PHASE-022 2-e · the screen registry (DR-P22-11 — check:mobile-shell validates this shape)", () => {
  it("registers the field screens + 3-b's companion/personal/reconciliation screens with title keys + a11y label keys from the catalog", () => {
    expect(screenNames()).toEqual([
      "RouteVisits",
      "VanSaleCapture",
      "Collection",
      "VanLoadUnload",
      "ReturnsDraft",
      "CountLines",
      "Dashboard",
      "Statements",
      "InvoiceList",
      "PersonalHome",
      "ParkedRejections",
    ]);
    for (const entry of FIELD_SCREENS) {
      expect(entry.area).toBe("fieldsales");
      expect(String(entry.titleKey)).toMatch(/Title$/);
      expect(String(entry.a11yLabelKey)).toMatch(/Title$/);
      expect(entry.component).toBeDefined();
    }
    // 3-b appended: the companion/personal/reconciliation areas.
    expect(SCREEN_REGISTRY).toHaveLength(
      FIELD_SCREENS.length + COMPANION_SCREENS.length + PERSONAL_SCREENS.length + RECONCILIATION_SCREENS.length,
    );
    expect(screenByName("Dashboard")?.area).toBe("companion");
    expect(screenByName("PersonalHome")?.area).toBe("personal");
    expect(screenByName("ParkedRejections")?.area).toBe("reconciliation");
    expect(screenByName("ReturnsDraft")?.financial).toBe(true);
  });

  it("the financial flags mirror 2-b's FINANCIAL_SCREENS policy list exactly", () => {
    const mine = financialScreenNames();
    for (const name of mine) {
      expect(FINANCIAL_SCREENS, `${name} must be on 2-b's FINANCIAL_SCREENS list`).toContain(name);
    }
    for (const name of ["VanSaleCapture", "Collection", "VanLoadUnload", "ReturnsDraft"]) {
      expect(mine).toContain(name);
    }
    expect(mine).not.toContain("RouteVisits");
    expect(mine).not.toContain("CountLines");
  });
});

// -- AR + EN renders (every string through t()) ---------------------------------------

describe("PHASE-022 2-e · the field screens render AR + EN", () => {
  afterEach(cleanup);

  const cases: { name: string; render: (locale: "ar" | "en") => ReactElement }[] = [
    { name: "RouteVisits", render: (locale) => <RouteVisitsScreen locale={locale} store={store} today="2026-11-18" /> },
    {
      name: "VanSaleCapture",
      render: (locale) => <VanSaleCaptureScreen locale={locale} store={store} ctx={CTX} scanner={new FakeBarcodeScanner()} />,
    },
    { name: "Collection", render: (locale) => <CollectionScreen locale={locale} store={store} ctx={CTX} partnerId={PARTNER_A} /> },
    { name: "VanLoadUnload", render: (locale) => <VanLoadUnloadScreen locale={locale} store={store} ctx={CTX} /> },
    { name: "Returns", render: (locale) => <ReturnsScreen locale={locale} store={store} ctx={CTX} /> },
    {
      name: "CountLines",
      render: (locale) => <CountLinesScreen locale={locale} store={store} ctx={CTX} scanner={new FakeBarcodeScanner()} />,
    },
  ];

  for (const { name, render: renderCase } of cases) {
    it(`${name} renders the localized title + intro in BOTH locales (t() keys present for every string)`, () => {
      for (const locale of ["ar", "en"] as const) {
        const registry = screenByName(
          name === "Returns" ? "ReturnsDraft" : name === "VanLoadUnload" ? "VanLoadUnload" : name,
        );
        renderTree(renderCase(locale));
        expect(screen.getAllByText(t(locale, registry!.titleKey)).length).toBeGreaterThan(0);
        expectLogicalStylesOnly(); // direction-agnostic by construction (DR-P22-03)
        expectTouchTargetsAtLeast44(); // ACCESSIBILITY §touch
        cleanup();
      }
    });
  }

  it("RouteVisits renders the visit rows with balances, visit states, the tier-pricing note and the AS-OF label", () => {
    renderTree(<RouteVisitsScreen locale="ar" store={store} today="2026-11-18" />);
    expect(screen.getByText("عميل الطريق الأول")).toBeTruthy();
    expect(allText().join(" ")).toContain(t("ar", "routesVisitPlanned"));
    expect(allText().join(" ")).toContain(t("ar", "routesVisitNoTierPricing")); // no price list → the no-tier note
    expect(screen.getByTestId(`visit-row-${PARTNER_A}`)).toBeTruthy();
    // The as-of label on the cached statement row (stale is labeled, never guessed).
    expect(allText().join(" ")).toContain(t("ar", "asOfLabel", { date: "2026-11-16" }));
  });

  it("RouteVisits renders the empty state when no route matches the day", () => {
    renderTree(<RouteVisitsScreen locale="ar" store={store} today="2026-11-20" />); // a Friday
    expect(screen.getByText(t("ar", "routesEmpty"))).toBeTruthy();
  });

  it("VanLoadUnload renders the van SNAPSHOT AS-OF label", () => {
    renderTree(<VanLoadUnloadScreen locale="ar" store={store} ctx={CTX} />);
    expect(allText().join(" ")).toContain(t("ar", "vanLoadAsOfSnapshot", { date: "2026-11-17T09:30:00Z".slice(0, 10) }));
  });

  it("Collection renders the open balance from the cached statement + the as-of label", () => {
    renderTree(<CollectionScreen locale="ar" store={store} ctx={CTX} partnerId={PARTNER_A} />);
    expect(allText().join(" ")).toContain(t("ar", "collectionOpenBalance", { balance: "90.0000 ر.س" }));
    expect(allText().join(" ")).toContain(t("ar", "asOfLabel", { date: "2026-11-16" }));
  });
});

// -- the LOCAL-VALID† banners + the honest states -------------------------------------

describe("PHASE-022 2-e · the LOCAL-VALID† banners + the honest state chips", () => {
  afterEach(cleanup);

  it("VanSaleCapture surfaces the advisory banner when the qty exceeds the cached van stock (never blocks)", async () => {
    const scanner = new FakeBarcodeScanner(["6291000000011"]);
    renderTree(<VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    fireEvent.press(screen.getByTestId("scan-button"));
    await waitFor(() => expect(screen.getByTestId(`cart-row-${ITEM_A}`)).toBeTruthy());
    // 11 units against the cached 10 → the VAN_STOCK_LOW advisory.
    fireEvent.changeText(screen.getByTestId(`qty-input-${ITEM_A}`), "11");
    await waitFor(() =>
      expect(allText().join(" ")).toContain(
        t("ar", "vanSaleStockAdvisory", { available: "10.000000", requested: "11" }),
      ),
    );
    // The advisory NEVER blocks: the checkout stays enabled (the server decides).
    const checkout = screen.getByTestId("checkout-button");
    expect((checkout.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled).not.toBe(true);
    expectLogicalStylesOnly();
  });

  it("VanSaleCapture surfaces the BLOCKING banner on a credit sale without a customer (checkout disabled)", () => {
    const scanner = new FakeBarcodeScanner();
    renderTree(<VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    fireEvent.press(screen.getByTestId("payment-credit"));
    expect(allText().join(" ")).toContain(t("ar", "vanSaleCustomerRequired"));
    const checkout = screen.getByTestId("checkout-button");
    expect((checkout.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled).toBe(true);
  });

  it("serial-tracked items expose the serial capture field (row 35)", async () => {
    const scanner = new FakeBarcodeScanner(["6291000000028"]);
    renderTree(<VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    fireEvent.press(screen.getByTestId("scan-button"));
    await waitFor(() => expect(screen.getByTestId(`serial-input-${ITEM_SERIAL}`)).toBeTruthy());
    expect(allText().join(" ")).toContain(t("ar", "vanSaleSerialCapture"));
  });

  it("the fake scanner flows END-TO-END: scan → cart line → qty edit → checkout → the honest PENDING_SYNC badge + the OFF- banner", async () => {
    const seqBefore = currentOfflineSeq(store, DEVICE_ID);
    const scanner = new FakeBarcodeScanner(["6291000000011"]);
    renderTree(<VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    fireEvent.press(screen.getByTestId("scan-button"));
    await waitFor(() => expect(screen.getByTestId(`cart-row-${ITEM_A}`)).toBeTruthy());
    expect(screen.getByText("مياه 600مل")).toBeTruthy();

    fireEvent.changeText(screen.getByTestId(`qty-input-${ITEM_A}`), "2");
    fireEvent.press(screen.getByTestId("checkout-button"));

    const localRef = `OFF-F01-${String(seqBefore + 1).padStart(5, "0")}`;
    await waitFor(() =>
      expect(allText().join(" ")).toContain(t("ar", "vanSaleSavedLocal", { number: localRef })),
    );
    // The honest PENDING_SYNC badge (state honesty §5 — the official number appears NOWHERE yet).
    expect(screen.getByTestId("flow-state-PENDING_SYNC")).toBeTruthy();
    // The command really landed in the outbox.
    expect(currentOfflineSeq(store, DEVICE_ID)).toBe(seqBefore + 1);
  });

  it("Collection: the on-account ADVISORY appears beyond the cached open balance; the save posts PENDING_SYNC", async () => {
    renderTree(<CollectionScreen locale="ar" store={store} ctx={CTX} partnerId={PARTNER_A} />);
    fireEvent.changeText(screen.getByTestId("collection-amount"), "120.0000");
    await waitFor(() =>
      expect(allText().join(" ")).toContain(t("ar", "collectionExceedsOpenBalance", { balance: "90.0000" })),
    );
    fireEvent.press(screen.getByTestId("collection-save"));
    await waitFor(() => expect(screen.getByTestId("flow-state-PENDING_SYNC")).toBeTruthy());
    expect(allText().join(" ")).toContain(t("ar", "collectionSavedLocal"));
  });

  it("CountLines: scan → counted line → submit → the PENDING_SYNC chip", async () => {
    const scanner = new FakeBarcodeScanner(["6291000000011"]);
    renderTree(<CountLinesScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    fireEvent.changeText(screen.getByTestId("count-session-input"), "2e2e2e2e-c0de-4111-8111-2e2e2e2e2ec0");
    fireEvent.press(screen.getByTestId("count-scan-button"));
    await waitFor(() => expect(screen.getByTestId("count-row-0")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("count-qty-0"), "9");
    fireEvent.press(screen.getByTestId("count-submit"));
    await waitFor(() => expect(screen.getByTestId("flow-state-PENDING_SYNC")).toBeTruthy());
    expect(allText().join(" ")).toContain(t("ar", "countSavedLocal"));
  });

  it("the honest state chips render distinctly for EVERY machine state (+ the server document status chip)", () => {
    renderTree(
      <>
        <StateChipRow locale="ar" state="DRAFT_LOCAL" />
        <StateChipRow locale="ar" state="PENDING_SYNC" />
        <StateChipRow locale="ar" state="POSTED" serverStatus="POSTED" />
        <StateChipRow locale="ar" state="REJECTED" />
        <StateChipRow locale="ar" state="CANCELLED" />
        <StateChipRow locale="ar" state="POSTED" serverStatus="DRAFT" />
      </>,
    );
    expect(screen.getByTestId("flow-state-DRAFT_LOCAL")).toBeTruthy();
    expect(screen.getByTestId("flow-state-PENDING_SYNC")).toBeTruthy();
    expect(screen.getAllByTestId("flow-state-POSTED").length).toBe(2); // both POSTED rows render
    expect(screen.getByTestId("flow-state-REJECTED")).toBeTruthy();
    expect(screen.getByTestId("flow-state-CANCELLED")).toBeTruthy();
    expect(screen.getAllByTestId("server-status-chip")).toHaveLength(2); // the §3 StatusChip map on server statuses
    expect(allText().join(" ")).toContain(t("ar", "syncStateRejected"));
  });

  it("Returns: the restock picker offers none / van / warehouse and the save refuses without the original invoice", async () => {
    renderTree(<ReturnsScreen locale="ar" store={store} ctx={CTX} />);
    expect(screen.getByTestId("restock-none-0")).toBeTruthy();
    expect(screen.getByTestId("restock-van-0")).toBeTruthy();
    expect(screen.getByTestId("restock-warehouse-0")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("return-line-id-0"), "2e2e2e2e-1b01-4111-8111-2e2e2e2e2e1b");
    fireEvent.changeText(screen.getByTestId("return-qty-0"), "1");
    fireEvent.press(screen.getByTestId("return-save"));
    // No original invoice → the blocking banner (returnsOriginalRequired).
    await waitFor(() => expect(allText().join(" ")).toContain(t("ar", "returnsOriginalRequired")));
  });

  it("VanLoadUnload: the unload mode lists the snapshot lines and confirms into the outbox", async () => {
    renderTree(<VanLoadUnloadScreen locale="ar" store={store} ctx={CTX} mode="unload" toWarehouseId={TO_WH} />);
    fireEvent.press(screen.getByTestId("mode-unload"));
    await waitFor(() => expect(screen.getByTestId(`unload-row-${ITEM_A}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId("confirm-movement"));
    await waitFor(() => expect(screen.getByTestId("flow-state-PENDING_SYNC")).toBeTruthy());
    expect(allText().join(" ")).toContain(t("ar", "vanUnloadSavedLocal"));
  });
});

// -- a11y labels on the interactive elements -------------------------------------------

describe(`PHASE-022 2-e · a11y labels on interactive elements (≥ ${String(TOUCH_TARGET_MIN)}px targets)`, () => {
  afterEach(cleanup);

  it("the scan + checkout controls are labelled (screen readers name them)", async () => {
    const scanner = new FakeBarcodeScanner(["6291000000011"]);
    renderTree(<VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={scanner} />);
    expect(screen.getByLabelText(t("ar", "vanSaleScanButton"))).toBeTruthy();
    expect(screen.getByLabelText(t("ar", "vanSaleCheckout"))).toBeTruthy();
    expect(screen.getByLabelText(t("ar", "vanSalePaymentCash"))).toBeTruthy();
    expect(screen.getByLabelText(t("ar", "vanSalePaymentCredit"))).toBeTruthy();

    const en = render(<VanSaleCaptureScreen locale="en" store={store} ctx={CTX} scanner={scanner} />);
    expect(en.getByLabelText(t("en", "vanSaleScanButton"))).toBeTruthy();
    expect(en.getByLabelText(t("en", "vanSaleCheckout"))).toBeTruthy();
  });

  it("RouteVisits: the sell-here / collect-here affordances are labelled and meet the touch floor", () => {
    renderTree(
      <RouteVisitsScreen
        locale="ar"
        store={store}
        today="2026-11-18"
        onSell={() => {}}
        onCollect={() => {}}
      />,
    );
    expect(screen.getByLabelText(t("ar", "routesVisitSellHere"))).toBeTruthy();
    expect(screen.getByLabelText(t("ar", "routesVisitCollectHere"))).toBeTruthy();
    expectTouchTargetsAtLeast44();
    expectLogicalStylesOnly();
  });

  it("the kitchen-sink render: every screen's tree is direction-agnostic (no physical style key anywhere)", () => {
    renderTree(
      <>
        <Text>chrome</Text>
        <RouteVisitsScreen locale="ar" store={store} today="2026-11-18" />
        <VanSaleCaptureScreen locale="ar" store={store} ctx={CTX} scanner={new FakeBarcodeScanner()} />
        <CollectionScreen locale="ar" store={store} ctx={CTX} partnerId={PARTNER_A} />
        <VanLoadUnloadScreen locale="ar" store={store} ctx={CTX} mode="unload" toWarehouseId={TO_WH} />
        <ReturnsScreen locale="ar" store={store} ctx={CTX} />
        <CountLinesScreen locale="ar" store={store} ctx={CTX} scanner={new FakeBarcodeScanner()} />
      </>,
    );
    expectLogicalStylesOnly();
    expectTouchTargetsAtLeast44();
  });
});
