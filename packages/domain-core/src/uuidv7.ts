import { DomainError } from "./errors";

/**
 * UUIDv7 identity generator per ADR-0004: time-ordered, database- and
 * index-friendly identifiers for entities and documents.
 *
 * Layout (RFC 9562): 48-bit unix_ts_ms | ver=7 | 12-bit intra-ms counter |
 * var=10 | 62 random bits. Uniqueness across processes comes from the 62
 * random bits; strict monotonicity within one process within one millisecond
 * comes from the counter (skeleton guarantee tested here; a database-side
 * monotonic sequence for document *numbers* is a later phase).
 */

/** Exceeded 4096 ids in the same millisecond (12-bit counter exhausted). */
export class Uuidv7OverflowError extends DomainError {
  constructor() {
    super(
      "domain/uuidv7-overflow",
      "UUIDv7 intra-millisecond counter exhausted (4096 ids/ms per process)",
    );
  }
}

const COUNTER_MAX = 0x0fff; // 12 bits

let lastTimestampMs = -1;
let counter = 0;

function randomFill(bytes: Uint8Array<ArrayBuffer>): void {
  // globalThis.crypto is available in Node >= 19 and in all browsers.
  // PHASE-046 (W-4 — the prepared-environment repair, honestly recorded):
  // the parameter is pinned to Uint8Array<ArrayBuffer> — the exact type of
  // the sole allocation site (`new Uint8Array(8)`) and the intersection of
  // every ambient getRandomValues signature (the modern @types/node
  // ArrayBufferLike-tolerant webcrypto shape AND the stricter shape an
  // ambient @types/node 14 chain can win in packages without a direct
  // @types/node dependency — the fresh-sandbox turbo cache surfaced the
  // latent fragility; the previous environment's typecheck evidence for
  // this file rode a cache replay). Zero runtime change.
  globalThis.crypto.getRandomValues(bytes);
}

function hex(value: number | bigint, width: number): string {
  return value.toString(16).padStart(width, "0");
}

export function generateUuidV7(): string {
  const timestampMs = Date.now();
  if (timestampMs === lastTimestampMs) {
    if (counter === COUNTER_MAX) {
      throw new Uuidv7OverflowError();
    }
    counter += 1;
  } else {
    lastTimestampMs = timestampMs;
    counter = 0;
  }

  const ts = BigInt(timestampMs);

  const rand = new Uint8Array(8);
  randomFill(rand);
  // variant: top two bits = 10
  const variantByte = (rand[0] ?? 0) & 0x3f;

  return (
    // time_low: top 32 bits of the 48-bit unix_ts_ms
    hex((ts >> 16n) & 0xffffffffn, 8) +
    "-" +
    // time_mid: low 16 bits of unix_ts_ms
    hex(ts & 0xffffn, 4) +
    "-7" + // version nibble + start of rand_a (counter)
    hex(counter, 3) +
    "-" +
    hex(0x80 | variantByte, 2) +
    hex((rand[1] ?? 0) & 0xff, 2) +
    "-" +
    (rand[2] ?? 0).toString(16).padStart(2, "0") +
    (rand[3] ?? 0).toString(16).padStart(2, "0") +
    (rand[4] ?? 0).toString(16).padStart(2, "0") +
    (rand[5] ?? 0).toString(16).padStart(2, "0") +
    (rand[6] ?? 0).toString(16).padStart(2, "0") +
    (rand[7] ?? 0).toString(16).padStart(2, "0")
  );
}

/** Test-only: reset the intra-ms counter state. */
export function __resetUuidv7ForTests(): void {
  lastTimestampMs = -1;
  counter = 0;
}
