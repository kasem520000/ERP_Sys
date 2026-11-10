/**
 * Wire types shared across the web app (BFF route handlers, server pages,
 * client forms). Mirrors the PHASE-003 identity + PHASE-004 tenancy/platform
 * API envelopes (docs/api/API_CONVENTIONS.md, docs/api/ERROR_MODEL.md):
 *
 *   success: `{ data, meta: { requestId } }`
 *   error:   `{ error: { code, message, details?, traceId? } }`
 *
 * Hand-written on purpose (ADR-0003): the web side adds no schema library —
 * manual narrowing helpers live next to the types they narrow.
 */

import type { IndustryTemplateManifest } from "@erp/contracts";

export const SESSION_COOKIE = "erp_session";
export const CSRF_COOKIE = "erp_csrf";

/** Methods that must not be CSRF-checked nor carry Idempotency-Key. */
export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ApiMeta {
  requestId: string;
}

/**
 * Cursor-pagination meta (API_CONVENTIONS §4). Present on the PHASE-004
 * list endpoints (platform tenants + platform audit events) — surfaced by
 * the fetch wrappers as `ApiResult.meta` for next-page links (P4-T12a).
 */
export interface PaginatedMeta {
  requestId: string;
  count: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  traceId?: string;
  retryable?: boolean;
}

/** Discriminated view of an envelope: either data (+ optional meta), or status+error. */
export type ApiResult<T> =
  | { ok: true; data: T; meta?: PaginatedMeta }
  | { ok: false; status: number; error: ApiErrorBody; retryAfterSeconds?: number };

// -- identity payloads (API surface §1–16) ---------------------------------

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  locale: string;
}

export interface LoginMembership {
  tenantId: string;
  tenantName: string;
  tenantNameAr: string | null;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  active: boolean;
}

/** POST /identity/sessions → data (token is stripped by the BFF before the browser sees it). */
export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  user: SessionUser;
  memberships: LoginMembership[];
}

export interface CurrentMembership {
  tenantId: string;
  tenantName: string;
  tenantNameAr: string | null;
  roleKey: string;
  membershipStatus: string;
  tenantStatus: string;
}

/** GET /identity/sessions/current → data. */
export interface CurrentSession {
  user: SessionUser;
  activeTenantId: string | null;
  memberships: CurrentMembership[];
  permissions: string[];
}

/** POST /identity/sessions/switch-tenant → data (token stripped by the BFF). */
export interface SwitchTenantResult {
  token: string;
  sessionId: string;
  activeTenantId: string;
}

/** POST /identity/invitations/accept → data (token stripped by the BFF). */
export interface AcceptInvitationResult {
  userId: string;
  token: string;
  sessionId: string;
  expiresAt: string;
}

export interface InvitationView {
  invitationId: string;
  tenantId: string;
  tenantName: string;
  tenantNameAr: string | null;
  tenantStatus: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  status: string;
  expiresAt: string;
}

/** POST /identity/invitations → data. */
export interface IssuedInvitation {
  invitationId: string;
  expiresAt: string;
  acceptPath: string;
}

export interface TenantUserRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  status: string;
  locale: string;
  lastLoginAt: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleNameAr: string | null;
  membershipStatus: string;
}

export interface RoleRow {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  nameAr: string | null;
  isSystem: boolean;
}

/** GET /identity/roles → data. */
export interface RolesData {
  tenantRoles: RoleRow[];
  systemTemplates: RoleRow[];
}

/** GET /identity/sessions/tenant → rows (tokenHash is never rendered). */
export interface TenantSessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  activeTenantId: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  lastSeenAt: string;
}

/** POST /identity/mfa/totp/enroll → data. */
export interface MfaEnrollResult {
  factorId: string;
  secret: string;
  otpauth: string;
}

export interface RevokedResult {
  revoked: boolean;
}

export interface AcceptedResult {
  accepted: boolean;
}

export interface ChangedResult {
  changed: boolean;
}

export interface ConfirmedResult {
  confirmed: boolean;
}

export interface RecoveryCodesResult {
  codes: string[];
}

// -- PHASE-004 tenancy + platform payloads (P4-T12a) ---------------------------

/** GET /platform/register/options → data (public; seeded reference data). */
export interface RegistrationCountry {
  code: string;
  name: string;
  nameAr: string | null;
  currencyCode: string;
  defaultLocale: string;
}

export interface RegistrationCurrency {
  code: string;
  name: string;
  nameAr: string | null;
  minorUnits: number;
}

export interface IndustryTemplateOption {
  key: string;
  name: string;
  nameAr: string | null;
  version: number;
}

export interface RegistrationOptions {
  countries: RegistrationCountry[];
  currencies: RegistrationCurrency[];
  industryTemplates: IndustryTemplateOption[];
}

/** POST /platform/register → data (no session is issued — owner signs in). */
export interface RegisterResult {
  tenantId: string;
  ownerEmail: string;
  trialExpiresAt: string;
  next: string;
}

/** GET /tenancy/profile → data (own-tenant profile row). */
export interface TenantProfile {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  baseCurrency: string;
  countryCode: string;
  timezone: string;
  industryTemplateKey: string | null;
  createdAt: string;
}

/** GET /tenancy/settings → effective-config snapshot (registry defaults ∪ stored rows). */
export type TenantSettingsMap = Record<string, unknown>;

/** Branch wire row (GET /tenancy/branches, POST /tenancy/branches). */
export interface BranchRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  createdAt: string;
}

/** POST /tenancy/onboarding/provision → data (idempotent provision diff). */
export interface ProvisionDiff {
  tenantId: string;
  roles: { created: string[]; existing: string[] };
  accounts: { created: number; existing: number };
  purposes: { created: number; existing: number };
  settings: { created: string[]; existing: string[] };
}

/**
 * GET /tenancy/entitlements → data (BR-039 derived payload, every member).
 * PHASE-014 adds the subscription state projection (read-only banner input).
 */
export interface DerivedEntitlements {
  featureKeys: string[];
  sources: Array<{ featureKey: string; source: string; expiresAt: string | null }>;
  subscription: EntitlementSubscriptionState | null;
}

/** The subscription state projection riding the entitlements payload. */
export interface EntitlementSubscriptionState {
  status: string;
  readOnly: boolean;
  graceEndsAt: string | null;
  trialEndsAt: string | null;
  periodEnd: string | null;
}

/** Support-session wire row (tenant + platform planes). */
export interface SupportSessionRow {
  id: string;
  tenantId: string;
  platformUserId: string;
  optIn: boolean;
  ticketRef: string | null;
  reason: string;
  openedAt: string;
  expiresAt: string;
  closedAt: string | null;
  closedBy: string | null;
  status: string;
}

/** GET /platform/tenants → rows (cursor-paginated; the UI requests limit=200). */
export interface ConsoleTenantSummary {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  countryCode: string;
  baseCurrency: string;
  industryTemplateKey: string | null;
  createdAt: string;
  isPlatformTenant: boolean;
}

export interface ConsoleEntitlement {
  id: string;
  tenantId: string;
  featureKey: string;
  source: string;
  expiresAt: string | null;
}

export interface ConsoleSubscription {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  providerRef: string | null;
}

export interface ConsoleMembership {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  roleKey: string;
  membershipStatus: string;
}

/** GET /platform/tenants/:id → data. */
export interface ConsoleTenantDetail extends ConsoleTenantSummary {
  subscription: ConsoleSubscription | null;
  plan: { key: string; name: string; nameAr: string } | null;
  entitlements: ConsoleEntitlement[];
  branches: BranchRow[];
  memberships: ConsoleMembership[];
}

/** POST /platform/tenants/:id/plan → data. */
export interface PlanAssignResult {
  planKey: string;
  grantedKeys: number;
}

/** POST /platform/tenants/:id/suspend → data. */
export interface SuspendResult {
  tenantId: string;
  status: string;
  killedSessions: number;
}

/** POST /platform/tenants/:id/restore → data. */
export interface RestoreResult {
  tenantId: string;
  status: string;
}

/** Audit event wire row (GET /platform/audit/events). tenantId is null on platform-scope rows. */
export interface PlatformAuditEvent {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  at: string;
  viaPlatformAdmin: boolean;
}

/**
 * PHASE-024 T4 — POST /identity/mfa/bootstrap → data (public credential
 * exchange; token stripped by the BFF before the browser sees it). The
 * 15-minute enrollment-only session: everything except the MFA endpoints +
 * logout answers 423 MFA_ENROLLMENT_REQUIRED until a TOTP verify passes.
 */
export interface MfaBootstrapResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  mfaEnrollmentRequired: true;
  user: SessionUser;
}

/**
 * PHASE-024 T4 — the `identity.mfa.policy` tenant setting value (SETTINGS_REGISTRY
 * schema): "plan" inherits plans.mfa_required_role_keys; "custom" overrides it
 * (an explicitly empty custom list makes MFA optional even when the plan mandates).
 */
export interface MfaPolicyValue {
  mode: "plan" | "custom";
  required_roles: string[];
}

/**
 * PHASE-024 T8 — audit event wire row (GET /audit/events, tenant plane; RLS-
 * confined, ordered by `at` ASC, limit ≤ 500). actorId/correlationId are null
 * on system-scope rows.
 */
export interface TenantAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  correlationId: string | null;
  at: string;
}

// -- PHASE-006 master-data payloads (P6-T11a; hand-written per ADR-0003) -------

export type PartnerKind = "CUSTOMER" | "SUPPLIER" | "BOTH";

/** GET/POST /partners/partners rows — money values are canonical decimal STRINGS. */
export interface PartnerRow {
  id: string;
  tenantId: string;
  kind: PartnerKind;
  code: string;
  name: string;
  nameAr: string | null;
  taxNumber: string | null;
  creditLimit: string | null;
  creditTermsId: string | null;
  priceListId: string | null;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreditTermsRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  days: number;
  description: string | null;
  isSystem: boolean;
}

export interface PartnerContactRow {
  id: string;
  partnerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
}

export interface PartnerAddressRow {
  id: string;
  partnerId: string;
  type: "BILLING" | "SHIPPING" | "OTHER";
  line1: string;
  line2: string | null;
  city: string | null;
  countryCode: string | null;
}

/** GET /partners/partners/:id/balance → data. `basis` is DRAFTS_ONLY at this phase. */
export interface PartnerBalanceRow {
  partnerId: string;
  openBalance: string;
  draftBalance: string;
  overdueAmount: string;
}

export type OpeningBalanceKind = "PARTNER" | "ACCOUNT" | "STOCK";

/** Opening-balance DRAFT rows (status is DRAFT-only at PHASE-006 — no posting). */
export interface OpeningBalanceDocRow {
  id: string;
  kind: OpeningBalanceKind;
  partnerId: string | null;
  accountId: string | null;
  itemId: string | null;
  qty: string | null;
  unitCost: string | null;
  amount: string | null;
  currencyCode: string;
  note: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type ItemKind = "STOCK" | "SERVICE" | "COMPOSITE";
export type CostingMethod = "WAC" | "FIFO";

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  kind: ItemKind;
  uomId: string;
  categoryId: string | null;
  taxCodeId: string | null;
  costingMethod: CostingMethod;
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  reorderLevel: string | null;
  reorderQty: string | null;
  basePrice: string | null;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface UomRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface ItemCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  status: string;
}

export interface BarcodeRow {
  id: string;
  itemId: string;
  uomId: string;
  code: string;
}

export interface PriceListRow {
  id: string;
  name: string;
  nameAr: string | null;
  kind: "SALE" | "PURCHASE";
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
}

export interface PriceListItemRow {
  id: string;
  priceListId: string;
  itemId: string;
  uomId: string;
  unitPrice: string;
  minQty: string;
}

export type ImportJobKind = "PARTNERS" | "ITEMS" | "OPENING_BALANCES";
export type ImportJobFormat = "CSV" | "XLSX";
export type ImportJobStatus =
  | "PREVIEWING"
  | "PREVIEW_READY"
  | "COMMITTING"
  | "COMMITTED"
  | "FAILED";

export interface ImportJobRow {
  id: string;
  kind: ImportJobKind;
  format: ImportJobFormat;
  uploadToken: string;
  fileKey: string;
  fileName: string | null;
  status: ImportJobStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  committedRows: number;
  report: unknown;
  error: string | null;
  committedAt: string | null;
  createdBy: string | null;
}

/** POST /items/export-jobs → data (signed download URL + row count). */
export interface ExportJobResult {
  downloadUrl: string;
  expiresInSeconds: number;
  rowCount: number;
  kind: string;
  format: string;
}

/** POST partners|items attachment issuance → data (direct-upload slot). */
export interface AttachmentIssuedUpload {
  attachmentId: string;
  key: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/** GET attachments list rows (signed download URL is minted per request). */
export interface AttachmentView {
  id: string;
  ownerType: string;
  ownerId: string;
  storageKey: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
  downloadUrl: string;
}

// -- PHASE-007: accounting ----------------------------------------------------

/** GET /accounting/accounts → rows (mirrors the CoA store row). */
export interface AccountRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  parentId: string | null;
  isPostable: boolean;
  currencyCode: string | null;
  status: string;
}

/** GET /accounting/purposes → rows (active + superseded mappings). */
export interface PurposeRow {
  id: string;
  purposeKey: string;
  accountId: string;
  accountCode?: string;
  activeFrom: string;
  activeTo: string | null;
}

/** GET /accounting/fiscal-years → rows. */
export interface FiscalYearRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export type FiscalPeriodKind = "REGULAR" | "OPENING" | "CLOSING";
export type FiscalPeriodStatus = "OPEN" | "SOFT_CLOSED" | "LOCKED";

