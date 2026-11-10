/**
 * Public surface of the identity module (DEPENDENCY_RULES §1 `api/`): the
 * only importable layer for other modules. Re-exports the services, domain
 * primitives, and store contracts consumed by the platform (BFF, future
 * tenancy module, tests).
 */
export { PasswordService } from "../application/password-service";
export { SessionService } from "../application/session-service";
export type { IssuedSession, SessionValidation } from "../application/session-service";
export { LoginService } from "../application/login-service";
export type { LoginInput, LoginResult } from "../application/login-service";
export { MfaService } from "../application/mfa-service";
export { RecoveryService } from "../application/recovery-service";
export { InvitationService } from "../application/invitation-service";
export { UsersService } from "../application/users-service";
export * from "../domain/identity-errors";
export * from "../domain/session-policy";
export * from "../domain/password-policy";
export * from "../domain/totp";
export * from "../domain/tokens";
export * from "../infrastructure/identity.store";
export { RateLimiter } from "../infrastructure/rate-limiter";
