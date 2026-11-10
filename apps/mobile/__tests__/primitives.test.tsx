/**
 * PHASE-022 T-P22-1b · the primitives render suite (MASTER-PLAN §4): real
 * `render()` from @testing-library/react-native for every primitive, with
 * a11y assertions (roles/labels/states), the ≥44px touch-target floor
 * asserted through the emitted styles, the §3 status-badge binding table,
 * the §4 money-sign colors, tabular numerals, bidi isolation, and the
 * DR-P22-03 direction proof (no physical-direction style key in ANY emitted
 * style — the tree is direction-agnostic by construction, which is what
 * makes AR-RTL and EN-LTR renders identical at the JS-tree level).
 *
 * RN components run under vitest through the Flow bridge
 * (vitest.rn-bridge.mjs — the T-P22-1a deviation 4 solution); comparisons
 * use TOKEN imports, never raw hex literals (erp-ui/no-raw-design-values
 * governs test files too — the canonical-literal checks live in the root
 * gate `pnpm check:mobile-tokens`).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
import { cleanup, render, screen, type RenderResult } from "@testing-library/react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  ListItem,
  MoneyText,
  Spinner,
  StatusChip,
  TabBar,
} from "../src/theme/primitives";
import { colors, elevation, surfaces, typeScale } from "../src/theme/tokens";

// -- render + tree-walking helpers (host-level style assertions) ------------

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

/** The resolved (flattened) style of a rendered host node. */
function flatStyle(node: HostNode): Record<string, unknown> {
  const style = node.props.style;
  if (style === undefined) return {};
  return StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) as Record<string, unknown>;
}

function nodesWith(predicate: (node: HostNode) => boolean): HostNode[] {
  return hostNodes(view.toJSON()).filter(predicate);
}

function flat(predicate: (node: HostNode) => boolean): Record<string, unknown> {
  const [node] = nodesWith(predicate);
  expect(node, "expected exactly one matching host node").toBeDefined();
  return flatStyle(node!);
}

function textChildrenOf(node: HostNode): string | undefined {
  const children = node.children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string") {
    return children[0];
  }
  if (typeof children === "string") {
    return children;
  }
  return undefined;
}

function allText(): string[] {
  return hostNodes(view.toJSON())
    .flatMap((node) => (Array.isArray(node.children) ? node.children : [node.children]))
    .filter((child): child is string => typeof child === "string");
}

/** DR-P22-03 — the physical-direction style keys banned in apps/mobile/src. */
const BANNED_PHYSICAL_KEYS = [
  "marginLeft",
  "marginRight",
  "paddingLeft",
  "paddingRight",
  "borderLeftWidth",
  "borderRightWidth",
  "borderLeftColor",
  "borderRightColor",
  "borderLeftRadius",
  "borderRightRadius",
  "left",
  "right",
] as const;

/** The direction proof: NO host node in the tree emits a banned physical
 *  style key, and textAlign never resolves to 'left'/'right' — the rendered
 *  JS tree is direction-agnostic (RN flips logical props at layout time),
 *  which is the property AR-RTL and EN-LTR both rely on. */
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

/** A kitchen sink rendering EVERY primitive (AR + EN prop sets) for the
 *  direction proof — if any primitive regresses to physical props, this
 *  render exposes it. */
