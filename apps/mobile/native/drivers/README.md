# native/drivers — device implementations of the src/ ports

Planned drivers (PHASE-022 §2 layout; each implements the matching port
interface declared under [`apps/mobile/src/`](../../src) — tests always inject
fakes, EAS builds bring these):

| Driver | Port (src/) | Device implementation |
|---|---|---|
| `sqlite.ts` | `store/driver-port.ts` → `SqliteDriverPort` | expo-sqlite + SQLCipher key from SecureStore (WAL ON, `integrity_check` on boot) |
| `secure-store.ts` | `device/secure-store-port.ts` → `SecureStorePort` | expo-secure-store (Android Keystore): refresh token, device private key, DB key |
| `unlock.ts` | `auth/unlock.ts` → `UnlockPort` | expo-local-authentication (biometric optional + PIN fallback) |
| `trust.ts` | `device/trust.ts` → `TrustSignalsPort` | best-effort rooted/tamper detection → `devices.trustFlags` (never brick, D-07) |
| `notifications.ts` + `fcm.ts` | `notifications/` | expo-notifications + FCM token registration (opt-in, default OFF) |
| `background-scheduler.ts` | `sync/` host | expo-background-fetch + expo-task-manager (≤ 15 min OS-scheduled, Doze-aware) |
| `barcode-scanner.ts` | `fieldsales/` scan port | camera scanner (tests: fake port) |

Rules (DR-P22-01): drivers import the port interfaces + `@erp/mobile`
internals and expo modules — never the other way around; no business logic
lives here; nothing in this dir is exercised by the vitest suites.
