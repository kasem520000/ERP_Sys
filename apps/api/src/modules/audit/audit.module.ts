import { Module } from "@nestjs/common";

import { AuditService, AUDIT_STORE } from "./application/audit.service";
import { DrizzleAuditStore } from "./infrastructure/drizzle-audit.store";

/**
 * Audit module (PHASE-002 §2.3): append-only, tenant-scoped audit trail.
 * Controllers/HTTP surfaces arrive when authenticated routes exist
 * (PHASE-003+); the module today exposes the service + store port only.
 */
@Module({
  providers: [{ provide: AUDIT_STORE, useClass: DrizzleAuditStore }, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
