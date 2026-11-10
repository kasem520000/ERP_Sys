import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { generateUuidV7 } from "@erp/domain-core";

import { requestContextStorage, isUuid } from "./request-context";
import { childLogger } from "./logger";

/**
 * Request-id middleware (OBSERVABILITY §Structured logging): accepts a
 * validated `X-Request-Id` (UUID only) or generates a UUIDv7, wraps the
 * request in the correlation ALS, echoes the id back, and logs one access
 * line per request with method/path/status/duration + correlation id.
 */
const log = childLogger({ module: "http" });

const REQUEST_ID_HEADER = "x-request-id";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = header(req, REQUEST_ID_HEADER);
    const correlationId = isUuid(incoming) ? incoming : generateUuidV7();
    // Date.now() is integer-ms by definition: no float rounding involved.
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", correlationId);
    res.on("finish", () => {
      log.info(
        {
          correlation_id: correlationId,
          action: "request",
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Date.now() - startedAt,
        },
        "request completed",
      );
    });
    requestContextStorage.run({ correlationId }, () => next());
  }
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
