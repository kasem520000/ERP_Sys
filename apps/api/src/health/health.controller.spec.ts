import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import type { Response } from "express";

import { HealthController, type LivenessResponse } from "./health.controller";
import { ReadinessService, type ReadinessReport } from "./readiness.service";

// Stable framework metadata keys (the router constants' literal values; the
// const symbols are not part of the public @nestjs/common export surface).
const PATH_METADATA = "path";
const METHOD_METADATA = "method";

function fakeRes(): { res: Response; statusCode(): number } {
  const res = {
    statusCode: 0,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(_name: string, _value: string) {
      return res;
    },
    on(_event: string, _listener: () => void) {
      return res;
    },
  } as unknown as Response;
  return { res, statusCode: () => res.statusCode };
}

describe("HealthController (GET /health/live, /health/ready)", () => {
  it("wires both routes to GET", () => {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, HealthController);
    const livePath = Reflect.getMetadata(PATH_METADATA, HealthController.prototype.getLiveness);
    const liveMethod = Reflect.getMetadata(METHOD_METADATA, HealthController.prototype.getLiveness);
    const readyPath = Reflect.getMetadata(PATH_METADATA, HealthController.prototype.getReadiness);
    const readyMethod = Reflect.getMetadata(METHOD_METADATA, HealthController.prototype.getReadiness);
    expect(controllerPath).toBe("health");
    expect(livePath).toBe("live");
    expect(liveMethod).toBe(RequestMethod.GET);
    expect(readyPath).toBe("ready");
    expect(readyMethod).toBe(RequestMethod.GET);
  });

  it("returns live build info", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    })
      .useMocker((token) => {
        if (token === ReadinessService) {
          return { check: () => Promise.resolve({ status: "ready", checks: [] }) };
        }
        return undefined;
      })
      .compile();
    const controller = moduleRef.get(HealthController);
    const result: LivenessResponse = controller.getLiveness();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("erp-api");
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.timestamp).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
  });

  it("returns 200 with the report when ready", async () => {
    const readiness = {
      check: () =>
        Promise.resolve({
          status: "ready",
          checks: [
            { name: "db", status: "up" },
            { name: "migrations", status: "up" },
            { name: "queue", status: "up" },
          ],
        } satisfies ReadinessReport),
    };
    const controller = new HealthController(readiness as unknown as ReadinessService);
    const { res, statusCode } = fakeRes();
    const report = await controller.getReadiness(res);
    expect(report.status).toBe("ready");
    expect(report.checks.map((check) => check.name)).toEqual([
      "db",
      "migrations",
      "queue",
    ]);
    expect(statusCode()).toBe(0); // no status override on success
  });

  it("returns 503 with the per-check report when a check is down", async () => {
    const readiness = {
      check: () =>
        Promise.resolve({
          status: "unavailable",
          checks: [
            { name: "db", status: "up" },
            { name: "migrations", status: "down", detail: "schema_version=1, build expects 2" },
            { name: "queue", status: "up" },
          ],
        } satisfies ReadinessReport),
    };
    const controller = new HealthController(readiness as unknown as ReadinessService);
    const { res, statusCode } = fakeRes();
    const report = await controller.getReadiness(res);
    expect(report.status).toBe("unavailable");
    expect(statusCode()).toBe(503);
  });
});