/** GET /accounting/fiscal-years/:id/periods → rows. */
export interface FiscalPeriodRow {
  id: string;
  fiscalYearId: string;
  name: string;
  kind: FiscalPeriodKind;
  startDate: string;
  endDate: string;
  status: FiscalPeriodStatus;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

/** GET /accounting/exchange-rates → rows (base per 1 foreign, §5). */
export interface ExchangeRateRow {
  id: string;
  currencyCode: string;
  rateDate: string;
  rate: string;
  source: "MANUAL" | "IMPORTED";
}

/** GET /accounting/cost-centers → rows. */
export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  isActive: boolean;
}

/** GET /accounting/journal-entries → rows (manual-journal documents). */
export interface ManualJournalRow {
  id: string;
  status:
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "POSTED"
    | "REVERSED"
    | "CANCELLED";
  entryDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  rateSource: string;
  description: string | null;
  descriptionAr: string | null;
  reference: string | null;
  recurrenceId: string | null;
  templateId: string | null;
  postedJournalId: string | null;
  approvalStep: number;
  createdBy: string | null;
  approvedBy: string | null;
  cancelledReason: string | null;
}

/** GET /accounting/recurring-journals → rows. */
export interface RecurringJournalRow {
  id: string;
  name: string;
  template: unknown;
  schedule: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunAt: string | null;
  status: "ACTIVE" | "PAUSED";
}

/** GET /accounting/approval-policies → rows. */
export interface ApprovalPolicyRow {
  id: string;
  docType: string;
  policy: {
    mode: "none" | "single-approver" | "two-step" | "amount-threshold";
    threshold?: string | null;
    allowSelfApproval?: boolean;
  };
  appliesFrom: string;
  isActive: boolean;
}

/** GET /accounting/gl/accounts → rows (trial-balance shape, base currency). */
export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
}

/** GET /accounting/gl/accounts/:id/movements → data.movements rows. */
export interface GlMovementRow {
  journalEntryId: string;
  entryNo: string | null;
  entryDate: string;
  lineNo: number;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  baseAmount: string;
  memo: string | null;
  partnerId: string | null;
  itemId: string | null;
  costCenterId: string | null;
  balanceAfter?: string;
}

/** GET /accounting/gl/journal-register → rows. */
export interface JournalRegisterRow {
  id: string;
  entryNo: string | null;
  entryDate: string;
  description: string | null;
  sourceType: string;
  status: string;
  currencyCode: string;
  totalDebit: string;
  totalCredit: string;
}

/** GET /accounting/gl/entries/:id → data.entry (append-only ledger row). */
export interface JournalEntryRow {
  id: string;
  entryNo: string | null;
  entryDate: string;
  fiscalPeriodId: string;
  currencyCode: string;
  exchangeRate: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  operation: string;
  reversalOfId: string | null;
  reversedById: string | null;
  description: string | null;
  descriptionAr: string | null;
  postReason: string | null;
  postedAt: string;
  postedBy: string | null;
}

/** GET /accounting/gl/entries/:id → data.lines rows. */
export interface JournalLineRow {
  id: string;
  journalEntryId: string;
  lineNo: number;
  accountId: string;
  accountCode?: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  baseAmount: string;
  partnerId: string | null;
  itemId: string | null;
  costCenterId: string | null;
  taxCodeId: string | null;
  memo: string | null;
  memoAr: string | null;
}

/** GET /accounting/reconciliation/runs → rows. */
export interface ReconciliationRunRow {
  id: string;
  kind: string;
  asOf: string;
  status: "OK" | "BROKEN";
  controlBalance: string;
  subledgerBalance: string;
  diffCount: number;
  diff: unknown;
  runMode: string;
}

/** POST /accounting/periods/:id/checklist → data (close checklist, PERIOD_CLOSING §2). */
export interface CloseChecklistResult {
  period: FiscalPeriodRow;
  items: Array<{
    key: string;
    label: { en: string; ar: string };
    state: "OK" | "BROKEN" | "NOT_RUN" | "NOT_APPLICABLE";
    detail: string | null;
  }>;
  allSatisfied: boolean;
}

// -- PHASE-008: treasury ------------------------------------------------------

/** GET /treasury/cash-accounts → rows. Money values are canonical decimal strings. */
export interface CashAccountRow {
  id: string;
  name: string;
  nameAr: string | null;
  type: "CASH" | "BANK" | "PETTY";
  accountId: string;
  accountCode: string;
  branchId: string | null;
  currencyCode: string;
  status: "ACTIVE" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  balance: string;
  movementCount: number;
}

/** GET /treasury/cash-accounts/:id/movements → rows (append-only ledger). */
export interface CashMovementRow {
  id: string;
  cashAccountId: string;
  direction: "IN" | "OUT";
  amount: string;
  currencyCode: string;
  exchangeRate: string;
  baseAmount: string;
  sourceType: string;
  sourceId: string;
  valueDate: string;
  memo: string | null;
  memoAr: string | null;
}

/** GET /treasury/receipts|payments → rows (money-in / money-out documents). */
export interface TreasuryDocRow {
  id: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "CANCELLED";
  docNo: string | null;
  cashAccountId: string;
  partnerId: string;
  method: string;
  counterpartyName: string | null;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  allocatedAmount: string;
  fxGainLoss: string;
  postedJournalId: string | null;
  createdAt: string;
}

/** GET/PUT /treasury/receipts|payments/:id/allocations → rows. */
export interface AllocationRow {
  id: string;
  receiptId: string | null;
  paymentId: string | null;
  openItemId: string;
  amount: string;
}

/** GET /treasury/open-items → rows (AR/AP subledger open items). */
export interface OpenItemRow {
  id: string;
  partnerId: string;
  entryDate: string;
  direction: string;
  amount: string;
  baseAmount: string;
  currencyCode: string;
  exchangeRate: string;
  controlAccountId: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  settledAmount: string;
  outstanding: string;
}

/** GET /treasury/expense-categories → rows. */
export interface ExpenseCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  accountId: string;
  accountCode: string;
  approvalMode: "none" | "single-approver";
  isActive: boolean;
}

/** GET /treasury/expenses → rows. */
export interface ExpenseRow {
  id: string;
  status: string;
  expenseNo: string | null;
  categoryId: string;
  categoryCode: string;
  cashAccountId: string;
  payeeName: string;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  taxCodeId: string | null;
  receiptFileId: string | null;
  valueDate: string;
  description: string | null;
  descriptionAr: string | null;
  postedJournalId: string | null;
  createdBy: string | null;
}

/** GET /treasury/cash-transfers → rows. */
export interface TransferRow {
  id: string;
  status: string;
  transferNo: string | null;
  fromAccountId: string;
  toAccountId: string;
  currencyCode: string;
  amount: string;
  feeAmount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  postedJournalId: string | null;
}

/** GET /treasury/shifts → rows. */
export interface ShiftRow {
  id: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  shiftNo: string | null;
  cashAccountId: string;
  currencyCode: string;
  exchangeRate: string | null;
  openingAmount: string;
  capturedIn: string;
  capturedOut: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  variancePostedJournalId: string | null;
  supervisorId: string | null;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
}

/** GET /treasury/bank-statements → rows. */
export interface StatementRow {
  id: string;
  status: "IMPORTED" | "RECONCILED";
  cashAccountId: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  fileHash: string;
  adapterId: string;
  openingBalance: string | null;
  closingBalance: string | null;
  lineCount: number;
  importedAt: string;
  reconciledAt: string | null;
}

/** GET /treasury/bank-statements/:id/lines → rows. */
export interface StatementLineRow {
  id: string;
  bankStatementId: string;
  lineNo: number;
  lineDate: string;
  amount: string;
  reference: string | null;
  description: string | null;
  matchedMovementId: string | null;
  matchedAt: string | null;
  matchMode: string | null;
  ageDays: number | null;
}

/** POST /treasury/receipts|payments/:id/post → data (settlement result). */
export interface SettlementPostResult {
  docNo: string;
  journalEntryId: string;
  journalEntryNo: string | null;
  idempotentReplay: boolean;
  allocatedAmount: string;
  fxGainLoss: string;
}

/** GET /treasury/import-adapters → rows (statement import adapters). */
export interface ImportAdapterRow {
  id: string;
  label: { en: string; ar: string };
  extensions: string[];
}

/** GET /treasury/allocations/suggest → rows (FIFO suggestion). */
export interface AllocationSuggestionRow {
  openItemId: string;
  amount: string;
  entryDate: string;
  memo: string | null;
}

/** GET /treasury/unmatched-aging → data (BR-022 aging snapshot). */
export interface UnmatchedAgingData {
  unmatchedLines: StatementLineRow[];
  unmatchedMovements: CashMovementRow[];
}

/** POST /treasury/bank-statements/import → data. */
export interface StatementImportResult {
  statement: StatementRow;
  idempotentReplay: boolean;
}

/** Cash-movement rows on the aging panel carry ageDays (store shape + aging). */
export type AgedCashMovementRow = CashMovementRow & { ageDays?: number | null };

/** POST /treasury/reconciliation/cash-check → data (reconciliation run). */
export interface TreasuryCashCheckResult {
  id: string;
  kind: string;
  status: "OK" | "BROKEN";
  controlBalance: string;
  subledgerBalance: string;
  diffCount: number;
  diff: unknown;
}

// -- T15-UI: PHASE-009 tax engine ------------------------------------------------

/** GET /tax/tax-codes → rows (usageCount = live reference count). */
export interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  countryCode: string;
  defaultTreatment: string;
  snapshotPolicy: string;
  status: "ACTIVE" | "ARCHIVED";
  usageCount: number;
}

/** GET /tax/tax-registrations → rows (one per jurisdiction, upserted). */
export interface TaxRegistrationRow {
  id: string;
  countryCode: string;
  status: "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";
  registrationNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  deregisteredAt: string | null;
  note: string | null;
}

/** Rate-window rows nested in each jurisdiction pack. */
export interface JurisdictionRateRow {
  id: string;
  treatment: string;
  rate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceRef: string;
  verifiedAt: string | null;
}

/** GET /tax/packs → rows (the seeded jurisdiction registry with rate windows). */
export interface JurisdictionPackRow {
  id: string;
  countryCode: string;
  countryName: string;
  countryNameAr: string;
  currencyCode: string;
  minorUnits: number;
  vatStatus: "VAT_IN_FORCE" | "VAT_PLANNED" | "NO_VAT";
  packVersion: string;
  descriptor: Record<string, unknown>;
  verificationStatus: "REQUIRES_VERIFICATION" | "VERIFIED";
  sourceRef: string;
  verifiedAt: string | null;
  rates: readonly JurisdictionRateRow[];
}

/** GET /tax/packs/:country/versions → data (seeded version + tenant binding). */
export interface PackVersionsRow {
  countryCode: string;
  packVersion: string;
  verificationStatus: "REQUIRES_VERIFICATION" | "VERIFIED";
  tenantBinding: {
    id: string;
    countryCode: string;
    packVersion: string;
    appliedAt: string;
    appliedBy: string | null;
  } | null;
  windows: Array<{
    treatment: string;
    rate: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceRef: string;
    verifiedAt: string | null;
  }>;
}

/** GET /tax/vat-returns → rows (summary/crossCheck are the prepared JSON). */
export interface VatReturnRow {
  id: string;
  countryCode: string;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "READY" | "FILED";
  summary: Record<string, unknown>;
  crossCheck: Record<string, unknown>;
  crossCheckOk: boolean;
  preparedAt: string | null;
  preparedBy: string | null;
  filedAt: string | null;
  filedBy: string | null;
  filingReference: string | null;
  filingNote: string | null;
}

/** POST /tax/resolve-lines → per-line resolution rows (snapshot pinned). */
export interface ResolvedTaxLineRow {
  taxCodeId: string;
  code: string;
  treatment: string;
  rate: string;
  taxBase: string;
  taxAmount: string;
  gross: string;
  snapshot: Record<string, unknown>;
  notSubject: boolean;
}

/** POST /tax/resolve-lines → data (deterministic, side-effect-free). */
export interface ResolveLinesResultRow {
  lines: readonly ResolvedTaxLineRow[];
  notSubject: boolean;
  boundaryWarning: {
    countryCode: string;
    treatment: string;
    effectiveFrom: string;
    rate: string;
  } | null;
  pricingMode: "EXCLUSIVE" | "INCLUSIVE";
}

/** POST /tax/vat-returns/:id/export → data (signed download URL). */
export interface VatReturnExportResult {
  downloadUrl: string;
  rowCount: number;
  format: "CSV" | "XLSX";
  expiresInSeconds: number;
}

// -- T14-UI (PHASE-010): inventory & warehousing --------------------------------
// Row shapes mirror apps/api/src/modules/inventory/infrastructure/inventory.store.ts
// (camelCase wire fields, canonical decimal strings per ADR-0009). The store's
// TransferRow/TransferLineRow/AdjustmentRow are renamed Stock* here to avoid
// colliding with the PHASE-008 treasury TransferRow above.

/** GET /inventory/warehouses → rows. */
export interface WarehouseRow {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  code: string;
  name: string;
  nameAr: string | null;
  inventoryAccountId: string | null;
  inventoryAccountCode: string | null;
  isActive: boolean;
  note: string | null;
  /** PHASE-018 (0026 widening): RAW | WIP | FG convention hint, or null. */
  role: string | null;
}

/** GET /inventory/stock → rows (the transactionally-maintained item_stock read model). */
export interface StockOnHandRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  avgCost: string;
  negative: boolean;
}

/** GET /inventory/moves → rows (the append-only stock_moves ledger; movedAt is a date). */
export interface StockMoveRow {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  direction: "IN" | "OUT";
  moveKind: string;
  qty: string;
  unitCost: string;
  valueAmount: string;
  batchId: string | null;
  batchNo: string | null;
  serialId: string | null;
  serialNo: string | null;
  sourceType: string;
  sourceId: string;
  movedAt: string;
  reason: string | null;
  memo: string | null;
  memoAr: string | null;
  postedJournalId: string | null;
  createdAt: string;
}

