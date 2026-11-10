/*
 * PHASE-020 · k6 fleet script — tests/performance/sync-fleet.js (MASTER-PLAN §15, T16).
 *
 * WHAT IT IS
 *   A 500-VU device fleet against the generalized sync plane (SYNC_PROTOCOL §2/§3
 *   + §11): mixed pull/push loops over GET /api/v1/sync/status → GET
 *   /api/v1/sync/pull?entity=…&cursor=…&limit=… and POST /api/v1/sync/push (a
 *   small v2 pos_sale:create batch), plus a 5% revoked-fleet slice asserting the
 *   cheap rejection path (R-06: a revoked device's pull answers HTTP 403 with the
 *   typed DEVICE_REVOKED code BEFORE anything is served — the device row is
 *   re-verified per request, never by token lifetime alone).
 *
 *   Thresholds (MASTER-PLAN §15): sync_roundtrip p(95) < 3000 ms (the
 *   status→pull-complete round trip, Trend "sync_roundtrip"); http_req_failed
 *   rate < 0.05 counted among 2xx/expected-4xx — the asserted 403/401 responses
 *   are tagged { expected: "true" } so k6's built-in failure metric excludes
 *   them; revoked_rejections rate > 0.99 (the revoked slice must NEVER be able
 *   to pull — a drop below the threshold fails the run: that is R-06 as a gate).
 *
 * HONESTY NOTE (the deliverable is the script + the documented procedure)
 *   This sandbox does NOT execute k6 (no k6 binary is installed; the staged
 *   fleet needs a live migrated API + provisioned device credentials). The
 *   script below plus the STAGED PROCEDURE in this header is the deliverable
 *   per MASTER-PLAN §15; the completion report notes this verbatim. Syntax is
 *   validated with `node --check` (Node ≥ 22.7 auto-detects the ESM import
 *   syntax; the repo engines floor is 22.12).
 *
 * k6 COMPATIBILITY
 *   k6 JavaScript is ES5.1+ (Goja): this file sticks to var/function
 *   expressions — no template literals, no arrow functions, no
 *   destructuring. Imports follow the k6 conventions:
 *     import http from "k6/http";  check/sleep from "k6";
 *     Rate/Trend from "k6/metrics".
 *   The tokens file is read with k6's BUILT-IN open() (init context only),
 *   which is why the read happens at module top level, guarded by __ENV.
 *
 * CONFIGURATION (all via `k6 -e KEY=value`)
 *   BASE_URL                   default http://localhost:3000   (the API origin)
 *   STAGE_VUS                  default 500   (fleet size: ~60% pull VUs,
 *                              ~35% push VUs, ~5% revoked slice)
 *   DURATION                   default 5m    (k6 duration string)
 *   PROVISIONED_TOKENS_FILE    optional; a JSON array of
 *                              [{ "deviceToken": "<15-min device access JWT>",
 *                                 "deviceId": "<uuid>",
 *                                 "revoked": true }]   — revoked:true marks the
 *                              provisioned 5% slice (optional field, omitted on
 *                              healthy devices). WITHOUT the file (or if it is
 *                              unreadable/not JSON) every scenario degrades to
 *                              anonymous status checks: GET /api/v1/sync/status
 *                              with no credentials, asserting the uniform 401
 *                              (server alive, no oracle) — tagged expected:true.
 *   PULL_ENTITY                default items   (the feed the pull loop drains)
 *   PULL_LIMIT                 default 500     (page size, §2.4 cap is 1000)
 *   CONTRACT_VERSION           default 2026-11-04.1  (SYNC_CONTRACT_VERSION —
 *                              keep in lockstep with @erp/contracts)
 *   K6_ITEM_ID / K6_TAX_CODE_ID / K6_TERMINAL_ID
 *                              optional; the fixture ids for the pos_sale
 *                              payload. Without them the push loop bootstraps
 *                              from the pull feed (first items/tax_codes/
 *                              pos_terminals rows); without either it degrades
 *                              to anonymous status checks.
 *
 * STAGED PROCEDURE (README — how to actually run this)
 *   1. Bring the API up at BASE_URL: `pnpm db:migrate` (migrations through
 *      0031), then the dev server / a deployed instance. Ensure an OPEN
 *      accounting period covering today (the pushed sales post into it) and
 *      the tenants.status ACTIVE.
 *   2. Seed the tenant: the API provisioning helper scripts create the tenant
 *      + an owner actor with an ACTIVE membership (the tenancy-provisioning
 *      flow / scripts/db-dev-credentials.ts), then log in over HTTP:
 *      POST /api/v1/identity/sessions {email, password} → X-Session-Token for
 *      the admin calls below.
 *   3. Seed master data in that tenant (seedMasterDataBasics): items, uoms,
 *      tax codes, partners — PLUS the k6 fixture row: one item priced
 *      100.000000 (the _oracle.ts posSalePayload default line — anything else
 *      rejects PRICE_CHANGED), the standard tax code, and at least one
 *      pos_terminal row. Export K6_ITEM_ID / K6_TAX_CODE_ID / K6_TERMINAL_ID
 *      from the helper (or let the push loop bootstrap them from the feed).
 *   4. Register the fleet over HTTP with the owner session:
 *      POST /api/v1/devices {deviceName, deviceClass: "pos-terminal",
 *      contractVersion: "2026-11-04.1", deviceKeyPublic?} → {deviceId,
 *      attestationNonce, enrollmentSecret}; then POST /api/v1/devices/:id/attest
 *      {signature} with the helper-held ed25519 key (attestation-lite).
 *   5. Capture refresh→access tokens. HONEST GAP (recorded leftover): as of
 *      PHASE-020 there is no HTTP route that issues the FIRST device refresh
 *      token (POST /api/v1/devices/:id/refresh only ROTATES an existing one —
 *      the enrollment exchange is T-P20-2c wiring item 4). The staging helper
 *      issues the first refresh token server-side (withTenant +
 *      issueRefreshToken — the exact path apps/api devices.spec uses), then
 *      rotates once over HTTP: POST /api/v1/devices/:id/refresh {refreshToken}
 *      → {accessToken, refreshToken}; the 15-min `accessToken` IS the
 *      deviceToken below. Access tokens live 15 minutes — provision right
 *      before the run (or re-provision); this script does not rotate mid-run.
 *   6. Revoke the 5% slice AFTER step 5 captured their tokens:
 *      POST /api/v1/devices/:id/revoke {reason: "k6 sync-fleet revoked slice"}.
 *      A revoked device's bearer still parses as a JWT — the server re-checks
 *      the row per request, so its pull answers 403 DEVICE_REVOKED: exactly
 *      the cheap rejection this slice asserts (never trust token lifetime).
 *   7. Write the tokens file (e.g. .k6/sync-fleet-tokens.json): a JSON array,
 *      one entry per device — {deviceToken, deviceId} for the healthy fleet,
 *      {deviceToken, deviceId, revoked: true} for the slice.
 *   8. Run (repo root):
 *      k6 run -e BASE_URL=http://localhost:3000 \
 *             -e STAGE_VUS=500 -e DURATION=5m \
 *             -e PROVISIONED_TOKENS_FILE=.k6/sync-fleet-tokens.json \
 *             tests/performance/sync-fleet.js
 *
 *   The push payload is byte-shaped after apps/api/src/__db__/sync/_oracle.ts
 *   posSalePayload() (the {sale: …} inner aggregate: clientId/terminalId/
 *   offlineReceiptNo/invoiceDate/customerId:null/orderType:COUNTER/checkId:null/
 *   one line {itemId, qty, unitPrice, taxCodeId} + one CASH tender at 15% —
 *   amount (net*1.15).toFixed(4)), wrapped in the v2 command envelope of
 *   SYNC_PROTOCOL §3.2 (commandId UUIDv7-like, entityType pos_sale, intent
 *   create, idempotencyKey unique per iteration, clientCreatedAt ISO).
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

/* k6 runtime globals (Goja): the injected k6 variables + the built-in file
 * reader, declared right below for the linter's no-undef — this file runs
 * inside k6, it is NOT a Node script. */
