# Conflict Resolution

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

Per-entity-type conflict policies for offline sync. Binding rule from
[ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md): **last-write-wins is forbidden
for financial data, stock, receipts, journals, prices, and tax rates.** Conflicts on
constrained data are decided by the server against server state; the client receives typed
rejections and acts. Automatic merging is limited to explicitly non-constrained fields.

## 1. Principles

1. **Classify, don't guess.** Every entity type has exactly one policy (§2). If a type is
   absent from the table, its policy is `SERVER_DECISION` (fail closed).
2. **The server decides against server state.** Validators run against current prices,
   stock, credit, period state, and partner status at execution time — never against the
   client's snapshot.
3. **Rejections are data, not errors.** A typed reason + machine-readable details + a
   resubmittable flag ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §3.4) — the UI converts them
   into specific user actions (§3).
4. **Local validation is advisory.** LOCALLY-VALIDATED operations may pass locally and
   still be rejected at sync; the UI never presents local validation as final
   ([OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md) §3, §5).
5. **Auditability.** Every merge, every server decision that overrides client intent, and
   every user resolution of a rejection writes an audit event (actor = device + user,
   before/after, correlation id).

## 2. Per-entity-type policy table (normative)

| Entity type | Policy | Mechanics | On conflict |
|-------------|--------|-----------|-------------|
| **Financial documents** (POS sales, invoices, credit notes, receipts, payments) | **SERVER_DECISION — never LWW** | Command executed via module service + posting engine; validation against open period (INV-011), current prices, available stock, partner credit limit, partner/item status; exactly-once per operation key (INV-013) | `REJECTED` with typed reason (§3); document returns to editable pending state on device; NO server-side auto-modification of amounts |
| **Prices / tax rates** | **SERVER_AUTHORITATIVE_SNAPSHOT** | Price lists and tax rates are pull-only on devices; a device never pushes a price. Stamped snapshots are stored on document lines at execution (ADR-0010 §1) | Client re-validates drafts against the fresh snapshot at pull; stale-priced drafts surface `PRICE_CHANGED` at push, user chooses (§3) |
| **Partner contact edits** (phone, email, address lines, contact person fields) | **FIELD_LEVEL_MERGE** (non-constrained fields only) | Last-editor-wins per field is permitted ONLY for fields with no financial constraint; merge happens server-side, writes audit event with field-level before/after | Constrained partner fields (credit limit, terms, tax registration, price-list binding, status) are SERVER_DECISION — offline edits of them are rejected |
| **Stock quantities** | **SERVER_DECISION with reservation semantics** | Server validates availability at execution; accepted commands consume stock atomically (issue + reserve paths per [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md) inventory); no offline device ever writes server stock directly | `INSUFFICIENT_STOCK` with current availability in `details`; POS/field user resolves at sync (§3) — overselling is impossible by construction |
| **Drafts** (DRAFT documents not yet submitted) | **OWNER_DEVICE_WINS** | A draft has exactly one owner device (§6). Only the owner's edits are pushed; other devices receive the updated draft via pull and see it read-only | No conflict exists by construction; if ownership is transferred (device loss), the transfer itself is a server-mediated, audited action |
| **Stock count lines** (POS-lite / field entry) | **SERVER_DECISION (aggregate)** | Counted quantities are facts, not mutations: the count document carries them; variance/adjustment is computed and posted on the server only ([../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §3) | Reject only for structural problems (inactive item, closed count session); quantity facts never silently re-merge |
| **Van stock load/unload** | **SERVER_DECISION** | Van movements replay against current van ledger; server rejects double-loads or unloads beyond current van quantity with `INSUFFICIENT_STOCK` | Rep resolves against actual van contents; server ledger stays authoritative |
| **Personal-account read models** | **READ_ONLY** | No local writes exist; staleness is resolved by pull alone | n/a |
| **Configuration / entitlements / roles** | **ONLINE_ONLY** | Never mirrored writable; permission snapshot is advisory cache ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §5) | Server rejects any attempted push with `FORBIDDEN` |

## 3. Rejection UX contract (typed reason → user action)