/** GET /inventory/transfers → rows (stock_transfers; two-leg G-15 documents). */
export interface StockTransferRow {
  id: string;
  transferNo: string | null;
  fromWarehouseId: string;
  fromWarehouseCode: string;
  toWarehouseId: string;
  toWarehouseCode: string;
  status: "DRAFT" | "IN_TRANSIT" | "POSTED" | "CANCELLED";
  dispatchDate: string | null;
  receiveDate: string | null;
  postedJournalId: string | null;
  note: string | null;
  noteAr: string | null;
  lineCount: number;
}

/** GET /inventory/transfers/:id/lines → rows. */
export interface StockTransferLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  sku: string;
  itemName: string;
  qty: string;
}

/** GET /inventory/adjustments → rows (DRAFT → POSTED/CANCELLED; G-13/G-14). */
export interface StockAdjustmentRow {
  id: string;
  adjustmentNo: string | null;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  reason: string;
  deltaQty: string;
  unitCost: string | null;
  counterAccountId: string | null;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  postingDate: string | null;
  postedJournalId: string | null;
  note: string | null;
  noteAr: string | null;
}

/** GET /inventory/batches → rows (batch registry; BR-017 FEFO). */
export interface BatchRow {
  id: string;
  itemId: string;
  sku: string;
  batchNo: string;
  expiryDate: string | null;
  sourceRef: string | null;
  status: string;
}

/** GET /inventory/serials → rows (BR-018 unit tracking). */
export interface SerialRow {
  id: string;
  itemId: string;
  sku: string;
  serialNo: string;
  imei: string | null;
  status: "in_stock" | "sold" | "returned";
  currentOwner: string | null;
  soldAt: string | null;
  returnedAt: string | null;
}

/** GET /inventory/reservations → rows (§2.13 hold seam). */
export interface ReservationRow {
  id: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  status: string;
  holderType: string;
  holderId: string | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

/** GET /inventory/counts → rows (DRAFT → COUNTED → VARIANCE_REVIEW → POSTED). */
export interface CountRow {
  id: string;
  countNo: string | null;
  warehouseId: string;
  warehouseCode: string;
  status: "DRAFT" | "COUNTED" | "VARIANCE_REVIEW" | "POSTED" | "CANCELLED";
  blind: boolean;
  snapshotAt: string;
  countedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  supervisorOverride: boolean;
  postingDate: string | null;
  postedJournalId: string | null;
  variance: CountVariance | null;
  note: string | null;
  noteAr: string | null;
  lineCount: number;
}

/** Session-level variance summary (JSONB on stock_counts). */
export interface CountVariance {
  lossLines: number;
  gainLines: number;
  lossValue: string;
  gainValue: string;
}

/** GET /inventory/counts/:id/lines → rows (frozen snapshot + counted reality). */
export interface CountLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  sku: string;
  itemName: string;
  batchId: string | null;
  batchNo: string | null;
  systemQty: string;
  countedQty: string | null;
  recounted: boolean;
  recountNote: string | null;
  valueImpact: string | null;
}

/** GET /inventory/availability → data (BR-016 netting view of one item-warehouse pair). */
export interface StockAvailabilityRow {
  itemId: string;
  warehouseId: string;
  onHandQty: string;
  avgCost: string;
  reservedQty: string;
  inTransitQty: string;
  availableQty: string;
}

// -- envelope narrowing ------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSuccessEnvelope(value: unknown): value is { data: unknown } {
  return isRecord(value) && "data" in value;
}

export function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  if (!isRecord(value) || !("error" in value)) {
    return false;
  }
  const error = value.error;
  return isRecord(error) && typeof error.code === "string" && typeof error.message === "string";
}

/** Best-effort error body from an arbitrary upstream JSON value. */
export function errorBodyOf(value: unknown): ApiErrorBody {
  if (isErrorEnvelope(value)) {
    return value.error;
  }
  return { code: "INTERNAL", message: "unexpected upstream response" };
}

/** Narrows an envelope's `meta` into a PaginatedMeta when present (P4-T12a). */
export function paginatedMetaOf(value: unknown): PaginatedMeta | undefined {
  if (!isRecord(value) || !("meta" in value) || !isRecord(value.meta)) {
    return undefined;
  }
  const meta = value.meta;
  const requestId = typeof meta.requestId === "string" ? meta.requestId : "";
  const count = typeof meta.count === "number" ? meta.count : 0;
  const hasMore = typeof meta.hasMore === "boolean" ? meta.hasMore : false;
  if (typeof meta.nextCursor === "string" && meta.nextCursor !== "") {
    return { requestId, count, hasMore, nextCursor: meta.nextCursor };
  }
  return { requestId, count, hasMore };
}

/** A success payload that carries a bearer token (login/switch/accept). */
export function hasToken(value: unknown): value is { token: string } & Record<string, unknown> {
  return isRecord(value) && typeof value.token === "string" && value.token !== "";
}

export function parseJsonOrUndefined(text: string): unknown {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `details.retryAfterSeconds` (account-lockout / rate-limit payloads). */
export function retrySecondsFrom(details: unknown): number | undefined {
  if (isRecord(details) && typeof details.retryAfterSeconds === "number") {
    return details.retryAfterSeconds;
  }
  return undefined;
}

export function retrySecondsFromHeader(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

// ---------------------------------------------------------------------------
// PHASE-011 purchasing rows (GET /purchasing/** → module documents + AP views).

/** Purchase requests (approval routing → PO). */
export interface PurchaseRequestRow {
  id: string;
  branchId: string;
  requestNo: string | null;
  neededBy: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  convertedOrderId: string | null;
  cancelReason: string | null;
}

/** Purchase orders (DRAFT → ISSUED → CLOSED; linked revisions). */
export interface PurchaseOrderRow {
  id: string;
  branchId: string;
  supplierId: string;
  orderNo: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  revisionOfId: string | null;
  revisionNo: number;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  issuedAt: string | null;
}

/** Goods receipts (G-07: stock + GRNI accrual). */
export interface GoodsReceiptRow {
  id: string;
  branchId: string;
  supplierId: string;
  poId: string | null;
  warehouseId: string;
  receiptNo: string | null;
  receiptDate: string;
  status: string;
  poLessReason: string | null;
  totalValue: string;
  note: string | null;
  createdAt: string;
  postedJournalId: string | null;
}

/** Supplier invoices (G-08; match outcome recorded pre-approval). */
export interface SupplierInvoiceRow {
  id: string;
  branchId: string;
  supplierId: string;
  invoiceNo: string;
  internalNo: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  poId: string | null;
  status: string;
  matchStatus: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  duplicateWarning: { kind: string; existingId: string; existingAmount: string } | null;
  note: string | null;
  createdAt: string;
  postedJournalId: string | null;
}

/** Debit notes (G-09 AP corrections). */
export interface DebitNoteRow {
  id: string;
  branchId: string;
  supplierId: string;
  refInvoiceId: string;
  noteNo: string | null;
  noteDate: string;
  currencyCode: string;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  createdAt: string;
  postedJournalId: string | null;
}

/** AP aging row (deterministic as-of recomputation). */
export interface ApAgingRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierNameAr: string | null;
  currencyCode: string;
  notDue: string;
  b1_30: string;
  b31_60: string;
  b61_90: string;
  b90Plus: string;
  total: string;
  baseTotal: string;
  itemCount: number;
}

/** Supplier statement (running balance + aging column). */
export interface SupplierStatementRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierNameAr: string | null;
  asOf: string;
  currencyCode: string;
  closingBalance: string;
  closingBalanceBase: string;
  entries: readonly {
    entryDate: string;
    docRef: string | null;
    sourceType: string;
    memo: string | null;
    currencyCode: string;
    debit: string;
    credit: string;
    balance: string;
    baseBalance: string;
    outstanding: string;
  }[];
  aging: {
    not_due: string;
    "1_30": string;
    "31_60": string;
    "61_90": string;
    "90_plus": string;
  };
}

/** GRNI register row (received − invoiced per GRN line). */
export interface GrniRegisterRow {
  grnId: string;
  receiptNo: string | null;
  receiptDate: string;
  supplierId: string;
  grnLineId: string;
  itemId: string;
  receivedQty: string;
  receivedValue: string;
  invoicedQty: string;
  invoicedValue: string;
}

/** Three-way match result (preview + recorded). */
export interface MatchResultRow {
  matchedAt: string;
  tolerances: { qtyPct: string; pricePct: string };
  lines: readonly {
    invoiceLineNo: number;
    grnLineId: string | null;
    poQty: string | null;
    poUnitPrice: string | null;
    grnQty: string | null;
    grnUnitCost: string | null;
    invoiceQty: string;
    invoiceUnitPrice: string;
    qtyVariancePct: string | null;
    priceVariancePct: string | null;
    outcome: string;
    disposition: { type: string; reason: string } | null;
  }[];
  summary: { outcome: string; exceptions: number; undisposed: number };
}

/** Landed-cost row (the PHASE-011 baseline). */
export interface LandedCostRow {
  id: string;
  grnId: string;
  costNo: string | null;
  costType: string;
  vendorId: string | null;
  amount: string;
  allocationMethod: string;
  chargeAccountId: string;
  status: string;
  allocatedToStock: string;
  allocatedToCogs: string;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// PHASE-012 sales rows (GET /sales/** → module documents + AR views).

/** Sales representatives (attribution on sales documents; T12). */
export interface SalesRepRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
}

/** Quotations (DRAFT → SENT → ACCEPTED/REJECTED/EXPIRED; BR-006, no ledger). */
export interface QuotationRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  quoteNo: string | null;
  quoteDate: string;
  validUntil: string;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  convertedOrderId: string | null;
}

/** Sales orders (DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → CLOSED). */
export interface SalesOrderRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  warehouseId: string;
  quotationId: string | null;
  orderNo: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

/** Delivery notes (DRAFT → POSTED; G-03 COGS without AR). */
export interface DeliveryNoteRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  orderId: string | null;
  warehouseId: string;
  deliveryNo: string | null;
  deliveryDate: string;
  currencyCode: string;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  cogsValue: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  postedJournalId: string | null;
  convertedInvoiceId: string | null;
}

/**
 * Sales invoices (CASH/CREDIT; G-01/G-02). `creditCheck` is the BR-001
 * decision recorded on the document at approval (ALLOW/WARN/BLOCK + math).
 */
export interface SalesInvoiceRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  kind: string;
  invoiceNo: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  orderId: string | null;
  deliveryId: string | null;
  warehouseId: string | null;
  cashAccountId: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  cogsValue: string;
  taxSummary: Record<string, unknown> | null;
  creditCheck: { decision?: string; math?: string } | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  postedJournalId: string | null;
  postedCogsJournalId: string | null;
}

/** Credit notes (BR-004 returns/corrections; G-04 + W-3 re-entry). */
export interface CreditNoteRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  invoiceId: string;
  noteNo: string | null;
  noteDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  reentryValue: string;
  taxSummary: Record<string, unknown> | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  postedJournalId: string | null;
}

/** AR aging row (RC-10 deterministic as-of; bucketed per customer). */
export interface ArAgingRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  currencyCode: string;
  notDue: string;
  b1_30: string;
  b31_60: string;
  b61_90: string;
  b90Plus: string;
  total: string;
  baseTotal: string;
  itemCount: number;
}

/** AR statement entry (running balance over the AR subledger). */
export interface ArStatementEntry {
  entryDate: string;
  docRef: string | null;
  sourceType: string;
  memo: string | null;
  currencyCode: string;
  debit: string;
  credit: string;
  balance: string;
  baseBalance: string;
  outstanding: string;
}

/** Customer statement (BR-028) with the INV-009 subledger tie footer. */
export interface ArStatement {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  asOf: string;
  currencyCode: string;
  openingBalance: string;
  entries: readonly ArStatementEntry[];
  closingBalance: string;
  closingBalanceBase: string;
  aging: {
    not_due: string;
    "1_30": string;
    "31_60": string;
    "61_90": string;
    "90_plus": string;
  };
  subledgerTie: { ok: boolean; statementBalance: string; subledgerBalance: string };
}

/** Open AR item (the receipts allocation surface; INV-016). */
export interface ArOpenItemRow {
  id: string;
  partnerId: string;
  entryDate: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  baseAmount: string;
  currencyCode: string;
  exchangeRate: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  settledAmount: string;
  outstanding: string;
  dueDate: string | null;
}

/** POST /sales/jobs/invoice-overdue/run-scan → data (§2.9 job result). */
export interface OverdueScanResult {
  overdue: number;
  alerted: number;
  recipient: string | null;
}

// ---------------------------------------------------------------------------
// PHASE-013 reporting wire types (GET/POST /reporting/** — the report
// workspace surface; mirrors the module's contract.ts shapes).

/** Registry snapshot row (GET /reporting/reports → data; §2 navigation). */
export interface ReportRegistryItem {
  id: string;
  title: { ar: string; en: string };
  category: string;
  requiredPermission: string;
  version: number;
  executionClass: "inline" | "job";
  exportFormats: string[];
  semantics: "as-of" | "current";
}

/** Bilingual label pair as carried inside result envelopes. */
export interface ReportBilingual {
  ar: string;
  en: string;
}

/** Result column (REPORT_CONTRACT §2). */
export interface ReportResultColumn {
  id: string;
  label: ReportBilingual;
  type: "text" | "money" | "qty" | "date" | "status" | "link";
  numeric?: boolean;
}

