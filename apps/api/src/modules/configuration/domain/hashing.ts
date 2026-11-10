import { createHash } from "node:crypto";

/**
 * Deterministic content hashing for the resolution engine
 * (CONFIGURATION_ENGINE §1 principle 2, §5, §10 #2).
 *
 * `@erp/contracts` `hashManifestJson` hashes MANIFESTS and must stay
 * isomorphic (no node:crypto — it ships to browsers). The API side is
 * Node-only, so this helper reuses the same canonical-JSON approach
 * (recursively key-sorted, no whitespace) with node:crypto's SHA-256 —
 * byte-identical results for identical content, whatever key order the
 * inputs were authored in.
 */

/** Recursively copy `value` with every object's keys sorted (canonical form). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical JSON: recursively key-sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Deterministic content hash — `sha256:<hex>` over the canonical JSON.
 * Same input ⇒ same hash; different key order ⇒ same hash; different
 * content ⇒ different hash (the golden-fixture CI pin relies on this).
 */
export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
