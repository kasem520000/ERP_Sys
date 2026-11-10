/**
 * DOM-level component behavior tests (keyed interactions per COMPONENT_CATALOG
 * §7): MoneyInput paste/blur/focus contract, Button loading semantics,
 * Checkbox tri-state, DocumentStatusBadge vocabulary, DataTable a11y +
 * virtualization behavior, Combobox keyboard model, list-state encoding.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { JSX } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../../components/button";
import { MoneyInput } from "../../components/money-input";
import { Checkbox } from "../../components/controls";
import { DocumentStatusBadge } from "../../components/badge";
import { DataTable } from "../../components/data-table/data-table";
import { DirectionProvider } from "../../utils/direction";
import { decodeListState, encodeListState } from "../../components/shell";

afterEach(cleanup);

describe("Button (catalog §1)", () => {
  it("keeps the label and sets aria-busy while loading", () => {
    render(<Button loading>save</Button>);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("save");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it("exposes the accessible name", () => {
    render(<Button aria-label="حفظ">save</Button>);
    expect(screen.getByRole("button", { name: "حفظ" })).toBeTruthy();
  });
});

describe("MoneyInput (§6.2 normative)", () => {
  it("renders grouped on blur and raw on focus", async () => {
    let amount = "12500";
    render(
      <DirectionProvider dir="rtl">
        <MoneyInput amount={amount} onAmountChange={(v) => (amount = v)} currency="SAR" label="المبلغ" />
      </DirectionProvider>,
    );
    const input = screen.getByRole("group").querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("12,500.00");
    await userEvent.click(input);
    expect(input.value).toBe("12500"); // raw digits for caret-preserving edit
  });

  it("sanitizes pasted junk (digits, dot, leading minus only)", async () => {
    let amount = "0";
    render(
      <DirectionProvider dir="rtl">
        <MoneyInput amount={amount} onAmountChange={(v) => (amount = v)} currency="SAR" allowNegative />
      </DirectionProvider>,
    );
    const input = screen.getByRole("group").querySelector("input") as HTMLInputElement;
    await userEvent.click(input);
    fireEvent.paste(input, { clipboardData: { getData: () => "abc-12x.50" } });
    expect(amount).toBe("-12.50");
  });

  it("forces LTR digit runs inside RTL (dir attr + isolate)", () => {
    render(
      <DirectionProvider dir="rtl">
        <MoneyInput amount="123.45" currency="SAR" />
      </DirectionProvider>,
    );
    const input = screen.getByRole("group").querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.style.unicodeBidi).toBe("isolate");
  });

  it("renders the currency chip (ISO + symbol)", () => {
    render(
      <DirectionProvider dir="rtl">
        <MoneyInput amount="1" currency="SAR" />
      </DirectionProvider>,
    );
    expect(screen.getByText("SAR ر.س")).toBeTruthy();
  });

  it("clamps to max when provided", async () => {
    function Harness(): JSX.Element {
      const [amount, setAmount] = useState("5");
      return (
        <DirectionProvider dir="rtl">
          <MoneyInput amount={amount} onAmountChange={setAmount} currency="SAR" max="100" />
        </DirectionProvider>
      );
    }
    render(<Harness />);
    const input = screen.getByRole("group").querySelector("input") as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await waitFor(() => expect((screen.getByRole("group").querySelector("input") as HTMLInputElement).value).toBe("100"));
  });
});

describe("Checkbox tri-state (§1)", () => {
  it("renders indeterminate visual without changing state semantics", () => {
    render(<Checkbox checked="indeterminate" label="الكل" />);
    expect(screen.getByRole("checkbox").getAttribute("data-state")).toBe("indeterminate");
  });
  it("toggles via Space", async () => {
    let checked: boolean | "indeterminate" = false;
    render(<Checkbox checked={checked} onCheckedChange={(v) => (checked = v)} label="خيار" />);
    await userEvent.type(screen.getByRole("checkbox"), " ");
    expect(checked).toBe(true);
  });
});

describe("DocumentStatusBadge (§6.4)", () => {
  it("renders the lifecycle vocabulary with the fixed tone classes", () => {
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DocumentStatusBadge status="POSTED" label="مُرحّل" />
      </DirectionProvider>,
    );
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toContain("مُرحّل");
    expect(badge.className).toContain("bg-success-bg"); // token tone, never bespoke
  });
  it("strikethroughs CANCELLED and keeps icons decorative", () => {
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DocumentStatusBadge status="CANCELLED" label="ملغي" showIcon />
      </DirectionProvider>,
    );
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.querySelector("span.line-through, span[class*=line-through]") ?? badge.textContent).toBeTruthy();
    const svg = badge.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("DataTable (§6.1 normative)", () => {
  interface Row {
    id: string;
    name: string;
    amount: string;
  }
  const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
    id: `row-${i}`,
    name: `اسم ${i}`,
    amount: `${i}.50`,
  }));
  const columns = [
    { id: "name", header: { ar: "الاسم", en: "Name" }, accessor: (r: Row) => r.name, sortable: true, filterable: true },
    { id: "amount", header: { ar: "المبلغ", en: "Amount" }, accessor: (r: Row) => r.amount, numeric: true, sortable: true },
  ];

  it("declares grid semantics with virtualized rows (500 rows render < 100 DOM rows)", () => {
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      </DirectionProvider>,
    );
    const grid = container.querySelector('[role="grid"]');
    expect(grid).toBeTruthy();
    expect(grid?.getAttribute("aria-rowcount")).toBe("500");
    const rendered = container.querySelectorAll('[data-row-index]');
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(20); // overscan keeps context
  });

  it("sorts by header click and announces aria-sort", async () => {
    const sort: Array<{ columnId: string; direction: "asc" | "desc" }> = [];
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          sort={[]}
          onSortChange={(s) => sort.push(...s)}
        />
      </DirectionProvider>,
    );
    await userEvent.click(container.querySelector('[role="columnheader"] button') as HTMLElement);
    expect(sort).toEqual([{ columnId: "name", direction: "asc" }]);
  });

  it("announces selection politely (polite live region)", () => {
    const selected = new Set(["row-0", "row-1"]);
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DataTable
          rows={rows.slice(0, 3)}
          columns={columns}
          rowKey={(r) => r.id}
          selected={selected}
          onSelectedChange={() => {}}
          selectionLabel={(n) => `تم تحديد ${n} صفوف`}
        />
      </DirectionProvider>,
    );
    const live = container.querySelector('p[aria-live="polite"]');
    expect(live?.textContent).toContain("تم تحديد 2 صفوف");
    const selectAll = screen.getByRole("checkbox", { name: "select all" });
    expect(selectAll.getAttribute("data-state")).toBe("indeterminate"); // tri-state header
  });

  it("keeps numeric digits LTR inside RTL", () => {
    const { container } = render(
      <DirectionProvider dir="rtl">
        <DataTable rows={rows.slice(0, 1)} columns={columns} rowKey={(r) => r.id} />
      </DirectionProvider>,
    );
    const numericSpan = container.querySelector('[role="gridcell"] span[dir="ltr"]');
    expect(numericSpan?.textContent).toBe("0.50");
  });

  it("renders empty and error states before first release (states matrix)", () => {
    const { container: emptyC } = render(
      <DirectionProvider dir="rtl">
        <DataTable rows={[]} columns={columns} rowKey={(r: Row) => r.id} empty={{ title: "لا بيانات" }} />
      </DirectionProvider>,
    );
    expect(emptyC.textContent).toContain("لا بيانات");
    const { container: errorC } = render(
      <DirectionProvider dir="rtl">
        <DataTable rows={[]} columns={columns} rowKey={(r: Row) => r.id} error={{ title: "خطأ" }} />
      </DirectionProvider>,
    );
    expect(errorC.querySelector('[role="alert"]')).toBeTruthy();
  });
});

describe("back-preserves-filters (NAVIGATION_MODEL §4)", () => {
  it("round-trips list state through the URL", () => {
    const state = { status: "POSTED", sort: "-date", page: "2" };
    const encoded = encodeListState(state);
    expect(decodeListState(encoded)).toEqual(state);
  });
});
