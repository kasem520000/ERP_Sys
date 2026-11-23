/**
 * PHASE-050 (W-26 — T-07, 2026-11-23) THE CAPA LIFECYCLE FOLD — the PURE
 * layer first (the unit-first law, the plan §4's own unit list: "the
 * NCR/CAPA lifecycle folds (the closure gates' refusal shapes)" — the
 * CAPA half of the pair W-25 opened). The fold encodes BR-103's
 * effectiveness gate exactly as the 0114 floor stamps it — never a
 * parallel machine: the DB CHECKs (ck_capa_records_close_gate ·
 * ck_capa_records_journal_gated) remain the authority; this fold is the
 * service's own decision surface so the typed refusals carry their
 * reasons BEFORE the DB floor ever fires.
 *
 *   THE LADDER (the 0114 status vocabulary): OPEN → IN_PROGRESS → CLOSED.
 *   The root-cause act IS the start act (the declared W-26
 *   interpretation): recording the root-cause analysis moves OPEN →
 *   IN_PROGRESS in the same CAS (the investigation's own move — the
 *   analysis begins the working life); at IN_PROGRESS the act re-records
 *   (the analysis evolved — root_cause_at refreshed, the honest stamp of
 *   its last revision). The actions act records at OPEN and IN_PROGRESS
 *   both (the plan can be drafted before or after the analysis); the
 *   external-cost act exists ONLY at IN_PROGRESS (the 0114 stamp gate:
 *   the G-63 journal exists only at IN_PROGRESS/CLOSED — a cost never
 *   lands on an unstarted record) and is SINGLE-USE (the fold's
 *   hasCostStamp cell — INV-013's sibling discipline).
 *
 *   BR-103's GATE (D-10, the binding wording): "a CAPA cannot close
 *   before its actions' due dates pass AND the effectiveness check is
 *   recorded — the typed refusal carrying the open action/due-date
 *   figures." TWO conditions, exactly:
 *   (1) every OPEN action's window has elapsed — an open action with NO
 *       due date BLOCKS (no declared window can never prove its passage
 *       — the fail-closed direction) and an open action with a FUTURE
 *       due date BLOCKS (the window has not passed); a COMPLETED action
 *       never blocks and an open action whose due date has elapsed does
 *       not (the effectiveness check records what actually happened —
 *       the refusal carries the open action/due-date figures);
 *   (2) the effectiveness check is RECORDED — the payload lands with the
 *       close CAS (the 0114 floor's own shape: CLOSED requires
 *       effectiveness non-null together with closed_at). The record's
 *       OUTCOME is the tenant's honest evidence — D-10 demands the CHECK
 *       RECORDED, never a forced "effective" verdict (the wave README's
 *       interpretation table).
 *
 *   The clock never enters: the fold carries day-values only — the
 *   SERVICE passes `today` (the ncr-service's own pinned-clock
 *   discipline; a date comparison, never a Date.now()+delta arming).
 */

export type CapaStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

/** The closed result vocabulary (0114's ck_capa_records_status). */
export const CAPA_STATUSES: readonly CapaStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED"];

/** The lifecycle moves the service exposes (one guarded CAS each — the
 * 0105 stamp-law shape the 0114 floor stamps). */
export type CapaMove = "root_cause" | "actions" | "external_cost" | "close";

/** The refusal shapes (the fold's own verdict vocabulary — each maps to
 * exactly one typed error in quality-errors.ts, never a raw string). */
export type CapaMoveRefusal =
  /** Any move on a CLOSED record — the register is evidence. */
  | "ALREADY_CLOSED"
  /** The root_cause/close/external_cost acts on an OPEN record — the
   * working life has not started (the root-cause act IS the start). */
  | "NOT_STARTED"
  /** The external-cost act on a record that already carries its G-63
   * stamp — the single-use law (INV-013's sibling). */
  | "COST_ALREADY_RECORDED";

export interface CapaMoveVerdict {
  allowed: boolean;
  refusal?: CapaMoveRefusal;
  /** The refusal's reason line (carried to the typed error verbatim). */
  reason?: string;
}

/**
 * THE ACTIONS ARRAY'S CANONICAL SHAPE (0114's jsonb column family — the
 * twelve-table budget has no capa_actions child; the fold owns the
 * shape's law so the DB never sees a malformed array): each action
 * carries a title (1…500), the optional owner (a uuid), the optional due
 * date (an ISO day-value), and the optional completion stamp (an ISO
 * datetime). The stored array uses these camelCase keys verbatim — the
 * jsonb is opaque to the DB, canonical for the API surface.
 */
export interface CapaAction {
  readonly title: string;
  readonly ownerEmployeeId: string | null;
  readonly dueDate: string | null;
  readonly completedAt: string | null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}(T| )\d{2}:\d{2}/;

/**
 * The array's shape law (the band-shape fold's sibling): a raw value is
 * either the canonical array or refused WITH the offending index and
 * field — the service's typed QualityInputInvalidError carries the
 * verdict. nulls are explicit (an absent owner/due-date/completion is a
 * legal, honest cell).
 */
