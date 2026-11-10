import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Request } from "express";

import { isIdempotencyExempt } from "../auth/route-permissions";

/**
 * Idempotency guard (IDEMPOTENCY §1.1): every POST /api/v1/* write requires
 * an `Idempotency-Key` header — missing key is a loud 422 VALIDATION_ERROR
 * (programming error, not a negotiation). Session-creating endpoints are
 * exempt (§1.5: login/refresh legitimately create new state per execution).
 *
 * PHASE-003 scope note: replay-storage semantics (§3) belong to the
 * idempotency store that ships with the first business module — no
 * authorized table exists in this phase's schema (documented in the
 * completion report). Presence enforcement + the format contract land now.
 */
@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== "POST" || !request.path.startsWith("/api/v1/")) {
      return true;
    }
    if (isIdempotencyExempt("POST", request.path)) {
      return true;
    }
    const key = request.header("idempotency-key");
    if (key === undefined || key.trim() === "" || key.length > 128) {
      // 422 VALIDATION_ERROR per IDEMPOTENCY §1.1 (the filter maps Nest's
      // UnprocessableEntityException to the envelope code).
      throw new UnprocessableEntityException("Idempotency-Key header is required on POST writes");
    }
    return true;
  }
}
