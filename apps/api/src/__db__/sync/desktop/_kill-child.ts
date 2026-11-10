import { appendFileSync, writeFileSync } from "node:fs";

import { openDesktopStore, recoveryPass, type DesktopStore } from "@erp/desktop";
import { SYNC_CONTRACT_VERSION, type PullEnvelope, type PushItemResultV2 } from "@erp/contracts";

import { enqueue } from "../../../../../../packages/sync-core/src/outbox/engine";
import { runCycle } from "../../../../../../packages/sync-core/src/cycle";
import { SyncClient, type SyncTransport } from "../../../../../../packages/sync-core/src/client";
import { buildSyncCommandV2 } from "../../../../../../packages/sync-core/src/commands/builders";

/**
 * PHASE-021 T13/3-a · the kill-matrix CHILD (MASTER-PLAN §9 "Kill-matrix
 * (T9 hook)": "spawn a real child Node process running a push cycle
 * against a file DB; SIGKILL at scripted points"). A standalone tsx
 * script (spawned by kill-matrix.spec.ts via `pnpm exec tsx`): opens a
 * REAL desktop store at `--db`, enqueues `--commands` v2 commands
 * (buildSyncCommandV2 + the real outbox engine), then runs ONE full
 * cycle through a scripted transport whose responses are deterministic
 * from the args (`--accept-first K` ACCEPTED, the rest DEFERRED — never
 * executed), with durable "server-side effects" appended to the
 * `--state` JSONL file (the server survives the device's crash) and a
 * delay at the scripted point so the parent can SIGKILL mid-step.
 *
 * Progress markers (one per line on stdout — the parent's kill triggers):
 *   booted                       store open + migrated (v1–5)
 *   commands:<id,id,…>           the queued commandIds (deterministic)
 *   queued                       all N rows QUEUED
 *   [boot delay]                 --delay-at boot: sleep before the cycle
 *   pulling:items:1              items feed page 1 served
 *   [mid-pull delay]             --delay-at mid-pull: sleep inside page 2
 *   pulling:items:2              items feed page 2 being served
 *   inflight:<id,id,…>           the push batch entered (rows IN_FLIGHT)
 *   servercommitted:<k>          the K accepts recorded to the state file
 *   [pre-commit delay]           --delay-at pre-commit: sleep BEFORE the
 *                                response returns (the crash window: the
 *                                server committed, the device never saw it)
 *   pushed:<n>                   results applied locally (ACKED rows)
 *   [post-commit-pre-ack delay]  --delay-at post-commit-pre-ack: sleep
 *                                inside pushAck (committed locally, ack
 *                                never sent)
 *   acked                        the pushAck call returned
 *   done                         the cycle completed without a kill
 *
 * The windows map 1:1 onto SYNC_TESTS C-04's crash semantics — driven
 * here through REAL process kills instead of simulated drops.
 */

interface ChildArgs {
  db: string;
  state: string;
  commands: number;
  acceptFirst: number;
  delayAt: "boot" | "pre-commit" | "post-commit-pre-ack" | "mid-pull";
  delayMs: number;
}

function parseArgs(argv: readonly string[]): ChildArgs {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (name === undefined || !name.startsWith("--")) {
      throw new Error(`_kill-child: expected a --flag at position ${index} (got ${String(name)})`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`_kill-child: flag ${name} needs a value`);
    }
    flags.set(name.slice(2), value);
  }
  const db = flags.get("db");
  if (db === undefined || db === "") {
    throw new Error("_kill-child: --db <file> is required");
  }
  const state = flags.get("state");
  if (state === undefined || state === "") {
    throw new Error("_kill-child: --state <file> is required");
  }
  const delayAt = (flags.get("delay-at") ?? "boot") as ChildArgs["delayAt"];
  if (!["boot", "pre-commit", "post-commit-pre-ack", "mid-pull"].includes(delayAt)) {
    throw new Error(`_kill-child: unknown --delay-at ${String(delayAt)}`);
  }
  return {
    db,
    state,
    commands: Number(flags.get("commands") ?? 6),
    acceptFirst: Number(flags.get("accept-first") ?? 6),
    delayAt,
    delayMs: Number(flags.get("delay-ms") ?? 1500),
  };
}

