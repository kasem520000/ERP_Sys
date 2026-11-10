import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  callReaderMemberGl,
  callReaderMemberPeriods,
  type MemberGlRow,
  type MemberPeriodRow,
} from "../infrastructure/consolidation.store";
import { ReaderRejectedError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T3 · THE audited platform-plane reader — the ONLY sanctioned
 * cross-tenant read path in the platform (ADR-0018 §3; RISK-016: no other
 * module may import the reader seam or acquire the grant).
 *
 * Discipline:
 * - **Every member-book read writes an audit row** (run id, member tenant,
 *   actor, scope) in the SAME ambient UoW as the read — read-audit
 *   completeness: audit rows == reads (the instrumented suite's count
 *   equality). An attempted read outside a group's membership is rejected
 *   (the function re-validates) and audited as a rejection.
 * - Reads are SELECT-only through the SECURITY DEFINER function family
 *   (`erp.consolidation_read_member_gl` + the period-lookup leg) — the
 *   reader role holds no INSERT/UPDATE/DELETE anywhere, so there is no
 *   write path through this service AT ALL (INV-026's grant-level half).
 * - Member RLS is never relaxed: the function's BYPASSRLS ownership is the
 *   0003 erp_definer escape-hatch pattern; the RLS policy set stays
 *   byte-identical (the canary proves it).
 * - BR-056 is re-verified at read time (the function only returns rows for
 *   closed member periods — SOFT_CLOSED/LOCKED; OPEN returns nothing and
 *   the service's pre-check has already rejected the run creation).
 *
 * This service is deliberately tiny: it is a seam, not a feature surface —
 * every capability it grants is auditable and enumerable.
 */
@Injectable()
export class ConsolidationReaderService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Read ONE member's posted GL account aggregates for its own fiscal
   * period: the statement-extract substrate. Audited per call.
   */
  async readMemberGl(input: {
    groupId: string;
    memberTenantId: string;
    memberPeriodId: string;
    runId: string | null;
    actorId: string | null;
  }): Promise<MemberGlRow[]> {
    // THE audit row — same UoW as the read (completeness = counts equal).
    await this.audit.record({
      action: "consolidation.member_gl_read",
      entityType: "tenant",
      entityId: input.memberTenantId,
      actorId: input.actorId ?? undefined,
      after: {
        groupId: input.groupId,
        memberPeriodId: input.memberPeriodId,
        runId: input.runId,
        scope: "member-gl",
      },
    });
    const rows = await callReaderMemberGl(
      input.groupId,
      input.memberTenantId,
      input.memberPeriodId,
    );
    return rows;
  }

  /**
   * Resolve the member's fiscal periods intersecting the owner's run-period
   * window (the BR-056 pre-check's substrate — each member's period ids are
   * its own). Audited per call (a period lookup IS a member-book read).
   */
  async readMemberPeriods(input: {
    groupId: string;
    memberTenantId: string;
    windowStart: string;
    windowEnd: string;
    runId: string | null;
    actorId: string | null;
  }): Promise<MemberPeriodRow[]> {
    await this.audit.record({
      action: "consolidation.member_period_lookup",
      entityType: "tenant",
      entityId: input.memberTenantId,
      actorId: input.actorId ?? undefined,
      after: {
        groupId: input.groupId,
        window: `${input.windowStart}..${input.windowEnd}`,
        runId: input.runId,
        scope: "member-periods",
      },
    });
    return callReaderMemberPeriods(
      input.groupId,
      input.memberTenantId,
      input.windowStart,
      input.windowEnd,
    );
  }

  /**
   * Audit a reader REJECTION (the attempted-read-outside-membership path:
   * the service pre-check or the function refused; the rejection itself is
   * audited — the attack suite asserts these rows exist).
   */
  async auditRejection(input: {
    groupId: string;
    memberTenantId: string;
    reason: string;
    actorId: string | null;
  }): Promise<void> {
    await this.audit.record({
      action: "consolidation.member_read_rejected",
      entityType: "tenant",
      entityId: input.memberTenantId,
      actorId: input.actorId ?? undefined,
      after: { groupId: input.groupId, reason: input.reason },
    });
    throw new ReaderRejectedError({
      groupId: input.groupId,
      memberTenantId: input.memberTenantId,
      reason: input.reason,
    });
  }
}