function renderEverything(): void {
  renderTree(
    <>
      <Button label="حفظ" onPress={() => {}} />
      <Button label="Save" variant="secondary" disabled />
      <Button label="Post" variant="danger" loading />
      <Button label="POS" variant="pos" focused />
      <IconButton icon={<Text>☰</Text>} accessibilityLabel="القائمة" onPress={() => {}} focused />
      <MoneyText amount="-1234.50" currency="SAR" locale="ar" />
      <MoneyText amount="150.00" currency="SAR" locale="en" align="end" />
      <MoneyText amount="0.00" locale="ar" />
      <Badge label="نجاح" tone="success" />
      <Badge label="Draft" tone="info" mono />
      <StatusChip status="PENDING_APPROVAL" label="بانتظار الموافقة" />
      <StatusChip status="VOIDED" />
      <ListItem title="فاتورة" subtitle="INV-2026-0001" divider onPress={() => {}} />
      <ListItem title="Customer" leading={<Text>◐</Text>} trailing={<Text>›</Text>} />
      <Card>
        <Text>card body</Text>
      </Card>
      <Card level="e3" padding={8}>
        <Text>overlay card</Text>
      </Card>
      <Field label="المبلغ" error="مطلوب">
        <Text>input</Text>
      </Field>
      <Field label="Name" hint="as printed" required>
        <Text>input</Text>
      </Field>
      <Spinner label="جارٍ الحفظ" showLabel />
      <EmptyState title="لا توجد بيانات" message="جرّب لاحقاً" icon={<Text>∅</Text>} />
      <TabBar
        items={[
          { key: "home", label: "الرئيسية", onPress: () => {}, active: true },
          { key: "visits", label: "الزيارات", onPress: () => {} },
          { key: "more", label: "المزيد", onPress: () => {} },
        ]}
      />
    </>,
  );
}