/** Result group (section header between rows). */
export interface ReportResultGroup {
  key: string;
  label: ReportBilingual;
}

/** Drill-down hop generated per row (route is locale-substituted). */
export interface ReportDrillLink {
  label: ReportBilingual;
  route: string;
}

/** Result row (values keyed by column id). */
export interface ReportResultRow {
  key: string;
  values: Record<string, string | number | null>;
  groupKey?: string;
  drillLinks?: readonly ReportDrillLink[];
}

/** Totals row (kind 'check' = the locked balance-check glyph). */
export interface ReportResultTotal {
  id: string;
  label: ReportBilingual;
  amount: string;
  kind: "sum" | "check";
}

/** Executable reconciliation assertion result (§1). */
export interface ReportAssertion {
  id: string;
  status: "PASS" | "FAIL";
  detail?: ReportBilingual;
  compared?: { left: string; right: string };
}

/** The stored result envelope (GET /reporting/report-runs/:id/result → data). */
export interface ReportResultEnvelope {
  reportId: string;
  contractVersion: number;
  runId: string;
  paramsEcho: Record<string, unknown>;
  columns: readonly ReportResultColumn[];
  groups: readonly ReportResultGroup[];
  rows: readonly ReportResultRow[];
  totals: readonly ReportResultTotal[];
  assertions: readonly ReportAssertion[];
  freshness: {
    computedAt: string;
    asOf?: string | null;
    cacheState: "fresh" | "stale" | "recomputed";
  };
  formatting: {
    baseCurrency: string;
    numerals: "western";
    locale: "ar" | "en";
  };
  notes?: readonly ReportBilingual[];
}

/** POST /reporting/report-runs → data (inline envelope or a queued job). */
export interface ReportRunOutcome {
  runId: string;
  /** Present for completed inline runs (and cached job results). */
  result?: ReportResultEnvelope;
  /** Present when the run was enqueued (job path) — the client polls. */
  queued?: boolean;
  status: "SUCCEEDED" | "QUEUED" | "FAILED";
}

/** Run history row (GET /reporting/report-runs?limit → data). */
export interface ReportRunSummary {
  runId: string;
  reportKey: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string | null;
  assertionStatus: "PASS" | "FAIL" | null;
  executionClass: "inline" | "job";
  durationMs: number | null;
  createdAt: string;
}

/** Run status row (GET /reporting/report-runs/:id → data; polling). */
export interface ReportRunStatus {
  runId: string;
  reportKey: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string | null;
  assertionStatus: "PASS" | "FAIL" | null;
  errorCode: string | null;
  durationMs: number | null;
}

/** POST /reporting/report-runs/:id/exports → data (signed download URL). */
export interface ReportExportResult {
  url: string;
  expiresInSeconds: number;
  sha256: string;
  bytes: number;
}

/** GET /reporting/print-preview/:id → data (null when no stored result). */
export interface ReportPrintPreview {
  html: string;
  footerTemplate: string;
}

// ---------------------------------------------------------------------------
// T19-WEB (PHASE-014): subscription, billing, usage, notifications, checkout
// ---------------------------------------------------------------------------

/** Bilingual pair as carried by the PHASE-014 billing payloads. */
export interface BillingBilingual {
  ar: string;
  en: string;
}

/** GET /public/plans rows (pricing page data; PLACEHOLDER prices ⚠ OQ-002). */
export interface PublicPlanRow {
  key: string;
  name: string;
  nameAr: string;
  positioning: BillingBilingual | null;
  priceAmount: string;
  annualPriceAmount: string;
  currencyCode: string;
  billingPeriod: string;
  highlight: boolean;
  sortOrder: number;
  placeholderPrice: boolean;
  limits: Record<string, unknown>;
  featureKeys: string[];
}

/** Subscription wire row (tenancy plane; lifecycle columns). */
export interface BillingSubscriptionRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  provider: string | null;
  providerRef: string | null;
  providerCheckoutRef: string | null;
  providerSubscriptionRef: string | null;
  providerCustomerRef: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  dunningStep: number;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: string | null;
  journeyCompletedAt: string | null;
}

/** The plan summary carried by GET /tenancy/subscriptions. */
export interface BillingPlanSummary {
  key: string;
  name: string;
  nameAr: string;
  priceAmount: string;
  annualPriceAmount: string;
  currencyCode: string;
  positioning: BillingBilingual | null;
}

/** Subscription invoice row (billing history; both payment paths, A-009). */
export interface SubscriptionInvoiceRow {
  id: string;
  tenantId: string;
  subscriptionId: string;
  number: string;
  planKey: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currencyCode: string;
  status: "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";
  source: "checkout" | "manual" | "trial_credit";
  providerRef: string | null;
  dueDate: string;
  paidAt: string | null;
  paidVia: "provider_webhook" | "manual_recorded" | null;
  paidReference: string | null;
  recordedBy: string | null;
  reason: string | null;
  placeholderPrice: boolean;
}

/** Append-only billing event row. */
export interface BillingEventRow {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  actorId: string | null;
  viaPlatformAdmin: boolean;
  createdAt: string;
}

/** GET /tenancy/subscriptions → data (owner billing home payload). */
export interface BillingHistoryData {
  subscription: BillingSubscriptionRow | null;
  plan: BillingPlanSummary | null;
  invoices: readonly SubscriptionInvoiceRow[];
  events: readonly BillingEventRow[];
  trialDaysPlaceholder: number;
}

/** POST /tenancy/subscriptions/change-plan → data. */
export interface ChangePlanOutcome {
  action: "checkout_created" | "downgrade_scheduled";
  planKey: string;
  checkoutUrl?: string;
  invoiceNumber?: string;
  message: BillingBilingual;
}

/** POST /tenancy/subscriptions/checkout/:ref/complete → data. */
export interface CompleteCheckoutOutcome {
  processed: "payment.succeeded" | "payment.failed" | "duplicate" | "no-op";
  subscriptionStatus?: string;
  invoiceStatus?: string;
}

/** One usage counter view (GET /tenancy/usage → counters[]). */
export interface UsageCounterView {
  key: string;
  label: BillingBilingual;
  usage: number;
  limit: number | "unlimited";
  period: string | null;
  warn80: boolean;
  warn100: boolean;
  note: BillingBilingual | null;
}

/** GET /tenancy/usage → data (owner usage snapshot + warning re-evaluation). */
export interface UsageSnapshotData {
  plan: {
    key: string;
    name: string;
    nameAr: string;
    positioning: BillingBilingual | null;
    priceAmount: string;
    annualPriceAmount: string;
    currencyCode: string;
    placeholderPrice: boolean;
  } | null;
  subscription: {
    id: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    pendingPlanKey: string | null;
    readOnly: boolean;
  } | null;
  counters: readonly UsageCounterView[];
  warningsEvaluated: number;
}

/** POST /tenancy/settings/platform.onboarding.journey_state value shape. */
export interface JourneyStateValue {
  step:
    | "registered"
    | "activity_picked"
    | "workspace_provisioned"
    | "opening_balances_done"
    | "first_item_created"
    | "first_customer_created"
    | "first_invoice_posted"
    | "first_invoice_printed"
    | "completed"
    | "skipped";
  completed_at: string | null;
}

/** In-app notification row (self plane; content is row-bilingual, no dictionary). */
export interface NotificationRow {
  id: string;
  userId: string;
  category: "limits" | "subscription" | "reconciliation" | "invoice_overdue";
  severity: "info" | "warning" | "critical";
  title: BillingBilingual;
  body: BillingBilingual;
  actionLabel: BillingBilingual | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Per-category channel preference row (absent rows = both channels ON). */
export interface NotificationPrefRow {
  category: "limits" | "subscription" | "reconciliation" | "invoice_overdue";
  inApp: boolean;
  email: boolean;
}

/** GET /notifications/unread-count → data. */
export interface UnreadCountData {
  count: number;
}

/** GET /platform/subscriptions?tenantId=… → data (admin billing panel). */
export interface PlatformBillingHistory {
  subscription: BillingSubscriptionRow | null;
  plan: BillingPlanSummary | null;
  invoices: readonly SubscriptionInvoiceRow[];
  events: readonly BillingEventRow[];
}

/** POST /platform/subscriptions/:id/manual-payment → data. */
export interface ManualPaymentOutcome {
  invoiceNumber: string;
  subscriptionStatus: string;
}

/** POST /platform/subscriptions/:id/suspend → data (billing-driven). */
export interface BillingSuspendOutcome {
  tenantId: string;
  killedSessions: number;
}

/** POST /platform/subscriptions/:id/restore → data. */
export interface BillingRestoreOutcome {
  tenantId: string;
}

/** POST /platform/subscriptions/run-daily-pass → data (outcome counts). */
export interface DailyPassOutcome {
  trialsExpired: number;
  suspensions: number;
  downgradesApplied: number;
  downgradesBlocked: number;
  overdueInvoices: number;
  documentsReconciled: number;
}

/** Downgrade blocker detail (422 tenancy/downgrade-blocked → details.blockers). */
export interface DowngradeBlocker {
  limit: string;
  usage: number;
  limitValue: number;
}

// ---------------------------------------------------------------------------
// PHASE-015 T11 (3-a) — industry templates + effective configuration wire
// types. Every shape mirrors the configuration controller verbatim
// (apps/api/src/modules/configuration/presentation/configuration.controller.ts
// + application/{apply,switch,closure,resolve} payload types — verified
// against the live code, never assumed).
// ---------------------------------------------------------------------------

/** Bilingual label carried by every configuration payload ({ ar, en }). */
export interface ConfigLocalizedText {
  ar: string;
  en: string;
}

/** GET configuration/templates → one ACTIVE registry row. */
export interface IndustryTemplateRow {
  key: string;
  name: string;
  nameAr: string;
  version: string;
  status: string;
  description: string | null;
  descriptionAr: string | null;
}

/** GET configuration/templates/activity-map → one catalog activity. */
export interface ActivityCatalogRow {
  activity: string;
  label: ConfigLocalizedText;
  keywords: readonly string[];
  templateKey: string;
}

/** GET configuration/templates/activity-map → the catalog + the ?activity= resolution. */
export interface ActivityMapData {
  activities: readonly ActivityCatalogRow[];
  resolution: {
    activity: string;
    templateKey: string;
    confidence: "exact" | "suggested";
  } | null;
}

/** One capability's classification vs the caller's entitlements (README §4). */
export interface PrerequisiteCapabilityState {
  capabilityId: string;
  level: "REQUIRED" | "OPTIONAL";
  featureKeys: readonly string[];
  status: "included" | "phase_gated" | "hidden" | "blocked";
  /** For phase_gated: the phase the capability ships with (e.g. PHASE-016). */
  phase?: string;
  /** For blocked/hidden: the keys missing from the entitlements. */
  missingKeys?: readonly string[];
}

/** The §4 prerequisite check (detail preview + apply/switch payloads carry it). */
export interface PrerequisiteCheckView {
  status: "ok" | "blocked";
  missingChain: readonly string[];
  guidance: ConfigLocalizedText | null;
  capabilities: readonly PrerequisiteCapabilityState[];
  closureViolations: readonly { featureKey: string; missing: readonly string[] }[];
  requiresAcknowledgement: boolean;
}

/** GET configuration/templates/:key → manifest + capability preview + appliedHere. */
export interface IndustryTemplateDetail {
  key: string;
  version: string;
  status: string;
  manifest: IndustryTemplateManifest;
  appliedHere: {
    appliedVersion: string;
    appliedManifestHash: string;
    isPrimary: boolean;
  } | null;
  capabilityPreview: PrerequisiteCheckView;
}

/** POST configuration/templates/:key/apply → data. */
export interface TemplateApplyOutcome {
  applied: boolean;
  reason?: "already-applied";
  templateKey: string;
  version: string;
  manifestHash: string;
  addedSeries: readonly { docType: string; format: string }[];
  prerequisiteCheck: PrerequisiteCheckView;
}

// -- the R9 what-will-change diff (POST …/:key/preview, mode switch|extend) --

export interface CapabilityDiffEntry {
  capabilityId: string;
  featureKeys: readonly string[];
  phase?: string;
}

export interface RenamedLabelEntry {
  termKey: string;
  from: ConfigLocalizedText | null;
  to: ConfigLocalizedText | null;
}

export interface NumberingSeriesEntry {
  docType: string;
  prefix: string;
  format: string;
  perBranch: boolean;
  reserveOnApproval: boolean;
}

export interface InventoryDefaultChange {
  key: string;
  from: string | number | boolean;
  to: string | number | boolean;
  /** R3: defaults apply to NEWLY created items only — never a mutation. */
  note: "new-items-only";
}

export interface WorkflowPolicyChange {
  key: string;
  from: string | number | boolean | null;
  to: string | number | boolean;
  /** True when both templates set the key with different values (§7 conflict). */
  conflict: boolean;
}

export interface TemplateSwitchPreview {
  mode: "switch" | "extend";
  fromTemplate: { key: string; version: string } | null;
  toTemplate: { key: string; version: string; manifestHash: string };
  addedCapabilities: {
    included: readonly CapabilityDiffEntry[];
    phaseGated: readonly CapabilityDiffEntry[];
    optionalMissing: readonly CapabilityDiffEntry[];
  };
  archivedCapabilities: readonly CapabilityDiffEntry[];
  renamedLabels: readonly RenamedLabelEntry[];
  newNumberingSeries: readonly NumberingSeriesEntry[];
  keptNumberingSeries: readonly { docType: string; format: string }[];
  inventoryDefaultChanges: readonly InventoryDefaultChange[];
  workflowPolicyChanges: readonly WorkflowPolicyChange[];
  reportPinChanges: { added: readonly string[]; removed: readonly string[] };
  onboardingChecklistChanges: { added: readonly string[]; removed: readonly string[] };
  blocked: boolean;
  missingChain: readonly string[];
  acknowledgementRequired: boolean;
  acknowledgementPhases: readonly string[];
}

/** POST configuration/templates/:key/switch|extend → data. */
export interface TemplateSwitchResult {
  applied: boolean;
  reason?: "already-applied";
  diff: TemplateSwitchPreview;
}

/** POST configuration/templates/drift-check → data (offers, never auto-applied). */
export interface TemplateDriftResult {
  status: "no-template" | "current" | "upgrade-available" | "registry-behind";
  templateKey: string | null;
  appliedVersion: string | null;
  registryVersion: string | null;
  drift: "patch" | "minor" | "major" | null;
  notification: { recorded: boolean; dedupeKey: string } | null;
}

// -- GET configuration/effective-config (the ten-layer §5 object) -----------

export interface EffectiveConfigBranchDefaults {
  numbering_series: Record<string, string>;
  default_warehouse: string | null;
  cash_account: string | null;
}

export interface EffectiveConfigLayers {
  l1_template: { key: string; version: string; terminology_overrides: number } | null;
  l2_jurisdiction_pack: {
    country_code: string;
    pack_version: string;
    vat_status: string;
    tenant_registration: string;
  } | null;
  l3_plan: { key: string; limits: Record<string, unknown> } | null;
  l4_entitlements: {
    active: readonly string[];
    missing: readonly string[];
    sources: Record<string, string>;
  };
  l7_branch_defaults: Record<string, EffectiveConfigBranchDefaults>;
  l8_installed: Record<string, boolean>;
}

/** L9 derived navigation item (phase_gated markers, not hidden). */
export interface DerivedNavItem {
  id: string;
  label: ConfigLocalizedText;
  target: string;
  feature_key?: string;
  phase_gated?: string;
}

/** L9 derived navigation group (empty groups already dropped server-side). */
export interface DerivedNavGroup {
  id: string;
  label: ConfigLocalizedText;
  order: number;
  items: readonly DerivedNavItem[];
}

/** GET configuration/effective-config → data (§5: tenant-static + request overlay). */
export interface EffectiveConfig {
  config_version: number;
  resolved_hash: string;
  tenant: {
    id: string;
    industry_template: string | null;
    jurisdiction: string;
    base_currency: string;
  };
  layers: EffectiveConfigLayers;
  /** Merged policy map (L10 > L5 > L1 > platform default per value class). */
  policies: Record<string, string | number | boolean>;
  ui: {
    navigation: readonly string[];
    navigation_tree: readonly DerivedNavGroup[];
    emphasis: readonly string[];
    terminology: Record<string, ConfigLocalizedText>;
  };
  invariants_note: string;
  request_overlay: {
    user_id: string;
    role: string;
    branch_scope: readonly string[];
    actions: readonly string[];
  } | null;
}

// -- PHASE-016 POS payloads (T4/T10 web UI; hand-written per ADR-0003) --------

export type PosReceiptSize = "80mm" | "58mm";
export type PosOrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";

/** GET/POST /pos/terminals rows (the registry; money-free). */
export interface PosTerminalRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  branchId: string;
  deviceId: string | null;
  cashAccountId: string;
  warehouseId: string | null;
  receiptSize: PosReceiptSize;
  status: "ACTIVE" | "INACTIVE";
  quickKeys: Record<string, unknown> | null;
  lastSeenAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  offlineSeq: number;
}