export function capaActionsValid(
  raw: readonly unknown[],
): { ok: true; actions: CapaAction[] } | { ok: false; reason: string } {
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: `actions[${index}] must be an object` };
    }
    const action = value as Record<string, unknown>;
    if (typeof action.title !== "string" || action.title.length < 1 || action.title.length > 500) {
      return { ok: false, reason: `actions[${index}].title is required (1…500 chars)` };
    }
    const owner = action.ownerEmployeeId ?? null;
    if (typeof owner === "string" && !UUID_RE.test(owner)) {
      return {
        ok: false,
        reason: `actions[${index}].ownerEmployeeId must be a uuid: ${owner}`,
      };
    }
    const due = action.dueDate ?? null;
    if (typeof due === "string" && !DAY_RE.test(due)) {
      return { ok: false, reason: `actions[${index}].dueDate must be an ISO date (YYYY-MM-DD)` };
    }
    const done = action.completedAt ?? null;
    if (typeof done === "string" && !STAMP_RE.test(done)) {
      return {
        ok: false,
        reason: `actions[${index}].completedAt must be an ISO datetime`,
      };
    }
  }
  return {
    ok: true,
    actions: raw.map((value) => {
      const action = value as Record<string, unknown>;
      return {
        title: action.title as string,
        ownerEmployeeId: (action.ownerEmployeeId ?? null) as string | null,
        dueDate: (action.dueDate ?? null) as string | null,
        completedAt: (action.completedAt ?? null) as string | null,
      };
    }),
  };
}

/**
 * The lifecycle verdict for a move from a state. The matrix is TOTAL —
 * every status × move cell is decided; the property test walks the full
 * grid. The `hasCostStamp` witness (the record's journal_entry_id
 * non-null) decides the external_cost cell's single-use half — the NCR
 * fold's status-only shape does not carry it because the CAPA's G-63
 * stamp does not move the status.
 */
export function nextCapaMove(
  status: CapaStatus,
  move: CapaMove,
  witness?: { hasCostStamp: boolean },
): CapaMoveVerdict {
  if (status === "CLOSED") {
    return {
      allowed: false,
      refusal: "ALREADY_CLOSED",
      reason: "the record is CLOSED — the register is evidence, no move reopens it",
    };
  }
  if (move === "root_cause" || move === "actions") {
    // The plan and the analysis live on the working record — OPEN and
    // IN_PROGRESS both; the root-cause CAS flips OPEN to IN_PROGRESS.
    return { allowed: true };
  }
  if (move === "external_cost") {
    if (status === "OPEN") {
      return {
        allowed: false,
        refusal: "NOT_STARTED",
        reason:
          "the G-63 cost lands on the working record — record the root cause first (the 0114 stamp gate: the journal exists only at IN_PROGRESS/CLOSED)",
      };
    }
    if (witness?.hasCostStamp === true) {
      return {
        allowed: false,
        refusal: "COST_ALREADY_RECORDED",
        reason: "the G-63 stamp is single-use — the record already carries its external cost",
      };
    }
    return { allowed: true };
  }
  // move === "close"
  if (status === "OPEN") {
    return {
      allowed: false,
      refusal: "NOT_STARTED",
      reason: "a CAPA closes from IN_PROGRESS — record the root cause and start the work first",
    };
  }
  return { allowed: true };
}

/** BR-103's gate refusals (the close act's own typed vocabulary). */
export type CapaGateRefusal = "ACTIONS_PENDING" | "EFFECTIVENESS_REQUIRED";

export interface CapaGateVerdict {
  allowed: boolean;
  refusal?: CapaGateRefusal;
  /** ACTIONS_PENDING's own figures (D-10: "the open action/due-date
   * figures") — the counts the refusal carries. */
  figures?: {
    openActionCount: number;
    pendingCount: number;
    /** The blocking due dates (the future ones + a null for each
     * undated blocker), the refusal's own evidence. */
    pendingDueDates: (string | null)[];
  };
}

/**
 * BR-103's effectiveness gate (D-10's two conditions, exactly) — the
 * close act's own fold. The actions array is the record's canonical
 * shape (capaActionsValid's output); `today` is a day-value the service
 * passes; `effectiveness` is the check payload (any non-null object is
 * the recorded check — the 0114 floor's jsonb shape; the OUTCOME is the
 * tenant's honest evidence, never a forced verdict — the wave README's
 * interpretation table).
 */
export function capaCloseGate(input: {
  actions: readonly CapaAction[];
  effectiveness: unknown;
  today: string;
}): CapaGateVerdict {
  const open = input.actions.filter((action) => action.completedAt === null);
  const pendingDueDates: (string | null)[] = [];
  for (const action of open) {
    // An undated open action can never prove its window passed
    // (fail-closed); a future-dated one has not passed it yet.
    if (action.dueDate === null || action.dueDate > input.today) {
      pendingDueDates.push(action.dueDate);
    }
  }
  if (pendingDueDates.length > 0) {
    return {
      allowed: false,
      refusal: "ACTIONS_PENDING",
      figures: {
        openActionCount: open.length,
        pendingCount: pendingDueDates.length,
        pendingDueDates,
      },
    };
  }
  if (input.effectiveness === null || input.effectiveness === undefined) {
    return { allowed: false, refusal: "EFFECTIVENESS_REQUIRED" };
  }
  return { allowed: true };
}