Each typed reason maps to a fixed set of user actions. The client UI must implement this
mapping exactly; "unknown reason" is not a valid UX state (registry fallback: show message
+ traceId + support hint, per [../api/ERROR_MODEL.md](../api/ERROR_MODEL.md) §5).

| Reason code | Meaning | Required user actions offered |
|-------------|---------|-------------------------------|
| `PERIOD_LOCKED` | Document date falls in a closed/locked period at sync time | **edit-and-resend** (change document date to an open period) · **cancel** (void the pending document, keep audit record) |
| `PRICE_CHANGED` | Line price differs from current server price beyond tolerance policy | **accept server price** (recompute totals locally, resend) · **edit-and-resend** (keep intended price if policy allows override) · **cancel** |
| `INSUFFICIENT_STOCK` | Available quantity < requested at execution | **edit-and-resend** (reduce qty / choose substitute) · **accept partial** (if the operation supports partial fulfillment policy) · **cancel** |
| `CREDIT_LIMIT_EXCEEDED` | Partner credit limit exceeded including this document | **edit-and-resend** (reduce amount / change terms) · **request approval path online** (collect prepayment via receipt) · **cancel** |
| `STALE_VERSION` | The command edited a row whose server version moved past `baseVersion` | **review-and-merge** (fetch fresh row, show field diff, user reconciles manually) · **discard local edit** (audited) |
| `ITEM_INACTIVE` / `PARTNER_INACTIVE` | Referenced master data was deactivated while offline | **cancel** · **substitute-and-resend** (choose active item/partner) |
| `VALIDATION_ERROR` | Structural/contract failure (missing line data, bad amount format) | **edit-and-resend** after fixing highlighted fields |
| `DEVICE_REVOKED` / `TENANT_SUSPENDED` | Device or tenant lost sync rights | No resubmission: surface administrative state, stop sync ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §3) |

Rules: rejected documents are **always editable again locally** (unless the reason is
administrative); resending produces a NEW command with a new `commandId` but the SAME
entity id and a fresh `idempotencyKey` when the payload changed; the original rejection
and every user choice are audit-logged with the `traceId` of the rejecting response.

## 4. Stale-version handling (optimistic concurrency on push)

1. Every mirrored server row carries an integer `version` advanced by the server on each
   change. Commands that EDIT server-known state (e.g., `update_draft` on a server-synced
   draft, or a field-merge partner edit) must carry `baseVersion` — the HTTP analogue of
   `If-Match` ([../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md) §8).
2. Server compares `baseVersion` with current version BEFORE executing: mismatch →
   `REJECTED / STALE_VERSION` with `details.currentVersion` and the current row snapshot.
   The push endpoint uses the item-result channel (not HTTP 409/412) because batches are
   per-item by design; plain REST edits outside sync use HTTP 412/409 per API conventions.
3. Version comparison is the ONLY freshness mechanism — never wall-clock timestamps.
4. Local-only rows (never synced) have no `baseVersion`; first push is an idempotent
   create-by-id upsert, which cannot conflict (new UUIDv7 id is globally unique).

## 5. Clock skew policy

1. **Client timestamps are advisory only.** `clientCreatedAt` is stored for audit and
   displayed as "created offline at (device time)" — it never gates acceptance, ordering,
   or expiry.
2. **Server time is authoritative for business dates.** Posting dates, document dates,
   and period validation use the server clock at execution; a POS sale recorded offline
   Saturday and pushed Tuesday keeps its business facts but is validated against Tuesday's
   server state (open period, active prices). Reconciliation rules per
   [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4.
3. **Sequences, not clocks.** Ordering in feeds (`change_log.seq`), outbox FIFO, and
   version numbers are monotonic counters immune to device clock jumps (manual changes,
   timezone travel, dead CMOS batteries on shop PCs).
4. Devices learn the server clock offset from `/sync/status` for DISPLAY purposes only
   ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §7); a device with skewed time never causes a
   server decision to change.

## 6. Multi-device same-entity draft rules

