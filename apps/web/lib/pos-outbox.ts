/**
 * PHASE-016 T10 — the POS offline outbox (client-side, localStorage).
 *
 * State honesty is the contract (OFFLINE_ARCHITECTURE §5 / A-010): a sale
 * captured offline is stored locally with its `OFF-{terminalCode}-{seq}`
 * number and `PENDING_SYNC` status; the official invoice number appears
 * NOWHERE until the server accepts the sale. Entries survive reloads and
 * drain through `POST pos/sales` (with `offlineReceiptNo`) once the browser
 * is back online. This module is browser-only by usage (guarded reads) and
 * carries no React — the components own the rendering.
 */
import type { PosOutboxEntry } from "./api-types";

/** localStorage keys (stable — do not rename across releases). */
export const POS_OUTBOX_KEY = "pos-outbox";
const POS_OUTBOX_SEQ_KEY = "pos-outbox-seq";

/** The sessionStorage hand-off a check payment uses to carry cart state to /pos. */
export const POS_PRELOAD_KEY = "pos-preloaded-check";
/** The sessionStorage hand-off "Edit & resend" uses to re-open a rejected sale on /pos. */
export const POS_OUTBOX_EDIT_KEY = "pos-outbox-edit";

/** The /pos preload payload (a table check handed over for payment). */
export interface PosPreloadPayload {
  checkId: string;
  checkNo: string;
  orderType: PosOutboxEntry["sale"]["orderType"];
  lines: readonly {
    itemId: string;
    name: string;
    nameAr: string | null;
    qty: string;
    unitPrice: string;
    sentToKitchen: boolean;
  }[];
}

/** Reads (and consumes) the check-payment preload when it matches the check id. */
export function consumePosPreload(checkId: string | null): PosPreloadPayload | null {
  if (typeof window === "undefined" || checkId === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(POS_PRELOAD_KEY) ?? "");
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as PosPreloadPayload).checkId === checkId &&
      Array.isArray((parsed as PosPreloadPayload).lines)
    ) {
      window.sessionStorage.removeItem(POS_PRELOAD_KEY);
      return parsed as PosPreloadPayload;
    }
  } catch {
    // absent or corrupt — fall through
  }
  return null;
}

/** Writes the check-payment preload (floor → counter "Pay"). */
export function writePosPreload(payload: PosPreloadPayload): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(POS_PRELOAD_KEY, JSON.stringify(payload));
}

/** Reads (and consumes) the rejected-sale edit hand-off clientId, if any. */
export function consumePosOutboxEditClientId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const clientId = window.sessionStorage.getItem(POS_OUTBOX_EDIT_KEY);
  if (clientId !== null) {
    window.sessionStorage.removeItem(POS_OUTBOX_EDIT_KEY);
  }
  return clientId;
}

/** Writes the rejected-sale edit hand-off (reconciliation → counter). */
export function writePosOutboxEditClientId(clientId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(POS_OUTBOX_EDIT_KEY, clientId);
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Parses the stored JSON, tolerating any corruption (empty outbox beats a bricked POS). */
function parseEntries(raw: string | null): PosOutboxEntry[] {
  if (raw === null || raw === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is PosOutboxEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PosOutboxEntry).offlineReceiptNo === "string" &&
        typeof (entry as PosOutboxEntry).terminalId === "string" &&
        typeof (entry as PosOutboxEntry).status === "string",
    );
  } catch {
    return [];
  }
}

/** Reads the outbox (oldest first — the drain order). */
export function readPosOutbox(): PosOutboxEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  return parseEntries(window.localStorage.getItem(POS_OUTBOX_KEY));
}

/** Writes the outbox back (same order semantics). */
export function writePosOutbox(entries: readonly PosOutboxEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(POS_OUTBOX_KEY, JSON.stringify(entries));
}

/** Replaces one entry by clientId (immutable-style update + persist). */
export function updatePosOutboxEntry(next: PosOutboxEntry): PosOutboxEntry[] {
  const entries = readPosOutbox().map((entry) => (entry.clientId === next.clientId ? next : entry));
  writePosOutbox(entries);
  return entries;
}

/** Reserves the next local OFF- number for a terminal: `OFF-{code}-{seq}`. */
export function nextOfflineReceiptNo(terminalCode: string): { offlineReceiptNo: string; clientId: string } {
  let seq = 1;
  if (typeof window !== "undefined") {
    const current = Number(window.localStorage.getItem(POS_OUTBOX_SEQ_KEY) ?? "0");
    seq = Number.isFinite(current) && current > 0 ? current + 1 : 1;
    window.localStorage.setItem(POS_OUTBOX_SEQ_KEY, String(seq));
  }
  return { offlineReceiptNo: `OFF-${terminalCode}-${seq}`, clientId: randomId() };
}