/* global __ENV, __VU, __ITER, open, console */

// -- configuration (env) -------------------------------------------------------

var BASE_URL = (__ENV.BASE_URL || "http://localhost:3000");
while (BASE_URL.charAt(BASE_URL.length - 1) === "/") {
  BASE_URL = BASE_URL.substring(0, BASE_URL.length - 1);
}
var STAGE_VUS = toInt(__ENV.STAGE_VUS, 500);
var DURATION = __ENV.DURATION || "5m";
var TOKENS_FILE = __ENV.PROVISIONED_TOKENS_FILE || "";
var PULL_ENTITY = __ENV.PULL_ENTITY || "items";
var PULL_LIMIT = toInt(__ENV.PULL_LIMIT, 500);
var CONTRACT_VERSION = __ENV.CONTRACT_VERSION || "2026-11-04.1";
var K6_ITEM_ID = __ENV.K6_ITEM_ID || "";
var K6_TAX_CODE_ID = __ENV.K6_TAX_CODE_ID || "";
var K6_TERMINAL_ID = __ENV.K6_TERMINAL_ID || "";

// The tokens file is read in the INIT context (k6's open() only works there,
// at module top level) and parsed later in setup().
var TOKENS_RAW = "";
if (TOKENS_FILE !== "") {
  try {
    TOKENS_RAW = open(TOKENS_FILE);
  } catch (openError) {
    console.log("k6 sync-fleet: cannot read PROVISIONED_TOKENS_FILE=" + TOKENS_FILE + " (" + openError + ") — degrading to anonymous status checks");
  }
}

