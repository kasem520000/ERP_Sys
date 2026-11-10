import { metrics, trace } from "@opentelemetry/api";

import { env } from "../../config/env";

/**
 * OpenTelemetry wiring with no-op export (PHASE-002 §2.10, OBSERVABILITY
 * §Tracing).
 *
 * The stable substrate for this phase is the `@opentelemetry/api` surface:
 * its default providers (ProxyTracerProvider / noop meter) are no-op by
 * construction, so every instrumentation call site (`tracer()`, `meter()`)
 * works today and exports nothing — exactly the "export enabled when a
 * backend is chosen" contract. SDK provider registration is deliberately NOT
 * pinned now: the 2.x SDK line removed the global provider setters this
 * integration would rely on, and the vendor decision (DR — observability
 * vendors) picks the registration path. `initOtel()` is the stable seam:
 * when OTEL_ENABLED=1 and a backend exists, the provider wiring lands here
 * (auto-instrumentation HTTP + pg arrives with the traffic-bearing phases;
 * PHASE-025 hardening review re-checks this seam).
 */

let initialized = false;

/** Idempotent; currently a validated no-op registration point. */
export function initOtel(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  if (env.OTEL_ENABLED === 0) {
    // No-op by configuration: the api surface stays usable (default
    // providers) so instrumentation calls need no feature flags.
    return;
  }
  // OTEL_ENABLED=1: no exporter is configured yet (no vendor decision) — the
  // api defaults remain inert; this branch flips when the backend lands.
}

/** Convenience accessor: the process tracer (no-op until export is enabled). */
export function tracer(): ReturnType<typeof trace.getTracer> {
  return trace.getTracer("erp-api", "0.1.0");
}

/** Convenience accessor: the process meter (no-op until export is enabled). */
export function meter(): ReturnType<typeof metrics.getMeter> {
  return metrics.getMeter("erp-api", "0.1.0");
}
