import "reflect-metadata";

import { config as loadDotenv } from "dotenv";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { env } from "./config/env";
import { initOtel } from "./infra/observability/otel";
import { logger, childLogger } from "./infra/observability/logger";

/**
 * PHASE-002 bootstrap (ADR-0001 modular monolith):
 * - `.env` is loaded when present (compose/dev convenience; no-op otherwise).
 * - OpenTelemetry registers its no-op providers before anything else.
 * - WORKER_MODE=0 → HTTP API + jobs client (compose `api` service).
 * - WORKER_MODE=1 → worker entrypoint of the same image (compose `worker`
 *   profile, ADR-0008): lifecycle hooks run, handlers register, no HTTP
 *   listen — the worker exits with the queue drain on SIGTERM.
 */
const bootstrapLog = childLogger({ module: "bootstrap" });

async function bootstrap(): Promise<void> {
  loadDotenv();
  initOtel();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  if (env.WORKER_MODE === 0) {
    await app.listen(env.PORT);
    bootstrapLog.info({ action: "listening", port: env.PORT }, "erp-api listening");
  } else {
    await app.init();
    bootstrapLog.info({ action: "worker-mode" }, "erp-api worker initialized (no HTTP listener)");
  }
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, "erp-api bootstrap failed");
  process.exitCode = 1;
});