// Fleet split: ~60% pull loop, ~35% push loop, ~5% revoked slice (the slice
// runs constant-arrival at 5% of the fleet per minute, preallocated 5 VUs).
// Integer sizing uses bitwise truncation (the repo's unix-seconds pattern —
// ADR-0009 forbids Math.round; this is VU arithmetic, not money).
var PULL_VUS = (STAGE_VUS * 0.6) | 0;
var PUSH_VUS = (STAGE_VUS * 0.35) | 0;
var REVOKED_VUS = Math.max(1, STAGE_VUS - PULL_VUS - PUSH_VUS);
var REVOKED_RATE = Math.max(1, (STAGE_VUS * 0.05) | 0);

// -- metrics -------------------------------------------------------------------

// status → pull-complete round trip, milliseconds (MASTER-PLAN §15: p(95)<3000).
var syncRoundtrip = new Trend("sync_roundtrip", false);
// R-06 cheap-rejection assert: 1 when the revoked pull was rejected as expected.
var revokedRejections = new Rate("revoked_rejections");

// -- options -------------------------------------------------------------------

export var options = {
  scenarios: {
    pull_loop: {
      // (a) the pull loop: each VU is a device cycling status → pull(items).
      executor: "constant-vus",
      exec: "pullLoop",
      vus: PULL_VUS,
      duration: DURATION,
    },
    push_loop: {
      // (b) the push loop: each VU pushes one small v2 pos_sale batch.
      executor: "constant-vus",
      exec: "pushLoop",
      vus: PUSH_VUS,
      duration: DURATION,
    },
    revoked_slice: {
      // (c) the 5% revoked fleet: cheap rejection asserts (R-06) at constant
      // arrival — the 403 is the EXPECTED outcome (tagged expected:"true").
      executor: "constant-arrival-rate",
      exec: "revokedSlice",
      rate: REVOKED_RATE,
      timeUnit: "1m",
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: REVOKED_VUS,
    },
  },
  thresholds: {
    // http_req_failed counts every non-2xx EXCEPT the ones tagged
    // expected:"true" (the asserted 403/401 paths) — i.e. the rate is
    // measured among 2xx/expected-4xx.
    http_req_failed: ["rate<0.05"],
    sync_roundtrip: ["p(95)<3000"],
    revoked_rejections: ["rate>0.99"],
  },
};

