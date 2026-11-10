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
  // PHASE-014: the notifications self plane (inbox + preferences; every
  // authenticated user manages their own — matrix carries no key).
  { method: "GET", path: "/api/v1/notifications" },
  { method: "GET", path: "/api/v1/notifications/unread-count" },
  { method: "PATCH", path: "/api/v1/notifications/:id/read" },
  { method: "GET", path: "/api/v1/notifications/preferences" },
  { method: "PUT", path: "/api/v1/notifications/preferences" },
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