function say(marker: string): void {
  process.stdout.write(`${marker}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The deterministic items feed: page 1 = two UPSERTs, page 2 = one —
 * the mid-pull window sits between them. */
function itemsPage(cursor: string | null): PullEnvelope {
  const after = cursor === null ? 0 : Number(cursor);
  if (after < 2) {
    return {
      entityType: "items",
      cursor: "2",
      nextCursor: "2",
      hasMore: true,
      changes: [
        {
          id: "kill-matrix-item-1",
          seq: 1,
          op: "UPSERT",
          payload: { id: "kill-matrix-item-1", sku: "KILL-1", name: "Kill Matrix Item 1", kind: "STOCK", status: "ACTIVE" },
          changedAt: "2026-11-04T00:00:00Z",
          version: 1,
        },
        {
          id: "kill-matrix-item-2",
          seq: 2,
          op: "UPSERT",
          payload: { id: "kill-matrix-item-2", sku: "KILL-2", name: "Kill Matrix Item 2", kind: "STOCK", status: "ACTIVE" },
          changedAt: "2026-11-04T00:00:00Z",
          version: 1,
        },
      ],
      serverTime: new Date().toISOString(),
      contractVersion: SYNC_CONTRACT_VERSION,
    };
  }
  return {
    entityType: "items",
    cursor: "3",
    nextCursor: "3",
    hasMore: false,
    changes: [
      {
        id: "kill-matrix-item-3",
        seq: 3,
        op: "UPSERT",
        payload: { id: "kill-matrix-item-3", sku: "KILL-3", name: "Kill Matrix Item 3", kind: "STOCK", status: "ACTIVE" },
        changedAt: "2026-11-04T00:00:00Z",
        version: 1,
      },
    ],
    serverTime: new Date().toISOString(),
    contractVersion: SYNC_CONTRACT_VERSION,
  };
}

/** The scripted server transport. The first `acceptFirst` commands
 * ACCEPT (their results durably recorded to the state file BEFORE any
 * sleep — the server's committed effects survive the crash); the rest
 * DEFERRED (never executed, never recorded — retried by the converging
 * cycle). */
class KillMatrixTransport implements SyncTransport {
  private itemsPulls = 0;

  constructor(
    private readonly opts: ChildArgs,
    private readonly serverEffects: (commandId: string, result: PushItemResultV2) => void,
  ) {}

  async status(): Promise<{ serverTime: string; contractVersion: string; device?: { revoked?: boolean } }> {
    return { serverTime: new Date().toISOString(), contractVersion: SYNC_CONTRACT_VERSION, device: { revoked: false } };
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    void limit;
    if (entityType !== "items") {
      // Every other feed entity: an honest empty page (cursor advances).
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
    this.itemsPulls += 1;
    say(`pulling:items:${this.itemsPulls}`);
    if (this.itemsPulls === 2 && this.opts.delayAt === "mid-pull") {
      // The mid-pull crash window: page 2 is being served when the
      // process dies — page 1 is already applied + cursor advanced.
      await sleep(this.opts.delayMs);
    }
    return itemsPage(cursor);
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<never> {
    void batchId;
    void commands;
    throw new Error("kill-matrix child: the v2 transport never serves the legacy push");
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    const ids = request.commands.map((raw) => String(raw.commandId ?? raw.id ?? ""));
    say(`inflight:${ids.join(",")}`);
    const results: PushItemResultV2[] = [];
    let accepted = 0;
    for (let index = 0; index < request.commands.length; index += 1) {
      const raw = request.commands[index]!;
      const commandId = ids[index]!;
      const idempotencyKey = String(raw.idempotencyKey ?? commandId);
      if (index < this.opts.acceptFirst) {
        accepted += 1;
        const sequence = index + 1;
        const result: PushItemResultV2 = {
          id: commandId,
          commandId,
          status: "ACCEPTED",
          idempotencyKey,
          result: {
            officialNo: `POS-KILL-${String(sequence).padStart(5, "0")}`,
            invoiceId: commandId,
            journalEntryId: `je-kill-${commandId}`,
            replay: false,
          },
          officialNumber: `POS-KILL-${String(sequence).padStart(5, "0")}`,
          entity: { id: String((raw.payload as { partnerId?: string } | undefined)?.partnerId ?? commandId), version: sequence },
          effects: { journalEntryIds: [`je-kill-${commandId}`] },
        };
        // The durable server-side effect (the inbox row): recorded BEFORE
        // any sleep — a replay of this commandId must return the ORIGINAL
        // result with duplicate:true, exactly like the real server.
        this.serverEffects(commandId, result);
        results.push(result);
      } else {
        results.push({
          id: commandId,
          commandId,
          status: "DEFERRED",
          idempotencyKey,
          reason: "RATE_LIMITED",
          message: "kill-matrix scripted defer (not executed, not recorded)",
        });
      }
    }
    say(`servercommitted:${accepted}`);
    if (this.opts.delayAt === "pre-commit") {
      // The C-04 crash window: the server COMMITTED (effects recorded)
      // but the response is dropped — the device dies mid-sleep with the
      // rows still IN_FLIGHT.
      await sleep(this.opts.delayMs);
    }
    return results;
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    void positions;
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    say(`pushed:${commandIds.length}`);
    if (this.opts.delayAt === "post-commit-pre-ack") {
      // The post-commit pre-ack window: results already applied locally
      // (ACKED rows committed), the ack itself never sent.
      await sleep(this.opts.delayMs);
    }
    say("acked");
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  // A fresh state file per run (the parent seeds its converging transport
  // from whatever survived the kill).
  writeFileSync(opts.state, "");

  const store: DesktopStore = openDesktopStore({ path: opts.db });
  say("booted");

  const commandIds: string[] = [];
  store.transaction(() => {
    for (let n = 1; n <= opts.commands; n += 1) {
      const command = buildSyncCommandV2({
        entityType: "partner",
        intent: "contact_merge",
        payload: { partnerId: `kill-matrix-partner-${n}`, phone: `+96650000000${n}` },
        idempotencyKey: `kill-matrix:${n}`,
      });
      enqueue(store, {
        entityType: command.entityType,
        intent: command.intent,
        payload: command as unknown as Record<string, unknown>,
        idempotencyKey: command.idempotencyKey,
        commandId: command.commandId,
      });
      commandIds.push(command.commandId);
    }
  });
  say(`commands:${commandIds.join(",")}`);
  say("queued");

  if (opts.delayAt === "boot") {
    // The immediate-kill control: everything queued, nothing in flight.
    await sleep(opts.delayMs);
  }

  const transport = new KillMatrixTransport(opts, (commandId, result) => {
    appendFileSync(opts.state, `${JSON.stringify({ commandId, result })}\n`);
  });
  const client = new SyncClient(store, transport);
  const outcome = await runCycle(client);
  // A clean exit (no kill): print the honest outcome for the parent's
  // no-kill sanity — the kill scenarios never reach this line.
  say(`done:pushed=${outcome.pushed},accepted=${outcome.accepted},duplicates=${outcome.duplicates}`);
  const recovery = recoveryPass(store);
  say(`recovered:${recovery.recoveredInFlight}`);
  store.close();
}

main().catch((error) => {
  process.stderr.write(`_kill-child failed: ${String(error)}\n`);
  process.exit(1);
});
