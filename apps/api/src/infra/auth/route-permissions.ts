/**
 * Route → permission registry (PHASE-003 T10; matrix §8 layer 1): the single
 * machine-readable source the controllers declare and the generated
 * checklist test (route × role template → 2xx/403) iterates. Adding a
 * protected route without a registry row is the review blocker the phase
 * document names — the checklist fails until it lands here.
 */

export interface RoutePermissionRule {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  /** AUTHORIZATION_MATRIX key — routes without one are public and listed in PUBLIC_ROUTES. */
  readonly permission: string;
  /** Self-scoped keys: granted to every authenticated user for own resources. */
  readonly self?: boolean;
}

/** PHASE-003 live routes (identity + audit plane). */
export const ROUTE_PERMISSIONS: readonly RoutePermissionRule[] = [
  {
    method: "GET",
    path: "/api/v1/identity/users",
    permission: "identity.users.view",
  },
  {
    method: "POST",
    path: "/api/v1/identity/invitations",
    permission: "identity.users.invite",
  },
  {
    method: "GET",
    path: "/api/v1/identity/invitations",
    permission: "identity.users.view",
  },
  {
    method: "POST",
    path: "/api/v1/identity/invitations/:id/revoke",
    permission: "identity.users.invite",
  },
  {
    method: "POST",
    path: "/api/v1/identity/memberships/:id/revoke",
    permission: "identity.users.manage",
  },
  {
    method: "GET",
    path: "/api/v1/identity/sessions/tenant",
    permission: "identity.sessions.revoke",
  },
  {
    method: "POST",
    path: "/api/v1/identity/sessions/:id/revoke",
    permission: "identity.sessions.revoke",
  },
  {
    method: "GET",
    path: "/api/v1/identity/roles",
    permission: "identity.roles.assign",
  },
  // PHASE-024 T4: the admin-assisted MFA reset (matrix §3.9
  // identity.mfa.admin_reset — the seeded key's first route).
  {
    method: "DELETE",
    path: "/api/v1/identity/users/:userId/mfa",
    permission: "identity.mfa.admin_reset",
  },
  // PHASE-024 T4: the plan-level MFA policy lever.
  {
    method: "PUT",
    path: "/api/v1/platform/plans/:key/mfa-policy",
    permission: "platform.plans.manage",
  },
  // PHASE-024 T11 (Journey H): the offboarding flow — tenant plane
  // (owner request/export/cancel) + platform plane (two-person execution,
  // legal hold, state read).
  {
    method: "POST",
    path: "/api/v1/tenancy/offboarding/request",
    permission: "tenancy.offboarding.execute",
  },
  {
    method: "POST",
    path: "/api/v1/tenancy/offboarding/export",
    permission: "tenancy.export.request",
  },
  {
    method: "POST",
    path: "/api/v1/tenancy/offboarding/cancel",
    permission: "tenancy.offboarding.execute",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/offboard",
    permission: "platform.tenants.offboard",
  },
  {
    method: "PUT",
    path: "/api/v1/platform/tenants/:id/legal-hold",
    permission: "platform.tenants.offboard",
  },
  {
    method: "GET",
    path: "/api/v1/platform/tenants/:id/offboarding",
    permission: "platform.tenants.view",
  },
  // PHASE-024 T12: the support-access review report over a window.
  {
    method: "GET",
    path: "/api/v1/platform/support-sessions/review",
    permission: "platform.support.access",
  },
  {
    method: "POST",
    path: "/api/v1/identity/roles/clone-template",
    permission: "identity.roles.assign",
  },
  {
    method: "POST",
    path: "/api/v1/identity/roles/:id/grants",
    permission: "identity.roles.assign",
  },
  {
    method: "GET",
    path: "/api/v1/audit/events",
    permission: "audit.view",
  },
  // PHASE-024 T8: the tenant-admin CSV export (audit.view; audited E-04).
  {
    method: "GET",
    path: "/api/v1/audit/events/export",
    permission: "audit.view",
  },
  // -- PHASE-004: tenancy tenant-plane routes (matrix §3.9) ---------------
  {
    method: "GET",
    path: "/api/v1/tenancy/profile",
    permission: "tenancy.settings.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/tenancy/profile",
    permission: "tenancy.settings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tenancy/settings",
    permission: "tenancy.settings.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/tenancy/settings/:key",
    permission: "tenancy.settings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tenancy/branches",
    permission: "tenancy.branches.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tenancy/branches",
    permission: "tenancy.branches.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/tenancy/branches/:id",
    permission: "tenancy.branches.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tenancy/onboarding/provision",
    permission: "tenancy.settings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tenancy/support-sessions",
    permission: "tenancy.settings.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/tenancy/support-sessions/:id",
    permission: "tenancy.settings.manage",
  },
  // -- PHASE-004: platform console routes (matrix §3.10, S-07) -----------
  {
    method: "GET",
    path: "/api/v1/platform/tenants",
    permission: "platform.tenants.view",
  },
  // PHASE-025 T9d: the SLO/error-budget dashboard aggregate (MONITORING
  // §5). Gated by the existing platform read-only observation key — the
  // plan's "platform.admin.access" is NOT a seeded key (the seed + matrix
  // §3.10 carry exactly ten platform.* keys; the identity-flows DB spec
  // pins that set), so the truthful existing key for a cross-tenant
  // platform-ops read is platform.audit.view (no new keys this phase).
  {
    method: "GET",
    path: "/api/v1/platform/slo",
    permission: "platform.audit.view",
  },
  {
    method: "GET",
    path: "/api/v1/platform/tenants/:id",
    permission: "platform.tenants.view",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/suspend",
    permission: "platform.tenants.suspend",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/restore",
    permission: "platform.tenants.restore",
  },
  {
    method: "GET",
    path: "/api/v1/platform/tenants/:id/entitlements",
    permission: "platform.entitlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/entitlements",
    permission: "platform.entitlements.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/platform/tenants/:id/entitlements/:featureKey",
    permission: "platform.entitlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/plan",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "GET",
    path: "/api/v1/platform/audit/events",
    permission: "platform.audit.view",
  },
  {
    method: "GET",
    path: "/api/v1/platform/tenants/:id/support-sessions",
    permission: "platform.support.access",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/support-sessions",
    permission: "platform.support.access",
  },
  {
    method: "POST",
    path: "/api/v1/platform/tenants/:id/support-sessions/:sessionId/close",
    permission: "platform.support.access",
  },
  {
    method: "GET",
    path: "/api/v1/platform/tenants/:id/support-sessions/:sessionId/tenant-data/:resource",
    permission: "platform.support.access",
  },
  // -- PHASE-006: partners & items master data (matrix §3.6) -------------
  {
    method: "GET",
    path: "/api/v1/partners/partners",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners",
    permission: "partners.create",
  },
  {
    method: "GET",
    path: "/api/v1/partners/partners/:id",
    permission: "partners.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/partners/partners/:id",
    permission: "partners.update",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/kind",
    permission: "partners.update",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/archive",
    permission: "partners.archive",
  },
  {
    method: "GET",
    path: "/api/v1/partners/partners/:id/balance",
    permission: "partners.view",
  },
  {
    method: "GET",
    path: "/api/v1/partners/partners/:id/contacts",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/contacts",
    permission: "partners.update",
  },
  {
    method: "GET",
    path: "/api/v1/partners/partners/:id/addresses",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/addresses",
    permission: "partners.update",
  },
  {
    method: "GET",
    path: "/api/v1/partners/credit-terms",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/credit-terms",
    permission: "partners.credit_terms.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/partners/credit-terms/:id",
    permission: "partners.credit_terms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/partners/credit-check",
    permission: "partners.view",
  },
  {
    method: "GET",
    path: "/api/v1/partners/opening-balances",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/opening-balances",
    permission: "partners.update",
  },
  {
    method: "GET",
    path: "/api/v1/partners/opening-balances/:id",
    permission: "partners.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/partners/opening-balances/:id",
    permission: "partners.update",
  },
  {
    method: "GET",
    path: "/api/v1/partners/search",
    permission: "partners.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/attachments",
    permission: "files.upload",
  },
  {
    method: "GET",
    path: "/api/v1/partners/partners/:id/attachments",
    permission: "files.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/attachments/:attachmentId/archive",
    permission: "files.manage",
  },
  {
    method: "POST",
    path: "/api/v1/partners/opening-balances/:id/attachments",
    permission: "files.upload",
  },
  {
    method: "GET",
    path: "/api/v1/partners/opening-balances/:id/attachments",
    permission: "files.view",
  },
  {
    method: "GET",
    path: "/api/v1/items/items",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/items",
    permission: "items.create",
  },
  {
    method: "GET",
    path: "/api/v1/items/items/:id",
    permission: "items.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/items/items/:id",
    permission: "items.update",
  },
  {
    method: "POST",
    path: "/api/v1/items/items/:id/archive",
    permission: "items.archive",
  },
  // PHASE-015 T9 (items.composite_products): composite definitions.
  {
    method: "GET",
    path: "/api/v1/items/items/:id/components",
    permission: "items.view",
  },
  {
    method: "PUT",
    path: "/api/v1/items/items/:id/components",
    permission: "items.update",
  },
  {
    method: "GET",
    path: "/api/v1/items/item-categories",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/item-categories",
    permission: "items.create",
  },
  {
    method: "PATCH",
    path: "/api/v1/items/item-categories/:id",
    permission: "items.update",
  },
  {
    method: "GET",
    path: "/api/v1/items/uoms",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/uoms",
    permission: "items.create",
  },
  {
    method: "PATCH",
    path: "/api/v1/items/uoms/:id",
    permission: "items.update",
  },
  {
    method: "GET",
    path: "/api/v1/items/uom-conversions",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/uom-conversions",
    permission: "items.create",
  },
  {
    method: "GET",
    path: "/api/v1/items/barcodes",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/barcodes",
    permission: "items.update",
  },
  {
    method: "GET",
    path: "/api/v1/items/price-lists",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/price-lists",
    permission: "items.price_lists.manage",
  },
  {
    method: "GET",
    path: "/api/v1/items/price-lists/:id",
    permission: "items.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/items/price-lists/:id",
    permission: "items.price_lists.manage",
  },
  {
    method: "GET",
    path: "/api/v1/items/price-lists/:id/items",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/price-lists/:id/items",
    permission: "items.price_lists.manage",
  },
  {
    method: "POST",
    path: "/api/v1/items/resolve-price",
    permission: "items.view",
  },
  {
    method: "GET",
    path: "/api/v1/items/search",
    permission: "items.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/items/:id/attachments",
    permission: "files.upload",
  },
  {
    method: "GET",
    path: "/api/v1/items/items/:id/attachments",
    permission: "files.view",
  },
  {
    method: "POST",
    path: "/api/v1/items/items/:id/attachments/:attachmentId/archive",
    permission: "files.manage",
  },
  {
    method: "GET",
    path: "/api/v1/items/import-jobs",
    permission: "items.import.run",
  },
  {
    method: "POST",
    path: "/api/v1/items/import-jobs",
    permission: "items.import.run",
  },
  {
    method: "GET",
    path: "/api/v1/items/import-jobs/:id",
    permission: "items.import.run",
  },
  {
    method: "POST",
    path: "/api/v1/items/import-jobs/:id/commit",
    permission: "items.import.run",
  },
  {
    method: "POST",
    path: "/api/v1/items/export-jobs",
    permission: "items.import.run",
  },
  // -- PHASE-007: accounting core (matrix §3.1) ---------------------------
  {
    method: "GET",
    path: "/api/v1/accounting/accounts",
    permission: "accounting.accounts.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/accounts/:id",
    permission: "accounting.accounts.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/accounts",
    permission: "accounting.accounts.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/accounting/accounts/:id",
    permission: "accounting.accounts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/accounts/:id/archive",
    permission: "accounting.accounts.archive",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/purposes",
    permission: "accounting.accounts.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/purposes",
    permission: "accounting.accounts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/purposes/:key/supersede",
    permission: "accounting.accounts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/fiscal-years",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/fiscal-years/:id",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/fiscal-years/:id/periods",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/fiscal-years",
    permission: "accounting.fiscal_years.manage",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/periods/:id",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/periods/:id/soft-close",
    permission: "accounting.periods.soft_close",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/periods/:id/lock",
    permission: "accounting.periods.lock",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/periods/:id/reopen",
    permission: "accounting.periods.reopen",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/periods/:id/checklist",
    permission: "accounting.periods.soft_close",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/exchange-rates",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/exchange-rates",
    permission: "accounting.exchange_rates.manage",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/cost-centers",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/cost-centers",
    permission: "accounting.cost_centers.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/accounting/cost-centers/:id",
    permission: "accounting.cost_centers.manage",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/numbering/assignments",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/gl/accounts",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/gl/accounts/:id/movements",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/gl/journal-register",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/gl/entries/:id",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/journal-entries",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/journal-entries/:id",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "PATCH",
    path: "/api/v1/accounting/journal-entries/:id",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries/:id/submit",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries/:id/approve",
    permission: "accounting.journal_entries.approve",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries/:id/post",
    permission: "accounting.journal_entries.post",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries/:id/reverse",
    permission: "accounting.journal_entries.reverse",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/journal-entries/:id/cancel",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/journal-entries/:id/preview",
    permission: "accounting.journal_entries.approve",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/approvals/queue",
    permission: "accounting.journal_entries.approve",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/approval-policies",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/approval-policies",
    permission: "accounting.accounts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/recurring-journals",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/recurring-journals",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/recurring-journals/:id/status",
    permission: "accounting.journal_entries.create",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/recurring-journals/generate-due",
    permission: "accounting.journal_entries.post",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/opening-balances",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/opening-balances/:yearId/post",
    permission: "accounting.opening_balances.post",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/year-end-close/:yearId/execute",
    permission: "accounting.year_end_close.execute",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/year-end-close/:yearId/reverse",
    permission: "accounting.year_end_close.execute",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/reconciliation/run",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "GET",
    path: "/api/v1/accounting/reconciliation/runs",
    permission: "accounting.journal_entries.view",
  },
  // -- PHASE-008: treasury (matrix §3.4) ----------------------------------
  {
    method: "GET",
    path: "/api/v1/treasury/cash-accounts",
    permission: "treasury.accounts.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-accounts",
    permission: "treasury.accounts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/cash-accounts/:id",
    permission: "treasury.accounts.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-accounts/:id/close",
    permission: "treasury.accounts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/cash-accounts/:id/movements",
    permission: "treasury.accounts.view",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/petty-cash/:id",
    permission: "treasury.petty_cash.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/receipts",
    permission: "sales.receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts",
    permission: "sales.receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/receipts/:id",
    permission: "sales.receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts/:id/submit",
    permission: "sales.receipts.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts/:id/approve",
    permission: "sales.receipts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts/:id/post",
    permission: "sales.receipts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts/:id/reverse",
    permission: "sales.receipts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/receipts/:id/cancel",
    permission: "sales.receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/receipts/:id/allocations",
    permission: "sales.receipts.view",
  },
  {
    method: "PUT",
    path: "/api/v1/treasury/receipts/:id/allocations",
    permission: "sales.receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/payments",
    permission: "purchasing.payments.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments",
    permission: "purchasing.payments.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/payments/:id",
    permission: "purchasing.payments.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments/:id/submit",
    permission: "purchasing.payments.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments/:id/approve",
    permission: "purchasing.payments.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments/:id/post",
    permission: "purchasing.payments.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments/:id/reverse",
    permission: "purchasing.payments.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/payments/:id/cancel",
    permission: "purchasing.payments.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/payments/:id/allocations",
    permission: "purchasing.payments.view",
  },
  {
    method: "PUT",
    path: "/api/v1/treasury/payments/:id/allocations",
    permission: "purchasing.payments.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/open-items",
    permission: "sales.receipts.view",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/allocations/suggest",
    permission: "sales.receipts.view",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/expense-categories",
    permission: "treasury.expenses.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expense-categories",
    permission: "treasury.expenses.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/expenses",
    permission: "treasury.expenses.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expenses",
    permission: "treasury.expenses.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/expenses/:id",
    permission: "treasury.expenses.view",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expenses/:id/submit",
    permission: "treasury.expenses.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expenses/:id/approve",
    permission: "treasury.expenses.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expenses/:id/post",
    permission: "treasury.expenses.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/expenses/:id/cancel",
    permission: "treasury.expenses.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/cash-transfers",
    permission: "treasury.transfers.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-transfers",
    permission: "treasury.transfers.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/cash-transfers/:id",
    permission: "treasury.transfers.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-transfers/:id/submit",
    permission: "treasury.transfers.create",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-transfers/:id/approve",
    permission: "treasury.transfers.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-transfers/:id/post",
    permission: "treasury.transfers.approve",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/cash-transfers/:id/cancel",
    permission: "treasury.transfers.create",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/shifts",
    permission: "treasury.shifts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/shifts",
    permission: "treasury.shifts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/shifts/:id",
    permission: "treasury.shifts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/shifts/:id/capture",
    permission: "treasury.shifts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/shifts/:id/close",
    permission: "treasury.shifts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/shifts/:id/cancel",
    permission: "treasury.shifts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/import-adapters",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/bank-statements",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/bank-statements/import",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/bank-statements/:id",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/bank-statements/:id/lines",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/bank-statements/:id/auto-match",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/bank-statements/:id/match",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/bank-statements/:id/reconcile",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/treasury/unmatched-aging",
    permission: "treasury.bank_reconciliation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/treasury/reconciliation/cash-check",
    permission: "treasury.accounts.view",
  },

  // -- PHASE-009: tax (matrix §3.7) ---------------------------------------
  {
    method: "GET",
    path: "/api/v1/tax/packs",
    permission: "tax.returns.view",
  },
  {
    method: "GET",
    path: "/api/v1/tax/packs/:country",
    permission: "tax.returns.view",
  },
  {
    method: "GET",
    path: "/api/v1/tax/packs/:country/versions",
    permission: "tax.returns.view",
  },
  {
    method: "GET",
    path: "/api/v1/tax/packs/:country/preview",
    permission: "tax.returns.view",
  },
  {
    method: "POST",
    path: "/api/v1/tax/packs/:country/apply",
    permission: "tax.codes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/tax-codes",
    permission: "tax.codes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/tax-codes",
    permission: "tax.codes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/tax-codes/:id",
    permission: "tax.codes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/tax-codes/:id/archive",
    permission: "tax.codes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/tax-registrations",
    permission: "tax.registrations.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/tax-registrations",
    permission: "tax.registrations.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/resolve-lines",
    permission: "tax.codes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/vat-returns",
    permission: "tax.returns.view",
  },
  {
    method: "POST",
    path: "/api/v1/tax/vat-returns",
    permission: "tax.returns.prepare",
  },
  {
    method: "GET",
    path: "/api/v1/tax/vat-returns/:id",
    permission: "tax.returns.view",
  },
  {
    method: "POST",
    path: "/api/v1/tax/vat-returns/:id/prepare",
    permission: "tax.returns.prepare",
  },
  {
    method: "POST",
    path: "/api/v1/tax/vat-returns/:id/mark-filed",
    permission: "tax.returns.mark_filed",
  },
  {
    method: "POST",
    path: "/api/v1/tax/vat-returns/:id/export",
    permission: "tax.returns.prepare",
  },
  {
    method: "POST",
    path: "/api/v1/tax/reconciliation/vat-check",
    permission: "tax.returns.view",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/submissions",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/submissions/:id",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/adapters",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/einvoicing/submissions",
    permission: "tax.einvoicing.manage",
  },
  // -- PHASE-023: operational registry + certificates + rollout (T1/T5/T13) --
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/registry/submissions",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/funnel",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/einvoicing/submissions/:id/resubmit",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/certificates",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/einvoicing/certificates/enroll",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/einvoicing/settings",
    permission: "tax.einvoicing.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/einvoicing/settings/:adapterId",
    permission: "tax.einvoicing.manage",
  },
  // -- PHASE-037 (Blueprint v3.0 · CR-07; matrix §3.7): the ZATCA Phase-1
  // EIAS device registry + chain verification + the backfill dry-run/run.
  // One new key (tax.einvoicing.devices.manage — 248 → 249 zero-drift;
  // migration 0050 §5). BR-061: the routes never expose a registration
  // write — the status stays the NOT_REGISTERED Phase-2 placeholder.
  {
    method: "GET",
    path: "/api/v1/tax/zatca/devices",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/zatca/devices",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/zatca/devices/:id",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/tax/zatca/devices/:id",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/zatca/devices/:id/chain",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/zatca/devices/:id/verify",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "GET",
    path: "/api/v1/tax/zatca/devices/:id/backfill/plan",
    permission: "tax.einvoicing.devices.manage",
  },
  {
    method: "POST",
    path: "/api/v1/tax/zatca/devices/:id/backfill",
    permission: "tax.einvoicing.devices.manage",
  },
  // -- PHASE-038 (Blueprint v3.0 · CR-08; matrix §3.16): the procurement
  // sourcing + supplier-collaboration surfaces — the RFQ negotiation loop
  // (H-11/P-01), quotes (P-02), comparison/award with the 3-bid floor
  // (BR-062) and BR-063's one-award-per-round, blanket agreements (P-03),
  // scorecards + approved items (P-04), advances + early-payment
  // discounts (G-33/G-34), CAPEX with the 028 guard (P-10/P-15), tender
  // intake (P-14). Seven keys (249 → 256 zero-drift; migration 0051 §9).
  // The SUPPLIER-FACING portal route is deliberately NOT here — it is the
  // PUBLIC_ROUTES surface (the token IS the credential; see below).
  { method: "GET", path: "/api/v1/purchasing/rfqs", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/rfqs", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/rfqs/:id", permission: "purchasing.rfqs.read" },
  { method: "PATCH", path: "/api/v1/purchasing/rfqs/:id", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/issue", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/close", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/cancel", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/rfqs/:id/quotes", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/quotes", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/portal-invites", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/portal-invites/revoke", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/rfqs/:id/comparison", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/rfqs/:id/comparison", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/comparisons/:id/award", permission: "purchasing.rfqs.award" },
  { method: "POST", path: "/api/v1/purchasing/comparisons/:id/cancel", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/blanket-orders", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/blanket-orders", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/blanket-orders/:id", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/blanket-orders/:id/releases", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/blanket-orders/:id/close", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/supplier-ratings", permission: "purchasing.rfqs.read" },
  { method: "GET", path: "/api/v1/purchasing/supplier-ratings/:supplierId", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/supplier-ratings/:supplierId/recompute", permission: "purchasing.suppliers.rate" },
  { method: "GET", path: "/api/v1/purchasing/approved-supplier-items", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/approved-supplier-items", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/supplier-advances", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/supplier-advances", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/supplier-advances/:id/approve", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/supplier-advances/:id/disburse", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/supplier-advances/:id/apply", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/supplier-advances/:id/cancel", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/early-payment-discount-terms", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/early-payment-discount-terms", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/early-payment-discount-terms/:id/approve", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/early-payment-discount-captures", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/capex-requests", permission: "purchasing.capex.read" },
  { method: "POST", path: "/api/v1/purchasing/capex-requests", permission: "purchasing.capex.manage" },
  { method: "GET", path: "/api/v1/purchasing/capex-requests/:id", permission: "purchasing.capex.read" },
  { method: "PATCH", path: "/api/v1/purchasing/capex-requests/:id", permission: "purchasing.capex.manage" },
  { method: "POST", path: "/api/v1/purchasing/capex-requests/:id/submit", permission: "purchasing.capex.manage" },
  { method: "POST", path: "/api/v1/purchasing/capex-requests/:id/approve", permission: "purchasing.capex.approve" },
  { method: "POST", path: "/api/v1/purchasing/capex-requests/:id/reject", permission: "purchasing.capex.approve" },
  { method: "POST", path: "/api/v1/purchasing/capex-requests/:id/cancel", permission: "purchasing.capex.manage" },
  { method: "GET", path: "/api/v1/purchasing/tender-intakes", permission: "purchasing.rfqs.read" },
  { method: "POST", path: "/api/v1/purchasing/tender-intakes", permission: "purchasing.rfqs.manage" },
  { method: "GET", path: "/api/v1/purchasing/tender-intakes/:id", permission: "purchasing.rfqs.read" },
  { method: "PATCH", path: "/api/v1/purchasing/tender-intakes/:id", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/tender-intakes/:id/decide", permission: "purchasing.rfqs.manage" },
  { method: "POST", path: "/api/v1/purchasing/tender-intakes/:id/close", permission: "purchasing.rfqs.manage" },
  // PHASE-039 (0059; matrix §3.17): the supplier RMA mirror — the
  // return-to-vendor lifecycle to the G-38 debit note (SoD rides the
  // manage key's server-side gate).
  { method: "GET", path: "/api/v1/purchasing/returns", permission: "purchasing.rma.read" },
  { method: "POST", path: "/api/v1/purchasing/returns", permission: "purchasing.rma.manage" },
  { method: "GET", path: "/api/v1/purchasing/returns/:id", permission: "purchasing.rma.read" },
  { method: "POST", path: "/api/v1/purchasing/returns/:id/approve", permission: "purchasing.rma.manage" },
  { method: "POST", path: "/api/v1/purchasing/returns/:id/ship", permission: "purchasing.rma.manage" },
  { method: "POST", path: "/api/v1/purchasing/returns/:id/credit", permission: "purchasing.rma.manage" },
  { method: "POST", path: "/api/v1/purchasing/returns/:id/cancel", permission: "purchasing.rma.manage" },
  // PHASE-040 (0060; matrix §3.18): the data onboarding & migration toolkit
  // — the /imports hub surface (kind catalog, header preview, the direct-
  // upload slot, BR-066 dry-run → commit jobs, the bilingual error-report
  // export) and the saved-mapping CRUD (both directions). All under the
  // back-office hub key; the demo-data + sandbox routes land with T-06/T-07.
  { method: "GET", path: "/api/v1/imports/adapters", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/adapters/:key/template", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/kinds", permission: "configuration.imports.manage" },
  { method: "POST", path: "/api/v1/imports/preview-headers", permission: "configuration.imports.manage" },
  { method: "POST", path: "/api/v1/imports/uploads", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/jobs", permission: "configuration.imports.manage" },
  { method: "POST", path: "/api/v1/imports/jobs", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/jobs/:id", permission: "configuration.imports.manage" },
  { method: "POST", path: "/api/v1/imports/jobs/:id/commit", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/jobs/:id/error-report", permission: "configuration.imports.manage" },
  { method: "GET", path: "/api/v1/imports/mappings", permission: "configuration.imports.manage" },
  { method: "POST", path: "/api/v1/imports/mappings", permission: "configuration.imports.manage" },
  { method: "PATCH", path: "/api/v1/imports/mappings/:id", permission: "configuration.imports.manage" },
  { method: "DELETE", path: "/api/v1/imports/mappings/:id", permission: "configuration.imports.manage" },
  // PHASE-041 (0064; matrix §3.19): the communications hub — provider
  // selection + sealed credentials + per-market senders (T-03; the masked
  // catalog read and the audited write both ride the settings/communication
  // back-office key; per-channel tier-4 entitlement checks fire server-side
  // in the service at write time).
  { method: "GET", path: "/api/v1/communication/providers", permission: "communication.templates.manage" },
  { method: "PUT", path: "/api/v1/communication/providers", permission: "communication.templates.manage" },
  // PHASE-041 T-04 (FD-30): the tenant template hub — the effective list
  // (overrides + builtin fallbacks), the audited upsert/delete, and the
  // fail-closed render preview.
  { method: "GET", path: "/api/v1/communication/templates", permission: "communication.templates.manage" },
  { method: "POST", path: "/api/v1/communication/templates", permission: "communication.templates.manage" },
  { method: "DELETE", path: "/api/v1/communication/templates", permission: "communication.templates.manage" },
  { method: "POST", path: "/api/v1/communication/templates/preview", permission: "communication.templates.manage" },
  // PHASE-041 T-06 (TB-23): the preference matrix — the SELF plane
  // (authenticated-only, the notification_prefs precedent) and the
  // tenant-default plane (communication.preferences.manage).
  // (the self-plane entries themselves are SESSION_ROUTES — see the
  // notifications self plane at the file's session section).
  { method: "GET", path: "/api/v1/communication/preferences/defaults", permission: "communication.preferences.manage" },
  { method: "POST", path: "/api/v1/communication/preferences/defaults", permission: "communication.preferences.manage" },
  // PHASE-041 T-08 (UX-14/IN-16): the unified inbox — the per-partner
  // interaction timeline with filters + the call logging (owner +
  // accountant + sales — the sales/support surface).
  { method: "GET", path: "/api/v1/communication/inbox", permission: "communication.inbox.read" },
  { method: "POST", path: "/api/v1/communication/inbox/calls", permission: "communication.inbox.read" },
  { method: "PATCH", path: "/api/v1/communication/inbox/calls/:id", permission: "communication.inbox.read" },
  // PHASE-041 T-09 (IN-17/IN-18): the calendar connect — OAuth flow with
  // the anti-CSRF state + sealed tokens, task-event writes, and the
  // opt-in contacts sync with review-only proposals (never auto-merge).
  { method: "GET", path: "/api/v1/communication/calendar/status", permission: "communication.calendar.connect" },
  { method: "GET", path: "/api/v1/communication/calendar/connect/:provider", permission: "communication.calendar.connect" },
  { method: "POST", path: "/api/v1/communication/calendar/callback", permission: "communication.calendar.connect" },
  { method: "POST", path: "/api/v1/communication/calendar/events/task/:taskId", permission: "communication.calendar.connect" },
  { method: "POST", path: "/api/v1/communication/calendar/contacts/sync", permission: "communication.calendar.connect" },
  { method: "GET", path: "/api/v1/communication/calendar/contacts/proposals", permission: "communication.calendar.connect" },
  { method: "POST", path: "/api/v1/communication/calendar/contacts/proposals/:id/accept", permission: "communication.calendar.connect" },
  { method: "POST", path: "/api/v1/communication/calendar/contacts/proposals/:id/reject", permission: "communication.calendar.connect" },
  // PHASE-040 T-06 (matrix §3.18): the demo-data loader — the 13-template
  // catalog + status + the one-click seed (feature-gated platform.demo_data,
  // ALL plans — the recorded trial-enablement decision).
  { method: "GET", path: "/api/v1/onboarding/demo-data/templates", permission: "configuration.demo_data.manage" },
  { method: "GET", path: "/api/v1/onboarding/demo-data/status", permission: "configuration.demo_data.manage" },
  { method: "POST", path: "/api/v1/onboarding/demo-data", permission: "configuration.demo_data.manage" },
  // PHASE-040 T-07 (OA-05): the platform-plane sandbox provisioning —
  // platform staff only (PlatformScope), riding platform.subscriptions.
  // manage (the manual-plan-assignment family — never plan-gated, the
  // platform.payouts precedent).
  { method: "POST", path: "/api/v1/platform/sandbox-tenants", permission: "platform.subscriptions.manage" },
  { method: "GET", path: "/api/v1/platform/sandbox-tenants", permission: "platform.subscriptions.manage" },
  // -- PHASE-023 T8: commerce channels (sales.commerce.manage) ----------------
  {
    method: "GET",
    path: "/api/v1/sales/commerce/channels",
    permission: "sales.commerce.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/commerce/import",
    permission: "sales.commerce.manage",
  },
  {
    method: "GET",
    path: "/api/v1/sales/commerce/orders",
    permission: "sales.commerce.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/commerce/orders/:id/resolve",
    permission: "sales.commerce.manage",
  },
  // -- PHASE-023 T6: billing refund + payouts (platform plane) ----------------
  {
    method: "POST",
    path: "/api/v1/platform/billing/refund",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "GET",
    path: "/api/v1/platform/billing/payouts",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/billing/payouts/sync",
    permission: "platform.subscriptions.manage",
  },
  // -- PHASE-010: inventory (matrix §3.5) ----------------------------------
  {
    method: "GET",
    path: "/api/v1/inventory/warehouses",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/warehouses",
    permission: "inventory.warehouses.manage",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/warehouses/:id",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/warehouses/:id/update",
    permission: "inventory.warehouses.manage",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/warehouses/:id/deactivate",
    permission: "inventory.warehouses.manage",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/warehouses/:id/reactivate",
    permission: "inventory.warehouses.manage",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/item-warehouse-settings",
    permission: "inventory.warehouses.manage",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/stock",
    permission: "inventory.stock.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/availability",
    permission: "inventory.stock.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/moves",
    permission: "inventory.moves.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/receipts",
    permission: "inventory.receipts.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/issues",
    permission: "inventory.issues.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/adjustments",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/adjustments",
    permission: "inventory.adjustments.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/adjustments/:id/post",
    permission: "inventory.adjustments.post",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/adjustments/:id/cancel",
    permission: "inventory.adjustments.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/transfers",
    permission: "inventory.transfers.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/transfers",
    permission: "inventory.transfers.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/transfers/:id",
    permission: "inventory.transfers.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/transfers/:id/lines",
    permission: "inventory.transfers.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/transfers/:id/dispatch",
    permission: "inventory.transfers.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/transfers/:id/receive",
    permission: "inventory.transfers.approve",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/transfers/:id/cancel",
    permission: "inventory.transfers.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/counts",
    permission: "inventory.counts.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts",
    permission: "inventory.counts.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/counts/:id",
    permission: "inventory.counts.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/counts/:id/lines",
    permission: "inventory.counts.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts/:id/enter",
    permission: "inventory.counts.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts/:id/submit",
    permission: "inventory.counts.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts/:id/recount",
    permission: "inventory.counts.create",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts/:id/approve",
    permission: "inventory.counts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/counts/:id/cancel",
    permission: "inventory.counts.create",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/batches",
    permission: "inventory.moves.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/batches",
    permission: "inventory.tracking.manage",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/batches/:id/write-off",
    permission: "inventory.tracking.manage",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/serials",
    permission: "inventory.moves.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/serials",
    permission: "inventory.tracking.manage",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/serials/:id/sale",
    permission: "inventory.moves.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/reservations",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reservations",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reservations/:id/release",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reservations/:id/consume",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reservations/sweep-expired",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reorder/run-scan",
    permission: "inventory.stock.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/reports/below-reorder",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/reconciliation/stock-check",
    permission: "inventory.stock.view",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/items/:id/method-switch/preview",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/items/:id/method-switch",
    permission: "inventory.items.method_switch",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/opening-stock/drafts",
    permission: "inventory.stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/opening-stock/post",
    permission: "inventory.adjustments.post",
  },
  // PHASE-044 (T-14): the WMS surface (matrix §3.21 — the eight 0071-seeded
  // keys; one per board). Locations/LPN + the bin-contents + INV-029
  // reconciliation reads ride inventory.wms.locations.
  {
    method: "GET",
    path: "/api/v1/inventory/wms/zones",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/zones",
    permission: "inventory.wms.locations",
  },
  {
    method: "PATCH",
    path: "/api/v1/inventory/wms/zones/:id",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/zones/:id/aisles",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/zones/:id/aisles",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/aisles/:id/racks",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/aisles/:id/racks",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/bins",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/bins/barcode/:barcode",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/bins/:id",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/bins",
    permission: "inventory.wms.locations",
  },
  {
    method: "PATCH",
    path: "/api/v1/inventory/wms/bins/:id",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/locations/tree",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/bin-contents",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/availability-by-bin",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/reconcile",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/lpns",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/lpns/:id/contents",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/lpns",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/lpns/:id/close",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/lpns/:id/bind",
    permission: "inventory.wms.locations",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/lpns/:id/move",
    permission: "inventory.wms.locations",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/serial-movements",
    permission: "inventory.tracking.serial_ledger",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/putaway/rules",
    permission: "inventory.wms.putaway",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/putaway/rules",
    permission: "inventory.wms.putaway",
  },
  {
    method: "PATCH",
    path: "/api/v1/inventory/wms/putaway/rules/:id",
    permission: "inventory.wms.putaway",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/putaway/tasks",
    permission: "inventory.wms.putaway",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/putaway/tasks/:id/label",
    permission: "inventory.wms.putaway",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/putaway/labels",
    permission: "inventory.wms.putaway",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/putaway/tasks/:id/assign",
    permission: "inventory.wms.putaway",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/putaway/tasks/:id/confirm",
    permission: "inventory.wms.putaway",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/putaway/tasks/:id/cancel",
    permission: "inventory.wms.putaway",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-strategy/:warehouseId",
    permission: "inventory.wms.picking",
  },
  {
    method: "PUT",
    path: "/api/v1/inventory/wms/pick-strategy",
    permission: "inventory.wms.picking",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-waves",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-waves",
    permission: "inventory.wms.picking",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-waves/:id",
    permission: "inventory.wms.picking",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-waves/:id/tasks",
    permission: "inventory.wms.picking",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-waves/:id/cluster-route",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-waves/:id/release",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-waves/:id/complete",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-waves/:id/cancel",
    permission: "inventory.wms.picking",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/pick-tasks",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-tasks/:id/assign",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-tasks/:id/start",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-tasks/:id/confirm",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/pick-tasks/:id/cancel",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/bin-contents/:id/transition",
    permission: "inventory.quarantine",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/cycle-count-schedules",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-schedules",
    permission: "inventory.cycle_counts",
  },
  {
    method: "PATCH",
    path: "/api/v1/inventory/wms/cycle-count-schedules/:id",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-schedules/:id/run",
    permission: "inventory.cycle_counts",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/cycle-count-documents",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents",
    permission: "inventory.cycle_counts",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id",
    permission: "inventory.cycle_counts",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/lines",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/enter",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/recount",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/submit",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/review",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/approve",
    permission: "inventory.cycle_counts",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/cycle-count-documents/:id/cancel",
    permission: "inventory.cycle_counts",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/abc",
    permission: "inventory.abc",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/abc/recompute",
    permission: "inventory.abc",
  },
  {
    method: "GET",
    path: "/api/v1/inventory/wms/quarantine-board",
    permission: "inventory.quarantine",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/quarantine-board/:contentId/transition",
    permission: "inventory.quarantine",
  },
  {
    method: "POST",
    path: "/api/v1/inventory/wms/quarantine-board/:contentId/dispose",
    permission: "inventory.quarantine",
  },
  // PHASE-011 purchasing routes (matrix §3.3 exact keys). Payments' money
  // movement rides the PHASE-008 treasury routes (already keyed
  // purchasing.payments.*); this surface adds the AP-specific endpoints.
  {
    method: "GET",
    path: "/api/v1/purchasing/purchase-requests",
    permission: "purchasing.purchase_requests.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-requests",
    permission: "purchasing.purchase_requests.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/purchase-requests/:id",
    permission: "purchasing.purchase_requests.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-requests/:id/submit",
    permission: "purchasing.purchase_requests.create",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-requests/:id/approve",
    permission: "purchasing.purchase_requests.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-requests/:id/reject",
    permission: "purchasing.purchase_requests.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-requests/:id/cancel",
    permission: "purchasing.purchase_requests.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/purchase-orders",
    permission: "purchasing.purchase_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders",
    permission: "purchasing.purchase_orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/purchase-orders/:id",
    permission: "purchasing.purchase_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders/:id/submit",
    permission: "purchasing.purchase_orders.create",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders/:id/approve",
    permission: "purchasing.purchase_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders/:id/issue",
    permission: "purchasing.purchase_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders/:id/close",
    permission: "purchasing.purchase_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/purchase-orders/:id/cancel",
    permission: "purchasing.purchase_orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/goods-receipts",
    permission: "purchasing.goods_receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/goods-receipts",
    permission: "purchasing.goods_receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/goods-receipts/:id",
    permission: "purchasing.goods_receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/goods-receipts/:id/post",
    permission: "purchasing.goods_receipts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/goods-receipts/:id/cancel",
    permission: "purchasing.goods_receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/landed-costs",
    permission: "purchasing.goods_receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/landed-costs",
    permission: "purchasing.goods_receipts.create",
  },
  // PHASE-015 T9 (purchasing.landed_costs full workflow): the read-only
  // allocation preview.
  {
    method: "POST",
    path: "/api/v1/purchasing/landed-costs/preview",
    permission: "purchasing.goods_receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/landed-costs/:id/post",
    permission: "purchasing.goods_receipts.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/landed-costs/:id/cancel",
    permission: "purchasing.goods_receipts.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/supplier-invoices",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices",
    permission: "purchasing.supplier_invoices.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/supplier-invoices/:id",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/supplier-invoices/:id/match",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices/:id/match",
    permission: "purchasing.supplier_invoices.create",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices/:id/submit",
    permission: "purchasing.supplier_invoices.create",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices/:id/approve",
    permission: "purchasing.supplier_invoices.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices/:id/post",
    permission: "purchasing.supplier_invoices.post",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/supplier-invoices/:id/cancel",
    permission: "purchasing.supplier_invoices.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/debit-notes",
    permission: "purchasing.debit_notes.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/debit-notes",
    permission: "purchasing.debit_notes.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/debit-notes/:id",
    permission: "purchasing.debit_notes.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/debit-notes/:id/submit",
    permission: "purchasing.debit_notes.create",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/debit-notes/:id/approve",
    permission: "purchasing.debit_notes.approve",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/debit-notes/:id/post",
    permission: "purchasing.debit_notes.post",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/debit-notes/:id/cancel",
    permission: "purchasing.debit_notes.create",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/payments/:id/reallocations",
    permission: "purchasing.payments.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/payments/:id/reallocate",
    permission: "purchasing.payments.approve",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/ap/aging",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/ap/statements/:supplierId",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/grni",
    permission: "purchasing.goods_receipts.view",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/ap/open-items",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/purchasing/ap/opening-verification",
    permission: "purchasing.supplier_invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/purchasing/reconciliation/grni-check",
    permission: "purchasing.supplier_invoices.post",
  },
  // PHASE-012 sales routes (matrix §3.2 exact keys). Receipts' money
  // movement rides the PHASE-008 treasury routes (already keyed
  // sales.receipts.*); this surface adds the quote-to-cash chain, the
  // AR-specific endpoints, and the credit-check preview.
  {
    method: "GET",
    path: "/api/v1/sales/quotations",
    permission: "sales.quotations.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations",
    permission: "sales.quotations.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/quotations/:id",
    permission: "sales.quotations.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/:id/send",
    permission: "sales.quotations.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/:id/accept",
    permission: "sales.quotations.convert",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/:id/convert",
    permission: "sales.quotations.convert",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/:id/reject",
    permission: "sales.quotations.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/:id/cancel",
    permission: "sales.quotations.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/quotations/sweep-expired",
    permission: "sales.quotations.approve",
  },
  {
    method: "GET",
    path: "/api/v1/sales/sales-orders",
    permission: "sales.orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders",
    permission: "sales.orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/sales-orders/:id",
    permission: "sales.orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/submit",
    permission: "sales.orders.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/approve",
    permission: "sales.orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/issue",
    permission: "sales.orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/close",
    permission: "sales.orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/cancel",
    permission: "sales.orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/delivery-notes",
    permission: "sales.deliveries.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/delivery-notes",
    permission: "sales.deliveries.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/delivery-notes/:id",
    permission: "sales.deliveries.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/delivery-notes/:id/post",
    permission: "sales.deliveries.create",
  },
  // PHASE-044 (T-15): the delivery's directed-pick wave (PP-11) — the
  // picking WMS key, not the sales create key (the 0071 §1 matrix row).
  {
    method: "POST",
    path: "/api/v1/sales/delivery-notes/:id/pick-wave",
    permission: "inventory.wms.picking",
  },
  {
    method: "POST",
    path: "/api/v1/sales/delivery-notes/:id/convert-to-invoice",
    permission: "sales.invoices.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/delivery-notes/:id/cancel",
    permission: "sales.deliveries.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/sales-invoices",
    permission: "sales.invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-invoices",
    permission: "sales.invoices.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/sales-invoices/:id",
    permission: "sales.invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-invoices/:id/submit",
    permission: "sales.invoices.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-invoices/:id/approve",
    permission: "sales.invoices.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-invoices/:id/post",
    permission: "sales.invoices.post",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-invoices/:id/cancel",
    permission: "sales.invoices.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/credit-notes",
    permission: "sales.credit_notes.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/credit-notes",
    permission: "sales.credit_notes.create",
  },
  {
    method: "GET",
    path: "/api/v1/sales/credit-notes/:id",
    permission: "sales.credit_notes.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/credit-notes/:id/submit",
    permission: "sales.credit_notes.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/credit-notes/:id/approve",
    permission: "sales.credit_notes.approve",
  },
  {
    method: "POST",
    path: "/api/v1/sales/credit-notes/:id/post",
    permission: "sales.credit_notes.post",
  },
  {
    method: "POST",
    path: "/api/v1/sales/credit-notes/:id/cancel",
    permission: "sales.credit_notes.create",
  },
  // PHASE-039 (0055; matrix §3.9): the customer RMA workflow — create and
  // progress through the lifecycle to the completion credit note; the SoD
  // approval hop is its own key. The managed-warranty register rides the
  // single sales.warranties.manage key.
  { method: "GET", path: "/api/v1/sales/returns", permission: "sales.rma.read" },
  { method: "POST", path: "/api/v1/sales/returns", permission: "sales.rma.manage" },
  { method: "GET", path: "/api/v1/sales/returns/:id", permission: "sales.rma.read" },
  { method: "POST", path: "/api/v1/sales/returns/:id/approve", permission: "sales.rma.approve" },
  { method: "POST", path: "/api/v1/sales/returns/:id/receive", permission: "sales.rma.manage" },
  { method: "POST", path: "/api/v1/sales/returns/:id/inspect", permission: "sales.rma.manage" },
  { method: "POST", path: "/api/v1/sales/returns/:id/complete", permission: "sales.rma.manage" },
  { method: "POST", path: "/api/v1/sales/returns/:id/cancel", permission: "sales.rma.manage" },
  { method: "GET", path: "/api/v1/sales/warranties", permission: "sales.warranties.manage" },
  { method: "POST", path: "/api/v1/sales/warranties", permission: "sales.warranties.manage" },
  { method: "POST", path: "/api/v1/sales/warranties/:id/void", permission: "sales.warranties.manage" },
  // PHASE-039 (0056/0057/0058; matrix §3.9): the dunning + collections
  // workspace — the policy ladder (BR-065), the letters register with the
  // late-fee charge/waive pair (L1-12, its own key), the logged collection
  // actions + the periodic credit reviews (L1-10), and the
  // collection-agency terminal layer (L1-11, its own key). The public
  // agency callback rides PUBLIC_ROUTES below (the token IS the
  // credential).
  { method: "GET", path: "/api/v1/sales/dunning/policies", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/policies", permission: "sales.dunning.manage" },
  { method: "PATCH", path: "/api/v1/sales/dunning/policies/:id", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/policies/:id/activate", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/policies/:id/archive", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/run", permission: "sales.dunning.manage" },
  { method: "GET", path: "/api/v1/sales/dunning/letters", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/letters/:id/waive-fee", permission: "sales.late-fees.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/charge-fee", permission: "sales.late-fees.manage" },
  { method: "GET", path: "/api/v1/sales/dunning/actions", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/dunning/actions", permission: "sales.dunning.manage" },
  { method: "GET", path: "/api/v1/sales/credit-reviews", permission: "sales.dunning.manage" },
  { method: "POST", path: "/api/v1/sales/credit-reviews/:partnerId", permission: "sales.dunning.manage" },
  { method: "GET", path: "/api/v1/sales/collection-agencies", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-agencies", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-agencies/:id/issue-token", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-agencies/:id/suspend", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-agencies/:id/activate", permission: "sales.collection-agencies.manage" },
  { method: "GET", path: "/api/v1/sales/collection-referrals", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-referrals", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-referrals/:id/settle", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-referrals/:id/post-commission", permission: "sales.collection-agencies.manage" },
  { method: "POST", path: "/api/v1/sales/collection-referrals/:id/close", permission: "sales.collection-agencies.manage" },
  {
    method: "GET",
    path: "/api/v1/sales/ar/aging",
    permission: "sales.invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/sales/ar/statements/:customerId",
    permission: "partners.statements.view",
  },
  {
    method: "GET",
    path: "/api/v1/sales/ar/open-items",
    permission: "sales.receipts.view",
  },
  {
    method: "GET",
    path: "/api/v1/sales/ar/opening-verification",
    permission: "sales.invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/sales/ar/allocations",
    permission: "sales.receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/receipts/:id/reallocate",
    permission: "sales.receipts.approve",
  },
  {
    method: "GET",
    path: "/api/v1/sales/receipts/:id/reallocations",
    permission: "sales.receipts.view",
  },
  {
    method: "POST",
    path: "/api/v1/sales/partners/:id/credit-check",
    permission: "sales.invoices.view",
  },
  {
    method: "POST",
    path: "/api/v1/partners/partners/:id/credit-check",
    permission: "sales.invoices.view",
  },
  {
    method: "GET",
    path: "/api/v1/sales/reps",
    permission: "sales.reps.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/reps",
    permission: "sales.reps.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/reps/:id/activate",
    permission: "sales.reps.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/reps/:id/deactivate",
    permission: "sales.reps.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/jobs/invoice-overdue/run-scan",
    permission: "sales.invoices.view",
  },
  // PHASE-013 reporting (PHASE-013 §4; matrix §3.8): registry snapshot, run
  // execution + polling, stored results, exports (audited, signed URLs),
  // print preview + template registry.
  { method: "GET", path: "/api/v1/reporting/reports", permission: "reporting.reports.run" },
  { method: "POST", path: "/api/v1/reporting/report-runs", permission: "reporting.reports.run" },
  { method: "GET", path: "/api/v1/reporting/report-runs", permission: "reporting.reports.run" },
  { method: "GET", path: "/api/v1/reporting/report-runs/:id", permission: "reporting.reports.run" },
  { method: "GET", path: "/api/v1/reporting/report-runs/:id/result", permission: "reporting.reports.run" },
  { method: "POST", path: "/api/v1/reporting/report-runs/:id/exports", permission: "reporting.reports.export" },
  { method: "GET", path: "/api/v1/reporting/print-preview/:id", permission: "reporting.reports.run" },
  { method: "GET", path: "/api/v1/reporting/print-templates", permission: "reporting.reports.run" },
  // PHASE-014 billing (PHASE-014 §4; matrix §3.9/§3.10): tenant-plane
  // subscription management (billing history, plan change, checkout
  // completion, usage) + platform-plane billing console.
  { method: "GET", path: "/api/v1/tenancy/subscriptions", permission: "tenancy.subscription.manage" },
  { method: "POST", path: "/api/v1/tenancy/subscriptions/change-plan", permission: "tenancy.subscription.manage" },
  {
    method: "POST",
    path: "/api/v1/tenancy/subscriptions/checkout/:ref/complete",
    permission: "tenancy.subscription.manage",
  },
  { method: "GET", path: "/api/v1/tenancy/usage", permission: "tenancy.subscription.manage" },
  { method: "GET", path: "/api/v1/platform/subscriptions", permission: "platform.subscriptions.manage" },
  { method: "POST", path: "/api/v1/platform/subscriptions", permission: "platform.subscriptions.manage" },
  {
    method: "POST",
    path: "/api/v1/platform/subscriptions/:id/manual-payment",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/subscriptions/:id/suspend",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/subscriptions/:id/restore",
    permission: "platform.subscriptions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/platform/subscriptions/run-daily-pass",
    permission: "platform.subscriptions.manage",
  },
  // PHASE-015 configuration (PHASE-015 §4; matrix §3.8): the industry
  // template engine's write surface — apply (feature
  // industry.template_engine), the additive-only switch/extend + preview
  // diff (BR-038; feature industry.template_switching), and the registry
  // drift check (upgrade offers recorded, never auto-applied). Registry
  // reads + effective-config are session routes (SESSION_ROUTES below).
  {
    method: "POST",
    path: "/api/v1/configuration/templates/:key/apply",
    permission: "configuration.templates.apply",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/templates/:key/preview",
    permission: "configuration.templates.apply",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/templates/:key/switch",
    permission: "configuration.templates.apply",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/templates/:key/extend",
    permission: "configuration.templates.apply",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/templates/drift-check",
    permission: "configuration.templates.apply",
  },

  // PHASE-036 (Blueprint v3.0 · CR-06; ADR-0019; matrix §3.8): the
  // extensibility core — the definitions manager, the picklist editor
  // (FD-20), the form-layout designer (FD-19), and the entity-values read.
  // All carry @RequireFeature(platform.custom_fields — migration 0049's
  // business+enterprise grant). The render surface (definitions with
  // inlined options for the six first-wave entity forms) and the entity
  // registry are session routes (SESSION_ROUTES below); entity value
  // WRITES ride the owning entity's own routes/permissions.
  {
    method: "GET",
    path: "/api/v1/configuration/custom-fields/definitions",
    permission: "configuration.custom_fields.read",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/definitions",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/configuration/custom-fields/definitions/:id",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/definitions/:id/archive",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/definitions/:id/restore",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "GET",
    path: "/api/v1/configuration/custom-fields/picklists",
    permission: "configuration.custom_fields.read",
  },
  {
    method: "GET",
    path: "/api/v1/configuration/custom-fields/picklists/:id",
    permission: "configuration.custom_fields.read",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklists",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/configuration/custom-fields/picklists/:id",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklists/:id/archive",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklists/:id/restore",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklists/:id/options",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/configuration/custom-fields/picklist-options/:optionId",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklist-options/:optionId/archive",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklist-options/:optionId/restore",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "POST",
    path: "/api/v1/configuration/custom-fields/picklists/:id/options/reorder",
    permission: "configuration.custom_fields.manage",
  },
  {
    method: "GET",
    path: "/api/v1/configuration/form-layouts",
    permission: "configuration.custom_fields.read",
  },
  {
    method: "PUT",
    path: "/api/v1/configuration/form-layouts/:entityType",
    permission: "configuration.form_layouts.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/configuration/form-layouts/:entityType/roles/:roleKey",
    permission: "configuration.form_layouts.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/configuration/form-layouts/:entityType/roles/:roleKey",
    permission: "configuration.form_layouts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/configuration/custom-fields/values/:entityType/:entityId",
    permission: "configuration.custom_fields.read",
  },

  // PHASE-017 (matrix §3.2/§3.8): the automotive job-card workspace
  // (sales.job_cards.* family — the manage key covers the card lifecycle;
  // posting runs through the sales invoice chain's own keys).
  {
    method: "GET",
    path: "/api/v1/sales/job-cards",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards",
    permission: "sales.job_cards.manage",
  },
  {
    method: "GET",
    path: "/api/v1/sales/job-cards/:id",
    permission: "sales.job_cards.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/sales/job-cards/:id",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/quotation",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/approve",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/complete",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/invoice",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/cancel",
    permission: "sales.job_cards.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/job-cards/:id/lines/:lineId/log-hours",
    permission: "sales.job_cards.manage",
  },

  // PHASE-017: the partners-owned vehicle registry (T5).
  {
    method: "GET",
    path: "/api/v1/partners/vehicles",
    permission: "partners.vehicles.manage",
  },
  {
    method: "POST",
    path: "/api/v1/partners/vehicles",
    permission: "partners.vehicles.manage",
  },
  {
    method: "GET",
    path: "/api/v1/partners/vehicles/:id",
    permission: "partners.vehicles.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/partners/vehicles/:id",
    permission: "partners.vehicles.manage",
  },
  {
    method: "POST",
    path: "/api/v1/partners/vehicles/:id/archive",
    permission: "partners.vehicles.manage",
  },
  {
    method: "GET",
    path: "/api/v1/partners/vehicles/:id/service-history",
    permission: "partners.vehicles.manage",
  },

  // PHASE-017: the distribution module (T7/T8/T10/T11) — routes & visits
  // (planning-only), van stock (VAN warehouses + load-out/unload), rep
  // settlements (approve is the RISKY money-lock key, creator≠approver),
  // customer tiers, and free-goods rules.
  {
    method: "GET",
    path: "/api/v1/distribution/routes",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/routes",
    permission: "distribution.routes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/routes/:id",
    permission: "distribution.routes.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/distribution/routes/:id",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/routes/:id/customers",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/routes/:id/plan-visits",
    permission: "distribution.routes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/visits",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/visits/:id/check-in",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/visits/:id/complete",
    permission: "distribution.routes.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/visits/:id/skip",
    permission: "distribution.routes.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/vans",
    permission: "distribution.van_stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/vans",
    permission: "distribution.van_stock.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/van-stock",
    permission: "distribution.van_stock.view",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/van-stock/load-out",
    permission: "distribution.van_stock.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/van-stock/unload",
    permission: "distribution.van_stock.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/van-stock/transfers/:id/receive",
    permission: "distribution.van_stock.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/settlements",
    permission: "distribution.settlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/settlements",
    permission: "distribution.settlements.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/settlements/:id",
    permission: "distribution.settlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/settlements/:id/count",
    permission: "distribution.settlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/settlements/:id/approve",
    permission: "distribution.settlements.approve",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/settlements/:id/post",
    permission: "distribution.settlements.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/settlements/:id/cancel",
    permission: "distribution.settlements.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/tiers",
    permission: "distribution.tiers.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/tiers",
    permission: "distribution.tiers.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/tiers/:id",
    permission: "distribution.tiers.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/distribution/tiers/:id",
    permission: "distribution.tiers.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/free-goods-rules",
    permission: "distribution.free_goods.manage",
  },
  {
    method: "POST",
    path: "/api/v1/distribution/free-goods-rules",
    permission: "distribution.free_goods.manage",
  },
  {
    method: "GET",
    path: "/api/v1/distribution/free-goods-rules/:id",
    permission: "distribution.free_goods.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/distribution/free-goods-rules/:id",
    permission: "distribution.free_goods.manage",
  },

  // PHASE-017: commissions (T12) — per-rep rules + runs (accrual at run).
  {
    method: "GET",
    path: "/api/v1/sales/reps/:id/commission-rule",
    permission: "sales.commissions.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/sales/reps/:id/commission-rule",
    permission: "sales.commissions.manage",
  },
  {
    method: "GET",
    path: "/api/v1/sales/commission-runs",
    permission: "sales.commissions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/commission-runs",
    permission: "sales.commissions.manage",
  },
  {
    method: "GET",
    path: "/api/v1/sales/commission-runs/:id",
    permission: "sales.commissions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/commission-runs/:id/post",
    permission: "sales.commissions.manage",
  },
  {
    method: "POST",
    path: "/api/v1/sales/commission-runs/:id/cancel",
    permission: "sales.commissions.manage",
  },

  // PHASE-018 (matrix §3.8): the manufacturing module — BOM maintenance
  // (one manage key for the whole version lifecycle), the production-order
  // workspace (view/create split from the RISKY approve pair release/start/
  // cancel and the RISKY post keys consume/scrap/complete), the WIP
  // reconciliation run, the batch-genealogy reads, and QC inspections.
  {
    method: "GET",
    path: "/api/v1/manufacturing/boms",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/boms",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/boms/:id",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/boms/:id",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/boms/:id/activate",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/boms/:id/archive",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/boms/explosion",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/production-orders",
    permission: "manufacturing.production_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders",
    permission: "manufacturing.production_orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/production-orders/:id",
    permission: "manufacturing.production_orders.view",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/production-orders/:id",
    permission: "manufacturing.production_orders.create",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/release",
    permission: "manufacturing.production_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/start",
    permission: "manufacturing.production_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/consume",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/scrap",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/complete",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/cancel",
    permission: "manufacturing.production_orders.approve",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/reconciliation/wip-check",
    permission: "manufacturing.costing.read",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/genealogy/upstream/:batchId",
    permission: "manufacturing.genealogy.read",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/genealogy/downstream/:batchId",
    permission: "manufacturing.genealogy.read",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/genealogy/batch/:batchId",
    permission: "manufacturing.genealogy.read",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/inspections",
    permission: "manufacturing.qc.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/inspections/:id",
    permission: "manufacturing.qc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/inspections",
    permission: "manufacturing.qc.manage",
  },

  // PHASE-042 (0065/0066; matrix §3.20): the manufacturing-execution slice —
  // work centers (one manage key for the master data + the guarded status
  // flip), versioned routings (the BOM surface shape), the shop-floor
  // operation transitions + the OP-scan terminal endpoint (shopfloor.execute
  // — the operational tier; the live operations view rides the order view
  // key), the downtime log, the OEE reads, rework orders (RW- lifecycle),
  // and the item standard costs (L2-12 — drafts, roll-ups, the revaluation
  // activation).
  {
    method: "GET",
    path: "/api/v1/manufacturing/work-centers",
    permission: "manufacturing.work_centers.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/work-centers",
    permission: "manufacturing.work_centers.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/manufacturing/work-centers/:id",
    permission: "manufacturing.work_centers.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/work-centers/:id/status",
    permission: "manufacturing.work_centers.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/routings",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/routings",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/routings/:id",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/manufacturing/routings/:id",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/routings/:id/activate",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/routings/:id/copy",
    permission: "manufacturing.routings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/production-orders/:id/operations",
    permission: "manufacturing.production_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/operations/:seq/start",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/operations/:seq/pause",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/operations/:seq/resume",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/operations/:seq/complete",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/operations/:seq/skip",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/shopfloor/scan",
    permission: "manufacturing.shopfloor.execute",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/downtime",
    permission: "manufacturing.downtime.log",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/downtime",
    permission: "manufacturing.downtime.log",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/downtime/:id/close",
    permission: "manufacturing.downtime.log",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/oee",
    permission: "manufacturing.oee.read",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/rework-orders",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/rework-orders",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/rework-orders/:id/release",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/rework-orders/:id/start",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/rework-orders/:id/complete",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/rework-orders/:id/cancel",
    permission: "manufacturing.rework_orders.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/standard-costs",
    permission: "manufacturing.standard_costs.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/standard-costs",
    permission: "manufacturing.standard_costs.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/standard-costs/roll-up",
    permission: "manufacturing.standard_costs.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/standard-costs/:id/activate",
    permission: "manufacturing.standard_costs.manage",
  },

  // PHASE-043 (matrix §3.20): the MRP & Planning surface — the run
  // engine + suggestions board (manufacturing.mrp), the master production
  // schedule (manufacturing.mps — the frozen-fence override key
  // manufacturing.mps.frozen_edit is DATA-DEPENDENT, resolved per request
  // by the service, not a static row here), the item planning policies +
  // the lot-sizing catalog (manufacturing.planning_policies), the ATP
  // query (manufacturing.mrp), the BOR maintenance (the boms.manage tier)
  // + the rough-cut check (manufacturing.mrp), the tolling round trip
  // (the production-order permission family — tolling posts stock and
  // journals exactly like production orders; no dedicated key was
  // seeded), and the sales-line ATP stamp (sales.orders.view — the
  // promise-date suggestion surface S-10).
  {
    method: "POST",
    path: "/api/v1/manufacturing/mrp/runs",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/mrp/runs",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/mrp/runs/:id",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/mrp/suggestions",
    permission: "manufacturing.mrp",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/mrp/suggestions/:id/accept",
    permission: "manufacturing.mrp",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/mrp/suggestions/:id/dismiss",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/mps/entries",
    permission: "manufacturing.mps",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/mps/entries",
    permission: "manufacturing.mps",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/mps/readiness",
    permission: "manufacturing.mps",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/planning/lot-sizing-rules",
    permission: "manufacturing.planning_policies",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/planning/policies/:itemId",
    permission: "manufacturing.planning_policies",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/planning/policies/:itemId",
    permission: "manufacturing.planning_policies",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/planning/atp",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/planning/bor/:bomId",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/planning/bor/:bomId",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/planning/bor/rough-cut",
    permission: "manufacturing.mrp",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/tolling/orders",
    permission: "manufacturing.production_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/tolling/orders",
    permission: "manufacturing.production_orders.create",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/tolling/orders/:id",
    permission: "manufacturing.production_orders.view",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/tolling/orders/:id/issue",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/tolling/orders/:id/return",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/tolling/orders/:id/settle",
    permission: "manufacturing.production_orders.post",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/tolling/orders/:id/cancel",
    permission: "manufacturing.production_orders.approve",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/boms/:id/substitutions",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/boms/:id/substitutions",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "GET",
    path: "/api/v1/manufacturing/boms/:id/outputs",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/manufacturing/boms/:id/outputs",
    permission: "manufacturing.boms.manage",
  },
  {
    method: "POST",
    path: "/api/v1/manufacturing/production-orders/:id/link-sales-order",
    permission: "manufacturing.production_orders.create",
  },
  {
    method: "POST",
    path: "/api/v1/sales/sales-orders/:id/lines/:lineId/atp",
    permission: "sales.orders.view",
  },

  // PHASE-019 (MASTER-PLAN §11; matrix §3.1/§3.8): the projects dimension
  // (view rides the existing journal-entries view tier; manage mirrors the
  // cost-center trio), the CRM intake (leads + tasks + activities), the
  // service-contract workspace (schedule preview, advances, the billing
  // runs with their own bill key, time entries + weekly review), and the
  // service-order workspace (the job-card generalization).
  {
    method: "GET",
    path: "/api/v1/accounting/projects",
    permission: "accounting.journal_entries.view",
  },
  {
    method: "POST",
    path: "/api/v1/accounting/projects",
    permission: "accounting.projects.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/accounting/projects/:id",
    permission: "accounting.projects.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/leads",
    permission: "crm.leads.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/leads",
    permission: "crm.leads.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/leads/:id",
    permission: "crm.leads.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/crm/leads/:id",
    permission: "crm.leads.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/leads/:id/convert",
    permission: "crm.leads.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/leads/:id/lose",
    permission: "crm.leads.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/tasks",
    permission: "crm.tasks.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/tasks",
    permission: "crm.tasks.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/crm/tasks/:id",
    permission: "crm.tasks.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/tasks/:id/complete",
    permission: "crm.tasks.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/tasks/:id/cancel",
    permission: "crm.tasks.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/activities",
    permission: "crm.activities.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/activities",
    permission: "crm.activities.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/dashboard-summary",
    permission: "crm.leads.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contracts",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/contracts",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contracts/:id",
    permission: "crm.contracts.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/crm/contracts/:id",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/contracts/:id/activate",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/contracts/:id/cancel",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/contracts/:id/renew",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contracts/:id/schedule",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contracts/:id/billing-preview",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/contracts/:id/advances",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contracts/:id/advances",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/contract-invoices",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/billing-runs",
    permission: "crm.contracts.bill",
  },
  {
    method: "POST",
    path: "/api/v1/crm/billing-runs",
    permission: "crm.contracts.bill",
  },
  {
    method: "GET",
    path: "/api/v1/crm/time-entries",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/time-entries",
    permission: "crm.contracts.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/crm/time-entries/:id",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/time-entries/:id/void",
    permission: "crm.contracts.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/time/timesheets/review",
    permission: "crm.contracts.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/service-orders",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders",
    permission: "crm.service_orders.manage",
  },
  {
    method: "GET",
    path: "/api/v1/crm/service-orders/:id",
    permission: "crm.service_orders.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/crm/service-orders/:id",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders/:id/approve",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders/:id/log-hours",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders/:id/complete",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders/:id/invoice",
    permission: "crm.service_orders.manage",
  },
  {
    method: "POST",
    path: "/api/v1/crm/service-orders/:id/cancel",
    permission: "crm.service_orders.manage",
  },

  // PHASE-020 (MASTER-PLAN §8; matrix §3.8/§3.9): the device registry
  // plane (register/attest under the sync register key; list/patch under
  // the identity manage key; revoke under its own key — self revoke is
  // allowed, a device may kill its own credential) and the sync admin
  // plane (health under sync settings; reconciliation + drafts reassign
  // under the revoke key — both are the revoked-device close-out journey).
  // The sync data plane itself (status/pull/push/acks) is session-
  // authenticated self-scope — SESSION_ROUTES below; the device refresh
  // credential exchange is public — PUBLIC_ROUTES below.
  {
    method: "POST",
    path: "/api/v1/devices",
    permission: "sync.devices.register",
  },
  {
    method: "GET",
    path: "/api/v1/devices",
    permission: "identity.devices.manage",
  },
  {
    method: "GET",
    path: "/api/v1/devices/:id",
    permission: "identity.devices.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/devices/:id",
    permission: "identity.devices.manage",
  },
  {
    method: "POST",
    path: "/api/v1/devices/:id/attest",
    permission: "sync.devices.register",
  },
  {
    method: "POST",
    path: "/api/v1/devices/:id/revoke",
    permission: "sync.devices.revoke",
    self: true,
  },
  // PHASE-022 · DR-P22-07 (integrations §3.5): the device-token opt-in
  // surface. Gated like device patch (identity.devices.manage) with the
  // revoke pattern's self scope — the device itself calls it
  // post-registration with its device credentials (the access-token
  // session resolves the user; the handler enforces the ownership
  // boundary: the device's own user, or an admin holding the key).
  {
    method: "PUT",
    path: "/api/v1/devices/:id/push-token",
    permission: "identity.devices.manage",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/sync/admin/health",
    permission: "sync.settings.manage",
  },
  {
    method: "GET",
    path: "/api/v1/sync/admin/reconciliation",
    permission: "sync.devices.revoke",
  },
  {
    method: "POST",
    path: "/api/v1/sync/admin/drafts/reassign",
    permission: "sync.devices.revoke",
  },

  // PHASE-045 (T-03 — matrix §3.24, the six 0086-seeded hr.* keys): the
  // shift-template + roster-grid surface rides hr.shifts (the attendance
  // and import routes land with T-04/T-05 on hr.attendance /
  // hr.attendance.import).
  {
    method: "POST",
    path: "/api/v1/hr/shifts",
    permission: "hr.shifts",
  },
  {
    method: "GET",
    path: "/api/v1/hr/shifts",
    permission: "hr.shifts",
  },
  {
    method: "GET",
    path: "/api/v1/hr/shifts/:id",
    permission: "hr.shifts",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/shifts/:id",
    permission: "hr.shifts",
  },
  {
    method: "POST",
    path: "/api/v1/hr/shifts/:id/activate",
    permission: "hr.shifts",
  },
  {
    method: "POST",
    path: "/api/v1/hr/shifts/:id/deactivate",
    permission: "hr.shifts",
  },
  {
    method: "GET",
    path: "/api/v1/hr/roster",
    permission: "hr.shifts",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/roster/cell",
    permission: "hr.shifts",
  },
  {
    method: "POST",
    path: "/api/v1/hr/roster/cell/clear",
    permission: "hr.shifts",
  },
  {
    method: "POST",
    path: "/api/v1/hr/roster/rotation",
    permission: "hr.shifts",
  },

  // PHASE-045 (T-04 — matrix §3.23): the attendance surface rides
  // hr.attendance — session capture, the one-shot checkout (BR-082),
  // the daily register, the exception board, and the derivation run.
  // The DEVICE-import pipeline (T-05) lands on hr.attendance.import.
  {
    method: "POST",
    path: "/api/v1/hr/attendance/records",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/attendance/records/:id/checkout",
    permission: "hr.attendance",
  },
  {
    method: "GET",
    path: "/api/v1/hr/attendance/register",
    permission: "hr.attendance",
  },
  {
    method: "GET",
    path: "/api/v1/hr/attendance/exceptions",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/attendance/derive",
    permission: "hr.attendance",
  },

  // PHASE-045 (T-05 — the 0086 seed's split): the DEVICE-IMPORT WIZARD
  // (preview, commit, the column mapping) rides hr.attendance.import
  // ("run the device-import wizard"); the REVIEW surface (the import
  // log + the anomaly quarantine + the resolve action) rides
  // hr.attendance (the register's management key).
  {
    method: "POST",
    path: "/api/v1/hr/attendance/import/preview",
    permission: "hr.attendance.import",
  },
  {
    method: "POST",
    path: "/api/v1/hr/attendance/import/commit",
    permission: "hr.attendance.import",
  },
  {
    method: "GET",
    path: "/api/v1/hr/attendance/import/mapping",
    permission: "hr.attendance.import",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/attendance/import/mapping",
    permission: "hr.attendance.import",
  },
  {
    method: "GET",
    path: "/api/v1/hr/attendance/import/batches",
    permission: "hr.attendance",
  },
  {
    method: "GET",
    path: "/api/v1/hr/attendance/import/anomalies",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/attendance/import/anomalies/:id/resolve",
    permission: "hr.attendance",
  },

  // PHASE-045 (T-06 — matrix §3.23): the overtime surface rides
  // hr.overtime — the tier rules, the tier match, the weekend setting,
  // and the entries' simple-approval lifecycle.
  {
    method: "POST",
    path: "/api/v1/hr/overtime/rules",
    permission: "hr.overtime",
  },
  {
    method: "GET",
    path: "/api/v1/hr/overtime/rules",
    permission: "hr.overtime",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/overtime/rules/:id",
    permission: "hr.overtime",
  },
  {
    method: "POST",
    path: "/api/v1/hr/overtime/rules/:id/activate",
    permission: "hr.overtime",
  },
  {
    method: "POST",
    path: "/api/v1/hr/overtime/rules/:id/deactivate",
    permission: "hr.overtime",
  },
  {
    method: "GET",
    path: "/api/v1/hr/overtime/tier",
    permission: "hr.overtime",
  },
  {
    method: "GET",
    path: "/api/v1/hr/overtime/weekend",
    permission: "hr.overtime",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/overtime/weekend",
    permission: "hr.overtime",
  },
  {
    method: "POST",
    path: "/api/v1/hr/overtime/entries",
    permission: "hr.overtime",
  },
  {
    method: "POST",
    path: "/api/v1/hr/overtime/entries/:id/approve",
    permission: "hr.overtime",
  },
  {
    method: "POST",
    path: "/api/v1/hr/overtime/entries/:id/reject",
    permission: "hr.overtime",
  },
  {
    method: "GET",
    path: "/api/v1/hr/overtime/entries",
    permission: "hr.overtime",
  },

  // PHASE-045 (T-07 — matrix §3.23): the leave surface rides hr.leave —
  // the type catalog, the balance cells, the request lifecycle (the
  // simple-approval chain), the accrual policy run, and the rollover.
  {
    method: "POST",
    path: "/api/v1/hr/leave/types",
    permission: "hr.leave",
  },
  {
    method: "GET",
    path: "/api/v1/hr/leave/types",
    permission: "hr.leave",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/leave/types/:id",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/types/:id/activate",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/types/:id/deactivate",
    permission: "hr.leave",
  },
  {
    method: "GET",
    path: "/api/v1/hr/leave/balances",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/requests",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/requests/:id/approve",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/requests/:id/reject",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/requests/:id/cancel",
    permission: "hr.leave",
  },
  {
    method: "GET",
    path: "/api/v1/hr/leave/requests",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/accrual",
    permission: "hr.leave",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/rollover",
    permission: "hr.leave",
  },

  // PHASE-045 (T-08 — matrix §3.23): the holiday-calendars surface
  // rides hr.attendance (the register's absence derivation is the
  // primary consumer; the overtime HOLIDAY tier follows the same
  // calendar — no dedicated key was seeded and none is invented).
  {
    method: "POST",
    path: "/api/v1/hr/holiday-calendars",
    permission: "hr.attendance",
  },
  {
    method: "GET",
    path: "/api/v1/hr/holiday-calendars",
    permission: "hr.attendance",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/holiday-calendars/:id",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/holiday-calendars/:id/activate",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/holiday-calendars/:id/deactivate",
    permission: "hr.attendance",
  },
  {
    method: "POST",
    path: "/api/v1/hr/holiday-calendars/:id/holidays",
    permission: "hr.attendance",
  },
  {
    method: "DELETE",
    path: "/api/v1/hr/holiday-calendars/:id/holidays/:holidayId",
    permission: "hr.attendance",
  },
  {
    method: "GET",
    path: "/api/v1/hr/holidays",
    permission: "hr.attendance",
  },

  // PHASE-045 (T-09 — matrix §3.23's dated note): the employee ↔ user
  // identity bridge (HR-13) — employee-MASTER maintenance riding the
  // payroll employee keys (the link writes employees.user_id), NEVER an
  // hr.* key and NEVER a user-administration key: the SoD law — linking
  // an employee to a user grants nothing; HR data visibility rides HR
  // permissions only (the dedicated attack test pins it).
  {
    method: "POST",
    path: "/api/v1/hr/employees/:id/link-user",
    permission: "payroll.employees.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/employees/:id/unlink-user",
    permission: "payroll.employees.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/employees/:id/bridge",
    permission: "payroll.employees.view",
  },

  // PHASE-045 (T-10 — matrix §3.23's dated note): the payroll variable
  // feeds — the per-pay-period overtime / absence / late feeds + the
  // leave balance snapshot (PHASE-046's variable-component inputs). The
  // feed is the PAYROLL PREPARATION read: it rides payroll.runs.view
  // (the payroll_officer's run-surface key) — the consumer-side handoff
  // of the hr cluster's facts; it grants no hr management surface.
  {
    method: "GET",
    path: "/api/v1/hr/feeds/variable",
    permission: "payroll.runs.view",
  },

  // PHASE-045 (T-11 — matrix §3.23's dated note): the goldens G-50/G-51
  // — the leave family's ONLY ledger surfaces (the period-end accrual
  // posting, policy-gated; the encashment settlement through the payout
  // machinery). Both are POSTING acts riding payroll.runs.post (the
  // ledger-writing key, the SoD three-way split: create ≠ approve ≠
  // post), never an hr.* management key.
  {
    method: "POST",
    path: "/api/v1/hr/leave/accrual/posting",
    permission: "payroll.runs.post",
  },
  {
    method: "POST",
    path: "/api/v1/hr/leave/encashment",
    permission: "payroll.runs.post",
  },

  // PHASE-046 (W-3 — matrix §3.24's dated note, D-13): the G-52
  // remittance settlement — the statutory liability's ONLY settlement
  // path (DR DEDUCTIONS_PAYABLE · CR cash + the payroll_payout movement,
  // the statutory_summary's accrued → remitted). A POSTING act riding
  // payroll.runs.post (the ledger-writing key, the SoD three-way split:
  // create ≠ approve ≠ post), never a payroll.statutory.* management
  // key (those gate the verification + export surfaces).
  {
    method: "POST",
    path: "/api/v1/payroll/runs/:id/remit",
    permission: "payroll.runs.post",
  },

  // PHASE-046 (W-4 — matrix §3.24's dated note, D-10/D-13): the BR-085
  // VERIFICATION ACT — the REQUIRES_VERIFICATION → VERIFIED flip (the
  // one-conditional-UPDATE CAS + the SoD law: the verifier ≠ the row's
  // last editor + the audit trail). Owner-only by seed (the act unblocks
  // legal postings) riding payroll.statutory.verify, NEVER
  // payroll.statutory — the management key must not carry the flip (the
  // SoD split D-10).
  {
    method: "POST",
    path: "/api/v1/payroll/statutory/profiles/:id/verify",
    permission: "payroll.statutory.verify",
  },

  // PHASE-046 (W-4 — matrix §3.24's dated note, T-08/IN-06): the GOSI
  // remittance export — the run's frozen statutory liability as
  // XLSX/CSV (the 028 exceljs pattern: RTL view at locale=ar, tabular
  // 4dp, the per-employee contribution breakdown + totals). A READ-ONLY
  // audited artifact (BR-086 — payroll.remittance_exported; no register
  // writes, no new machinery) riding payroll.statutory (the management
  // key, D-13's export law); exports + PHASE-055 are the path — NO
  // live-government-API claim exists anywhere (IN-06).
  {
    method: "GET",
    path: "/api/v1/payroll/runs/:id/remittance-export",
    permission: "payroll.statutory",
  },

  // PHASE-046 (W-5 — matrix §3.24's guarded-routes paragraph, D-16): the
  // compliance screen's THREE MANAGEMENT LISTS (the /payroll/
  // statutory-profiles tabs) — every statutory row of the tenant (any
  // status, any effective window), READ-ONLY on the management key
  // (BR-086's read family: a read never stamps; the badges ride the
  // rows' own status/citation fields, the verify act stays the single
  // writer at its own owner-only key).
  {
    method: "GET",
    path: "/api/v1/payroll/statutory/profiles",
    permission: "payroll.statutory",
  },
  {
    method: "GET",
    path: "/api/v1/payroll/statutory/brackets",
    permission: "payroll.statutory",
  },
  {
    method: "GET",
    path: "/api/v1/payroll/statutory/eosb-rules",
    permission: "payroll.statutory",
  },

  // PHASE-046 (W-5 — matrix §3.24's guarded-routes paragraph, D-16): the
  // EOSB screen's two views — the calculations register + the BR-087
  // reconciliation (entitlement ↔ provision ↔ settled). READ-ONLY on
  // payroll.eosb (the management key; the views never carry the posting
  // act — the true-up rides the ledger key below).
  {
    method: "GET",
    path: "/api/v1/payroll/eosb/calculations",
    permission: "payroll.eosb",
  },
  {
    method: "GET",
    path: "/api/v1/payroll/eosb/reconciliation",
    permission: "payroll.eosb",
  },

  // PHASE-046 (W-5 — matrix §3.24's guarded-routes paragraph, D-16): the
  // EOSB TRUE-UP TRIGGER — the W-2 engine's delta-only G-54 act exposed
  // unchanged. The ledger act rides the EXISTING payroll.runs.post key
  // (the G-50/G-51 law — never payroll.eosb: the management key must not
  // carry a posting act).
  {
    method: "POST",
    path: "/api/v1/payroll/eosb/true-up",
    permission: "payroll.runs.post",
  },

  // PHASE-045 (T-14 — matrix §3.23 + the 0086 seed note): the employee
  // self-service plane — the OWN-ROWS reads (summary, attendance
  // calendar, roster, the leave world) + the two narrow writes
  // (create-own-request, cancel-own-PENDING). Every row rides
  // hr.self_service marked self: true — runtime-granted to every
  // authenticated user (the SELF_SCOPE_KEYS mechanism), the ownership
  // boundary being the identity bridge (the employee scope resolved
  // from the acting user; an unlinked user is the typed
  // HR_SELF_NOT_LINKED refusal). Approve/reject stay on /hr/leave
  // under hr.leave — this plane grants NO management surface.
  {
    method: "GET",
    path: "/api/v1/hr/self/summary",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/hr/self/attendance",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/hr/self/roster",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/hr/self/leave/types",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/hr/self/leave/balances",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "GET",
    path: "/api/v1/hr/self/leave/requests",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "POST",
    path: "/api/v1/hr/self/leave/requests",
    permission: "hr.self_service",
    self: true,
  },
  {
    method: "POST",
    path: "/api/v1/hr/self/leave/requests/:id/cancel",
    permission: "hr.self_service",
    self: true,
  },

  // PHASE-047 (W-2 — matrix §3.25, the 0098 §1 seed): the talent
  // performance + goals families. The family-cluster mapping (the
  // matrix's guarded-routes note): the performance plane's reads ride
  // hr.performance.view (the scorecard's framework data included — the
  // accountant's read plane); the manage-side writes (cycle lifecycle,
  // calibration, goal authoring, the competency dictionary) ride
  // hr.performance.manage; the OWN-ROWS acts (draft/submit reviews,
  // the own goals read, the KRI progress triage) ride
  // hr.performance.review — the reviewer/owner identity is resolved
  // from the acting user through the identity bridge at the service
  // boundary (never a client-supplied id); the competency dictionary's
  // writes ride hr.competency.manage. BR-090's law holds at the
  // service boundary: the aggregate-360 read returns only the ≥ 3
  // per-relationship aggregates — never an attributed source.
  {
    method: "POST",
    path: "/api/v1/hr/performance/cycles",
    permission: "hr.performance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/performance/cycles",
    permission: "hr.performance.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/performance/cycles/:id",
    permission: "hr.performance.view",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/cycles/:id/activate",
    permission: "hr.performance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/cycles/:id/calibrate",
    permission: "hr.performance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/cycles/:id/close",
    permission: "hr.performance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/performance/cycles/:id/reviews",
    permission: "hr.performance.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/performance/cycles/:id/reviews/:revieweeId/aggregate-360",
    permission: "hr.performance.view",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/reviews/draft",
    permission: "hr.performance.review",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/reviews/submit",
    permission: "hr.performance.review",
  },
  {
    method: "GET",
    path: "/api/v1/hr/performance/reviews/own",
    permission: "hr.performance.review",
  },
  {
    method: "POST",
    path: "/api/v1/hr/performance/reviews/calibrate",
    permission: "hr.performance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/competencies",
    permission: "hr.competency.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/competencies",
    permission: "hr.performance.view",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/competencies/:id",
    permission: "hr.competency.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/competencies/:id/activate",
    permission: "hr.competency.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/competencies/:id/deactivate",
    permission: "hr.competency.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/competencies/levels",
    permission: "hr.performance.view",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/competencies/levels/:level",
    permission: "hr.competency.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/goals",
    permission: "hr.performance.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/goals/:id",
    permission: "hr.performance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/goals/tree",
    permission: "hr.performance.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/goals/own",
    permission: "hr.performance.review",
  },
  {
    method: "POST",
    path: "/api/v1/hr/goals/:id/progress",
    permission: "hr.performance.review",
  },
  {
    method: "GET",
    path: "/api/v1/hr/goals/validate",
    permission: "hr.performance.view",
  },
  // PHASE-047 (W-3 — matrix §3.25, the 0098 §1 seed): the recruitment
  // + training/org/documents families (T-07 + T-08 + T-09). The
  // family-cluster mapping (the matrix's guarded-routes note): the
  // recruitment reads ride hr.recruitment.view; the pipeline's writes
  // (vacancies, applicants, the stage/reopen/hire acts, interview
  // scheduling) ride hr.recruitment.manage; the panelist's OWN
  // scorecard rides hr.recruitment.interview (the acting user's
  // linked employee is resolved at the service boundary — the
  // own-rows law, never a client-supplied panelist id). The training
  // reads ride hr.training.view; the family's writes (programs,
  // enrollments, the certification register — the family-cluster
  // mapping: the view key names all three surfaces) ride
  // hr.training.manage. The org reads ride hr.org.view; the tree and
  // position writes (the D-09 cycle-safe moves) ride hr.org.manage.
  // The document register's reads AND writes ride hr.documents.manage
  // (the register's own permission plane — the PII inventory's law:
  // the numbers surface only here), and the hr-expiry-sweep's
  // registration surface rides the same key (the compliance plane's
  // config).
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/vacancies",
    permission: "hr.recruitment.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/vacancies",
    permission: "hr.recruitment.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/vacancies/:id",
    permission: "hr.recruitment.view",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/vacancies/:id/transition",
    permission: "hr.recruitment.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/applicants",
    permission: "hr.recruitment.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/applicants",
    permission: "hr.recruitment.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/applicants/:id",
    permission: "hr.recruitment.view",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/applicants/:id/stage",
    permission: "hr.recruitment.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/applicants/:id/reopen",
    permission: "hr.recruitment.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/applicants/:id/hire",
    permission: "hr.recruitment.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/recruitment/interviews",
    permission: "hr.recruitment.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/interviews",
    permission: "hr.recruitment.view",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/recruitment/interviews/:id/scorecard",
    permission: "hr.recruitment.interview",
  },
  {
    method: "POST",
    path: "/api/v1/hr/training/programs",
    permission: "hr.training.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/training/programs",
    permission: "hr.training.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/training/programs/:id",
    permission: "hr.training.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/training/programs/:id",
    permission: "hr.training.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/training/enrollments",
    permission: "hr.training.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/training/enrollments",
    permission: "hr.training.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/training/enrollments/:id",
    permission: "hr.training.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/training/certifications",
    permission: "hr.training.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/training/certifications",
    permission: "hr.training.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/training/certifications/:id",
    permission: "hr.training.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/org/units",
    permission: "hr.org.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/org/units",
    permission: "hr.org.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/org/units/:id",
    permission: "hr.org.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/positions",
    permission: "hr.org.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/positions",
    permission: "hr.org.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/positions/:id",
    permission: "hr.org.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/documents",
    permission: "hr.documents.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/documents",
    permission: "hr.documents.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/hr/documents/:id",
    permission: "hr.documents.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/hr/documents/:id",
    permission: "hr.documents.manage",
  },
  {
    method: "GET",
    path: "/api/v1/hr/alerts/expiry-sweep",
    permission: "hr.documents.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/hr/alerts/expiry-sweep",
    permission: "hr.documents.manage",
  },
  // PHASE-047 (W-4 — matrix §3.25, the 0098 §1 seed): the external HR
  // bridges (T-10, D-07 — the three export contracts + the two import
  // paths). The family-cluster mapping (the W-3 precedent — no new
  // keys, drift stays 312 = 312): the employee-master and
  // employment-org-snapshot exports ride payroll.employees.view — the
  // employment master's own read plane (the 045 bridge-read precedent;
  // the org axes are D-01's documented extensions riding the master as
  // the employment record's placement columns); the appraisal-results
  // export rides hr.performance.view — the performance plane's read
  // key (BR-090's posture holds structurally: the contract ships the
  // MANAGER outcomes only, no reviewer axis, no 360 input rows); the
  // appraisal-results import rides hr.performance.manage — the
  // manage-side bulk act (the reviewer identity is the DATA's own, the
  // external system's manager; the acting user is the importing
  // administrator — the own-rows law is the in-app /review surface's);
  // the training-completions import rides hr.training.manage — the
  // family's write key.
  {
    method: "GET",
    path: "/api/v1/hr/bridges/exports/employee-master",
    permission: "payroll.employees.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/bridges/exports/employment-org-snapshot",
    permission: "payroll.employees.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/bridges/exports/appraisal-results",
    permission: "hr.performance.view",
  },
  {
    method: "POST",
    path: "/api/v1/hr/bridges/imports/appraisal-results",
    permission: "hr.performance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/hr/bridges/imports/training-completions",
    permission: "hr.training.manage",
  },
  // PHASE-047 (W-5 — T-14, the 360 extension's composition reads): four
  // READ routes on the EXISTING family keys (the 046 W-5 web-plane
  // precedent — the module API serves the screen's read-model
  // composition; no new keys, drift stays 312 = 312). The trend read
  // ships ONLY the MANAGER reviews (BR-090 by construction — the 360
  // input rows never leave the aggregate read); the goals read is the
  // manage-side plane (the OWN plane stays goals/own on
  // hr.performance.review); the applicant-by-employee read returns
  // null for no-hire-link (A7-indistinguishable, never a 404 — null
  // is the common case); the placement read is D-01's documented
  // extension axes, READ-ONLY on the employees substrate.
  {
    method: "GET",
    path: "/api/v1/hr/performance/reviews/for-employee/:employeeId",
    permission: "hr.performance.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/goals/for-employee/:employeeId",
    permission: "hr.performance.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/recruitment/applicants/by-employee/:employeeId",
    permission: "hr.recruitment.view",
  },
  {
    method: "GET",
    path: "/api/v1/hr/org/placement/:employeeId",
    permission: "hr.org.view",
  },

  // PHASE-048 (W-9 — T-05 + T-06 + T-07, dated 2026-11-20; matrix §3.26):
  // the /api/v1/projects/* families BEGIN — the W-8 keys-seed-first
  // discipline's first binding wave (the fourteen projects.* keys seeded
  // at 0103 §1 bind their routes as the W-9…W-13 waves ship; this block
  // binds six of them: projects.wbs.view/manage ·
  // projects.budget.view/manage · projects.allocation.manage ·
  // projects.evm.view — 988 + 19 = 1007). The WBS board (wbs.view),
  // the cost plan (budget.view/manage), the resource allocations
  // (allocation.manage — the 14-key list carries no allocation.view:
  // the allocation plane's read + write ride the manage key), and the
  // actual collectors + INV-033 (evm.view — AC is the EVM plane's cost
  // figure, the W-10 engine's input; the accountant's finance-read
  // key). The entitlement plane rides the projects.wbs feature flag
  // (the @RequireFeature decorator — the entitlement/authorization
  // separation, D-16).
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/wbs",
    permission: "projects.wbs.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/wbs/rollup",
    permission: "projects.wbs.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/wbs/tasks",
    permission: "projects.wbs.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/projects/wbs/tasks/:id",
    permission: "projects.wbs.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/projects/wbs/tasks/:id",
    permission: "projects.wbs.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/budgets",
    permission: "projects.budget.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/budgets",
    permission: "projects.budget.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/budgets/:id/lines",
    permission: "projects.budget.view",
  },
  {
    method: "PUT",
    path: "/api/v1/projects/budgets/:id/lines",
    permission: "projects.budget.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/budgets/:id/approve",
    permission: "projects.budget.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/budgets/:id/close",
    permission: "projects.budget.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/budget-curve",
    permission: "projects.budget.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/budget-vs-actual",
    permission: "projects.budget.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/allocations",
    permission: "projects.allocation.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/allocations",
    permission: "projects.allocation.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/projects/allocations/:id",
    permission: "projects.allocation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/allocation-warnings",
    permission: "projects.allocation.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/actuals",
    permission: "projects.evm.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/inv033",
    permission: "projects.evm.view",
  },

  // PHASE-048 (W-10 — T-08 + T-09 + the D-11 engine, dated 2026-11-20;
  // matrix §3.26): the EVM engine's own surface + the change-order gate
  // + the IAS-23 capitalization — the W-8 keys' second binding wave
  // (1007 + 11 = 1018). The EVM snapshot binds evm.view (the W-9
  // finance-read key's own engine — PV from the approved curve, the two
  // EV disciplines, AC from the collectors, CPI/SPI/ETC/EAC). The
  // change-order authoring + reads bind change_order.view (the
  // fourteen-key list ships no change_order.manage — BR-094's gate
  // makes authoring safe: a DRAFT author moves nothing until an
  // approver acts, so the view key carries the working plane), and THE
  // GATE (approve/reject) binds change_order.approve. The IAS-23
  // routes ride the BUDGET plane's keys (D-11's own scope law: the
  // capitalization rides the approved budget's lines; the fourteen-key
  // list ships no ias23 key — preview + the scope rows' read →
  // budget.view, capitalize → budget.manage, the dated reading recorded
  // here). The entitlement plane rides the projects.wbs feature flag on
  // every route (D-16).
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/evm",
    permission: "projects.evm.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/change-orders",
    permission: "projects.change_order.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/change-orders",
    permission: "projects.change_order.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/change-orders/ceiling",
    permission: "projects.change_order.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/change-orders/:id",
    permission: "projects.change_order.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/change-orders/:id/submit",
    permission: "projects.change_order.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/change-orders/:id/approve",
    permission: "projects.change_order.approve",
  },
  {
    method: "POST",
    path: "/api/v1/projects/change-orders/:id/reject",
    permission: "projects.change_order.approve",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/ias23/preview",
    permission: "projects.budget.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/ias23/capitalize",
    permission: "projects.budget.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/ias23/capitalizations",
    permission: "projects.budget.view",
  },

  // PHASE-048 (W-11 — T-10 + T-11 + T-12, dated 2026-11-20; matrix
  // §3.26): the contracting core — the W-8 keys' third binding wave
  // (1018 + 20 = 1038). The authoring + read plane binds
  // contracting.view (the W-10 gate's own reading: a DRAFT author
  // moves nothing until an approver acts, so the view key carries the
  // working plane); THE APPROVAL GATES (the sub certificate's approve
  // — the AP linkage + G-55's sub-side hold — and the progress
  // certificate's approve — BR-093's ceiling + G-57 + the generated
  // invoice + the advance amortization) bind certificates.approve; the
  // lifecycle moves (activate/close/cancel) + the voids bind
  // contracting.manage; the register's authoring/schedule + G-56's
  // release bind retention.manage. The entitlement plane rides the
  // projects.contracting feature flag on every route (D-16).
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/subcontracts",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/subcontracts",
    permission: "projects.contracting.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/subcontracts/:id",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/subcontracts/:id/activate",
    permission: "projects.contracting.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/subcontracts/:id/close",
    permission: "projects.contracting.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/subcontracts/:id/cancel",
    permission: "projects.contracting.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/subcontracts/:id/certificates",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/subcontracts/:id/certificates",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/sub-certificates/:id/approve",
    permission: "projects.certificates.approve",
  },
  {
    method: "POST",
    path: "/api/v1/projects/sub-certificates/:id/void",
    permission: "projects.contracting.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/retention",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/retention/register",
    permission: "projects.retention.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/retention/:id/schedule",
    permission: "projects.retention.manage",
  },
  {
    method: "POST",
    path: "/api/v1/projects/retention/:id/release",
    permission: "projects.retention.manage",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/billing",
    permission: "projects.contracting.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/certificates",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/certificates",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/certificates/:id/submit",
    permission: "projects.contracting.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/certificates/:id/approve",
    permission: "projects.certificates.approve",
  },
  {
    method: "POST",
    path: "/api/v1/projects/certificates/:id/void",
    permission: "projects.contracting.manage",
  },

  // PHASE-048 (W-12 — T-14, dated 2026-11-20; matrix §3.26): the WBS
  // board's project pool — GET /api/v1/projects rides the WBS plane's
  // OWN view key (the board renders for WBS-only sessions; the
  // accounting module's project list keeps its own key) — the W-12
  // step-2 addition to the keys' fourth binding wave (1050 + 1 = 1051).
  {
    method: "GET",
    path: "/api/v1/projects",
    permission: "projects.wbs.view",
  },

  // PHASE-048 (W-13 — T-15, dated 2026-11-21; matrix §3.26): the
  // contracting screen's project pool — the SAME one-store read the WBS
  // board's pool rides, bound on the CONTRACTING plane's own viewer key
  // (the W-12 step-2 precedent, mirrored: the /projects/contracting screen
  // renders for contracting-only sessions; the accounting module's project
  // list keeps its own key) — the W-8 keys' fifth binding wave
  // (1051 + 1 = 1052). The entitlement plane rides the
  // projects.contracting feature flag (D-16).
  {
    method: "GET",
    path: "/api/v1/projects/contracting/pool",
    permission: "projects.contracting.view",
  },

  // PHASE-048 (W-12 — T-13, dated 2026-11-20; matrix §3.26): the field
  // service — the W-8 keys' fourth binding wave (1038 + 12 = 1050). The
  // dispatch board on the EXISTING service_orders (never a new order
  // surface — D-12): the board listing + the visit reads + THE SINGLE
  // CLOCK's SLA evaluation (both pause-aware clocks + BR-096's deduped
  // escalation) bind fieldservice.view; the status machine's transitions
  // (schedule → dispatch → respond → start → pause/resume → complete
  // with the parts-used record through the service-order line issue path
  // → close) + the visit's authoring bind fieldservice.dispatch — the
  // matrix's own wording: "the status machine's transitions + the SLA
  // pause states feed BR-096's breach escalation — the single clock
  // service's write surface". The entitlement plane rides the
  // projects.fieldservice feature flag on every route (D-16).
  {
    method: "GET",
    path: "/api/v1/projects/fieldservice/visits",
    permission: "projects.fieldservice.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/fieldservice/visits/:id",
    permission: "projects.fieldservice.view",
  },
  {
    method: "GET",
    path: "/api/v1/projects/fieldservice/visits/:id/sla",
    permission: "projects.fieldservice.view",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/schedule",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/dispatch",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/respond",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/start",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/pause",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/resume",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/complete",
    permission: "projects.fieldservice.dispatch",
  },
  {
    method: "POST",
    path: "/api/v1/projects/fieldservice/visits/:id/close",
    permission: "projects.fieldservice.dispatch",
  },

  // PHASE-049 (W-17 — T-05/T-06/T-07, dated 2026-11-21; matrix §3.27):
  // the CMMS plane's first two route families — the maintenance
  // work-order engine (the status machine, the cost collectors, the step
  // results, and THE G-59 COMPLETION ACT on the manage key — the SoD
  // surface over the posting) and the preventive plans (BR-097's
  // single-open window + the checklist carry-over on the plan key).
  // The 0108-seeded keys' FIRST binding wave (1,052 + 25 = 1,077 — the
  // keys-seed-first discipline: the keys landed at W-16, the routes bind
  // as the service waves ship). The meters/spares/transfers/tags/expiry
  // families land with W-18/W-19; the web planes (W-20/W-21) on the same
  // keys. The entitlement plane rides the assets.maintenance feature
  // flag (D-16).
  {
    method: "GET",
    path: "/api/v1/assets/maintenance/orders",
    permission: "assets.maintenance.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders",
    permission: "assets.maintenance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/maintenance/orders/:id",
    permission: "assets.maintenance.view",
  },
  {
    method: "GET",
    path: "/api/v1/assets/maintenance/orders/:id/lines",
    permission: "assets.maintenance.view",
  },
  {
    method: "GET",
    path: "/api/v1/assets/maintenance/orders/:id/steps",
    permission: "assets.maintenance.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/plan",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/start",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/hold",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/resume",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/complete",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/lines",
    permission: "assets.maintenance.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/assets/maintenance/orders/:id/lines/:lineId",
    permission: "assets.maintenance.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/assets/maintenance/orders/:id/lines/:lineId",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/maintenance/orders/:id/steps/:stepId/result",
    permission: "assets.maintenance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/plans",
    permission: "assets.maintenance.plan",
  },
  {
    method: "POST",
    path: "/api/v1/assets/plans",
    permission: "assets.maintenance.plan",
  },
  {
    method: "GET",
    path: "/api/v1/assets/plans/:id",
    permission: "assets.maintenance.plan",
  },
  {
    method: "PATCH",
    path: "/api/v1/assets/plans/:id",
    permission: "assets.maintenance.plan",
  },
  {
    method: "GET",
    path: "/api/v1/assets/plans/:id/tasks",
    permission: "assets.maintenance.plan",
  },
  {
    method: "POST",
    path: "/api/v1/assets/plans/:id/tasks",
    permission: "assets.maintenance.plan",
  },
  {
    method: "PATCH",
    path: "/api/v1/assets/plans/:id/tasks/:taskId",
    permission: "assets.maintenance.plan",
  },
  {
    method: "DELETE",
    path: "/api/v1/assets/plans/:id/tasks/:taskId",
    permission: "assets.maintenance.plan",
  },
  {
    method: "POST",
    path: "/api/v1/assets/plans/:id/evaluate",
    permission: "assets.maintenance.plan",
  },
  {
    method: "POST",
    path: "/api/v1/assets/plans/:id/generate",
    permission: "assets.maintenance.plan",
  },
  {
    method: "POST",
    path: "/api/v1/assets/plans/evaluate",
    permission: "assets.maintenance.plan",
  },
  // PHASE-049 (W-18 — T-08/T-09/T-10, the meters + spares + transfers
  // wave): the 0108-seeded keys' SECOND binding wave (1,077 + 16 = 1,093
  // — the dated delta in matrix §3.27). The SoD split on the transfers
  // family: the reads on assets.transfer.view; the authoring + the
  // submission on assets.maintenance.manage (the CREATOR's key — the
  // maintenance plane's operational write); the VERDICTS (the G-61 gate:
  // approve + reject) on assets.transfer.approve (the APPROVER's key —
  // creator ≠ approver at the key plane and at the service's SoD
  // backstop). The meters family: the reads on assets.meters.view, the
  // readings (the event surface — a reading evaluates the METER plans in
  // its own transaction) on assets.meters.record, and the meter
  // AUTHORING (the register + R-10's odometer designation) on
  // assets.maintenance.manage — the declared interpretation (the meters
  // keys are view/record only; the designation is a maintenance-
  // management act), recorded in the W-18 dated note. The spares family
  // rides its single assets.spares.manage key (the matrix's own set).
  // The tags/expiry families bind with W-19/W-20; the web planes
  // (W-20/W-21) on the same keys.
  {
    method: "GET",
    path: "/api/v1/assets/meters",
    permission: "assets.meters.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/meters",
    permission: "assets.maintenance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/meters/:id",
    permission: "assets.meters.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/assets/meters/:id",
    permission: "assets.maintenance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/meters/:id/readings",
    permission: "assets.meters.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/meters/:id/readings",
    permission: "assets.meters.record",
  },
  {
    method: "GET",
    path: "/api/v1/assets/spares",
    permission: "assets.spares.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/spares",
    permission: "assets.spares.manage",
  },
  {
    method: "PATCH",
    path: "/api/v1/assets/spares/:id",
    permission: "assets.spares.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/assets/spares/:id",
    permission: "assets.spares.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/transfers",
    permission: "assets.transfer.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/transfers",
    permission: "assets.maintenance.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/transfers/:id",
    permission: "assets.transfer.view",
  },
  {
    method: "POST",
    path: "/api/v1/assets/transfers/:id/submit",
    permission: "assets.maintenance.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/transfers/:id/approve",
    permission: "assets.transfer.approve",
  },
  {
    method: "POST",
    path: "/api/v1/assets/transfers/:id/reject",
    permission: "assets.transfer.approve",
  },
  // PHASE-049 (W-19 — T-11/T-12, the tags + sweep + fleet-light wave):
  // the 0108-seeded keys' THIRD binding wave + the 0111 key's first
  // (1,093 + 9 = 1,102 — the dated delta in matrix §3.27's W-19 note).
  // The tags family rides its single assets.tags.manage key (the batch
  // create with the signed-code generation, the list, THE PRINT SHEET
  // payload, THE PRINTED STAMP — the single-consumption CAS seal — and
  // the register-hygiene delete). THE SCAN ROUTE rides
  // assets.maintenance.view — the DECLARED INTERPRETATION: the scan
  // resolves INTO the maintenance plane's asset card (the technician's
  // surface); the register's own reads stay on fixed_assets.assets.view.
  // THE FLEET-LIGHT REGISTER (R-10) rides assets.expiry.view (the
  // renewal-register read plane). The sweep config family rides the NEW
  // 0111-seeded assets.expiry.manage key (the sweep threshold settings
  // surface — the first 049 settings keys). The web planes (W-20/W-21)
  // bind on the same keys.
  {
    method: "POST",
    path: "/api/v1/assets/tags",
    permission: "assets.tags.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/tags",
    permission: "assets.tags.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/tags/print-sheet",
    permission: "assets.tags.manage",
  },
  {
    method: "POST",
    path: "/api/v1/assets/tags/:id/print",
    permission: "assets.tags.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/assets/tags/:id",
    permission: "assets.tags.manage",
  },
  {
    method: "GET",
    path: "/api/v1/assets/scan/:code",
    permission: "assets.maintenance.view",
  },
  {
    method: "GET",
    path: "/api/v1/assets/fleet-light",
    permission: "assets.expiry.view",
  },
  {
    method: "GET",
    path: "/api/v1/assets/expiry-sweep",
    permission: "assets.expiry.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/assets/expiry-sweep",
    permission: "assets.expiry.manage",
  },
  // PHASE-050 (W-25 — T-05 + T-06, dated 2026-11-23; matrix §3.28): the
  // 0116-seeded keys' FIRST binding wave (1,102 + 11 = 1,113 — the
  // keys-seed-first discipline: the TEN keys landed at W-24, the routes
  // bind as the service waves ship, every change dated at the block —
  // the 1,102 baseline anchor). The specifications plane binds
  // quality.view / quality.manage (the master-data register — the
  // 0113 grants carry DELETE by design); the NCR plane binds
  // quality.ncr.manage over the lifecycle acts (BR-102's gate + the
  // G-62 write-off door — the disposition and the close); the
  // inspection-result mapping contract's read rides quality.view. The
  // CAPA/calibration (W-26), SPC (quality.spc.view, W-27) and
  // complaints/holds/recall (W-28) families bind on their own waves.
  {
    method: "GET",
    path: "/api/v1/quality/specifications",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/specifications",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/specifications/:id",
    permission: "quality.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/quality/specifications/:id",
    permission: "quality.manage",
  },
  {
    method: "DELETE",
    path: "/api/v1/quality/specifications/:id",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/inspections/:inspectionId/map",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/ncr",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/ncr",
    permission: "quality.ncr.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/ncr/:id",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/ncr/:id/disposition",
    permission: "quality.ncr.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/ncr/:id/close",
    permission: "quality.ncr.manage",
  },
  // PHASE-050 (W-26 — T-07 + T-08, dated 2026-11-23; matrix §3.28): the
  // keys-seed-first SECOND binding wave (1,113 + 12 = 1,125 — the
  // discipline standing: the TEN keys landed at W-24, the routes bind
  // as the service waves ship, every change dated at the block — the
  // 1,102 baseline anchor). The CAPA plane binds quality.capa.manage
  // over the lifecycle acts (the root-cause start act · the actions
  // array · BR-103's close door · the G-63 external-cost door) with
  // quality.view over the reads; the calibration plane binds
  // quality.calibration.manage (the register's create + the due-date
  // sweep's configuration — the 0116 key's own description) with
  // quality.view over the reads; the sweep-config read is the manage
  // plane (the cmms expiry-sweep precedent — the effective ladder + the
  // last run's seal is operational config, never a finance read). The
  // SPC (quality.spc.view, W-27) and complaints/holds/recall (W-28)
  // families bind on their own waves.
  {
    method: "GET",
    path: "/api/v1/quality/capa",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/capa",
    permission: "quality.capa.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/capa/:id",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/capa/:id/root-cause",
    permission: "quality.capa.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/capa/:id/actions",
    permission: "quality.capa.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/capa/:id/external-cost",
    permission: "quality.capa.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/capa/:id/close",
    permission: "quality.capa.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/calibration",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/calibration",
    permission: "quality.calibration.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/calibration/sweep-config",
    permission: "quality.calibration.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/quality/calibration/sweep-config",
    permission: "quality.calibration.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/calibration/:id",
    permission: "quality.view",
  },
  // PHASE-050 (W-27 — T-09 + T-10 + T-11, dated 2026-11-23; matrix §3.28):
  // the keys-seed-first THIRD binding wave (1,125 + 9 = 1,134 — the
  // discipline standing: the TEN keys landed at W-24, the routes bind as
  // the service waves ship, every change dated at the block — the 1,102
  // baseline anchor). The SPC plane binds quality.spc.view over the
  // chart + measurement reads (the `quality.spc` feature key at the
  // controller) with the INGESTION on quality.manage (the master-data
  // manage key — the 0113 S/I/U evidence discipline; the surface rides
  // quality.spc, D-12); the supplier-score plane binds quality.view over
  // the reads + the 038 feed contract's own door and quality.manage over
  // the rolling recompute (rebuildable derived data — the 0115 grants'
  // own shape); the COA plane binds quality.coa.generate over BR-104's
  // generation door (the 0116 key's own description) with quality.view
  // over the reads. The complaints/holds/recall (W-28) families bind on
  // their own wave.
  {
    method: "GET",
    path: "/api/v1/quality/spc/measurements",
    permission: "quality.spc.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/spc/measurements",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/spc/charts/:specId",
    permission: "quality.spc.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/supplier-scores",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/supplier-scores/:partnerId/feed",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/supplier-scores/:partnerId/recompute",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/coa",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/coa",
    permission: "quality.coa.generate",
  },
  {
    method: "GET",
    path: "/api/v1/quality/coa/:id",
    permission: "quality.view",
  },
  // PHASE-050 (W-28 — T-12 + T-13 + T-14, dated 2026-11-23; matrix §3.28):
  // the keys-seed-first FOURTH binding wave (1,134 + 18 = 1,152 — the
  // discipline standing: the TEN keys landed at W-24, the routes bind as
  // the service waves ship, every change dated at the block — the 1,102
  // baseline anchor). The complaints plane binds quality.complaints.manage
  // over the lifecycle acts (the intake + the triage/link/progress/resolve/
  // close — the 0116 key's own description) with quality.view over the
  // reads; the holds plane binds quality.hold.manage over the register's
  // create/release acts with quality.view over the reads (the BLOCKING side
  // of INV-035 is NOT a route — it is the shared gate wired into the
  // movement core, server-side on every issue/ship path); the recall plane
  // binds quality.recall.manage over the drill + the initiate/execute/close
  // acts with quality.view over the register reads.
  {
    method: "POST",
    path: "/api/v1/quality/complaints",
    permission: "quality.complaints.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/complaints",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/complaints/:id",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/complaints/:id/triage",
    permission: "quality.complaints.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/complaints/:id/link-ncr",
    permission: "quality.complaints.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/complaints/:id/progress",
    permission: "quality.complaints.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/complaints/:id/resolve",
    permission: "quality.complaints.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/complaints/:id/close",
    permission: "quality.complaints.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/holds",
    permission: "quality.hold.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/holds",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/holds/batch/:batchId",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/holds/:id/release",
    permission: "quality.hold.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/recall",
    permission: "quality.recall.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/recall",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/recall/drill/:batchId",
    permission: "quality.recall.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/recall/:id",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/recall/:id/execute",
    permission: "quality.recall.manage",
  },
  {
    method: "POST",
    path: "/api/v1/quality/recall/:id/close",
    permission: "quality.recall.manage",
  },
  // PHASE-050 (W-30 — T-16, dated 2026-11-23; matrix §3.28): the
  // keys-seed-first FIFTH binding wave (1,152 + 7 = 1,159 — the
  // discipline standing: the TEN keys landed at W-24, the routes bind as
  // the service waves ship, every change dated at the block — the 1,102
  // baseline anchor). The management review plane binds quality.manage
  // over the create (the meeting record with the FROZEN indicator pack —
  // the register is evidence, NO lifecycle acts exist by design) with
  // quality.view over the reads; the hazard register plane binds
  // quality.manage over the create + the patch (the HACCP master data —
  // the tenant owns the critical-limits structure, the
  // food-manufacturing template composes the surface) with quality.view
  // over the reads.
  {
    method: "POST",
    path: "/api/v1/quality/reviews",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/reviews",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/reviews/:id",
    permission: "quality.view",
  },
  {
    method: "POST",
    path: "/api/v1/quality/hazards",
    permission: "quality.manage",
  },
  {
    method: "GET",
    path: "/api/v1/quality/hazards",
    permission: "quality.view",
  },
  {
    method: "GET",
    path: "/api/v1/quality/hazards/:id",
    permission: "quality.view",
  },
  {
    method: "PATCH",
    path: "/api/v1/quality/hazards/:id",
    permission: "quality.manage",
  },
  // PHASE-051 (W-34 — T-05 + T-06, dated 2026-11-25; matrix §3.29): the
  // keys-seed-first FIRST trade binding wave (1,159 + 11 = 1,170 — the
  // discipline standing: the TEN trade.* keys landed at W-33 (0122 §5),
  // the routes bind as the service waves ship, every change dated at
  // the block — the 1,159 baseline anchor). The LC plane binds
  // trade.lc.view over the register reads (the list + the find with
  // the amendments and the documents checklist) and trade.lc.manage
  // over the lifecycle acts (the issue — G-64's margin deposit door ·
  // the typed amendments with the G-64 margin adjustments · the
  // checklist writes with the discrepancy notes · the fees — the
  // financial-charges discipline's door · the retire — G-64's
  // reversal door · the cancel) + the sweep-config surface (the cmms/
  // quality expiry-sweep precedent: the effective ladder + the last
  // run's seal is operational config, never a finance read). The
  // collections (W-35) · transport/tracking (W-36) · customs (W-37) ·
  // bonded/drawback (W-38) families bind on their own waves; the
  // routes are feature-gated at the controller on trade.lc — the LC
  // plane's own composable unit (D-04).
  {
    method: "GET",
    path: "/api/v1/trade/lc",
    permission: "trade.lc.view",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc",
    permission: "trade.lc.manage",
  },
  {
    method: "GET",
    path: "/api/v1/trade/lc/sweep-config",
    permission: "trade.lc.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/trade/lc/sweep-config",
    permission: "trade.lc.manage",
  },
  {
    method: "GET",
    path: "/api/v1/trade/lc/:id",
    permission: "trade.lc.view",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/issue",
    permission: "trade.lc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/amendments",
    permission: "trade.lc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/documents",
    permission: "trade.lc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/fees",
    permission: "trade.lc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/retire",
    permission: "trade.lc.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/lc/:id/cancel",
    permission: "trade.lc.manage",
  },
  // PHASE-051 (W-35 — T-07 + T-08, dated 2026-11-25; matrix §3.29): the
  // keys-seed-first SECOND trade binding wave (1,170 + 11 = 1,181 —
  // the discipline standing: the TEN trade.* keys landed at W-33 (0122
  // §5), the routes bind as the service waves ship, every change dated
  // at the block — the 1,159 baseline anchor). THE COLLECTIONS FAMILY
  // binds trade.collections.manage over the register acts (create ·
  // present · accept — the usance act, D/A only · settle — the
  // settlement linkage · cancel — the stamp law's OPEN-only exit) and
  // trade.view over the reads (the matrix row's OWN wording names the
  // LC/collections registers — the finance-read plane; no family view
  // key exists, and the W-34 LC precedent bound the family key it
  // HAD: the family view key is preferred when it exists, the plane
  // read key covers the families without one). THE INCOTERMS REGISTRY
  // binds trade.view over the reads (the plane's reference register —
  // the W-39 reference page and the selector's data source) and
  // trade.collections.manage over the tenant-addition MANAGEMENT (the
  // dated interpretation recorded here for the owner's review: the
  // registry is the trade plane's shared non-ledger reference data,
  // no registry-specific key exists among the ten, the drift is
  // zero-drift-locked at 357 — the W-35 wave's own register-act key
  // carries the management, the matrix's own non-ledger owner
  // posture; never a ledger key — the registry writes must not ride
  // G-64's or G-65's doors). The transport/tracking (W-36) · customs
  // (W-37) · bonded/drawback (W-38) families bind on their own waves;
  // the routes are feature-gated at the controller on the whole-
  // module unit trade (D-04 — the collections/incoterms families
  // carry no own flag).
  {
    method: "GET",
    path: "/api/v1/trade/collections",
    permission: "trade.view",
  },
  {
    method: "GET",
    path: "/api/v1/trade/collections/:id",
    permission: "trade.view",
  },
  {
    method: "POST",
    path: "/api/v1/trade/collections",
    permission: "trade.collections.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/collections/:id/present",
    permission: "trade.collections.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/collections/:id/accept",
    permission: "trade.collections.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/collections/:id/settle",
    permission: "trade.collections.manage",
  },
  {
    method: "POST",
    path: "/api/v1/trade/collections/:id/cancel",
    permission: "trade.collections.manage",
  },
  {
    method: "GET",
    path: "/api/v1/trade/incoterms",
    permission: "trade.view",
  },
  {
    method: "GET",
    path: "/api/v1/trade/incoterms/:code",
    permission: "trade.view",
  },
  {
    method: "POST",
    path: "/api/v1/trade/incoterms",
    permission: "trade.collections.manage",
  },
  {
    method: "PUT",
    path: "/api/v1/trade/incoterms/:code",
    permission: "trade.collections.manage",
  },
];

/**
 * Session-authenticated but permission-free routes (self plane):
 * introspection, logout, rotation, switch, MFA self-management, password
 * change. identity.mfa.manage is "every user (self)" (matrix §3.9) — the
 * evaluator grants it to every authenticated user on self-targeted routes.
 */
export const SESSION_ROUTES: readonly { method: string; path: string }[] = [
  { method: "GET", path: "/api/v1/identity/sessions/current" },
  // PHASE-004: BR-039 derived-only UI payload — every tenant member reads it.
  { method: "GET", path: "/api/v1/tenancy/entitlements" },
  // PHASE-015: BR-039 derived-only effective config (L6 overlay + L9
  // derivation per principal) + the template registry reads the onboarding
  // wizard renders before any permission-bearing apply.
  { method: "GET", path: "/api/v1/configuration/effective-config" },
  { method: "GET", path: "/api/v1/configuration/templates" },
  { method: "GET", path: "/api/v1/configuration/templates/activity-map" },
  { method: "GET", path: "/api/v1/configuration/templates/:key" },
  // PHASE-036 (BR-039 derived-only pattern): the custom-fields render
  // surface — ACTIVE definitions + inlined ACTIVE picklist options for the
  // six first-wave entity forms — and the code-owned entity registry
  // (ADR-0019). Every tenant member renders entity forms; RLS scopes the
  // rows; a starter tenant simply sees zero definitions.
  { method: "GET", path: "/api/v1/configuration/custom-fields/surface" },
  { method: "GET", path: "/api/v1/configuration/custom-fields/entities" },
  // PHASE-014: the notifications self plane (inbox + preferences; every
  // authenticated user manages their own — matrix carries no key).
  { method: "GET", path: "/api/v1/notifications" },
  { method: "GET", path: "/api/v1/notifications/unread-count" },
  { method: "PATCH", path: "/api/v1/notifications/:id/read" },
  { method: "GET", path: "/api/v1/notifications/preferences" },
  { method: "PUT", path: "/api/v1/notifications/preferences" },
  // PHASE-041 (TB-23): the communication preference-matrix self plane —
  // every authenticated user manages their own rows.
  { method: "GET", path: "/api/v1/communication/preferences/me" },
  { method: "POST", path: "/api/v1/communication/preferences/me" },
  { method: "DELETE", path: "/api/v1/identity/sessions/current" },
  { method: "POST", path: "/api/v1/identity/sessions/refresh" },
  { method: "POST", path: "/api/v1/identity/sessions/switch-tenant" },
  { method: "POST", path: "/api/v1/identity/mfa/totp/enroll" },
  { method: "POST", path: "/api/v1/identity/mfa/totp/verify" },
  { method: "DELETE", path: "/api/v1/identity/mfa/totp" },
  { method: "POST", path: "/api/v1/identity/mfa/recovery-codes" },
  { method: "POST", path: "/api/v1/identity/password-change" },
  // PHASE-020 (MASTER-PLAN §8 rows 8–12; SYNC_PROTOCOL §1): the sync data
  // plane — every authenticated principal (web session OR device access
  // token) manages its own device's sync state; the device binding + feed
  // group + revocation checks are enforced inside the sync services, not
  // by a permission key (the 016 controllers already gate on pos.sales.sell
  // sessions; the 020 device-token path resolves the same plane).
  { method: "GET", path: "/api/v1/sync/status" },
  { method: "GET", path: "/api/v1/sync/pull" },
  { method: "POST", path: "/api/v1/sync/push" },
  { method: "POST", path: "/api/v1/sync/pull/ack" },
  { method: "POST", path: "/api/v1/sync/push/ack" },
];

/**
 * Public (pre-auth) routes — login/refresh are ALSO exempt from the
 * Idempotency-Key requirement (IDEMPOTENCY §1.5: session-creating endpoints
 * legitimately create new state per execution).
 */
export const PUBLIC_ROUTES: readonly { method: string; path: string }[] = [
  { method: "POST", path: "/api/v1/identity/sessions" },
  { method: "POST", path: "/api/v1/identity/sessions/refresh" },
  { method: "POST", path: "/api/v1/identity/password-resets" },
  { method: "PUT", path: "/api/v1/identity/password-resets/:token" },
  { method: "GET", path: "/api/v1/identity/invitations/accept" },
  { method: "POST", path: "/api/v1/identity/invitations/accept" },
  // PHASE-024 T4: the MFA enrollment bootstrap — the login discipline
  // re-verified for the 15-minute enrollment-only session (session-creating
  // like login: Idempotency-exempt by the same §1.5 reading).
  { method: "POST", path: "/api/v1/identity/mfa/bootstrap" },
  // PHASE-004: public registration (rate-limited inside the service).
  { method: "GET", path: "/api/v1/platform/register/options" },
  { method: "POST", path: "/api/v1/platform/register" },
  // PHASE-014: the pricing page data (rate-limited; tenant-data-free) and
  // the provider webhook (signature-verified — the provider cannot hold a
  // session; the HMAC + timestamp window ARE the authentication).
  { method: "GET", path: "/api/v1/public/plans" },
  { method: "POST", path: "/api/v1/platform/billing/webhook" },
  // PHASE-020 (MASTER-PLAN §8 row 7): the device refresh-token exchange —
  // the bearer refresh token in the body IS the credential (the login
  // pattern: no session can exist before credentials rotate); rotation is
  // idempotent by token, so the Idempotency-Key exemption applies too.
  { method: "POST", path: "/api/v1/devices/:id/refresh" },
  // PHASE-021 DR-P21-01 (MASTER-PLAN §1 item 2): the enrollment bootstrap
  // exchange — the one-time enrollment secret register returned IS the
  // credential (the same login pattern; the sha256 proof in the body clears
  // devices.device_key_hash on success, so replay is impossible and the
  // Idempotency-Key exemption applies like refresh).
  { method: "POST", path: "/api/v1/devices/:id/enroll" },
  // PHASE-038 (P-05): the supplier-portal quote submission — the invitation
  // token IS the credential (the enrollment/refresh login pattern verbatim;
  // the SECURITY DEFINER projection resolves it pre-GUC, then the service
  // re-validates under RLS). Rate-limited + audited by the controller; the
  // full portal (060) shares this surface.
  { method: "POST", path: "/api/v1/portal/rfqs/:rfqId/quotes" },
  // PHASE-039 (L1-11): the collection-agency callback — the agency's
  // callback token IS the credential (the supplier-portal pattern verbatim;
  // erp.portal_resolve_agency_token resolves it pre-GUC, then the service
  // re-validates under RLS). Fixed-window rate-limited (10/min per token
  // hash) + audited by the controller.
  { method: "POST", path: "/api/v1/portal/collection-agencies/callback" },
];

/** Routes whose POSTs require an Idempotency-Key header (IDEMPOTENCY §1). */
export function isIdempotencyExempt(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => route.method === method && (route.path.endsWith(":token") || pathMatches(route.path, path)),
  );
}

/**
 * PHASE-024 (R-04): true when (method, path) is a PUBLIC_ROUTES row — the
 * anonymous surface the per-tenant burst limiter must skip (those requests
 * carry no tenant budget; the login/reset limiters own them). Reuses the
 * registry rows (incl. `:param` matching) instead of re-listing paths.
 */
export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((route) => route.method === method && pathMatches(route.path, path));
}

function pathMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

/** Route matching helper shared by guard + checklist test. */
export function routeMatches(rule: RoutePermissionRule, method: string, path: string): boolean {
  return rule.method === method && pathMatches(rule.path, path);
}