/** POST /pos/terminals/:id/devices → data. */
export interface PosDeviceEnrollResult {
  terminal: PosTerminalRow;
  deviceId: string;
}

/** One tender line of a POS sale (CASH split to till, CARD to receivable). */
export interface PosSaleTender {
  method: "CASH" | "CARD";
  amount: string;
  reference?: string | null;
}

/** POST /pos/sales → data (posting is automatic — BR-005 cash autopost). */
export interface PosSaleResult {
  invoice: SalesInvoiceRow;
  journalEntryId: string | null;
  terminal: PosTerminalRow;
}

/** POST /pos/terminals/:id/shift/open → data. */
export interface PosShiftOpenResult {
  shift: ShiftRow;
  alreadyOpen: boolean;
}

/** A guest-check line (working jsonb document — no ledger effect until paid). */
export interface PosCheckLine {
  lineNo: number;
  itemId: string;
  name: string;
  nameAr: string | null;
  qty: string;
  unitPrice: string;
  note: string | null;
  sentToKitchen: boolean;
}

/** GET/POST /pos/checks rows (table-service guest checks). */
export interface PosCheckRow {
  id: string;
  branchId: string;
  checkNo: string;
  tableId: string | null;
  orderType: PosOrderType;
  guestCount: number;
  status: "OPEN" | "PAID" | "CANCELLED";
  lines: PosCheckLine[];
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  invoiceId: string | null;
  note: string | null;
}

/** POST /pos/checks/:id/split → data. */
export interface PosCheckSplitResult {
  source: PosCheckRow;
  target: PosCheckRow;
}

/** A floor-plan table with its OPEN check link (occupancy is derived). */
export interface PosFloorTable {
  id: string;
  branchId: string;
  zone: string;
  zoneAr: string | null;
  label: string;
  seats: number;
  status: "FREE" | "OCCUPIED" | "RESERVED" | "OUT_OF_SERVICE";
  sortKey: number;
  openCheckId: string | null;
  openCheckNo: string | null;
}

/** GET /pos/floor?branchId= → zones (tables grouped, ordered). */
export interface PosFloorZone {
  zone: string;
  zoneAr: string | null;
  tables: PosFloorTable[];
}

/** GET /pos/checks/:id/kitchen-tickets rows. */
export interface PosKitchenTicketRow {
  id: string;
  checkId: string;
  ticketNo: string;
  items: PosCheckLine[];
  status: "PRINTED" | "VOID";
  printedAt: string;
}

/** GET /pos/invoices/:id/receipt → data (screen + paper share the HTML). */
export interface PosReceiptRender {
  html: string;
  payload: Record<string, unknown>;
  template: "receipt-80" | "receipt-58";
}

/** GET /pos/z-report → data (the end-of-day close derivation). */
export interface PosZReport {
  zNumber: string;
  branchId: string;
  date: string;
  totals: {
    invoiceCount: number;
    totalNet: string;
    totalTax: string;
    totalGross: string;
  };
  byOrderType: readonly { orderType: string; count: number; net: string; tax: string; gross: string }[];
  byTender: readonly { method: string; amount: string }[];
  byTerminal: readonly { terminalId: string; count: number; gross: string }[];
  byHour: readonly { hour: string; count: number; gross: string }[];
  offlineReconciliation: readonly {
    invoiceNo: string | null;
    offlineReceiptNo: string | null;
    orderType: string;
    gross: string;
    createdAt: string;
  }[];
  shift: Record<string, unknown> | null;
}

/**
 * The LOCAL offline outbox entry (T10 state honesty): a sale captured while
 * offline keeps its `OFF-…` number and `PENDING_SYNC` state until the server
 * accepts it — the official number appears NOWHERE before that. Lives in
 * localStorage (`pos-outbox`), never on the wire as-is.
 */
export interface PosOutboxEntry {
  clientId: string;
  offlineReceiptNo: string;
  terminalId: string;
  terminalCode: string;
  createdAt: string;
  status: "PENDING_SYNC" | "SYNCED" | "REJECTED";
  /** True once the user chooses "keep" — auto-retry stops, record stays. */
  kept: boolean;
  localCancelReason?: string;
  /** Typed sync rejection (SYNC_PROTOCOL §11: PERIOD_LOCKED | PRICE_CHANGED | …). */
  rejection?: { reason: string; message: string };
  sale: {
    customerId: string | null;
    orderType: PosOrderType;
    checkId?: string | null;
    lines: readonly {
      itemId: string;
      description?: string | null;
      descriptionAr?: string | null;
      qty: string;
      unitPrice: string;
      discountAmount?: string | null;
      taxCodeId?: string | null;
      serialIds?: string[] | null;
    }[];
    tenders: readonly PosSaleTender[];
  };
}

// -- PHASE-017 T14 (9a-dist): distribution + commissions wire rows ------------------
//
// Hand-written mirrors of the distribution module's store rows (apps/api
// src/modules/distribution/infrastructure/distribution.store.ts + the sales
// commissions store) — same ADR-0003 no-schema-library policy as the rest of
// this file. Money/qty travel as canonical decimal strings.

/** Weekday codes on routes (day_pattern jsonb array). */
export type RouteDayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

/** GET /distribution/routes → rows. */
export interface RouteRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  salesRepId: string | null;
  salesRepCode: string | null;
  salesRepName: string | null;
  vanWarehouseId: string | null;
  vanWarehouseCode: string | null;
  dayPattern: string[];
  status: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** POST /distribution/routes/:id/customers → rows (the full-replace result). */
export interface RouteCustomerRow {
  id: string;
  routeId: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerNameAr: string | null;
  visitOrder: number;
  isPinned: boolean;
}

/** POST /distribution/routes/:id/plan-visits → data (planned + the day's visits). */
export interface RoutePlanVisitsResult {
  date: string;
  planned: number;
  skipped: number;
  visits: RouteVisitRow[];
}

/** GET /distribution/visits → rows (the visit board). */
export interface RouteVisitRow {
  id: string;
  routeId: string;
  routeCode: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerNameAr: string | null;
  plannedDate: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  salesInvoiceId: string | null;
  creditNoteId: string | null;
  receiptId: string | null;
  salesRepId: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /distribution/vans → rows (the VAN slice of warehouses). */
export interface VanRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  salesRepId: string | null;
  salesRepCode: string | null;
  salesRepName: string | null;
  isActive: boolean;
  note: string | null;
}

/** GET /distribution/van-stock → rows (the per-van mirror of stock_moves). */
export interface VanStockRow {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  batchId: string | null;
  qty: string;
  value: string;
  refreshedAt: string;
}

/** GET /distribution/settlements → rows (decorated server-side with
 * approvalRequired — a beyond-tolerance COUNTED variance needs the hop). */
export interface RepSettlementRow {
  id: string;
  settlementNo: string | null;
  salesRepId: string;
  salesRepCode: string | null;
  salesRepName: string | null;
  vanWarehouseId: string | null;
  vanWarehouseCode: string | null;
  shiftId: string | null;
  shiftNo: string | null;
  settlementDate: string;
  status: string;
  openingCash: string;
  cashSales: string;
  collections: string;
  cashRefunds: string;
  repExpenses: string;
  expectedCash: string;
  countedCash: string | null;
  variance: string | null;
  varianceDirection: string | null;
  varianceReason: string | null;
  varianceJournalId: string | null;
  depositAccountId: string | null;
  depositAmount: string | null;
  depositJournalId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  approvalRequired: boolean;
}

/** GET /distribution/settlements/:id → row + its component lines. */
export interface RepSettlementWithLines extends RepSettlementRow {
  lines: RepSettlementLineRow[];
}

/** One expected-cash component line (signed; Σ = expected cash). */
export interface RepSettlementLineRow {
  id: string;
  settlementId: string;
  lineNo: number;
  component: string;
  amount: string;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  descriptionAr: string | null;
}

/** GET /distribution/tiers → rows (BR-003 tier price lists). */
export interface CustomerTierRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  priceListId: string | null;
  priceListName: string | null;
  discountCapPct: string | null;
  visitFrequencyDays: number | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /distribution/free-goods-rules → rows (BR-008 buy-X-get-Y FOC). */
export interface FreeGoodsRuleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  ruleType: string;
  buyItemId: string;
  buyItemSku: string | null;
  buyQty: string;
  getItemId: string;
  getItemSku: string | null;
  getQty: string;
  perMultiple: boolean;
  maxFreePerOrder: string | null;
  tierId: string | null;
  tierCode: string | null;
  reasonCode: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /sales/commission-runs → rows. */
export interface CommissionRunRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  periodFrom: string;
  periodTo: string;
  basis: "INVOICED" | "COLLECTED";
  status: "DRAFT" | "POSTED" | "CANCELLED";
  totalBase: string;
  totalCommission: string;
  journalEntryId: string | null;
  computedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  note: string | null;
  noteAr: string | null;
}

/** GET /sales/commission-runs/:id → row + lines. */
export interface CommissionRunWithLines extends CommissionRunRow {
  lines: CommissionRunLineRow[];
}

/** One commission run line joined with its rep. */
export interface CommissionRunLineRow {
  id: string;
  runId: string;
  salesRepId: string;
  repCode: string;
  repName: string;
  baseAmount: string;
  rateApplied: string;
  commissionAmount: string;
  detail: Record<string, unknown> | null;
  payoutStatus: "ACCRUED" | "PAID";
  paymentId: string | null;
}

/** GET /sales/reps/:id/commission-rule → row (the per-rep rule editor's model). */
export interface RepCommissionRuleRow {
  repId: string;
  code: string;
  name: string;
  status: string;
  method: "NONE" | "PERCENTAGE";
  rate: string;
  basis: "INVOICED" | "COLLECTED";
  tiers: { upTo: string | null; rate: string }[] | null;
}

// -- PHASE-017 T6 (9-a): automotive rows ---------------------------------------

/**
 * GET/POST /sales/job-cards rows (PHASE-017 T3). Money/qty/hours travel as
 * canonical decimal STRINGS (ADR-0009); partsIssueMode is `reserve` |
 * `issue_immediate` (service-level union rendered as string on the wire).
 */
