import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { SYNC_CONTRACT_VERSION, type PullEnvelope, type PushItemResultV2 } from "@erp/contracts";

import type { SyncTransport } from "../../../../../../packages/sync-core/src/client";

import { assertExpoFileIntegrity, disposeExpoFiles, expoDeviceOnFile } from "./expo-device";

/**
 * PHASE-022 T-P22-3a · the KILL MATRIX on the EXPO store (MASTER-PLAN §9 —
 * BINDING: "Kill-matrix: reuse the desktop real-SIGKILL harness shape
 * against the mobile store process (boot/pre-commit/post-commit-pre-ack/
 * mid-pull) → WAL recovery, IN_FLIGHT→QUEUED, outbox intact, converges,
 * duplicate:true replays"; SYNC_TESTS §5 the field-sales phone's
 * battery/connectivity fault profiles — "mid-sync kills").
 *
 * Each scripted point spawns `_kill-child.ts` (a REAL android-field store
 * — `openFieldStore`, better-sqlite3, WAL, sync-core v1–3 + the mobile
 * field migrations v4/v5 — plus the real sync-core cycle over a scripted
 * transport whose server effects are durably recorded to a JSONL state
 * file, so the server survives the device's crash), watches the child's
 * stdout progress markers, SIGKILLs at the point's window, asserts the
 * process really died by signal, then REOPENS the same DB file in this
 * process:
 *
 *   1. WAL recovery: `integrity_check` ok;
 *   2. the boot `recoveryPass` flips IN_FLIGHT → QUEUED (the pre-commit
 *      point) and sees a consistent store (no quarantine);
 *   3. the outbox rows are ALL intact — exactly the child's commandIds,
 *      none lost, none duplicated;
 *   4. the `cursorCount` checksum matches the real cursors table;
 *   5. a full converging cycle (a scripted transport seeded from the
 *      surviving server state — replays return the ORIGINAL result with
 *      duplicate:true, fresh commands ACCEPT) → zero residue, every
 *      command ACKED;
 *   6. the inbox-dedupe posture: replaying the same commandIds again
 *      returns duplicate:true for every one (no second execution).
 *
 * CI posture (recorded, the desktop kill-matrix note): SIGKILL via
 * child.kill("SIGKILL") is exercised on Linux (the sandbox + the CI
 * runners). What the assertions prove is the STORE's durability, which is
 * platform-invariant SQLite WAL — the same engine expo-sqlite ships
 * on-device (the expo-device.ts honest cipher note applies here too).
 */

const API_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const CHILD_PATH = join(__dirname, "_kill-child.ts");
const DELAY_MS = 1500;
const COMMANDS = 6;
const ACCEPT_FIRST = 4;

interface KillPoint {
  readonly name: string;
  readonly delayAt: "boot" | "pre-commit" | "post-commit-pre-ack" | "mid-pull";
  /** The stdout marker that arms the kill window (string equality or regex). */
  readonly killOnMarker: RegExp;
  /** Markers that must have been seen before the kill (the window context). */
  readonly expectBefore: readonly RegExp[];
  /** IN_FLIGHT rows the post-reopen recoveryPass must requeue. */
  readonly expectRecoveredInFlight: number;
  /** The pre-kill honest outbox shape. */
  readonly expectStatuses:
    | { readonly kind: "all-in-flight" }
    | { readonly kind: "all-queued" }
    | { readonly kind: "all-acked" };
  /** Commands the converging cycle pushes (the post-commit point already
   * ACKED its accepts; every other point re-pushes all). */
  readonly expectConvergePushed: number;
  /** ACCEPTED results that are inbox replays (duplicate:true) in the
   * converging cycle. */
  readonly expectConvergeDuplicates: number;
}

