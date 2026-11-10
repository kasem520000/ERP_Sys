/**
 * PHASE-021 · the desktop credential vault abstraction (T3; MASTER-PLAN §4;
 * SECURITY_AND_DEVICE_MANAGEMENT §3 — the credential-storage table):
 *
 * | Credential            | Storage        | Lifetime                     |
 * |-----------------------|----------------|------------------------------|
 * | Access token          | MEMORY ONLY    | 15 min, silent refresh       |
 * | Refresh token         | OS keychain    | one-time-use, rotating       |
 * | Device private key    | OS keychain    | lifetime of the registration |
 * | SQLite encryption key | OS keychain    | rotated only with re-encrypt |
 *
 * Rules (§3): **no secrets in SQLite** — the local DB carries business data
 * and cursors only; tokens/keys live exclusively in OS-protected storage.
 * The `Keychain` interface is the ONLY seam the desktop runtime programs
 * against, so every environment gets an implementation:
 *
 * - `MemoryKeychain` — unit tests + the browser parity path (the offline
 *   console in a plain browser has no OS keychain; credentials simply do
 *   not survive a reload there, which is the honest browser behavior);
 * - the shell bridge keychain (Windows Credential Manager via the Tauri
 *   plugin) lands with the W2 bridge contract — it implements this same
 *   interface, so everything downstream is implementation-blind.
 */

/** The credential-vault seam (SECURITY §3): namespaced get/set/delete over
 * OS-protected storage. Implementations MUST never persist to the local
 * database, logs, or preferences — the secret-scan test enforces it. */
export interface Keychain {
  /** Read one entry; null when absent. */
  get(name: string): Promise<string | null>;
  /** Write one entry (create or overwrite). */
  set(name: string, value: string): Promise<void>;
  /** Delete one entry (idempotent — deleting an absent entry is a no-op). */
  delete(name: string): Promise<void>;
}

/** The in-memory implementation: unit tests + browser parity (no OS
 * keychain in a plain browser — credentials are process-local there, the
 * honest degradation; the Tauri shell swaps in the bridge keychain). */
export class MemoryKeychain implements Keychain {
  private readonly entries = new Map<string, string>();

  async get(name: string): Promise<string | null> {
    return this.entries.get(name) ?? null;
  }

  async set(name: string, value: string): Promise<void> {
    this.entries.set(name, value);
  }

  async delete(name: string): Promise<void> {
    this.entries.delete(name);
  }
}

/** The namespaced keychain entry names for one device (MASTER-PLAN §4.2:
 * `erp.<deviceId>.{refreshToken|deviceKey|dbKey}`). */
export interface KeychainNames {
  readonly refreshToken: string;
  readonly deviceKey: string;
  readonly dbKey: string;
}

/** Build the keychain entry names for one enrolled device. The deviceId is
 * the server-assigned registration id — the namespace that keeps multiple
 * device registrations (a re-install is a NEW device, SECURITY §2.4) from
 * ever colliding in the vault. */
export function keychainNames(deviceId: string): KeychainNames {
  return {
    refreshToken: `erp.${deviceId}.refreshToken`,
    deviceKey: `erp.${deviceId}.deviceKey`,
    dbKey: `erp.${deviceId}.dbKey`,
  };
}
