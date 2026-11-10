import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { processMetrics, type RouteGroup } from "../observability/metrics";

/**
 * PHASE-025 T9b — request metrics middleware (MONITORING §1 "API golden
 * signals" — request rate, error rate by class, p50/p95/p99 per route
 * group): the in-process substrate's API-plane source. Every finished
 * response records one request counter, a 4xx/5xx error counter when the
 * class warrants it, an over-budget counter when the duration exceeds the
 * group's NFR-006/T budget, and one latency sample — cheap fixed-cardinality
 * buckets, no per-request Map growth (the SF-024-021 substrate; the OTel
 * exporter swap picks the names up from `infra/observability/metrics.ts`).
 *
 * Route grouping (truthful fold of the real /api/v1/* namespaces into the
 * eight golden-signal groups; the budgets live in metrics.ts):
 * - identity      ← /identity, /tenancy (auth, sessions, tenant admin)
 * - accounting    ← /accounting, /audit (GL plane + the tenant audit trail)
 * - sales         ← /sales, /pos, /crm, /distribution, /partners (revenue
 *                   plane incl. customer/supplier master data)
 * - purchasing    ← /purchasing
 * - treasury      ← /treasury, /tax (cash + VAT/e-invoicing)
 * - inventory     ← /inventory, /items, /manufacturing (stock, item master,
 *                   production)
 * - sync          ← /sync, /devices (offline plane)
 * - platform      ← /platform, /configuration, /notifications, /reporting,
 *                   /files, /public, /health and everything else (the
 *                   admin/reporting plane)
 */

/** First-match-wins prefix table (fixed; longest prefixes first within a group). */
const ROUTE_GROUP_PREFIXES: readonly (readonly [prefix: string, group: RouteGroup])[] = [
  ["/api/v1/identity", "identity"],
  ["/api/v1/tenancy", "identity"],
  ["/api/v1/accounting", "accounting"],
  ["/api/v1/audit", "accounting"],
  ["/api/v1/sales", "sales"],
  ["/api/v1/pos", "sales"],
  ["/api/v1/crm", "sales"],
  ["/api/v1/distribution", "sales"],
  ["/api/v1/partners", "sales"],
  ["/api/v1/purchasing", "purchasing"],
  ["/api/v1/treasury", "treasury"],
  ["/api/v1/tax", "treasury"],
  ["/api/v1/inventory", "inventory"],
  ["/api/v1/items", "inventory"],
  ["/api/v1/manufacturing", "inventory"],
  ["/api/v1/sync", "sync"],
  ["/api/v1/devices", "sync"],
];

/** Pure: classify a URL path into its route group (exported for the spec). */
export function routeGroupOf(path: string): RouteGroup {
  for (const [prefix, group] of ROUTE_GROUP_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return group;
    }
  }
  return "platform";
}

/** Pure: the status class bucket (exported for the spec). */
export function statusClassOf(status: number): "2xx" | "3xx" | "4xx" | "5xx" {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Date.now() is integer-ms by definition: no float rounding involved.
    const startedAt = Date.now();
    // Nest's per-route middleware mounting resets request.path to "/" —
    // the full path survives on originalUrl (query stripped) — the
    // tenant-rate-limit middleware's rule.
    const path = (req.originalUrl ?? req.path).split("?")[0] ?? req.path;
    const group = routeGroupOf(path);
    res.on("finish", () => {
      processMetrics.recordApiRequest(group, statusClassOf(res.statusCode), Date.now() - startedAt);
    });
    next();
  }
}