const KILL_POINTS: readonly KillPoint[] = [
  {
    name: "pre-commit (server committed, response dropped)",
    delayAt: "pre-commit",
    killOnMarker: /^servercommitted:\d+$/,
    expectBefore: [/^booted$/, /^commands:/, /^queued$/, /^inflight:/],
    expectRecoveredInFlight: COMMANDS,
    expectStatuses: { kind: "all-in-flight" },
    expectConvergePushed: COMMANDS,
    expectConvergeDuplicates: ACCEPT_FIRST,
  },
  {
    name: "post-commit pre-ack (results applied, ack never sent)",
    delayAt: "post-commit-pre-ack",
    killOnMarker: /^pushed:\d+$/,
    expectBefore: [/^booted$/, /^commands:/, /^queued$/, /^inflight:/, /^servercommitted:/],
    expectRecoveredInFlight: 0,
    expectStatuses: { kind: "all-acked" },
    expectConvergePushed: 0,
    expectConvergeDuplicates: 0,
  },
  {
    name: "mid-pull (page 1 committed, page 2 in flight)",
    delayAt: "mid-pull",
    killOnMarker: /^pulling:items:2$/,
    expectBefore: [/^booted$/, /^commands:/, /^queued$/, /^pulling:items:1$/],
    expectRecoveredInFlight: 0,
    expectStatuses: { kind: "all-queued" },
    expectConvergePushed: COMMANDS,
    expectConvergeDuplicates: 0,
  },
  {
    name: "immediate-kill control (everything queued, nothing in flight)",
    delayAt: "boot",
    killOnMarker: /^queued$/,
    expectBefore: [/^booted$/, /^commands:/],
    expectRecoveredInFlight: 0,
    expectStatuses: { kind: "all-queued" },
    expectConvergePushed: COMMANDS,
    expectConvergeDuplicates: 0,
  },
];

interface ChildRun {
  readonly commandIds: string[];
  readonly serverState: Map<string, PushItemResultV2>;
}

/** Spawn the child, watch markers, SIGKILL at the point, return what the
 * parent needs (the commandIds + the surviving server-side effects). */
