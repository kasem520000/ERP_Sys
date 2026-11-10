/**
 * PHASE-021 T9 · crash telemetry: redaction + the crash-free-session counter
 * (MASTER-PLAN §1 item 9 / §7; FAILURE_RECOVERY §3; SECURITY_AND_DEVICE_
 * MANAGEMENT "no secrets in logs"): every event/log line leaving the shell
 * is redacted (tokens, keys, Authorization headers, DSNs, file paths), and
 * the rolling per-device crash-free rate feeds the updater's staged-rollout
 * gates (updater/rollout — CRASH_FREE_GATES). Counters live in memory;
 * persistence/upload is the host's concern.
 *
 * What stays vs. goes (documented): TENANT IDS STAY — they are routing
 * tags, not secrets (the error tracker's tenant tag, MONITORING §1); token
 * VALUES, key material, Authorization headers, DSNs, and file paths are
 * replaced — a leak in a crash payload must never carry credentials.
 */

import { crashFreeRate, type CrashFreeMetrics } from "../updater/rollout";

/** Secret-bearing KEY names whose VALUES are always replaced (normalized:
 * camelCase / snake_case / kebab-case / spaces all collapse — refreshToken,
 * refresh_token, REFRESH-TOKEN … match). Tenant ids are NOT in this list. */
export const SECRET_KEY_NAMES: ReadonlySet<string> = new Set([
  "refreshtoken",
  "accesstoken",
  "dbkey",
  "devicekey",
  "authorization",
]);

export const REDACTED_VALUE = "[REDACTED]";

/** Free-text redaction patterns (log lines, message strings, URLs) — applied
 * in order by redactText and to every string VALUE inside redactEvent. */
export const REDACT_PATTERNS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    name: "bearer-token",
    pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g,
    replacement: "Bearer [REDACTED]",
  },
  {
    name: "db-dsn",
    pattern: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/)[^\s"'<>]+/g,
    replacement: "$1[REDACTED]",
  },
  {
    name: "url-query-secret",
    pattern: /([?&](?:access_token|refresh_token|token|api_key|apikey|secret|client_secret|signature)=)[^&\s"'<>]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    name: "posix-path",
    pattern: /(^|[\s"'(=,:[])(\/(?:home|Users|root|var|tmp|etc|mnt|opt|srv|data|private)\/[^\s"')\]]+)/g,
    replacement: "$1<path>",
  },
  {
    name: "windows-path",
    pattern: /(^|[\s"'(=,:[])([A-Za-z]:[\\/][^\s"')\]]+)/g,
    replacement: "$1<path>",
  },
];

/** Redact a single text value (log line / message string): bearer tokens,
 * database DSNs, token-bearing URL query params, and absolute file paths
 * (POSIX + Windows) are replaced. URLs themselves survive unless they carry
 * secrets in the query string. */
export function redactText(text: string): string {
  let output = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_NAMES.has(key.toLowerCase().replace(/[-_\s]/g, ""));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown): unknown {
  if (isPlainObject(value)) return redactObject(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "string") return redactText(value);
  return value;
}

function redactObject(event: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    // A secret-named key loses its ENTIRE value, whatever the shape.
    output[key] = isSecretKey(key) ? REDACTED_VALUE : redactValue(value);
  }
  return output;
}

/**
 * Deep-clone + redact a telemetry event. NEVER mutates the input (the clone
 * is structural — structuredClone — so nested objects/arrays are copies).
 * Secret-named keys are wholesale replaced; every nested string value runs
 * through redactText; tenant ids and other routing tags pass through
 * untouched. Non-plain containers (Map/Set/etc.) are preserved as cloned —
 * documented: only plain-object trees are walked.
 */
export function redactEvent(event: Record<string, unknown>): Record<string, unknown> {
  return redactObject(structuredClone(event));
}

// -- crash-free sessions (feeds the rollout gates) -----------------------------

interface SessionRecord {
  readonly startedAt: number;
  crashed: boolean;
}

/**
 * Rolling per-device session counters: `sessionStart` on app start,
 * `reportCrash` marks the device's latest session as crashed, and
 * `metrics`/`rate` compute the trailing-window crash-free rate that feeds
 * evaluateStageTransition. In-memory only (persistence is the host's
 * concern); queries roll the window — records older than the queried
 * window are pruned, so long-lived hosts don't grow without bound.
 */
export class CrashFreeSessions {
  readonly #sessions = new Map<string, SessionRecord[]>();

  /** Record a session start for a device (defaults to now). */
  sessionStart(deviceId: string, at: number = Date.now()): void {
    const records = this.#sessions.get(deviceId) ?? [];
    records.push({ startedAt: at, crashed: false });
    this.#sessions.set(deviceId, records);
  }

  /**
   * Mark the device's LATEST session as crashed (a crash belongs to the
   * session it killed). An orphan crash with no recorded session is ignored
   * — honestly recorded here: pre-telemetry startup crashes are the host's
   * bootstrapping concern, not a phantom session.
   */
  reportCrash(deviceId: string, _at: number = Date.now()): void {
    const records = this.#sessions.get(deviceId);
    if (records === undefined || records.length === 0) return;
    let target = records.length - 1;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (!records[index]!.crashed) {
        target = index;
        break;
      }
    }
    records[target]!.crashed = true;
  }

  /**
   * Trailing-window metrics (default 24 h — the gate window): sessions
   * STARTED within the window, and how many of those never crashed.
   * Records aged out of the window are pruned (rolling counter).
   */
  metrics(windowMs: number = 24 * 60 * 60 * 1000, now: number = Date.now()): CrashFreeMetrics {
    const cutoff = now - windowMs;
    let sessions = 0;
    let crashFreeSessions = 0;
    for (const [deviceId, records] of this.#sessions) {
      const kept = records.filter((record) => {
        if (record.startedAt >= cutoff) {
          sessions += 1;
          if (!record.crashed) crashFreeSessions += 1;
          return true;
        }
        return false;
      });
      if (kept.length === 0) this.#sessions.delete(deviceId);
      else this.#sessions.set(deviceId, kept);
    }
    return { sessions, crashFreeSessions };
  }

  /** The trailing-window crash-free rate (null when no sessions — the
   * dashboard's empty-window case; never a misleading 0). */
  rate(windowMs: number = 24 * 60 * 60 * 1000, now: number = Date.now()): number | null {
    return crashFreeRate(this.metrics(windowMs, now));
  }
}
