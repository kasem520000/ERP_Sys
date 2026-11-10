import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped correlation context (OBSERVABILITY §Structured logging).
 *
 * `correlation_id` is generated as UUIDv7 here, or accepted from an incoming
 * `X-Request-Id` header when it is a valid UUID (validated — never trusted
 * blindly). It is propagated to responses, the tenant context, audit events
 * (`audit_events.correlation_id`), and job payloads.
 */
export interface RequestContext {
  correlationId: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts only a well-formed UUID; anything else is treated as absent. */
export function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_PATTERN.test(value);
}

/** Correlation id of the current request scope, if one is active. */
export function getCorrelationId(): string | undefined {
  return requestContextStorage.getStore()?.correlationId;
}
