import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/api/audit";
import { NotificationsModule } from "../notifications/notifications.module";
import { IDENTITY_EMAIL_SENDERS, type IdentityEmailSenders } from "../notifications/notifications.module";
import { PasswordService } from "./application/password-service";
import { SessionService } from "./application/session-service";
import { LoginService } from "./application/login-service";
import { MfaService } from "./application/mfa-service";
import { MfaBootstrapService } from "./application/mfa-bootstrap-service";
import { RecoveryService } from "./application/recovery-service";
import { InvitationService } from "./application/invitation-service";
import { UsersService } from "./application/users-service";
import { SessionsController } from "./presentation/sessions.controller";
import { MfaController } from "./presentation/mfa.controller";
import { PasswordController } from "./presentation/password.controller";
import { UsersController } from "./presentation/users.controller";

/**
 * Identity module (PHASE-003): users, memberships, roles, permissions,
 * sessions, TOTP MFA, invitations — the platform trust substrate every
 * later business module inherits. Wiring follows the layer rules: the
 * audit trail is consumed through the AuditModule's service (never direct
 * inserts), email through the notifications skeleton (ADR-0008 jobs).
 */
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [SessionsController, MfaController, PasswordController, UsersController],
  providers: [
    PasswordService,
    SessionService,
    MfaService,
    UsersService,
    // PHASE-024 T4: the enrollment bootstrap (ADR-0015 §4 enforcement) —
    // the same PasswordService/SessionService/AuditService substrate as
    // login, so the credential discipline is identical by construction.
    {
      provide: MfaBootstrapService,
      useFactory: (
        password: PasswordService,
        sessions: SessionService,
        audit: AuditService,
      ) => new MfaBootstrapService({ password, sessions, audit }),
      inject: [PasswordService, SessionService, AuditService],
    },
    {
      provide: LoginService,
      useFactory: (
        password: PasswordService,
        sessions: SessionService,
        mfa: MfaService,
        audit: AuditService,
        senders: IdentityEmailSenders,
      ) =>
        new LoginService({
          password,
          sessions,
          mfa,
          audit,
          notifyLogin: (_userId, email, locale) =>
            senders.sendLoginNotification({
              tenantId: null,
              email,
              locale,
              ip: "unknown",
              at: new Date().toISOString(),
            }),
        }),
      inject: [
        PasswordService,
        SessionService,
        MfaService,
        AuditService,
        IDENTITY_EMAIL_SENDERS,
      ],
    },
    {
      provide: RecoveryService,
      useFactory: (
        password: PasswordService,
        sessions: SessionService,
        audit: AuditService,
        senders: IdentityEmailSenders,
      ) =>
        new RecoveryService({
          password,
          sessions,
          audit,
          sendResetEmail: (_userId, email, locale, token) =>
            senders.sendPasswordReset({ tenantId: null, email, locale, token }),
        }),
      inject: [PasswordService, SessionService, AuditService, IDENTITY_EMAIL_SENDERS],
    },
    {
      provide: InvitationService,
      useFactory: (
        password: PasswordService,
        sessions: SessionService,
        audit: AuditService,
        senders: IdentityEmailSenders,
      ) =>
        new InvitationService({
          password,
          sessions,
          audit,
          sendInvitation: (input) =>
            senders.sendInvitation({
              tenantId: input.tenantId,
              email: input.email,
              locale: input.locale,
              token: input.token,
              tenantName: input.tenantName,
              tenantNameAr: input.tenantNameAr,
              roleName: input.roleName,
              roleNameAr: input.roleNameAr,
            }),
        }),
      inject: [PasswordService, SessionService, AuditService, IDENTITY_EMAIL_SENDERS],
    },
  ],
  exports: [PasswordService, SessionService, LoginService],
})
export class IdentityModule {}
