/**
 * PHASE-022 · the mobile credential vault port (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §3 — the credential
 * storage table, the Android Keystore rules): the `@erp/desktop`
 * `auth/keychain.ts` port applied to the Android runtime. The
 * `SecureStorePort` interface is the ONLY seam the mobile auth/device
 * code programs against, so every environment gets an implementation:
 *
 * | Credential            | Storage                     | Lifetime                    |
 * |-----------------------|-----------------------------|-----------------------------|
 * | Access token          | MEMORY ONLY (session.ts)    | 15 min, silent refresh      |
 * | Refresh token         | SecureStorePort (Keystore)  | one-time-use, rotating      |
 * | Device private key    | SecureStorePort (Keystore)  | lifetime of the registration|
 * | Device public key     | SecureStorePort (Keystore)  | lifetime of the registration|
 * | SQLite encryption key | SecureStorePort (Keystore)  | rotated only with re-encrypt|
 *
 * Rules (§3, verbatim commitments): **no secrets in SQLite** — the local
 * DB carries business data and cursors only; tokens/keys live
 * exclusively in OS-protected storage (expo-secure-store / Android
 * Keystore on device). Implementations MUST never persist to the local
 * database, logs, or preferences — the auth suite's SECRET-SCAN test
 * enforces it (apps/mobile/__tests__/auth.test.ts).
 *
 * Implementations:
 * - **Device** (`apps/mobile/native/drivers/secure-store.ts`):
 *   `expo-secure-store` — `getItem`→`SecureStore.getItemAsync(key)`,
 *   `setItem`→`setItemAsync(key, value)` (authentication prompt NEVER —
 *   the app gate owns the biometric unlock, unlock.ts; `keychainService`
 *   pinned so Android Keystore-backed entries never sync to cloud
 *   backups), `deleteItem`→`deleteItemAsync(key)` (idempotent).
 * - **Tests + harness**: {@link MemorySecureStore} below (the desktop
 *   `MemoryKeychain` pattern — an in-process Map; credentials never
 *   leave the test run).
 *
 * ASYNC ON PURPOSE (the desktop keychain is async too — the seam is
 * I/O-shaped on every platform; only the store layer is synchronous).
 */

/**
 * The credential-vault seam (SECURITY §3): namespaced
 * getItem/setItem/deleteItem over OS-protected storage.
 */
export interface SecureStorePort {
  /** Read one entry; null when absent. */
  getItem(name: string): Promise<string | null>;
  /** Write one entry (create or overwrite). */
  setItem(name: string, value: string): Promise<void>;
  /** Delete one entry (idempotent — deleting an absent entry is a no-op). */
  deleteItem(name: string): Promise<void>;
}

/**
 * The in-memory implementation: unit tests + the Node harness (the
 * desktop `MemoryKeychain` port). Process-local — the honest behavior
 * for any host without an OS keystore.
 */
export class MemorySecureStore implements SecureStorePort {
  private readonly entries = new Map<string, string>();

  async getItem(name: string): Promise<string | null> {
    return this.entries.get(name) ?? null;
  }

  async setItem(name: string, value: string): Promise<void> {
    this.entries.set(name, value);
  }

  async deleteItem(name: string): Promise<void> {
    this.entries.delete(name);
  }

  /** The honest test/harness probe: every entry as a plain record —
   * the SECRET-SCAN's scan surface (never shipped to the device). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }
}

/** The fixed entry holding the ACTIVE device's server-assigned id (the
 * deviceId namespaces every other entry; a reinstall enrolls a NEW
 * device — SECURITY §2.4 — so one active id per install at a time). */
export const ACTIVE_DEVICE_ID_KEY = "erp.activeDeviceId" as const;

/** The namespaced SecureStore entry names for one enrolled device (the
 * desktop `keychainNames` port: `erp.<deviceId>.<credential>` — the
 * namespace keeps a re-install's fresh registration from ever colliding
 * with purged credentials in the vault). */
export interface SecureStoreNames {
  /** The rotating one-time-use refresh token (refresh.ts owns it). */
  readonly refreshToken: string;
  /** The Ed25519 device PRIVATE key (crypto-port material; never in
   * SQLite, never in logs — signs attestation nonces + future
   * re-challenges). */
  readonly devicePrivateKey: string;
  /** The device PUBLIC key record (the base64 registered with the
   * server — the identifying half, mirror of the desktop deviceKey). */
  readonly deviceKey: string;
  /** The SQLCipher DB key (the DEVICE store bootstrap owns writing it;
   * listed here so the namespace is the single source of truth). */
  readonly dbKey: string;
}

/** Build the SecureStore entry names for one enrolled device. */
export function secureStoreNames(deviceId: string): SecureStoreNames {
  return {
    refreshToken: `erp.${deviceId}.refreshToken`,
    devicePrivateKey: `erp.${deviceId}.devicePrivateKey`,
    deviceKey: `erp.${deviceId}.deviceKey`,
    dbKey: `erp.${deviceId}.dbKey`,
  };
}