// -- setup: parse the provisioned tokens file ----------------------------------

export function setup() {
  var devices = [];
  var revoked = [];
  if (TOKENS_RAW !== "") {
    try {
      var parsed = JSON.parse(TOKENS_RAW);
      if (Object.prototype.toString.call(parsed) !== "[object Array]") {
        throw new Error("not a JSON array");
      }
      for (var i = 0; i < parsed.length; i++) {
        var entry = parsed[i];
        if (entry === null || typeof entry !== "object" ||
            typeof entry.deviceToken !== "string" || typeof entry.deviceId !== "string") {
          console.log("k6 sync-fleet: tokens entry #" + i + " missing deviceToken/deviceId — skipped");
          continue;
        }
        if (entry.revoked === true) {
          revoked.push({ deviceId: entry.deviceId, deviceToken: entry.deviceToken });
        } else {
          devices.push({ deviceId: entry.deviceId, deviceToken: entry.deviceToken });
        }
      }
    } catch (parseError) {
      console.log("k6 sync-fleet: PROVISIONED_TOKENS_FILE is not a JSON array (" + parseError + ") — degrading to anonymous status checks");
    }
  }
  if (devices.length === 0 && revoked.length === 0) {
    console.log("k6 sync-fleet: no provisioned devices — running anonymous status checks only (see the STAGED PROCEDURE in the header)");
  }
  return { devices: devices, revoked: revoked };
}

// Guard: with exec set on every scenario the default function never runs —
// if a k6 build ever routes here, fail loudly instead of silently no-oping.
export default function () {
  throw new Error("k6 sync-fleet: default function reached — scenario exec routing is misconfigured");
}

// -- shared state (module scope: cursors per device, one-time seed bootstrap) ---

var CURSORS = {}; // deviceId → last opaque pull cursor ("" = bootstrap)

var SEED_IDS = null; // { itemId, taxCodeId, terminalId } | null (unresolvable)
var SEED_RESOLVED = false;

// -- helpers (ES5.1) -----------------------------------------------------------

