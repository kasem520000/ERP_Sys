/**
 * PHASE-052 (W-48 — T-13) THE WORKFLOW NAVIGATION ROWS' registry tests
 * (the trade-nav-rows pattern: the NAV_ITEMS contract is BINDING data —
 * the sidebar, the command menu (⌘K — OA-04) and the mobile tabs all
 * consume it; these pins keep the workflow family's rows exactly as
 * the wave declared them, D-03/D-04):
 *
 * - THE DECLARED +3: settings.workflows · workflow.approvals ·
 *   workflow.tasks — the exact feature keys (D-04: workflow.definitions
 *   the editor plane · workflow.engine the base unit · workflow.tasks
 *   the composable lane unit) and the exact 0130-seeded matrix §3.30
 *   permission keys (workflow.definitions.manage · workflow.inbox.act;
 *   the tasks lane is the self plane — no key, the actor law is the
 *   engine's own floor).
 * - THE HONEST +1 (disclosed at the wave's README): trade.drawbacks —
 *   the fourth bound detail surface's own register (the whole-module
 *   `trade` flag + trade.view, the W-39 precedent verbatim).
 * - BOTH LABEL SIDES present (real Arabic on the ar side — Arabic-first).
 */
import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@erp/contracts";

function rowByRoute(route: string) {
  return NAV_ITEMS.find((item) => item.route === route);
}

describe("PHASE-052 W-48 — the workflow navigation rows (NAV_ITEMS)", () => {
  it("(a) the declared +3 carry the exact ids, routes and feature keys (D-04's units)", () => {
    expect(rowByRoute("/workflow/approvals")).toMatchObject({
      id: "workflow.approvals",
      featureKey: "workflow.engine",
      route: "/workflow/approvals",
    });
    expect(rowByRoute("/workflow/tasks")).toMatchObject({
      id: "workflow.tasks",
      featureKey: "workflow.tasks",
      route: "/workflow/tasks",
    });
    expect(rowByRoute("/settings/workflows")).toMatchObject({
      id: "settings.workflows",
      featureKey: "workflow.definitions",
      route: "/settings/workflows",
    });
  });

  it("(b) the permission keys mirror the 0130-seeded matrix §3.30 rows verbatim (the tasks lane is the self plane — no key)", () => {
    expect(rowByRoute("/workflow/approvals")?.permission).toBe("workflow.inbox.act");
    expect(rowByRoute("/settings/workflows")?.permission).toBe("workflow.definitions.manage");
    // The tasks lane rides the SESSION_ROUTES self plane (the actor law
    // is the engine's own floor, never a role key).
    expect(rowByRoute("/workflow/tasks")?.permission).toBeUndefined();
  });

  it("(c) the honest +1 — the drawbacks board (the fourth bound surface, the whole-module trade flag)", () => {
    expect(rowByRoute("/trade/drawbacks")).toMatchObject({
      id: "trade.drawbacks",
      featureKey: "trade",
      permission: "trade.view",
      route: "/trade/drawbacks",
    });
  });

  it("(d) both label sides present (real Arabic on the ar side — Arabic-first)", () => {
    const approvals = rowByRoute("/workflow/approvals");
    expect(approvals?.label.ar).toBe("صندوق الموافقات");
    expect(approvals?.label.en).toBe("Approvals inbox");
    const tasks = rowByRoute("/workflow/tasks");
    expect(tasks?.label.ar).toBe("مهامي");
    expect(tasks?.label.en).toBe("My tasks");
    const settings = rowByRoute("/settings/workflows");
    expect(settings?.label.ar).toBe("سير العمل والموافقات");
    expect(settings?.label.en).toBe("Workflows");
    const drawbacks = rowByRoute("/trade/drawbacks");
    expect(drawbacks?.label.ar).toBe("طلبات استرداد الرسوم");
    expect(drawbacks?.label.en).toBe("Duty drawback claims");
  });
});
