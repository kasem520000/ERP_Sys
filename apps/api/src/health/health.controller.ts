import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import pkg from "../../package.json";

import { ReadinessService, type ReadinessReport } from "./readiness.service";

/** Liveness payload — build info only; readiness (DB + queue) is separate. */
export interface LivenessResponse {
  status: "ok";
  service: "erp-api";
  version: string;
  timestamp: string;
}

/**
 * Health routes (DEVELOPMENT_SETUP.md §2 verification steps):
 * - `GET /health/live` — process up (LB liveness).
 * - `GET /health/ready` — DB round-trip + migration state + queue liveness;
 *   503 with the per-check report when anything is down (OBSERVABILITY §Health).
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get("live")
  getLiveness(): LivenessResponse {
    return {
      status: "ok",
      service: "erp-api",
      version: pkg.version,
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async getReadiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const report = await this.readiness.check();
    if (report.status !== "ready") {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