1. **One owner device per draft.** A draft created on a device is owned by that device
   until submitted or explicitly released. Other devices can VIEW the draft (after it has
   synced to the server at least once) but see it **read-only** with an "owned by
   <device/user>" badge.
2. Only the owner device pushes edits for that draft; the server rejects pushes from
   non-owner devices with `FORBIDDEN` (details: ownerDeviceId). This is a correctness
   rule, not a UX nicety — it eliminates multi-writer merge for documents entirely.
3. **Ownership transfer** is a server-mediated action (used when a device is lost or
   replaced): old device is revoked, an admin/user with `drafts.reassign` transfers
   ownership, the transfer is audited, and the new owner must pull the latest draft before
   editing.
4. Submitting the draft (online-only action) ends local editability everywhere; the draft
   enters the server lifecycle (DRAFT → PENDING_APPROVAL → …,
   [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §1).
5. The POS exception: an offline-completed POS sale is not a "draft" — it is a pending
   financial command owned by its terminal; no other device can touch it, and it
   reconciles at sync ([OFFLINE_CAPABILITIES_MATRIX.md](OFFLINE_CAPABILITIES_MATRIX.md)).

## 6.1 Worked example — two terminals, one item

```mermaid
sequenceDiagram
  participant T1 as POS terminal A (offline)
  participant T2 as POS terminal B (offline)
  participant S as Server
  Note over T1,T2: item X: server on-hand = 1
  T1->>T1: sale of last X → PENDING_SYNC (local stock 1→0)
  T2->>T2: sale of last X → PENDING_SYNC (its cache still shows 1)
  Note over T1,T2: connectivity returns; A pushes first
  T1->>S: push pos_sale (commandId c1)
  S->>S: stock available → ACCEPTED: issue stock, post invoice (INV-013 key)
  S-->>T1: ACCEPTED + invoice_no
  T2->>S: push pos_sale (commandId c2)
  S->>S: available = 0 → REJECTED INSUFFICIENT_STOCK (details.availableQty=0)
  S-->>T2: REJECTED → UI offers: substitute / partial / cancel (cash refund path)
  Note over T2: terminal B's drawer gets an over/short entry if cash was taken;<br/>resolution is an explicit, audited action — never a silent merge
```

This is the canonical "offline oversell" case: the platform guarantees the LEDGER and
STOCK stay exact; the business resolution (refund cash, substitute, backorder) stays a
human decision surfaced with full context.

## 6.2 Worked example — partner contact field merge with audit

Desktop edits a customer's phone offline; the accountant edits the same customer's email
online; both change the address line independently.

```jsonc
// Push result for the desktop command (intent: partner.contact.update)
{ "commandId": "0192…", "status": "ACCEPTED",
  "entity": { "id": "partner-…", "version": 21 },
  "merge": { "fieldsApplied": ["phone"],
             "fieldsIgnored": ["addressLine1"],     // server version newer at exec time
             "currentRow": { "addressLine1": "الرياض - حي العليا …" } } }
```

Server-side merge rule (per §2 "Partner contact edits"): apply the client's changed
non-constrained fields onto the CURRENT server row (not the client's base row); write an
audit event with field-level before/after and both actors; return the merged row so the
device replaces its stale copy. The user sees the address they did not change — honest,
explained, audited. Constrained fields in the same payload (e.g., an attempted credit-limit
change) are rejected independently (`FORBIDDEN`) without failing the merge of contact
fields — per-field results, not all-or-nothing.

## 7. Tolerance policies (configurable, documented)

| Policy knob | Default | Meaning |
|-------------|---------|---------|
| `priceTolerancePct` | 0% for POS; 2% configurable per tenant for field drafts | How far a pushed line price may sit from the current server price before `PRICE_CHANGED` (server always stamps the CURRENT price on the posted document) |
| `stockReservationWindow` | until command execution (no timed holds offline) | Offline commands reserve at execution, not creation — availability is computed then ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §3) |
| `creditCheckIncludePending` | ON | Server credit-limit checks include other devices' in-flight accepted documents — the offline device's local check can only approximate |

Tolerance changes are configuration, not policy changes: they never turn a SERVER_DECISION
row into LWW, and they are audited per change.