export interface JobCardRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  cardNo: string | null;
  customerId: string;
  vehicleId: string | null;
  status: string;
  partsIssueMode: string;
  warehouseId: string;
  complaints: string | null;
  complaintsAr: string | null;
  diagnosis: string | null;
  diagnosisAr: string | null;
  odometerKm: string | null;
  checkedInAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  invoicedAt: string | null;
  cancelledAt: string | null;
  quotationId: string | null;
  invoiceId: string | null;
  creditNoteId: string | null;
  laborHoursTotal: string;
  note: string | null;
  noteAr: string | null;
}

/**
 * A job-card line (PHASE-017 T3): PARTS lines reference STOCK items (qty =
 * parts count, unitPrice = per-unit), LABOR lines reference SERVICE items
 * (estimatedHours = billed quantity, unitPrice = per-hour rate).
 */
export interface JobCardLineRow {
  id: string;
  jobCardId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  estimatedHours: string | null;
  loggedHours: string;
  discountAmount: string;
  taxCodeId: string | null;
  status: string;
  reservationId: string | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  issueJournalId: string | null;
  invoiceLineId: string | null;
  note: string | null;
  createdBy: string | null;
}

/** GET /sales/job-cards/:id → the card with its lines (findWithLines). */
export type JobCardWithLines = JobCardRow & { lines: readonly JobCardLineRow[] };

/** GET/POST /partners/vehicles rows (PHASE-017 T5; the per-partner registry). */
export interface VehicleRow {
  id: string;
  tenantId: string;
  createdBy: string | null;
  partnerId: string;
  make: string;
  model: string;
  modelYear: number | null;
  chassisNo: string | null;
  plateNo: string | null;
  color: string | null;
  engineNo: string | null;
  odometerKm: string | null;
  odometerAt: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * GET /partners/vehicles/:id/service-history entries: the per-vehicle
 * timeline (job cards by check-in date, invoices, warranty credit notes),
 * newest first; job cards carry no document total (null).
 */
export interface VehicleHistoryEntry {
  kind: "JOB_CARD" | "INVOICE" | "CREDIT_NOTE";
  id: string;
  docNo: string | null;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  status: string;
  /** Decimal string; job cards carry no document total (null). */
  total: string | null;
}

// -- PHASE-018 (T41): manufacturing wire rows -------------------------------------
// (BOMs, production orders, QC inspections, genealogy — mirrors the
// manufacturing store/service types exactly; ADR-0009 decimal strings:
// quantities numeric(19,6), money numeric(19,4), percentages numeric(7,4).)

/** GET /manufacturing/boms → rows (bills_of_materials; one row per version). */
export interface BomRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  itemId: string;
  versionNo: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | string;
  outputUomId: string;
  yieldPct: string;
  effectiveFrom: string | null;
  note: string | null;
  noteAr: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
}

/** A BOM component line (uomId = the component item's base uom). */
export interface BomLineRow {
  id: string;
  bomId: string;
  lineNo: number;
  componentItemId: string;
  uomId: string;
  qtyPerOutput: string;
  scrapPct: string;
  note: string | null;
  noteAr: string | null;
}

/** GET /manufacturing/boms/:id → the version with its lines (findWithLines). */
export type BomWithLines = BomRow & { lines: readonly BomLineRow[] };

/** One item requirement at one explosion level (bom-service explode). */
export interface ExplosionLevelItem {
  itemId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  /** The gross requirement at this level — canonical 6dp string. */
  qty: string;
  scrapPct: string;
  /** The yield of the BOM version that produced this line (4dp). */
  yieldPct: string;
  /** The semi-finished parent whose BOM produced this line; null on level 1. */
  viaSemiFinished: string | null;
}

/** GET /manufacturing/boms/explosion?itemId=&qty=&bomId= → the multi-level explosion. */
export interface ExplosionResult {
  item: { id: string; sku: string; name: string; nameAr: string | null };
  /** The requested output quantity — canonical 6dp string. */
  outputQty: string;
  levels: { level: number; items: readonly ExplosionLevelItem[] }[];
  /** Per-item sum across levels, itemId-ascending. */
  totals: { itemId: string; sku: string; qty: string }[];
}

/** GET /manufacturing/production-orders → rows (production_orders). */
export interface ProductionOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  /** NULL until release reserves + binds the PRD number (INV-021). */
  orderNo: string | null;
  status: "DRAFT" | "RELEASED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | string;
  /** The BOM version bound at release (input bomId ?? the item's ACTIVE). */
  bomId: string | null;
  itemId: string;
  uomId: string;
  plannedQty: string;
  plannedDate: string | null;
  actualQty: string;
  materialsWarehouseId: string;
  fgWarehouseId: string;
  laborRate: string;
  overheadRate: string;
  costCenterId: string | null;
  yieldSnapshot: string | null;
  fgBatchId: string | null;
  fgJournalId: string | null;
  fgValue: string;
  wipCreditValue: string;
  laborValue: string;
  overheadValue: string;
  note: string | null;
  noteAr: string | null;
  cancelReason: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** A release-frozen level-1 plan line (production_order_lines). */
export interface ProductionOrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  componentItemId: string;
  uomId: string;
  plannedQty: string;
  scrapPct: string;
  actualQty: string;
  overPlan: boolean;
  note: string | null;
  noteAr: string | null;
}

/** One consumed slice (production_consumptions; batch-granular). */
export interface ProductionConsumptionRow {
  id: string;
  orderId: string;
  itemId: string;
  batchId: string | null;
  qty: string;
  unitCost: string;
  value: string;
  journalId: string | null;
  consumedAt: string;
  note: string | null;
  noteAr: string | null;
}

/** One pre-completion WIP scrap (production_scraps; reason-coded). */
export interface ProductionScrapRow {
  id: string;
  orderId: string;
  reasonCode: string;
  qty: string;
  value: string;
  journalId: string | null;
  scrappedAt: string;
  note: string | null;
  noteAr: string | null;
}

/** The completion summary (the order's fg fields + batch provenance). */
export interface OrderCompletionSummary {
  journalEntryId: string | null;
  batchId: string | null;
  batchNo: string | null;
  expiry: string | null;
  fgValue: string;
  wipCredit: string;
  labor: string;
  overhead: string;
}

/** GET /manufacturing/production-orders/:id → the full order workspace. */
export interface ProductionOrderDetail {
  order: ProductionOrderRow;
  lines: readonly ProductionOrderLineRow[];
  consumptions: readonly ProductionConsumptionRow[];
  scraps: readonly ProductionScrapRow[];
  completion: OrderCompletionSummary;
}

/** POST /manufacturing/production-orders/:id/consume result (one journal per call). */
export interface ConsumeResult {
  order: ProductionOrderRow;
  journalEntryId: string;
  consumptions: readonly ProductionConsumptionRow[];
}

/** POST /manufacturing/production-orders/:id/scrap result (DR scrap · CR WIP). */
export interface ScrapResult {
  order: ProductionOrderRow;
  journalEntryId: string;
  scrap: ProductionScrapRow;
}

/** POST /manufacturing/production-orders/:id/complete result (FG receipt + journal). */
export interface CompletionResult extends OrderCompletionSummary {
  order: ProductionOrderRow;
}

/** GET /manufacturing/inspections → rows (the QC pass/fail log). */
export interface InspectionRow {
  id: string;
  targetType: "production_order" | "goods_receipt";
  orderId: string | null;
  grnId: string | null;
  fgBatchId: string | null;
  result: "PASS" | "FAIL";
  sampled: boolean;
  sampleSize: number | null;
  disposition: "ACCEPT" | "SCRAP" | "REWORK" | "RETURN_TO_SUPPLIER" | null;
  inspectedAt: string;
  note: string | null;
  noteAr: string | null;
}

/** POST /manufacturing/inspections result (the gate decision + its effects). */
export interface CreateInspectionResult {
  inspection: InspectionRow;
  /** A quarantine hold was released (PASS/ACCEPT or the FAIL+ACCEPT override). */
  released: boolean;
  /** FAIL+SCRAP leg only — the qc_scrap journal (§1 row 4). */
  scrapJournalEntryId: string | null;
  scrapQty: string | null;
  scrapValue: string | null;
}

/** A genealogy batch identity (item_batches JOIN items). */
export interface GenealogyBatchRef {
  batchId: string;
  batchNo: string;
  itemId: string;
  sku: string;
  status: string;
  expiryDate: string | null;
}

/** One upstream material edge (level = hops; producedBy null = purchased). */
export interface UpstreamMaterialEdge {
  /** Hops from the queried batch (1 = the producing order's inputs). */
  level: number;
  batchId: string;
  batchNo: string;
  itemId: string;
  sku: string;
  qty: string;
  consumedByOrderId: string;
  consumedByOrderNo: string | null;
  /** The material batch's own producing order (null for purchased batches). */
  producedByOrderId: string | null;
  producedByOrderNo: string | null;
}

/** GET /manufacturing/genealogy/upstream/:batchId → the material walk. */
export interface GenealogyUpstreamResult {
  batch: GenealogyBatchRef;
  materials: readonly UpstreamMaterialEdge[];
}

/** One downstream production edge (an order that consumed the batch). */
export interface DownstreamProductionEdge {
  /** Hops from the queried batch (1 = an order that consumed it directly). */
  level: number;
  fromBatchId: string;
  fromBatchNo: string | null;
  orderId: string;
  orderNo: string | null;
  orderStatus: string;
  fgBatchId: string | null;
  fgBatchNo: string | null;
  fgItemId: string | null;
  fgSku: string | null;
  qty: string;
}

/** One downstream sale edge off stock_moves (IDS ONLY — the report enriches). */
export interface DownstreamSaleEdge {
  /** Hops from the queried batch (1 = sold straight off it). */
  level: number;
  batchId: string;
  docType: "sales_invoice" | "delivery_note";
  docId: string;
  docDate: string;
  qty: string;
}

/** GET /manufacturing/genealogy/downstream/:batchId → the forward walk. */
export interface GenealogyDownstreamResult {
  batch: GenealogyBatchRef;
  productions: readonly DownstreamProductionEdge[];
  sales: readonly DownstreamSaleEdge[];
}

/** GET /manufacturing/genealogy/batch/:batchId → the recall summary. */
export interface GenealogyBatchSummary {
  batch: GenealogyBatchRef;
  producingOrderId: string | null;
  producingOrderNo: string | null;
  onHand: string;
  consumedByOrders: { orderId: string; orderNo: string | null; qty: string }[];
  salesCount: number;
  inspectionsCount: number;
}

// -- PHASE-019 (T50): crm + projects wire rows ------------------------------------
// (mirrors the crm store Row interfaces + the accounting ProjectRow exactly —
// camelCase, canonical decimal strings, "STATUS" | string unions; ADR-0009)

/** GET /crm/leads rows (the NEW → QUALIFIED → CONVERTED/LOST pipeline). */
export interface LeadRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  name: string;
  nameAr: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string;
  status: string;
  lostReason: string | null;
  ownerUserId: string | null;
  partnerId: string | null;
  convertedAt: string | null;
  note: string | null;
  noteAr: string | null;
}

/** GET /crm/tasks rows (future work — OPEN → DONE/CANCELLED). */
export interface CrmTaskRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  title: string;
  relatedType: string;
  relatedId: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  remindAt: string | null;
  notifiedAt: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
}

/** GET /crm/activities rows (the logged-past timeline). */
export interface CrmActivityRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  kind: string;
  relatedType: string;
  relatedId: string;
  occurredAt: string;
  summary: string;
  durationMinutes: number | null;
  actorUserId: string | null;
}

/** GET /crm/contracts rows (the inner service_contracts projection). */
export interface ServiceContractRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  contractNo: string | null;
  partnerId: string;
  projectId: string | null;
  title: string;
  titleAr: string | null;
  scope: string | null;
  feeModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: string | null;
  currencyCode: string;
  status: string;
  renewedToContractId: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
}

/** The contracts read envelope: the row + the DERIVED expiry flag (§4). */
export interface ServiceContractReadRow {
  contract: ServiceContractRow;
  isExpired: boolean;
}

/** GET /crm/contracts/:id/schedule rows (the §4 expanded grid). */
export interface ScheduleEntryRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  contractId: string;
  entryType: string;
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  billDate: string;
  amount: string | null;
  feeItemId: string;
  milestoneLabel: string | null;
  milestoneLabelAr: string | null;
  status: string;
  invoiceId: string | null;
}

/** One would-be invoice line of a due schedule entry (the run's mirror). */
export interface PreviewInvoiceLine {
  feeItemId: string;
  qty: string;
  unitPrice: string | null;
  description: string | null;
}

/** One due PLANNED entry of a billing preview (the T47 contract). */
export interface BillingPreviewItemRow {
  entry: ScheduleEntryRow;
  wouldInvoice: readonly PreviewInvoiceLine[];
  pullableTimeEntries: readonly TimeEntryRow[];
  needsNarrative: readonly TimeEntryRow[];
  periodStatus: "OPEN" | "SOFT_CLOSED" | "LOCKED" | "NONE";
  periodLocked: boolean;
}

/** GET /crm/contracts/:id/billing-preview?asOf → data. */
export interface BillingPreviewRow {
  contractId: string;
  asOf: string;
  items: readonly BillingPreviewItemRow[];
}

/** GET /crm/contract-invoices rows (the idempotency guard listing). */
export interface ContractInvoiceRow {
  id: string;
  createdAt: string;
  contractId: string;
  invoiceId: string;
  periodKey: string | null;
  milestoneScheduleId: string | null;
  status: string;
}

/** GET /crm/contracts/:id/advances rows (on-account receipts tagged). */
export interface ContractAdvanceRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  contractId: string;
  receiptId: string;
  amount: string;
  status: string;
  deferJournalId: string | null;
  releasedJournalId: string | null;
  releasedInvoiceId: string | null;
  note: string | null;
  noteAr: string | null;
}