describe("PHASE-022 primitives — render + a11y (MASTER-PLAN §4)", () => {
  afterEach(cleanup);

  // -- Button / IconButton ---------------------------------------------------

  it("Button renders with the button role and its label", () => {
    renderTree(<Button label="حفظ الفاتورة" onPress={() => {}} />);
    expect(screen.getByRole("button")).toBeTruthy();
    expect(screen.getByText("حفظ الفاتورة")).toBeTruthy();
  });

  it("Button meets the ≥44dp touch target (ACCESSIBILITY §touch) with token padding", () => {
    renderTree(<Button label="Save" onPress={() => {}} />);
    const style = flat((n) => n.props.accessibilityRole === "button");
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.paddingStart).toBe(16);
    expect(style.paddingEnd).toBe(16);
    expect(style.borderRadius).toBe(6);
  });

  it("Button variants wear the token surfaces (primary/secondary/danger/pos)", () => {
    const result = renderTree(<Button label="b" variant="primary" onPress={() => {}} />);
    const byRole = (): Record<string, unknown> => flat((n) => n.props.accessibilityRole === "button");
    expect(byRole().backgroundColor).toBe(colors.primary[600]);
    result.rerender(<Button label="b" variant="secondary" onPress={() => {}} />);
    expect(byRole().backgroundColor).toBe(surfaces.card);
    result.rerender(<Button label="b" variant="danger" onPress={() => {}} />);
    expect(byRole().backgroundColor).toBe(colors.danger.solid);
    result.rerender(<Button label="b" variant="pos" onPress={() => {}} />);
    expect(byRole().backgroundColor).toBe(surfaces.posRaised);
  });

  it("disabled Button greys out, announces disabled, and drops the press handler", () => {
    renderTree(<Button label="b" disabled onPress={() => {}} />);
    expect(flat((n) => n.props.accessibilityRole === "button").backgroundColor).toBe(colors.gray[100]);
    const [node] = nodesWith((n) => n.props.accessibilityRole === "button");
    expect(node!.props.accessibilityState).toMatchObject({ disabled: true });
    expect(node!.props.onPress).toBeUndefined();
    expect(screen.getByText("b")).toBeTruthy();
  });

  it("loading Button shows the Spinner (progressbar role) and announces busy", () => {
    renderTree(<Button label="b" loading onPress={() => {}} />);
    // NOTE: @testing-library/react-native's role queries do not map RN's
    // "progressbar" accessibilityRole — asserted on the rendered tree (the
    // a11y props are what TalkBack consumes).
    const [progress] = nodesWith((n) => n.props.accessibilityRole === "progressbar");
    expect(progress).toBeDefined();
    const [node] = nodesWith((n) => n.props.accessibilityRole === "button");
    expect(node!.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });

  it("focused Button draws the §11 focus ring (2dp solid, 2dp offset, variant color)", () => {
    renderTree(<Button label="b" focused onPress={() => {}} />);
    const style = flat((n) => flatStyle(n).borderWidth === 2 && flatStyle(n).margin === 2);
    expect(style.borderWidth).toBe(2);
    expect(style.borderColor).toBe(colors.primary[200]); // brand ring on primary fills (§11)
    expect(style.borderRadius).toBe(6);
  });

  it("IconButton renders the icon with a REQUIRED accessibility label and the ≥44dp target", () => {
    renderTree(<IconButton icon={<Text>☰</Text>} accessibilityLabel="القائمة" onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "القائمة" })).toBeTruthy();
    const style = flat((n) => n.props.accessibilityRole === "button");
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByText("☰")).toBeTruthy();
  });

  // -- MoneyText -------------------------------------------------------------

  it("MoneyText colors by §4 finance sign: positive/negative/zero/malformed", () => {
    const result = renderTree(<MoneyText amount="150.00" currency="SAR" locale="en" />);
    const moneyStyle = (): Record<string, unknown> => flat((n) => n.type === "RCTText");
    expect(moneyStyle().color).toBe(colors.finance.positive);
    result.rerender(<MoneyText amount="-1234.50" currency="SAR" locale="en" />);
    expect(moneyStyle().color).toBe(colors.finance.negative);
    result.rerender(<MoneyText amount="0.00" currency="SAR" locale="en" />);
    expect(moneyStyle().color).toBe(colors.gray[600]); // zero is NEVER red or green
    result.rerender(<MoneyText amount="not-a-number" currency="SAR" locale="en" />);
    expect(moneyStyle().color).toBe(colors.gray[600]); // no sign claim on malformed input
  });

  it("MoneyText renders tabular numerals and the type-scale metrics", () => {
    renderTree(<MoneyText amount="150.00" currency="SAR" locale="en" size="lg" />);
    const style = flat((n) => n.type === "RCTText");
    expect(style.fontVariant).toEqual(["tabular-nums"]);
    expect(style.fontSize).toBe(typeScale.lg.fontSize);
    expect(style.lineHeight).toBe(typeScale.lg.lineHeight);
  });

  it("MoneyText bidi-isolates the money run (U+2066…U+2069) in BOTH locales", () => {
    const result = renderTree(<MoneyText amount="-1234.50" currency="SAR" locale="en" />);
    expect(allText().join("")).toBe(`\u2066-1,234.50 SAR\u2069`);
    result.rerender(<MoneyText amount="-1234.50" currency="SAR" locale="ar" />);
    expect(allText().join("")).toBe(`\u2066-1,234.50 ر.س\u2069`);
  });

  it("MoneyText preserves the exact decimal scale and can drop sign coloring", () => {
    const result = renderTree(<MoneyText amount="1234.5000" currency="" locale="en" />);
    expect(allText().join("")).toBe(`\u20661,234.5000\u2069`);
    result.rerender(<MoneyText amount="-1234.50" currency="" locale="en" colorBySign={false} />);
    expect(flat((n) => n.type === "RCTText").color).toBeUndefined();
  });

  it("MoneyText aligns money columns to the inline END edge (RTL §8)", () => {
    renderTree(<MoneyText amount="1.00" currency="" locale="en" align="end" />);
    expect(flat((n) => n.type === "RCTText").alignSelf).toBe("flex-end");
  });

  // -- Badge / StatusChip (the §3 binding map) ---------------------------------

  it("Badge renders the §3 tint triple for any semantic tone", () => {
    renderTree(<Badge label="نجاح" tone="success" />);
    const badge = flat((n) => flatStyle(n).borderRadius === 4 && flatStyle(n).borderWidth === 1);
    expect(badge.backgroundColor).toBe(colors.success.tintBg);
    expect(badge.borderColor).toBe(colors.success.tintBorder);
    const label = flat((n) => n.type === "RCTText");
    expect(label.color).toBe(colors.success.tintText);
  });

  it("Badge mono routes the label through the mono family", () => {
    renderTree(<Badge label="INV-1" tone="info" mono />);
    expect(flat((n) => n.type === "RCTText").fontFamily).toBe("IBM Plex Mono");
  });

  it("StatusChip applies the binding map to EVERY documented lifecycle state", () => {
    const cases = [
      { status: "DRAFT", family: colors.info },
      { status: "PENDING_APPROVAL", family: colors.warning },
      { status: "APPROVED", family: colors.successInfo },
      { status: "POSTED", family: colors.success },
      { status: "VOIDED", family: colors.danger },
      { status: "CANCELLED", family: colors.danger },
    ] as const;
    for (const testCase of cases) {
      cleanup();
      renderTree(<StatusChip status={testCase.status} label={testCase.status} />);
      const badge = flat((n) => flatStyle(n).borderRadius === 4 && flatStyle(n).borderWidth === 1);
      expect(badge.backgroundColor, `${testCase.status} tint bg`).toBe(testCase.family.tintBg);
      expect(badge.borderColor, `${testCase.status} tint border`).toBe(testCase.family.tintBorder);
      const label = flat((n) => n.type === "RCTText");
      expect(label.color, `${testCase.status} tint text`).toBe(testCase.family.tintText);
    }
  });

  it("StatusChip never invents a color for an unmapped status (neutral text, no badge chrome)", () => {
    renderTree(<StatusChip status="SOMETHING_NEW" />);
    const [root] = hostNodes(view.toJSON());
    expect(root.type).toBe("RCTText"); // plain text fallback, no View badge
    expect(flatStyle(root).color).toBe(colors.gray[600]);
    expect(allText()).toContain("SOMETHING_NEW");
  });

  // -- ListItem ---------------------------------------------------------------

  it("ListItem renders title/subtitle/slots, the divider, and the ≥44dp target", () => {
    renderTree(
      <ListItem
        title="فاتورة INV-2026-0001"
        subtitle="الزبون: مؤسسة النور"
        leading={<Text>◐</Text>}
        trailing={<StatusChip status="POSTED" label="مرحّلة" />}
        divider
        onPress={() => {}}
      />,
    );
    expect(screen.getByText("فاتورة INV-2026-0001")).toBeTruthy();
    expect(screen.getByText("الزبون: مؤسسة النور")).toBeTruthy();
    const style = flat((n) => n.props.accessibilityRole === "button");
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(style.paddingStart).toBe(12);
    expect(screen.getByText("مرحّلة")).toBeTruthy(); // trailing slot rendered
    expect(screen.getByText("◐")).toBeTruthy(); // leading slot rendered
  });

  it("ListItem without onPress is a plain row (no button role)", () => {
    renderTree(<ListItem title="بدون ضغط" />);
    expect(nodesWith((n) => n.props.accessibilityRole === "button")).toEqual([]);
    expect(screen.getByText("بدون ضغط")).toBeTruthy();
  });

  // -- Card --------------------------------------------------------------------

  it("Card wears the card surface, lg radius, hairline border, and the e1 elevation token", () => {
    renderTree(
      <Card>
        <Text>body</Text>
      </Card>,
    );
    const card = flat((n) => flatStyle(n).borderRadius === 8);
    expect(card.backgroundColor).toBe(surfaces.card);
    expect(card.borderWidth).toBe(StyleSheet.hairlineWidth);
    expect(card.borderColor).toBe(colors.gray[200]);
    expect(card.shadowRadius).toBe(elevation.e1.shadowRadius);
    expect(card.elevation).toBe(elevation.e1.elevation);
    expect(card.padding).toBe(16);
  });

  it("Card level=e3 escalates to the e3 shadow and honors custom padding", () => {
    renderTree(
      <Card level="e3" padding={8}>
        <Text>body</Text>
      </Card>,
    );
    const card = flat((n) => flatStyle(n).borderRadius === 8);
    expect(card.shadowRadius).toBe(elevation.e3.shadowRadius);
    expect(card.elevation).toBe(elevation.e3.elevation);
    expect(card.padding).toBe(8);
  });

  // -- Field --------------------------------------------------------------------

  it("Field labels the control group and renders the §3 danger error / gray-600 hint", () => {
    const result = renderTree(
      <Field label="المبلغ" error="هذا الحقل مطلوب">
        <Text>input</Text>
      </Field>,
    );
    expect(screen.getByText("المبلغ")).toBeTruthy();
    expect(screen.getByText("هذا الحقل مطلوب")).toBeTruthy();
    expect(flat((n) => textChildrenOf(n) === "هذا الحقل مطلوب").color).toBe(colors.danger.solid);
    result.rerender(
      <Field label="Name" hint="as printed on the invoice">
        <Text>input</Text>
      </Field>,
    );
    expect(flat((n) => textChildrenOf(n) === "as printed on the invoice").color).toBe(colors.gray[600]);
  });

  it("Field carries accessibilityLabel (defaulting to the label) and the required marker", () => {
    renderTree(
      <Field label="الرقم الضريبي" required>
        <Text>input</Text>
      </Field>,
    );
    const [group] = nodesWith((n) => n.type === "RCTView" && n.props.accessibilityLabel === "الرقم الضريبي");
    expect(group).toBeDefined();
    expect(allText().join("")).toContain("*"); // the required marker rendered
  });

  // -- Spinner / EmptyState -------------------------------------------------------

  it("Spinner exposes the progressbar role with an accessible label", () => {
    renderTree(<Spinner label="جارٍ الحفظ" />);
    const [progress] = nodesWith((n) => n.props.accessibilityRole === "progressbar");
    expect(progress).toBeDefined();
    expect(progress!.props.accessibilityLabel).toBe("جارٍ الحفظ");
  });

  it("EmptyState renders title + message with the icon hidden from a11y", () => {
    renderTree(<EmptyState title="لا توجد فواتير" message="سحّب للتحديث" icon={<Text>∅</Text>} />);
    expect(screen.getByText("لا توجد فواتير")).toBeTruthy();
    expect(screen.getByText("سحّب للتحديث")).toBeTruthy();
    expect(nodesWith((n) => n.props.accessibilityElementsHidden === true)).toHaveLength(1);
  });

  // -- TabBar -----------------------------------------------------------------------

  it("TabBar renders one accessible tab per item with selected state + brand active color", () => {
    renderTree(
      <TabBar
        items={[
          { key: "home", label: "الرئيسية", onPress: () => {}, active: true },
          { key: "visits", label: "الزيارات", onPress: () => {} },
          { key: "more", label: "المزيد", onPress: () => {} },
        ]}
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const selected = nodesWith(
      (n) => n.props.accessibilityRole === "tab" && (n.props.accessibilityState as { selected?: boolean } | undefined)?.selected === true,
    );
    expect(selected).toHaveLength(1);
    expect(flat((n) => n.type === "RCTText" && textChildrenOf(n) === "الرئيسية").color).toBe(colors.primary[600]);
    expect(flat((n) => n.type === "RCTText" && textChildrenOf(n) === "الزيارات").color).toBe(colors.gray[600]);
    expect(flat((n) => flatStyle(n).borderTopWidth === StyleSheet.hairlineWidth).zIndex).toBe(10);
  });

  // -- the DR-P22-03 direction proof ----------------------------------------------

  it("emits LOGICAL styles only — no physical-direction key in any rendered style (AR + EN)", () => {
    renderEverything();
    expectLogicalStylesOnly();
  });
});
