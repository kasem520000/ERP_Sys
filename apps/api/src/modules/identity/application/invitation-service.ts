import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { generateOpaqueToken, hashToken } from "../domain/tokens";
import { INVITATION_TTL_MS } from "../domain/session-policy";
import {
  InvitationNotAcceptableError,
  NotFoundError,
} from "../domain/identity-errors";
import * as store from "../infrastructure/identity.store";
import { PasswordService } from "./password-service";
import { SessionService } from "./session-service";
import type { InvitationView } from "../infrastructure/identity.store";

/**
 * Invitations (PHASE-003 §2.7): issue (email + tenant role), accept
 * (existing user → membership; new user → PENDING user + password setup),
 * revoke, expire — every transition audited; tokens are one-time,
 * 256-bit, hashed at rest (72 h expiry).
 */

const log = childLogger({ module: "identity" });

export interface InvitationDeps {
  readonly password: PasswordService;
  readonly sessions: SessionService;
  readonly audit: AuditService;
  readonly sendInvitation: (input: {
    tenantId: string;
    email: string;
    locale: string;
    token: string;
    tenantName: string;
    tenantNameAr: string | null;
    roleName: string;
    roleNameAr: string | null;
  }) => Promise<void>;
}

/** Result of issuing an invitation: the emailed link is built by the caller. */
export interface IssuedInvitation {
  invitationId: string;
  token: string;
  expiresAt: string;
}

export interface AcceptInput {
  token: string;
  fullName: string;
  password: string;
  locale?: string;
}

export interface AcceptResult {
  userId: string;
  token: string;
  sessionId: string;
  expiresAt: string;
}

export class InvitationService {
  constructor(private readonly deps: InvitationDeps) {}

  /** Issue (owner route, tenant context established by the interceptor). */
  async issue(input: {
    tenantId: string;
    email: string;
    roleId: string;
    invitedBy: string;
  }): Promise<IssuedInvitation> {
    const email = input.email.trim().toLowerCase();
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    const invitation = await store.insertInvitation({
      tenantId: input.tenantId,
      email,
      roleId: input.roleId,
      tokenHash: hashToken(token),
      expiresAt,
      invitedBy: input.invitedBy,
      createdBy: input.invitedBy,
    });
    await this.deps.audit.record({
      action: "invitation.issued",
      entityType: "invitation",
      entityId: invitation.id,
      actorId: input.invitedBy,
      after: { email, role_id: input.roleId, expires_at: expiresAt },
    });
    const role = await store.findRoleInTenant(input.tenantId, input.roleId);
    const memberships = await store.membershipOptions(input.invitedBy);
    const membership = memberships.find((m) => m.tenantId === input.tenantId);
    await this.deps.sendInvitation({
      tenantId: input.tenantId,
      email,
      locale: "ar",
      token,
      tenantName: membership?.tenantName ?? "",
      tenantNameAr: membership?.tenantNameAr ?? null,
      roleName: role?.name ?? "",
      roleNameAr: role?.nameAr ?? null,
    }).catch((error: unknown) => {
      log.warn({ err: error }, "invitation email failed (non-blocking)");
    });
    return { invitationId: invitation.id, token, expiresAt };
  }

  /** Pre-auth view of the invitation behind an emailed token (definer). */
  async viewByToken(token: string): Promise<InvitationView> {
    const view = await store.invitationByTokenHash(hashToken(token));
    if (view === undefined) {
      throw new NotFoundError("invitation");
    }
    return view;
  }

  /**
   * Accept: single-use token → membership for an existing user, or a new
   * PENDING user + password. Runs inside the invitation's tenant scope so
   * the membership INSERT and the audit event are one RLS-scoped
   * transaction; the invitation itself is consumed atomically first.
   */
  async accept(input: AcceptInput): Promise<AcceptResult> {
    const view = await store.invitationByTokenHash(hashToken(input.token));
    if (view === undefined) {
      throw new NotFoundError("invitation");
    }
    if (view.status === "ACCEPTED") {
      throw new InvitationNotAcceptableError("accepted");
    }
    if (view.status === "REVOKED") {
      throw new InvitationNotAcceptableError("revoked");
    }
    if (view.status === "EXPIRED" || Date.now() >= Date.parse(view.expiresAt)) {
      throw new InvitationNotAcceptableError("expired");
    }
    if (view.tenantStatus !== "ACTIVE") {
      throw new InvitationNotAcceptableError("revoked"); // suspended tenant: no leak
    }

    const passwordHash = await this.deps.password.hashFromNewPassword(input.password);
    const existing = await store.findUserByEmail(view.email);
    const user =
      existing ??
      (await store.insertUser({
        email: view.email,
        fullName: input.fullName,
        passwordHash,
        locale: input.locale ?? "ar",
      }));

    const result = await withTenant(view.tenantId, async () => {
      const membership = await store.insertMembership({
        tenantId: view.tenantId,
        userId: user.id,
        roleId: view.roleId,
        createdBy: view.invitationId,
      });
      // Consume the invitation inside the same transaction: the
      // single-use property is atomic with the membership creation.
      await store.markInvitationAccepted(view.invitationId, view.tenantId);
      await this.deps.audit.record({
        action: "invitation.accepted",
        entityType: "membership",
        entityId: membership.id,
        actorId: user.id,
        after: { invitation_id: view.invitationId, role_id: view.roleId, email: view.email },
      });
      await this.deps.audit.record({
        action: "membership.created",
        entityType: "membership",
        entityId: membership.id,
        actorId: user.id,
        after: { user_id: user.id, role_id: view.roleId },
      });
      const session = await this.deps.sessions.issue({
        userId: user.id,
        activeTenantId: view.tenantId,
      });
      if (existing === undefined) {
        await store.markLoginSuccess(user.id);
      }
      return session;
    });

    return {
      userId: user.id,
      token: result.token,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
    };
  }

  /** Revoke (owner route) — audited; accepted/expired are terminal states. */
  async revoke(invitationId: string, tenantId: string, actorId: string): Promise<void> {
    await store.revokeInvitation(invitationId, tenantId);
    await this.deps.audit.record({
      action: "invitation.revoked",
      entityType: "invitation",
      entityId: invitationId,
      actorId,
    });
  }

  /** List for the tenant admin screen (tenant context established). */
  async listForTenant(tenantId: string): Promise<readonly InvitationView[]> {
    await store.expireStaleInvitations(tenantId);
    return store.listInvitationsForTenant(tenantId);
  }
}
