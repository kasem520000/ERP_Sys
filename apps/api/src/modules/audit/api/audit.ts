/**
 * Public surface of the audit module (DEPENDENCY_RULES §1 `api/`): the only
 * importable layer for other modules. Re-exports the DI token, the service,
 * and the payload/query contracts.
 */
export {
  AuditService,
  AUDIT_STORE,
  InvalidAuditEventError,
  type AuditEventInput,
  type AuditEventRow,
  type AuditQuery,
  type AuditStore,
  type PlatformAuditQuery,
} from "../application/audit.service";
