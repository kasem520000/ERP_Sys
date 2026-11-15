import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findUserById } from "../../identity/api/identity";
import {
  BridgeAlreadyLinkedError,
  BridgeInvalidError,
  BridgeNotLinkedError,
  BridgeUserNotMemberError,
  BridgeUserNotFoundError,
} from "../domain/bridge-errors";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import * as store from "../infrastructure/bridge.store";

/**
 * PHASE-045 (T-09) — the employee ↔ user identity-bridge service (HR-13):
 * the one-to-one link between the HR employee file and the platform
 * user, with the uniqueness guard, the audit trail, and the SoD law.
 *
 * THE LINK LAW: ONE employee ↔ ONE user per tenant at any moment —
 * (1) an employee carries at most one link (a second link attempt is
 * the typed refusal — the audited unlink is the only way a link moves);
 * (2) a user maps to at most ONE employee (the 0085 partial-UNIQUE
 * floor; the pre-write check refuses a taken user and the floor catches
 * the race — 23505 surfaced as the same typed refusal).
 *
 * THE MEMBERSHIP LAW: the linked user must be an ACTIVE member of the
 * acting tenant — a link to a user who cannot reach the tenant would be
 * an orphan (they could never see their own rows); the check reads the
 * tenant-RLS'd memberships table, so a foreign tenant's membership
 * facts are invisible by construction.
 *
 * THE LIFECYCLE LAW: a TERMINATED employee is never linked (TERMINATED
 * is terminal — no self-service future; the EOS history stays frozen);
 * employees WITHOUT a user remain valid (the field workforce) — the
 * link is optional, never required.
 *
 * THE SoD LAW (the authorization-matrix note): linking an employee to a
 * user grants NOTHING — HR data visibility rides the hr.* keys (and the
 * payroll employee master rides payroll.employees.*), NEVER user
 * administration and never the link itself; the dedicated attack test
 * pins that the link writes no permission and opens no read.
 */

/** 23505 = unique_violation; unwraps driver causes (the work-center
 * precedent) — the 0085 floor's race arm. */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class BridgeService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Link an employee to a tenant-member user. */
  async link(input: { employeeId: string; userId: string; actorId: string | null }): Promise<store.BridgeEmployeeRow> {
    const employee = await store.findBridgeEmployeeById(input.employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(input.employeeId);
    if (employee.status === "TERMINATED") {
      throw new BridgeInvalidError(
        `employee ${input.employeeId} is TERMINATED — the honest lifecycle links only ACTIVE/SUSPENDED employees (HR-13)`,
      );
    }
    if (employee.userId !== null) {
      throw new BridgeAlreadyLinkedError(
        `employee ${employee.code} is already linked to user ${employee.userId} — unlink first (the audited way a link moves)`,
      );
    }
    const user = await findUserById(input.userId);
    if (user === undefined) throw new BridgeUserNotFoundError(input.userId);
    if (!(await store.userHasActiveMembership(input.userId))) {
      throw new BridgeUserNotMemberError(input.userId);
    }
    const taken = await store.findEmployeeByUser(input.userId);
    if (taken !== undefined) {
      throw new BridgeAlreadyLinkedError(
        `user ${input.userId} is already linked to employee ${taken.code} in this tenant — one user maps to one employee (the 0085 guard)`,
      );
    }
    let linked: store.BridgeEmployeeRow | undefined;
    try {
      linked = await store.linkUser(input.employeeId, input.userId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BridgeAlreadyLinkedError(
          `user ${input.userId} is already linked to another employee in this tenant — one user maps to one employee (the 0085 guard)`,
        );
      }
      throw error;
    }
    if (linked === undefined) throw new EmployeeNotFoundError(input.employeeId);
    await this.audit.record({
      action: "hr.employee_user_linked",
      entityType: "employee",
      entityId: input.employeeId,
      actorId: input.actorId ?? undefined,
      after: { employeeCode: linked.code, userId: input.userId, employeeStatus: linked.status },
    });
    return linked;
  }

  /** Clear the link (the audited way a link moves). */
  async unlink(input: { employeeId: string; actorId: string | null }): Promise<store.BridgeEmployeeRow> {
    const employee = await store.findBridgeEmployeeById(input.employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(input.employeeId);
    if (employee.userId === null) throw new BridgeNotLinkedError(input.employeeId);
    const unlinked = await store.unlinkUser(input.employeeId);
    if (unlinked === undefined) throw new EmployeeNotFoundError(input.employeeId);
    await this.audit.record({
      action: "hr.employee_user_unlinked",
      entityType: "employee",
      entityId: input.employeeId,
      actorId: input.actorId ?? undefined,
      before: { employeeCode: unlinked.code, userId: employee.userId },
    });
    return unlinked;
  }

  /** The bridge state of one employee (the read the HR screen renders). */
  async get(employeeId: string): Promise<store.BridgeEmployeeRow> {
    const employee = await store.findBridgeEmployeeById(employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(employeeId);
    return employee;
  }

  /** THE OWN-ROWS RESOLVER (the self-service substrate, T-14): the
   * employee linked to the acting user in the ambient tenant —
   * undefined when the user is nobody's employee here (the field
   * workforce / a pure back-office user). */
  async resolveByUser(userId: string): Promise<store.BridgeEmployeeRow | undefined> {
    return store.findEmployeeByUser(userId);
  }
}