async function runAndKillAt(point: KillPoint, dbPath: string, statePath: string): Promise<ChildRun> {
  const child: ChildProcess = spawn(
    "pnpm",
    [
      "exec",
      "tsx",
      CHILD_PATH,
      "--db",
      dbPath,
      "--state",
      statePath,
      "--commands",
      String(COMMANDS),
      "--accept-first",
      String(ACCEPT_FIRST),
      "--delay-at",
      point.delayAt,
      "--delay-ms",
      String(DELAY_MS),
    ],
    { cwd: API_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  const seen: string[] = [];
  let commandIds: string[] = [];
  const stderr: string[] = [];
  let killed = false;
  const killAt = new Promise<void>((resolveKill, rejectKill) => {
    const stdout = createInterface({ input: child.stdout! });
    stdout.on("line", (line: string) => {
      if (line === "") return;
      seen.push(line);
      const commandsMatch = line.match(/^commands:(.*)$/);
      if (commandsMatch !== null) {
        commandIds = commandsMatch[1]!.split(",").filter((id) => id !== "");
      }
      if (!killed && point.killOnMarker.test(line)) {
        killed = true;
        // The window is armed: the child is sleeping DELAY_MS — kill it
        // NOW, mid-step, with a real SIGKILL.
        child.kill("SIGKILL");
        stdout.close();
        resolveKill();
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
    child.on("error", rejectKill);
    child.on("exit", (code, signal) => {
      // A child that dies BEFORE the armed window is a harness failure —
      // fail loudly with everything it said.
      if (!killed) {
        rejectKill(
          new Error(
            `kill-matrix child exited before the ${point.name} window (code=${String(code)}, signal=${String(signal)}): ` +
              `markers=[${seen.join(" | ")}] stderr=[${stderr.join("")}]`,
          ),
        );
      }
    });
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
    child.on("exit", (code, signal) => resolveExit({ code, signal }));
  });
  await killAt;
  const exit = await exited;

  // The process REALLY died by signal — not a graceful exit, not a crash
  // into some handler: SIGKILL, exactly the C-04 hard-crash semantics.
  expect(exit.code).toBeNull();
  expect(exit.signal).toBe("SIGKILL");
  // The context markers prove the kill landed inside the intended window.
  for (const before of point.expectBefore) {
    const markerSeen = seen.some((line) => before.test(line));
    expect(markerSeen, `marker ${String(before)} must precede the kill (saw: ${seen.join(" | ")})`).toBe(true);
  }
  expect(commandIds).toHaveLength(COMMANDS);
  if (stderr.length > 0) {
    throw new Error(`kill-matrix child wrote to stderr: ${stderr.join("")}`);
  }

  // The server-side effects that survived the crash (the JSONL state file
  // the child appended BEFORE the crash window).
  const serverState = new Map<string, PushItemResultV2>();
  for (const line of readFileSync(statePath, "utf8").split("\n")) {
    if (line === "") continue;
    const entry = JSON.parse(line) as { commandId: string; result: PushItemResultV2 };
    serverState.set(entry.commandId, entry.result);
  }
  return { commandIds, serverState };
}

/** The converging scripted transport: seeded with the surviving server
 * effects (replays return the ORIGINAL result + duplicate:true), accepts
 * everything else, serves the remaining items pages. */
class ConvergingTransport implements SyncTransport {
  constructor(private readonly serverState: Map<string, PushItemResultV2>) {}

  async status(): Promise<{ serverTime: string; contractVersion: string; device?: { revoked?: boolean } }> {
    return { serverTime: new Date().toISOString(), contractVersion: SYNC_CONTRACT_VERSION, device: { revoked: false } };
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    void limit;
    if (entityType !== "items") {
      return {
        entityType,
        cursor: cursor ?? "0",
        nextCursor: cursor ?? "0",
        hasMore: false,
        changes: [],
        serverTime: new Date().toISOString(),
        contractVersion: SYNC_CONTRACT_VERSION,
      };
    }
    const after = cursor === null ? 0 : Number(cursor);
    const page = after < 2 ? 1 : 2;
    const changes =
      page === 1
        ? [
            {
              id: "kill-matrix-item-1",
              seq: 1,
              op: "UPSERT" as const,
              payload: { id: "kill-matrix-item-1", sku: "KILL-1", name: "Kill Matrix Item 1", kind: "STOCK", status: "ACTIVE" },
              changedAt: "2026-11-04T00:00:00Z",
              version: 1,
            },
            {
              id: "kill-matrix-item-2",
              seq: 2,
              op: "UPSERT" as const,
              payload: { id: "kill-matrix-item-2", sku: "KILL-2", name: "Kill Matrix Item 2", kind: "STOCK", status: "ACTIVE" },
              changedAt: "2026-11-04T00:00:00Z",
              version: 1,
            },
          ]
        : [
            {
              id: "kill-matrix-item-3",
              seq: 3,
              op: "UPSERT" as const,
              payload: { id: "kill-matrix-item-3", sku: "KILL-3", name: "Kill Matrix Item 3", kind: "STOCK", status: "ACTIVE" },
              changedAt: "2026-11-04T00:00:00Z",
              version: 1,
            },
          ];
    const lastSeq = page === 1 ? 2 : 3;
    return {
      entityType: "items",
      cursor: String(lastSeq),
      nextCursor: String(lastSeq),
      hasMore: page === 1,
      changes,
      serverTime: new Date().toISOString(),
      contractVersion: SYNC_CONTRACT_VERSION,
    };
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<never> {
    void batchId;
    void commands;
    throw new Error("kill-matrix converging transport: legacy push is never served");
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    return request.commands.map((raw) => {
      const commandId = String(raw.commandId ?? raw.id ?? "");
      const idempotencyKey = String(raw.idempotencyKey ?? commandId);
      const original = this.serverState.get(commandId);
      if (original !== undefined) {
        // The server's inbox replay: the ORIGINAL result verbatim +
        // duplicate:true, zero new effects (C-01/C-04).
        return { ...original, duplicate: true };
      }
      const sequence = this.serverState.size + 1;
      const result: PushItemResultV2 = {
        id: commandId,
        commandId,
        status: "ACCEPTED",
        idempotencyKey,
        result: {
          officialNo: `RCV-KILL-${String(sequence).padStart(5, "0")}`,
          receiptId: commandId,
          status: "POSTED",
          journalEntryId: `je-kill-${commandId}`,
          replay: false,
        },
        officialNumber: `RCV-KILL-${String(sequence).padStart(5, "0")}`,
        entity: { id: String((raw.payload as { partnerId?: string } | undefined)?.partnerId ?? commandId), version: sequence },
        effects: { journalEntryIds: [`je-kill-${commandId}`] },
      };
      this.serverState.set(commandId, result);
      return result;
    });
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    void positions;
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    void commandIds;
  }
}

afterAll(() => {
  disposeExpoFiles();
});

describe("PHASE-022 kill matrix on the EXPO store — real SIGKILL crash windows (C-04 semantics; MASTER-PLAN §9)", () => {
  for (const point of KILL_POINTS) {
    it(`kill at ${point.name} → WAL recovers, outbox intact, re-converges, inbox dedupe holds`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "erp-expo-killmatrix-"));
      const dbPath = join(dir, "kill-matrix.db");
      const statePath = join(dir, "server-state.jsonl");

      // (1) Run the child to the armed window and SIGKILL it.
      const run = await runAndKillAt(point, dbPath, statePath);
      expect(run.commandIds).toHaveLength(COMMANDS);

      // (2) REOPEN the same DB file in THIS process (the REAL android-
      //     field store + the ReferenceDevice over it): the WAL recovers
      //     and the file passes integrity_check.
      // (held as the concrete instance so the replay call below is
      // non-optional — SyncTransport declares pushV2 optional)
      const converging = new ConvergingTransport(run.serverState);
      const ed = expoDeviceOnFile(dbPath, {
        transport: converging,
        seed: 0x1111,
      });
      assertExpoFileIntegrity(ed.store);

      // (3) The RAW post-crash state, read BEFORE any recovery pass: the
      //     crash window's honest on-disk shape. The outbox rows are ALL
      //     intact — exactly the child's commandIds, none lost, none
      //     duplicated.
      const rawRows = ed.store.all("SELECT command_id, status FROM outbox");
      expect(rawRows).toHaveLength(COMMANDS);
      const rawIds = rawRows.map((row) => String(row.command_id)).sort();
      expect(rawIds).toEqual([...run.commandIds].sort());
      const duplicatedIds = rawIds.filter((id, index) => rawIds.indexOf(id) !== index);
      expect(duplicatedIds).toHaveLength(0);
      const rawStatuses = rawRows.map((row) => String(row.status));
      if (point.expectStatuses.kind === "all-in-flight") {
        for (const status of rawStatuses) expect(status).toBe("IN_FLIGHT");
      } else if (point.expectStatuses.kind === "all-queued") {
        for (const status of rawStatuses) expect(status).toBe("QUEUED");
      } else {
        for (const status of rawStatuses) expect(status).toBe("ACKED");
      }
      if (point.delayAt === "mid-pull") {
        // Page 1 committed before the kill: the items cursor sits at seq 2
        // + the two page-1 rows are in the mobile cache.
        expect(ed.store.all("SELECT id FROM items")).toHaveLength(2);
      }
      if (point.delayAt === "post-commit-pre-ack") {
        // The child's whole push completed before the ack window: every
        // command carries its official number in the FILE already.
        for (const row of ed.store.all("SELECT official_no FROM outbox")) {
          expect(String(row.official_no)).toMatch(/^RCV-KILL-/);
        }
      }

      // (4) The boot recoveryPass: IN_FLIGHT → QUEUED at the pre-commit
      //     point (then ALL rows are re-pushable on disk); a consistent
      //     store everywhere (never quarantined).
      const recovery = ed.recover();
      expect(recovery.recoveredInFlight).toBe(point.expectRecoveredInFlight);
      expect(recovery.integrity).toBe("ok");
      if (point.expectRecoveredInFlight > 0) {
        // The flip landed on disk: every previously-IN_FLIGHT row is now
        // QUEUED (the re-push reads them), none lost.
        for (const row of ed.store.all("SELECT status FROM outbox")) {
          expect(String(row.status)).toBe("QUEUED");
        }
      }

      // (5) The cursorCount checksum matches the real cursors table.
      const cursorCount = Number(
        ed.store.get("SELECT value FROM meta WHERE key = 'cursorCount'")?.value ?? "0",
      );
      expect(ed.store.all("SELECT entity_type FROM cursors")).toHaveLength(cursorCount);

      // (6) The converging cycle: zero residue — every command drains to
      //     ACKED (the server-state replays + the fresh accepts).
      const outcome = await ed.device.cycle();
      expect(outcome.pushed).toBe(point.expectConvergePushed);
      expect(outcome.accepted).toBe(point.expectConvergePushed);
      expect(outcome.duplicates).toBe(point.expectConvergeDuplicates);
      expect(outcome.rejected).toBe(0);
      expect(outcome.deferred).toBe(0);
      const finalRows = ed.store.all("SELECT command_id, status, official_no FROM outbox");
      expect(finalRows).toHaveLength(COMMANDS);
      for (const row of finalRows) {
        expect(String(row.status)).toBe("ACKED");
        expect(String(row.official_no)).toMatch(/^RCV-KILL-/);
      }
      // The pull side converged too: all three feed rows present in the
      // mobile items cache.
      expect(ed.store.all("SELECT id FROM items")).toHaveLength(3);
      // And the store stays consistent for the next boot.
      const recoveryAfter = ed.recover();
      expect(recoveryAfter.integrity).toBe("ok");
      expect(recoveryAfter.recoveredInFlight).toBe(0);

      // (7) The inbox-dedupe posture: replaying the same commandIds
      // returns duplicate:true for EVERY one (the ORIGINAL results —
      // no second execution).
      const envelopes = run.commandIds.map((commandId) => {
        const row = ed.store.get("SELECT payload FROM outbox WHERE command_id = ?", [commandId]);
        return JSON.parse(String(row!.payload)) as Record<string, unknown>;
      });
      const replay = await converging.pushV2({
        contractVersion: SYNC_CONTRACT_VERSION,
        commands: envelopes,
      });
      expect(replay).toHaveLength(COMMANDS);
      for (const item of replay) {
        expect(item.status).toBe("ACCEPTED");
        expect(item.duplicate).toBe(true);
      }
      ed.dispose();
    }, 30_000);
  }
});
