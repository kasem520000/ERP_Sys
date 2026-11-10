import { Inject, Injectable } from "@nestjs/common";

import { DomainError } from "@erp/domain-core";

import {
  ambientPlatformContext,
  requireTenantContext,
  type PlatformContext,
  type TenantContext,
} from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";

/**
 * Audit trail application service (PHASE-002 §2.3, OBSERVABILITY §Audit vs
 * telemetry): audit events are a DOMAIN record — immutable, transactional,
 * written inside the caller's unit of work. The store port is implemented by
 * `infrastructure/drizzle-audit.store.ts`; the service itself never touches
 * SQL (DEPENDENCY_RULES §1 application layer).
 */
export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  before?: unknown;
  after?: unknown;
  deviceId?: string;
  /**
   * PHASE-004 (matrix §3.10/§7): true when the action executes on the
   * platform path — platform-console reads, lifecycle actions, entitlement
   * edits, support-session actions. Stamped on the audit row.
   */
  viaPlatformAdmin?: boolean;
}

export interface AuditEventRow {
  id: string;
  /** NULL for platform-scope rows (PHASE-004 widening). */
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  deviceId: string | null;
  at: string;
  viaPlatformAdmin: boolean;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  /** PHASE-013: actor filter (platform.user-activity report feed). */
  actorId?: string;
  /** PHASE-013: action filter (report parameter). */
  action?: string;
  /** PHASE-024 T8: the correlation-id lookup (one request's full trail). */
  correlationId?: string;
  fromAt?: string;
  toAt?: string;
  limit?: number;
}

/**
 * Cross-tenant platform review query (PHASE-004 §2.7; platform.audit.view):
 * cursor-paginated over the whole trail — tenant rows and platform rows
 * alike — through the platform GUC path only.
 */
export interface PlatformAuditQuery {
  tenantId?: string;
  platformOnly?: boolean;
  action?: string;
  fromAt?: string;
  toAt?: string;
  limit?: number;
  cursor?: { at: string; id: string };
}

/** Storage port; bound to the drizzle implementation by AuditModule. */
export abstract class AuditStore {
  abstract append(context: TenantContext, event: AuditEventInput): Promise<void>;
  abstract list(
    context: TenantContext,
    query: AuditQuery,
  ): Promise<readonly AuditEventRow[]>;
  /** PHASE-004: platform-scope append (tenant_id NULL, via_platform_admin). */
  abstract appendPlatform(
    context: PlatformContext,
    event: AuditEventInput,
  ): Promise<void>;
  /** PHASE-004: cross-tenant platform review (cursor-paginated). */
  abstract listPlatform(
    context: PlatformContext,
    query: PlatformAuditQuery,
  ): Promise<readonly AuditEventRow[]>;
}

export const AUDIT_STORE = Symbol("AUDIT_STORE");

/** The BR-005 policy-actor sentinel (see sales POLICY_ACTOR_ID): a
 * document-column marker, never an audit actor. Duplicated locally to
 * keep the audit module dependency-free (the sales module owns the
 * canonical value; both are the frozen 0003-era literal). */
export const POLICY_ACTOR_SENTINEL = "00000000-0000-0000-0000-000000000505";

export class InvalidAuditEventError extends DomainError {
  constructor(message: string) {
    super("audit/invalid-event", message);
  }
}

const MAX_IDENTIFIER_LENGTH = 100;
const MAX_QUERY_LIMIT = 500;

const log = childLogger({ module: "audit" });

@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_STORE) private readonly store: AuditStore) {}

  /**
   * Append an event inside the ambient tenant transaction. Requires a tenant
   * context (ADR-0005: fail closed — no audit ever happens "outside" a
   * tenant scope). The correlation id flows from the request context.
   */
  async record(event: AuditEventInput): Promise<void> {
    // DOCUMENT_LIFECYCLE §2 rule 1 (BR-005): the POLICY actor sentinel
    // (`policy:*` approvals/autoposts) is a marker on document columns
    // (approved_by/posted_by), NEVER an audit actor — audit_events.actor_id
    // references a real user (fk_audit_events_actor, 0003). System-path
    // events record without a human actor; the sentinel context rides in
    // the payload.
    const sanitized: AuditEventInput =
      event.actorId === POLICY_ACTOR_SENTINEL ? { ...event, actorId: undefined } : event;
    validateEvent(sanitized);
    const context = requireTenantContext();
    await this.store.append(context, sanitized);
    log.debug(
      { action: event.action, entity_type: event.entityType, via_platform_admin: event.viaPlatformAdmin === true },
      "audit event recorded",
    );
  }

  /**
   * Append a platform-scope event (tenant_id NULL; PHASE-004 §2.9) inside the
   * ambient PLATFORM transaction — requires withPlatformScope (fail closed).
   * Platform rows are invisible to tenant sessions (policy) and carry
   * via_platform_admin = true.
   */
  async recordPlatform(event: AuditEventInput): Promise<void> {
    validateEvent(event);
    const context = ambientPlatformContext();
    if (context === undefined) {
      throw new Error("platform audit events require a withPlatformScope() scope");
    }
    await this.store.appendPlatform(context, event);
    log.debug(
      { action: event.action, entity_type: event.entityType, platform: true },
      "platform audit event recorded",
    );
  }

  /** Query the tenant's trail inside the ambient tenant transaction. */
  async list(query: AuditQuery): Promise<readonly AuditEventRow[]> {
    if (query.limit !== undefined && (query.limit < 1 || query.limit > MAX_QUERY_LIMIT)) {
      throw new InvalidAuditEventError(
        `audit query limit must be between 1 and ${MAX_QUERY_LIMIT}`,
      );
    }
    const context = requireTenantContext();
    return this.store.list(context, query);
  }

  /**
   * Cross-tenant platform review (platform.audit.view) inside the ambient
   * PLATFORM transaction — cursor-paginated, statement-timeout budgeted.
   */
  async listPlatform(
    query: PlatformAuditQuery,
  ): Promise<readonly AuditEventRow[]> {
    if (query.limit !== undefined && (query.limit < 1 || query.limit > MAX_QUERY_LIMIT)) {
      throw new InvalidAuditEventError(
        `audit query limit must be between 1 and ${MAX_QUERY_LIMIT}`,
      );
    }
    const context = ambientPlatformContext();
    if (context === undefined) {
      throw new Error("platform audit review requires a withPlatformScope() scope");
    }
    return this.store.listPlatform(context, query);
  }
}

function validateEvent(event: AuditEventInput): void {
  if (event.action.length < 1 || event.action.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidAuditEventError(
      `audit action length must be 1..${MAX_IDENTIFIER_LENGTH}`,
    );
  }
  if (event.entityType.length < 1 || event.entityType.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidAuditEventError(
      `audit entity_type length must be 1..${MAX_IDENTIFIER_LENGTH}`,
    );
  }
}
