/**
 * PHASE-021 T2-b — the offline components suite: each shared component
 * renders AR + EN with correct RTL/LTR dir, and every capability-gated
 * state is honest (disabled + reason, never a queue). The §3 action
 * model and the reprint template are pinned here too.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AsOfLabel } from "../as-of-label";
import { ConnectivityDot } from "../connectivity-dot";
import { HonestStateBadge, OutboxStatusBadge } from "../honest-state-badge";
import { OfflineBadge } from "../offline-badge";
import { OnlineOnlyDisabled } from "../online-only-disabled";
import { SyncNowButton } from "../sync-now-button";
import { buildReprintHtml } from "../reprint-html";
import {
  availableQtyFromDetails,
  isAdministrative,
  parseTypedRejection,
  rejectionActionsFor,
  serverPriceFromDetails,
} from "../rejection-actions";
import { getDictionary } from "../../../i18n/dictionaries";
import type { CachedInvoice } from "../../../lib/shell/store-client";

afterEach(cleanup);

describe("ConnectivityDot (AR/EN)", () => {
  it("renders the online label in Arabic", () => {
    render(<ConnectivityDot locale="ar" online={true} />);
    expect(screen.getByRole("status").textContent).toContain(getDictionary("ar").offlineOnlineLabel);
  });
  it("renders the offline label in English", () => {
    render(<ConnectivityDot locale="en" online={false} />);
    expect(screen.getByRole("status").textContent).toContain(getDictionary("en").offlineOfflineLabel);
  });
});

describe("OfflineBadge (phase + queue depth)", () => {
  it("shows the syncing phase with the queue count in Arabic", () => {
    const { container } = render(<OfflineBadge locale="ar" phase="syncing" queueDepth={3} />);
    expect(container.textContent).toContain(getDictionary("ar").offlinePhaseSyncing);
    expect(container.textContent).toContain("3");
  });
  it("shows the revoked phase in English", () => {
    render(<OfflineBadge locale="en" phase="revoked" queueDepth={0} />);
    expect(screen.getByText(getDictionary("en").offlinePhaseRevoked)).toBeTruthy();
  });
  it("shows the browser phase honestly (no queue simulation)", () => {
    render(<OfflineBadge locale="en" phase="browser" queueDepth={0} />);
    expect(screen.getByText(getDictionary("en").offlinePhaseBrowser)).toBeTruthy();
  });
});

describe("AsOfLabel (stale is labeled, never guessed)", () => {
  it("renders the as-of time in Arabic", () => {
    render(<AsOfLabel locale="ar" asOf={Date.UTC(2026, 10, 4, 9, 30)} />);
    expect(screen.getByText(new RegExp("آخر مزامنة"), { exact: false })).toBeTruthy();
  });
  it("says never-synced honestly when the stamp is absent", () => {
    render(<AsOfLabel locale="en" asOf={null} />);
    expect(screen.getByText(getDictionary("en").offlineAsOfNever)).toBeTruthy();
  });
});

describe("OnlineOnlyDisabled (reason, never a queue)", () => {
  it("renders the browser reason in Arabic (RTL)", () => {
    render(<OnlineOnlyDisabled locale="ar" reason={getDictionary("ar").offlineReasonBrowser} />);
    const note = screen.getByRole("note");
    expect(note.getAttribute("dir")).toBe("rtl");
    expect(note.textContent).toContain(getDictionary("ar").offlineReasonBrowser);
    expect(note.textContent).toContain(getDictionary("ar").offlineOnlineOnlyTitle);
  });
  it("renders any bilingual reason in English (LTR)", () => {
    render(<OnlineOnlyDisabled locale="en" reason={getDictionary("en").offlineReasonNoSync} />);
    expect(screen.getByRole("note").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText(getDictionary("en").offlineReasonNoSync)).toBeTruthy();
  });
});

describe("HonestStateBadge + OutboxStatusBadge", () => {
  it("renders every draft state AR/EN with the exact label", () => {
    const cases = [
      ["DRAFT_LOCAL", getDictionary("ar").offlineStateDraftLocal, getDictionary("en").offlineStateDraftLocal],
      ["PENDING_MERGE", getDictionary("ar").offlineStatePendingMerge, getDictionary("en").offlineStatePendingMerge],
      ["SYNC_FAILED", getDictionary("ar").offlineStateSyncFailed, getDictionary("en").offlineStateSyncFailed],
      ["MERGED", getDictionary("ar").offlineStateMerged, getDictionary("en").offlineStateMerged],
      ["CANCELLED_LOCAL", getDictionary("ar").offlineStateCancelledLocal, getDictionary("en").offlineStateCancelledLocal],
    ] as const;
    for (const [status, ar, en] of cases) {
      cleanup();
      const { container: arRoot } = render(<HonestStateBadge locale="ar" status={status} />);
      expect(arRoot.textContent).toContain(ar);
      cleanup();
      const { container: enRoot } = render(<HonestStateBadge locale="en" status={status} />);
      expect(enRoot.textContent).toContain(en);
    }
  });
  it("renders every outbox status AR/EN with the exact label", () => {
    const cases = [
      ["QUEUED", getDictionary("ar").offlineStatusQueued, getDictionary("en").offlineStatusQueued],
      ["IN_FLIGHT", getDictionary("ar").offlineStatusInFlight, getDictionary("en").offlineStatusInFlight],
      ["ACKED", getDictionary("ar").offlineStatusAcked, getDictionary("en").offlineStatusAcked],
      ["REJECTED", getDictionary("ar").offlineStatusRejected, getDictionary("en").offlineStatusRejected],
      ["CANCELLED", getDictionary("ar").offlineStatusCancelled, getDictionary("en").offlineStatusCancelled],
    ] as const;
    for (const [status, ar, en] of cases) {
      cleanup();
      const { container: arRoot } = render(<OutboxStatusBadge locale="ar" status={status} />);
      expect(arRoot.textContent).toContain(ar);
      cleanup();
      const { container: enRoot } = render(<OutboxStatusBadge locale="en" status={status} />);
      expect(enRoot.textContent).toContain(en);
    }
  });
});

describe("SyncNowButton (gated on capabilities.sync — DR-P21-09)", () => {
  it("renders disabled with the unavailable reason when the driver is absent", () => {
    render(<SyncNowButton locale="ar" variant="sync" available={false} onClick={() => undefined} />);
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(getDictionary("ar").offlineSyncUnavailable)).toBeTruthy();
    expect(screen.getByText(getDictionary("ar").offlineSyncNow)).toBeTruthy();
  });
  it("invokes onClick when available", () => {
    let clicked = 0;
    render(
      <SyncNowButton
        locale="en"
        variant="push"
        available={true}
        onClick={() => {
          clicked += 1;
        }}
      />,
    );
    screen.getByRole("button", { name: getDictionary("en").offlinePushNow }).click();
    expect(clicked).toBe(1);
  });
});

describe("the CONFLICT_RESOLUTION §3 action table (exact)", () => {
  it("maps every typed reason to exactly its §3 action set", () => {
    expect(rejectionActionsFor("PERIOD_LOCKED").map((a) => a.id)).toEqual(["edit_and_resend", "cancel"]);
    expect(rejectionActionsFor("PRICE_CHANGED").map((a) => a.id)).toEqual([
      "accept_server_price",
      "edit_and_resend",
      "cancel",
    ]);
    expect(rejectionActionsFor("INSUFFICIENT_STOCK").map((a) => a.id)).toEqual([
      "edit_and_resend",
      "accept_partial",
      "cancel",
    ]);
    expect(rejectionActionsFor("CREDIT_LIMIT_EXCEEDED").map((a) => a.id)).toEqual([
      "edit_and_resend",
      "request_approval_online",
      "cancel",
    ]);
    expect(rejectionActionsFor("STALE_VERSION").map((a) => a.id)).toEqual(["review_and_merge", "discard"]);
    expect(rejectionActionsFor("ITEM_INACTIVE").map((a) => a.id)).toEqual(["cancel", "substitute_and_resend"]);
    expect(rejectionActionsFor("PARTNER_INACTIVE").map((a) => a.id)).toEqual(["cancel", "substitute_and_resend"]);
    expect(rejectionActionsFor("VALIDATION_ERROR").map((a) => a.id)).toEqual(["edit_and_resend"]);
  });
  it("administrative reasons render NO resubmission actions", () => {
    expect(isAdministrative("DEVICE_REVOKED")).toBe(true);
    expect(isAdministrative("TENANT_SUSPENDED")).toBe(true);
    expect(rejectionActionsFor("DEVICE_REVOKED")).toEqual([]);
    expect(rejectionActionsFor("TENANT_SUSPENDED")).toEqual([]);
  });
  it("unknown reasons fall back to no actions (registry fallback, never a guess)", () => {
    expect(rejectionActionsFor("SOME_FUTURE_REASON")).toEqual([]);
    expect(isAdministrative("SOME_FUTURE_REASON")).toBe(false);
  });
  it("parses the typed lastError JSON defensively", () => {
    const typed = parseTypedRejection(
      JSON.stringify({ reason: "PRICE_CHANGED", resubmittable: true, details: { serverPrice: "12.5000" }, message: "price moved" }),
      "PRICE_CHANGED",
    );
    expect(typed.reason).toBe("PRICE_CHANGED");
    expect(typed.resubmittable).toBe(true);
    expect(serverPriceFromDetails(typed.details)).toBe("12.5000");
    expect(parseTypedRejection("plain legacy text", "VALIDATION_ERROR").message).toBe("plain legacy text");
    expect(parseTypedRejection(null, null).reason).toBe("VALIDATION_ERROR");
    expect(availableQtyFromDetails({ availableQty: 4 })).toBe("4");
    expect(availableQtyFromDetails(null)).toBeNull();
  });
});

describe("the reprint template (row 32 — never re-numbers)", () => {
  const invoice: CachedInvoice = {
    id: "21212121-0000-4000-8000-0000000000aa",
    docNo: "INV-2026-0042",
    partnerId: null,
    status: "POSTED",
    issueDate: "2026-11-01",
    totalGross: "115.0000",
    totalTax: "15.0000",
    currency: "SAR",
    payload: JSON.stringify({
      storeName: { ar: "متجر النخبة", en: "Elite Store" },
      vatRegNo: "310000000000003",
      subtotal: "100.0000",
      lines: [
        { nameAr: "كوب إسبريسو", name: "Espresso cup", qty: "2", unitPrice: "12.5000", lineTotal: "25.0000" },
      ],
    }),
    version: 3,
    updatedAt: null,
  };

  it("uses the CACHED doc_no verbatim, exactly once, with the REPRINT marker", () => {
    const html = buildReprintHtml(invoice, "2026-11-04T12:00:00.000Z");
    expect(html).toContain("INV-2026-0042");
    expect(html.split("INV-2026-0042").length - 1).toBe(1);
    expect(html).toContain("*** إعادة طباعة / REPRINT · 2026-11-04T12:00:00.000Z ***");
    expect(html).toContain("متجر النخبة");
    expect(html).toContain("Elite Store");
    expect(html).toContain("310000000000003");
    expect(html).toContain("كوب إسبريسو");
    expect(html).toContain("115.0000");
    expect(html).toContain('dir="rtl"');
  });

  it("degrades to column-level totals when the payload is corrupt", () => {
    const html = buildReprintHtml({ ...invoice, payload: "{not json" }, "2026-11-04T12:00:00.000Z");
    expect(html).toContain("INV-2026-0042");
    expect(html).toContain("115.0000");
    expect(html).toContain("المتجر"); // the defensive store fallback
  });
});