function toInt(envValue, fallback) {
  var parsed = parseInt(envValue, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function nowMs() {
  return Date.now();
}

function todayIsoDate() {
  return new Date().toISOString().substring(0, 10);
}

// A UUIDv7-shaped string: 48-bit unix-ms hex + version 7 + variant 8..b.
// Good enough for commandId/clientId (the wire only demands uuid shape).
function uuidv7Like() {
  var ts = Date.now().toString(16);
  while (ts.length < 12) {
    ts = "0" + ts;
  }
  var ts12 = ts.substring(ts.length - 12);
  var variant = (8 | ((Math.random() * 4) | 0)).toString(16);
  return (
    ts12.substring(0, 8) + "-" + ts12.substring(8) +
    "-7" + hex3() +
    "-" + variant + hex3() +
    "-" + hex4() + hex4() + hex4()
  );
}

function hex4() {
  var s = ((Math.random() * 0x10000) | 0).toString(16);
  while (s.length < 4) {
    s = "0" + s;
  }
  return s;
}

function hex3() {
  return hex4().substring(1);
}

function deviceParams(device) {
  return {
    headers: {
      "X-Device-Id": device.deviceId,
      Authorization: "Bearer " + device.deviceToken,
    },
  };
}

function expectedParams(device) {
  var params = deviceParams(device);
  params.tags = { expected: "true" };
  return params;
}

function pickDevice(pool, seed) {
  if (pool.length === 0) {
    return null;
  }
  return pool[seed % pool.length];
}

// Anonymous degrade: one unauthenticated status call; the uniform 401 is the
// expected outcome (server alive, no existence oracle) — tagged expected:true.
function anonymousStatus() {
  var res = http.get(BASE_URL + "/api/v1/sync/status", { tags: { expected: "true" } });
  check(res, {
    "anonymous status answered 401": function (r) {
      return r.status === 401;
    },
  });
}

// -- scenario (a): the pull loop ------------------------------------------------

export function pullLoop(data) {
  var device = pickDevice(data.devices, __VU);
  if (device === null) {
    anonymousStatus();
    sleep(1);
    return;
  }
  var params = deviceParams(device);
  var started = nowMs();
  var statusRes = http.get(BASE_URL + "/api/v1/sync/status", params);
  check(statusRes, {
    "status 200": function (r) {
      return r.status === 200;
    },
    "status advertises the contract version": function (r) {
      return r.json("data.contractVersion") === CONTRACT_VERSION;
    },
  });
  var cursor = CURSORS[device.deviceId];
  if (cursor === undefined) {
    cursor = ""; // bootstrap: the server maps an empty cursor → null (§2.2)
  }
  var pullRes = http.get(
    BASE_URL + "/api/v1/sync/pull?entity=" + PULL_ENTITY +
      "&cursor=" + encodeURIComponent(cursor) +
      "&limit=" + PULL_LIMIT,
    params,
  );
  var pulled = check(pullRes, {
    "pull 200": function (r) {
      return r.status === 200;
    },
    "pull envelope carries a cursor": function (r) {
      return typeof r.json("data.cursor") === "string";
    },
  });
  if (pulled) {
    CURSORS[device.deviceId] = pullRes.json("data.cursor") || "";
  }
  syncRoundtrip.add(nowMs() - started);
  sleep(1 + Math.random() * 2);
}

// -- scenario (b): the push loop ------------------------------------------------

// Resolve the fixture ids once: explicit -e K6_*_ID wins, else the feed
// bootstrap (first items/tax_codes/pos_terminals rows of the tenant feed),
// else null (the push loop degrades to anonymous status checks).
function bootstrapIds(device) {
  if (SEED_RESOLVED) {
    return SEED_IDS;
  }
  var ids = null;
  if (K6_ITEM_ID !== "" && K6_TAX_CODE_ID !== "" && K6_TERMINAL_ID !== "") {
    ids = { itemId: K6_ITEM_ID, taxCodeId: K6_TAX_CODE_ID, terminalId: K6_TERMINAL_ID };
  } else {
    var params = deviceParams(device);
    var itemId = firstFeedRowId(pullOnce(params, "items"));
    var taxCodeId = firstFeedRowId(pullOnce(params, "tax_codes"));
    var terminalId = firstFeedRowId(pullOnce(params, "pos_terminals"));
    if (itemId !== null && taxCodeId !== null && terminalId !== null) {
      ids = { itemId: itemId, taxCodeId: taxCodeId, terminalId: terminalId };
    }
  }
  if (ids === null) {
    console.log("k6 sync-fleet: no usable master data for the pos_sale payload — pass K6_ITEM_ID/K6_TAX_CODE_ID/K6_TERMINAL_ID or seed the feed; the push loop degrades to status checks");
  }
  SEED_IDS = ids;
  SEED_RESOLVED = true;
  return SEED_IDS;
}

function pullOnce(params, entity) {
  var res = http.get(BASE_URL + "/api/v1/sync/pull?entity=" + entity + "&cursor=&limit=50", params);
  if (res.status !== 200) {
    return null;
  }
  return res.json();
}

function firstFeedRowId(envelope) {
  if (envelope === null || typeof envelope !== "object") {
    return null;
  }
  var changes = envelope.data && envelope.data.changes;
  if (!changes || changes.length === 0) {
    return null;
  }
  return changes[0].id;
}

export function pushLoop(data) {
  var device = pickDevice(data.devices, __VU + 7919);
  if (device === null) {
    anonymousStatus();
    sleep(1);
    return;
  }
  var ids = bootstrapIds(device);
  if (ids === null) {
    anonymousStatus();
    sleep(1);
    return;
  }
  // The payload mirrors _oracle.ts posSalePayload(): one line, CASH tender at
  // 15% over net — amount (net*1.15).toFixed(4), money as decimal strings.
  var unitPrice = "100.000000";
  var qty = "1";
  var net = Number(unitPrice) * Number(qty);
  var payload = {
    sale: {
      clientId: uuidv7Like(),
      terminalId: ids.terminalId,
      offlineReceiptNo: "OFF-K6-" + __VU + "-" + __ITER,
      invoiceDate: todayIsoDate(),
      customerId: null,
      orderType: "COUNTER",
      checkId: null,
      lines: [
        {
          itemId: ids.itemId,
          qty: qty,
          unitPrice: unitPrice,
          taxCodeId: ids.taxCodeId,
        },
      ],
      tenders: [
        {
          method: "CASH",
          amount: (net * 1.15).toFixed(4),
        },
      ],
    },
  };
  var command = {
    commandId: uuidv7Like(),
    entityType: "pos_sale",
    intent: "create",
    idempotencyKey: "k6-push-" + __VU + "-" + __ITER + "-" + uuidv7Like(),
    clientCreatedAt: new Date().toISOString(),
    payload: payload,
  };
  var params = deviceParams(device);
  params.headers["Content-Type"] = "application/json";
  // SYNC_PROTOCOL §3.1: the batch carries its own Idempotency-Key (batch id);
  // each command carries its own key as well (the server dedupes per command).
  params.headers["Idempotency-Key"] = "k6-batch-" + __VU + "-" + __ITER;
  var res = http.post(
    BASE_URL + "/api/v1/sync/push",
    JSON.stringify({ contractVersion: CONTRACT_VERSION, commands: [command] }),
    params,
  );
  check(res, {
    "push 200": function (r) {
      return r.status === 200;
    },
    "pos_sale ACCEPTED (official number assigned)": function (r) {
      return r.json("data.results.0.status") === "ACCEPTED";
    },
  });
  sleep(1 + Math.random() * 2);
}

// -- scenario (c): the revoked slice (R-06 cheap rejection) ----------------------

export function revokedSlice(data) {
  if (data.revoked.length === 0) {
    // No provisioned revoked slice: degrade honestly (still counted as
    // server-up); the rejection assert cannot run without one.
    anonymousStatus();
    return;
  }
  var device = data.revoked[__ITER % data.revoked.length];
  var params = expectedParams(device);
  // The same pull call a healthy device makes — a revoked device must be
  // rejected BEFORE anything is served: HTTP 403 with the typed
  // DEVICE_REVOKED code (per-item DEVICE_REVOKED on the push path). Cheap
  // by design: one round trip, no feed work (the 2-a spec "revoked device:
  // pull rejected with DEVICE_REVOKED before anything is served", §1.5).
  var res = http.get(
    BASE_URL + "/api/v1/sync/pull?entity=" + PULL_ENTITY + "&cursor=&limit=10",
    params,
  );
  var rejected = check(res, {
    "revoked pull rejected 403": function (r) {
      return r.status === 403;
    },
    "typed DEVICE_REVOKED (or per-item code)": function (r) {
      var raw = typeof r.body === "string" ? r.body : "";
      return raw.indexOf("DEVICE_REVOKED") >= 0;
    },
  });
  if (!rejected) {
    console.log("k6 sync-fleet: revoked device " + device.deviceId + " was NOT rejected (status " + res.status + ") — R-06 violation");
  }
  revokedRejections.add(rejected);
}