/** GET /crm/time-entries rows (timeslips — rate snapshotted at recording). */
export interface TimeEntryRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  entryDate: string;
  hours: string;
  feeItemId: string;
  projectId: string | null;
  contractId: string | null;
  feeEarnerUserId: string | null;
  unitRate: string;
  narrative: string | null;
  billable: boolean;
  status: string;
  billedInvoiceId: string | null;
}

/** POST /crm/time/timesheets/review → data (the batch DRAFT → APPROVED flip). */
export interface TimesheetReviewResult {
  weekStart: string;
  weekEnd: string;
  reviewed: number;
}

/** GET /crm/service-orders rows (the job-card generalization). */
export interface ServiceOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  orderNo: string | null;
  partnerId: string;
  contractId: string | null;
  warehouseId: string;
  status: string;
  note: string | null;
  noteAr: string | null;
  cancelReason: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  invoicedAt: string | null;
  cancelledAt: string | null;
}

/** GET /crm/service-orders/:id → the order with its lines. */
export interface ServiceOrderDetailRow extends ServiceOrderRow {
  lines: readonly ServiceOrderLineRow[];
}

/** Service-order lines (SERVICE/PARTS; tombstone-based lifecycle). */
export interface ServiceOrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  estimatedHours: string | null;
  unitPrice: string;
  qty: string;
  loggedHours: string;
  status: string;
  reservationId: string | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  issueJournalId: string | null;
  invoiceLineId: string | null;
  note: string | null;
  createdBy: string | null;
}

/** GET /accounting/projects rows (the cost-center clone, OPEN|CLOSED). */
export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  status: string;
}

/** GET /crm/billing-runs rows (the crm.billing_run audit events, newest first). */
export interface BillingRunSummaryRow {
  id: string;
  at: string;
  actorId: string | null;
  /** The audit after-state — the run result shape (defensively rendered). */
  summary: unknown;
}

/** One generated draft of a billing run result. */
export interface BillingRunDraftRow {
  contractId: string;
  invoiceId: string;
  entryId: string;
  periodKey: string | null;
  milestoneScheduleId: string | null;
  status: string;
  periodStatus: string;
}

/** POST /crm/billing-runs → data (§5; idempotent by the guard rows). */
export interface BillingRunResultRow {
  asOf: string;
  contractsScanned: number;
  draftsCreated: readonly BillingRunDraftRow[];
  skippedLocked: readonly {
    contractId: string;
    entryId: string;
    periodKey: string | null;
    billDate: string;
    periodStatus: string;
  }[];
  skippedDuplicate: readonly { contractId: string; entryId: string; periodKey: string | null }[];
  needsNarrative: readonly {
    contractId: string;
    entryId: string;
    timeEntryId: string;
    entryDate: string;
    hours: string;
  }[];
}

/** GET /crm/dashboard-summary → data (§13 operational counts). */
export interface CrmDashboardSummary {
  pipeline: { NEW: number; QUALIFIED: number; CONVERTED: number; LOST: number };
  followUpsDueToday: number;
  followUpsOverdue: number;
  contractsExpiringIn30d: number;
  upcomingBillingEntries: number;
}

/** PHASE-023: GET /tax/einvoicing/registry/submissions → the operational registry rows. */
export interface EInvoicingSubmissionRow {
  id: string;
  countryCode: string;
  adapterId: string;
  sourceType: string;
  sourceId: string;
  status:
    | "PENDING"
    | "GENERATED"
    | "SIGNED"
    | "SUBMITTED"
    | "ACCEPTED"
    | "REJECTED"
    | "REPORTED"
    | "FAILED";
  attempts: number;
  nextAttemptAt: string | null;
  authorityReference: string | null;
  authorityRefs: readonly unknown[];
  lastErrorCode: string | null;
  errorDetail: Record<string, unknown> | null;
  submittedAt: string | null;
  respondedAt: string | null;
  reportedAt: string | null;
  retryOfSubmissionId: string | null;
  createdAt: string;
}

/** PHASE-023: GET /tax/einvoicing/adapters → the registered adapter surface. */
export interface EInvoicingAdapterRow {
  id: string;
  supportedCountries: readonly string[];
  regimeVerified: boolean;
}

/** PHASE-023: GET /tax/einvoicing/certificates → metadata only (no key material). */
export interface EInvoicingCertificateRow {
  id: string;
  countryCode: string;
  adapterId: string;
  label: string;
  keyVersion: string;
  secretPath: string;
  fingerprint: string;
  notBefore: string;
  notAfter: string;
  status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "REVOKED";
  enrolledAt: string;
  rotatedFromId: string | null;
  signCount: number;
  lastUsedAt: string | null;
}

/** PHASE-023: GET /tax/einvoicing/funnel → the monitoring aggregate (MONITORING §1). */
export interface EInvoicingFunnelWire {
  byStatus: Record<string, number>;
  rejectionReasons: readonly { code: string; count: number }[];
  deadLetter: number;
  latencyMs: { p50: number | null; p95: number | null };
  rejectionWindow: { total: number; rejected: number; ratePct: number | null };
}

// ---------------------------------------------------------------------------
// PHASE-026 (T13-UI) — fixed assets & depreciation rows. The shapes mirror
// the fixed_assets store DTOs (apps/api fixed-assets.store.ts selects), the
// single source the parallel backend (P26-A/B/C) wraps; money stays canonical
// decimal strings (ADR-0009), ids are UUIDv7 strings.
// ---------------------------------------------------------------------------

/** GET /fixed-assets/categories → rows (categories manage). */
export interface FixedAssetCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  usefulLifeMonthsDefault: number;
  depreciationMethodDefault: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
  expensePurposeKey: string;
  active: boolean;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /fixed-assets/assets → rows (register list + search). */
export interface FixedAssetRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  openingAccumulated: string;
  usefulLifeMonths: number;
  depreciationMethod: string;
  totalEstimatedUnits: string | null;
  branchId: string;
  custodianUserId: string | null;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  note: string | null;
  noteAr: string | null;
  disposedAt: string | null;
  writtenOffAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** One depreciation-history line on the asset detail (run status joined). */
export interface FixedAssetHistoryLine {
  id: string;
  runId: string;
  assetId: string;
  lineNo: number;
  periodUnits: string | null;
  periodAmount: string;
  accumulatedAmount: string;
  runStatus: "DRAFT" | "POSTED";
  reversedAt: string | null;
  createdAt: string;
}

/**
 * GET /fixed-assets/assets/:id → the detail: the register row plus the NBV
 * read model (accumulated-to-date + NBV — INV-023 mirror) and the
 * depreciation history over the append-only lines (reversed runs marked).
 */
export interface FixedAssetDetailRow extends FixedAssetRow {
  accumulatedToDate: string;
  nbv: string;
  history: readonly FixedAssetHistoryLine[];
}

