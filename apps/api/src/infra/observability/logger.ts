import { pino, type Logger as PinoLogger } from "pino";

import { env } from "../../config/env";

/**
 * Structured JSON logging to stdout (OBSERVABILITY §Structured logging):
 * pino with mandatory base fields (`ts`, `level`, `correlation_id`,
 * `tenant_id`, `module`, `action`) bound per child logger, a fail-closed
 * redaction list for credential-bearing keys, and an error serializer that
 * never emits raw stacks at non-debug levels (stacks belong to the error
 * tracker).
 *
 * The allow-list serializer for arbitrary objects lands with the first
 * user-payload-bearing phases; until then this module is the single logging
 * surface and the redaction list is the enforced policy.
 */
const REDACT_PATHS = [
  "password",
  "*.password",
  "newPassword",
  "*.newPassword",
  "currentPassword",
  "*.currentPassword",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "sessionSecret",
  "*.sessionSecret",
  "authorization",
  "*.authorization",
  "secretKey",
  "*.secretKey",
  "accessKey",
  "*.accessKey",
  "credentials",
  "*.credentials",
];

const STACK_LEVELS = new Set(["debug", "trace"]);

function errorSerializer(value: unknown): object {
  const serialized = pino.stdSerializers.err(value as Error);
  if (!STACK_LEVELS.has(env.LOG_LEVEL)) {
    delete (serialized as { stack?: string }).stack;
  }
  return serialized as object;
}

export const logger: PinoLogger = pino({
  level: env.LOG_LEVEL,
  base: { service: "erp-api" },
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  serializers: { err: errorSerializer, error: errorSerializer },
});

/** Child logger with bound `module` (+ request fields where available). */
export function childLogger(bindings: Record<string, unknown>): PinoLogger {
  return logger.child(bindings);
}