/** GET /fixed-assets/depreciation-runs → rows (runs list). */
export interface DepreciationRunListRow {
  id: string;
  fiscalPeriodId: string;
  status: "DRAFT" | "POSTED";
  assetCount: number;
  totalAmount: string;
  assemblyJobId: string | null;
  assembledAt: string | null;
  assembledBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * One assembly-grid line in the run workspace: the append-only line joined
 * with the asset fields the grid + the live UoP preview need (code, method,
 * cost/salvage/opening basis, the UoP denominator) and the NBV read model.
 */
export interface DepreciationRunLineView {
  id: string;
  runId: string;
  assetId: string;
  lineNo: number;
  periodUnits: string | null;
  periodAmount: string;
  accumulatedAmount: string;
  assetCode: string;
  assetName: string;
  assetNameAr: string;
  method: string;
  cost: string;
  salvageValue: string;
  openingAccumulated: string;
  totalEstimatedUnits: string | null;
  nbvAfter: string;
  createdAt: string;
}

/** GET /fixed-assets/depreciation-runs/:id → the workspace payload. */
export interface DepreciationRunDetailRow {
  run: DepreciationRunListRow;
  lines: readonly DepreciationRunLineView[];
}

/** POST /fixed-assets/assets/:id/capitalize → the posted capitalization. */
export interface CapitalizeResultRow {
  assetId: string;
  sourceType: string;
  sourceId: string;
  journalEntryId: string;
  journalEntryNo: string | null;
}

/** GET /fixed-assets/disposals + the wizard drafts (disposals list). */
export interface AssetDisposalRow {
  id: string;
  assetId: string;
  disposalNo: string | null;
  kind: string;
  disposalDate: string;
  proceeds: string;
  netBookValue: string;
  accumulatedSnapshot: string;
  gainLoss: string;
  status: "DRAFT" | "POSTED";
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** POST /fixed-assets/revaluations → DRAFT; :id/post → POSTED. */
export interface AssetRevaluationRow {
  id: string;
  assetId: string;
  revaluationDate: string;
  newGrossValue: string;
  newAccumulated: string;
  delta: string;
  status: "DRAFT" | "POSTED";
  reason: string;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * PHASE-026 (T13-UI) — the list rows the register screen renders: the store
 * AssetRow plus the NBV read model (assetAccumulated/assetNbv helpers) the
 * list table's accumulated/NBV columns display.
 */
export interface FixedAssetListRow extends FixedAssetRow {
  accumulatedToDate: string;
  nbv: string;
}

// ---------------------------------------------------------------------------
// PHASE-027 wire types (GET/POST /notes + /installment-plans). Field names
// mirror the modules' store rows EXACTLY (camelCase as the API returns);
// money values are canonical decimal strings (ADR-0009).

/** GET /notes → rows (the register §C note row; notes.store NoteRow). */
export interface NoteListRow {
  id: string;
  kind: "CHEQUE" | "PROMISSORY_NOTE";
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  issueDate: string | null;
  maturityDate: string;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  cashAccountId: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /notes/:id → events (the append-only custody log; NoteEventRow). */
export interface NoteEventRow {
  id: string;
  noteId: string;
  eventKind: string;
  eventDate: string;
  refs: unknown;
  journalEntryId: string | null;
  memo: string | null;
  memoAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** GET /notes/:id → data (the register row + its custody timeline). */
export interface NoteDetailRow {
  note: NoteListRow;
  events: readonly NoteEventRow[];
}

/** POST /notes/:id/endorse|deposit → data ({note, event}). */
export interface NoteEventActionResult {
  note: NoteListRow;
  event: NoteEventRow;
}

/** POST /notes/:id/collect → data (adds the collection journal id). */
export interface NoteCollectResult extends NoteEventActionResult {
  journalEntryId: string;
}

/** POST /notes/:id/dishonor|return → data (the repoint-restore outcome). */
export interface NoteRestoreResult {
  note: NoteListRow;
  journalEntryId: string;
  anchored: boolean;
}

/** POST /notes/:id/discount → data (proceeds + the explicit fee). */
export interface NoteDiscountResult {
  journalEntryId: string;
  proceeds: string;
  fee: string;
}

/** One live note in the calendar drill list (CalendarNoteView). */
export interface PdcCalendarNoteRow {
  id: string;
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  partnerName: string | null;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  maturityDate: string;
  status: string;
}

/** One maturity bucket side (received vs issued; BR-045 fold). */
export interface PdcDirectionBuckets {
  overdue: { count: number; amountBase: string };
  thisWeek: { count: number; amountBase: string };
  d30: { count: number; amountBase: string };
  d60: { count: number; amountBase: string };
  d90: { count: number; amountBase: string };
  beyond: { count: number; amountBase: string };
}

/** GET /notes/pdc-calendar → data (the cached read model + freshness stamps). */
export interface PdcCalendarSnapshot {
  tenantId: string;
  asOf: string;
  computedAt: string;
  buckets: {
    received: PdcDirectionBuckets;
    issued: PdcDirectionBuckets;
  };
  drill: {
    byPartner: { partnerId: string; partnerName: string | null; count: number; amountBase: string }[];
    byBank: { bank: string | null; count: number }[];
    notes: PdcCalendarNoteRow[];
  };
  /** true when the daily job is overdue (age > staleAfterHours — labeled, never silent). */
  stale: boolean;
  staleAfterHours: number;
}

/** GET /installment-plans → rows (BR-048 plan; status null = DRAFT). */
export interface InstallmentPlanRow {
  id: string;
  partnerId: string;
  sourceType: "sales_invoice" | "service_contract";
  sourceId: string;
  sourceNo: string | null;
  totalAmount: string;
  downPayment: string;
  lineCount: number;
  startDate: string;
  frequency: string;
  lateFeePolicy: {
    rate: string;
    cap: string;
    grace_days: number;
    auto_charge: boolean;
    defaulted_after_lines: number;
  };
  status: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  closedAt: string | null;
  defaultedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** GET /installment-plans/:id → lines (the flat DR-003 schedule). */
export interface InstallmentLineRow {
  id: string;
  planId: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: "PENDING" | "DUE" | "PAID" | "OVERDUE" | "WAIVED";
  receiptRefs: { receiptId: string; receiptNo: string | null; amount: string; valueDate: string }[] | null;
  collectedAmount: string;
  waivedAt: string | null;
  waivedBy: string | null;
  waiveReason: string | null;
  lateFeeAmount: string | null;
  lateFeeEntryId: string | null;
  lateFeeChargedAt: string | null;
}

/** GET/POST /installment-plans[/:id] → data (the plan + its lines). */
export interface InstallmentPlanDetailRow {
  plan: InstallmentPlanRow;
  lines: readonly InstallmentLineRow[];
}

/** POST /installment-plans/:id/lines/:lineId/charge-late-fee → data. */
export interface LateFeeChargeResult {
  line: InstallmentLineRow;
  journalEntryId: string;
  fee: string;
}

// ---------------------------------------------------------------------------
// PHASE-028 wire types (GET/POST/PUT /budgeting/budgets…). Field names mirror
// the module's store rows EXACTLY (camelCase as the API returns); money
// values are canonical decimal strings (ADR-0009). Budgets post NOTHING —
// every row below is planning data, never a ledger document.

/** GET /budgeting/budgets → rows (the version register; BudgetSummaryRow). */
export interface BudgetListRow {
  id: string;
  code: string;
  fiscalYearId: string;
  scope: "ACCOUNTS" | "COST_CENTERS" | "PROJECTS" | "BRANCHES";
  name: string;
  nameAr: string | null;
  revisionNo: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "REVISED" | "CLOSED";
  supersedesId: string | null;
  /** The SoD approval stamp (set while STILL PENDING_APPROVAL — BR-050). */
  approvedAt: string | null;
  lineCount: number;
  yearTotal: string;
  createdAt: string;
}

/** GET /budgeting/budgets/:id → data (the version + its supersede chain). */
export interface BudgetDetailRow {
  budget: BudgetListRow;
  lineCount: number;
  chain: readonly BudgetListRow[];
}

/** GET /budgeting/budgets/:id/grid → periods (the fiscal calendar rows). */
export interface FiscalPeriodView {
  id: string;
  name: string;
  nameAr: string | null;
  startDate: string;
  endDate: string;
  status: string;
}

/** GET /budgeting/budgets/:id/grid → the account enrichment of each line. */
export interface GridAccountView {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
}

/** GET /budgeting/budgets/:id/grid → lines (BudgetLineRow + account view). */
export interface BudgetLineView {
  id: string;
  budgetId: string;
  fiscalPeriodId: string;
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
  amount: string;
  account: GridAccountView | null;
}

/** Grid totals (live row/period/year folds — exact 4dp strings). */
export interface BudgetGridTotals {
  year: string;
  perPeriod: Record<string, string>;
}

/** GET /budgeting/budgets/:id/grid → data (budget + periods + lines + totals). */
export interface BudgetGridResponse {
  budget: BudgetListRow;
  periods: readonly FiscalPeriodView[];
  lines: readonly BudgetLineView[];
  totals: BudgetGridTotals;
}

/** PUT /budgeting/budgets/:id/grid + import/commit → data. */
export interface BudgetGridSaveResult {
  lineCount: number;
  totals: BudgetGridTotals;
}

/** One consumption banner key: the budget side vs the GL-derived actual. */
export interface ConsumptionKeyRowView {
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
  budget: string;
  actual: string;
  thresholdBudget: string;
}

/** GET /budgeting/budgets/:id/consumption → data (ADR-0008 TTL cache). */
export interface ConsumptionResponse {
  budgetId: string;
  scope: string | null;
  computedAt: string;
  stale: boolean;
  periods: readonly {
    fiscalPeriodId: string;
    name: string;
    nameAr: string | null;
    rows: readonly ConsumptionKeyRowView[];
  }[];
}

/** POST /budgeting/budgets/:id/import/dry-run → data (zero writes). */
export interface ImportDryRunResponse {
  rowCount: number;
  validRows: number;
  errors: readonly { rowNo: number; messageAr: string; messageEn: string }[];
  totalsPreview: string;
}

/** GET /budgeting/budgets/:id/export?locale=ar|en → data (module XLSX). */
export interface ExportResponse {
  filename: string;
  mimeType: string;
  fileBase64: string;
  bytes: number;
}

/** POST /budgeting/control/evaluate → data (the BR-051 advisory guard). */
export interface ControlEvaluationResult {
  mode: "OFF" | "ADVISORY" | "ENFORCE_DRAFT";
  warnings: readonly {
    accountId: string;
    periodId: string;
    budgetId: string;
    budgetAmount: string;
    actualAmount: string;
    projectedAmount: string;
    percentUsed: string;
  }[];
}

// ---------------------------------------------------------------------------
// PHASE-029 wire types (GET/POST/PUT /payroll/…). Field names mirror the
// module's store rows EXACTLY (camelCase as the API returns); money values
// are canonical decimal strings (ADR-0009). The employee surface is the
// PII-restricted shape: national_id + bank fields leave ONLY as masked
// forms (toEmployeeView — the restricted permission gates the route; the
// unmasked shape never crosses the wire).

/** GET /payroll/employees → rows (the masked register; C-PII law). */
export interface EmployeeListRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  nationalIdMasked: string | null;
  hireDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  contractType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
  basicSalary: string;
  salaryStructureId: string | null;
  branchId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  bankMasked: {
    name: string | null;
    ibanTail: string | null;
    accountTail: string | null;
  };
  eosSettledAmount?: string | null;
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  note: string | null;
  noteAr: string | null;
  createdAt: string;
}

/** POST /payroll/employees body + PUT /payroll/employees/:id (partial). */
export interface EmployeeInput {
  code: string;
  name: string;
  nameAr?: string | null;
  nationalId?: string | null;
  hireDate: string;
  contractType: "FULL_TIME" | "PART_TIME" | "CONTRACTOR";
  basicSalary: string;
  salaryStructureId?: string | null;
  branchId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
  bankName?: string | null;
  bankIban?: string | null;
  bankAccount?: string | null;
  note?: string | null;
  noteAr?: string | null;
}

/** GET /payroll/salary-structures → rows (BR-052 version register). */
export interface SalaryStructureRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  currency: string;
  status: "ACTIVE" | "ARCHIVED";
  supersededById: string | null;
  note: string | null;
  createdAt: string;
}

/** One builder row: kind/calc/account + the eos-base flag (BR-055). */
export interface SalaryComponentInput {
  key: string;
  name: string;
  nameAr?: string | null;
  kind: "ALLOWANCE" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  calc: "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS";
  amount?: string | null;
  rate?: string | null;
  glAccountId: string;
  isEosBase?: boolean;
  seq?: number;
}

/** GET /payroll/salary-structures/:id → data (the version + components). */
export interface SalaryComponentRow extends SalaryComponentInput {
  id: string;
  structureId: string;
  amount: string | null;
  rate: string | null;
  isEosBase: boolean;
  seq: number;
}

/** GET /payroll/runs → rows (the monthly register; INV-025 totals). */
export interface PayrollRunListRow {
  id: string;
  runNo: string | null;
  fiscalPeriodId: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "POSTED";
  grossTotal: string;
  deductionsTotal: string;
  netTotal: string;
  paidNetTotal: string;
  employerContributionsTotal: string;
  eosAccrualTotal: string;
  journalEntryId: string | null;
  entryNo: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  reversalJournalEntryId: string | null;
  createdAt: string;
}

/** The frozen calculation basis (BR-052 — jsonb shape, DATA_DICTIONARY). */
export interface ComponentSnapshot {
  structure: { id: string; code: string; name: string };
  components: readonly {
    key: string;
    kind: "ALLOWANCE" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
    calc: "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS";
    amount: string | null;
    rate: string | null;
    glAccountId: string;
    isEosBase: boolean;
    computed: string;
  }[];
  loanDeductions: readonly { loanId: string; lineId: string; amount: string }[];
  eos: { enabled: boolean; accrual: string };
  basicSalary: string;
}

/** GET /payroll/runs/:id → lines (the per-employee frozen rows). */
export interface PayrollRunLineRow {
  id: string;
  runId: string;
  employeeId: string;
  componentSnapshot: ComponentSnapshot;
  grossAmount: string;
  deductionsAmount: string;
  netAmount: string;
  employerContributions: string;
  eosAccrual: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
  createdAt: string;
}

/** POST /payroll/runs/:id/calculate → data (BR-054 clamps are explicit). */
export interface RunCalculationResult {
  run: PayrollRunListRow;
  lineCount: number;
  warnings: {
    loanClamps: { employeeCode: string; loanId: string; scheduled: string; clampedTo: string }[];
    skippedEmployees: { code: string; reason: string }[];
  };
}

/** POST /payroll/runs/:id/payout → data (G-30; exact remainder tracking). */
export interface RunPayoutResult {
  run: PayrollRunListRow;
  payoutId: string;
  journalEntryId: string;
  amount: string;
}

/** GET /payroll/runs/:id/payslips → data (masked C-PII; batch). */
export interface PayslipsResult {
  run: {
    id: string;
    runNo: string | null;
    periodName: string;
    gross: string;
    deductions: string;
    net: string;
    employerContributions: string;
    eosAccrual: string;
    paid: string;
  };
  slips: {
    employee: EmployeeListRow;
    gross: string;
    deductions: string;
    net: string;
    components: { key: string; name: string; nameAr: string | null; kind: string; computed: string }[];
    loanDeductions: { amount: string }[];
  }[];
}

/** GET /payroll/loans → rows (the BR-054-capped register). */
export interface EmployeeLoanRow {
  id: string;
  code: string;
  employeeId: string;
  amount: string;
  installmentsCount: number;
  startPeriodId: string;
  status: "ACTIVE" | "CLOSED" | "WRITE_OFF";
  cashAccountId: string | null;
  disbursementJournalEntryId: string | null;
  writeOffReason: string | null;
  note: string | null;
  createdAt: string;
}

/** GET /payroll/loans/:id → lines (the per-period schedule). */
export interface EmployeeLoanLineRow {
  id: string;
  loanId: string;
  fiscalPeriodId: string;
  amount: string;
  status: "PENDING" | "DEDUCTED" | "WAIVED";
  payrollRunId: string | null;
  waivedReason: string | null;
}

/** GET /payroll/eos/employees/:id/balance → data (BR-055 per employee). */
export interface EosBalanceRow {
  accrued: string;
  settled: string | null;
  balance: string;
}

/** GET /payroll/eos/policy → data (the tenant policy surface). */
export interface EosPolicyRow {
  enabled: boolean;
  basisDays: number | null;
}

// -- PHASE-034 (T11): multi-entity consolidation wire types ------------------

/** GET/POST /consolidation/groups[/:id] → rows (the consolidation group). */
export interface ConsolidationGroupRow {
  id: string;
  name: string;
  nameAr: string;
  baseCurrency: string;
  fxTranslationMethod: "CLOSING_RATE" | "TEMPORARY";
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET/POST /consolidation/groups/:id/members → rows (the group membership). */
export interface GroupMemberRow {
  id: string;
  groupId: string;
  memberTenantId: string;
  ownershipPercent: string;
  includeFrom: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** One elimination document line (the jsonb DRAFT body's row — the G-32 shape). */
export interface EliminationLineRow {
  purposeKey: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  memberTenantId: string | null;
  /** Optional on the wire (omitted keys never reach the jsonb body). */
  memoEn?: string;
  memoAr?: string;
}

/** GET/POST /consolidation/eliminations[/:id] → rows (the elimination entry). */
export interface EliminationRow {
  id: string;
  groupId: string;
  fiscalPeriodId: string;
  eliminationNo: string | null;
  kind: "INTERCOMPANY" | "INVESTMENT_EQUITY";
  description: string;
  memberATenantId: string | null;
  memberBTenantId: string | null;
  lines: EliminationLineRow[];
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryIds: string[];
  reversalOf: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * GET /consolidation/groups/:id/intercompany-suggestions → rows. Snake_case
 * on purpose — the platform-plane reader contract's own column names.
 */
export interface IntercompanySuggestionRow {
  partner_id: string;
  partner_code: string;
  partner_name: string;
  partner_name_ar: string | null;
  ar_balance: string;
  ap_balance: string;
}

/** GET/POST /consolidation/runs[/:id] → rows (the consolidation run). */
export interface ConsolidationRunRow {
  id: string;
  groupId: string;
  fiscalPeriodId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  snapshotVersion: number;
  snapshot: ConsolidationSnapshot | null;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorDetail: unknown;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** GET /consolidation/runs/:id/snapshots → data (the run + its snapshot). */
export interface ConsolidationRunSnapshotView {
  runId: string;
  status: string;
  snapshot: ConsolidationSnapshot | null;
}

/** The run snapshot's money shape (group currency, 4dp decimal strings). */
export interface ConsolidationAmounts {
  debit: string;
  credit: string;
}

/** One member's translated account extract (snapshot memberExtracts row). */
export interface SnapshotMemberExtractRow {
  memberTenantId: string;
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  amounts: ConsolidationAmounts;
}

/** One elimination's frozen effect lines (snapshot eliminations row). */
export interface SnapshotEliminationRow {
  eliminationId: string;
  eliminationNo: string | null;
  accountCode: string;
  purposeKey: string | null;
  amounts: ConsolidationAmounts;
}

/** One consolidated statement line (snapshot consolidated row). */
export interface SnapshotConsolidatedRow {
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  amounts: ConsolidationAmounts;
}

/** One snapshot member (membership + the dated rates applied, INV-008). */
export interface SnapshotMemberRow {
  memberTenantId: string;
  memberName: string | null;
  ownershipPercent: string;
  includeFrom: string | null;
  baseCurrency: string;
  /** The dated stored rates applied (per currency — exactly as stored). */
  appliedRates: Record<string, string>;
}

/**
 * The run snapshot jsonb (PHASE-034 §4 — the immutable, versioned DERIVED
 * artifact; ADR-0017: never a second ledger, never a source of truth).
 */
export interface ConsolidationSnapshot {
  schemaVersion: number;
  runId: string;
  groupId: string;
  fiscalPeriodId: string;
  periodEndDate: string;
  group: {
    groupId?: string;
    name: string;
    nameAr: string;
    baseCurrency: string;
    fxTranslationMethod: "CLOSING_RATE" | "TEMPORARY";
  };
  members: SnapshotMemberRow[];
  memberExtracts: SnapshotMemberExtractRow[];
  eliminations: SnapshotEliminationRow[];
  consolidated: SnapshotConsolidatedRow[];
  /** The INV-026 assertion recorded at build time (never a silent drift). */
  inv026: {
    status: "PASS" | "FAIL";
    compared: { left: string; right: string };
    brokenLines: string[];
  };
}
