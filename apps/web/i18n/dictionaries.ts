/**
 * Typed AR/EN dictionaries (PHASE-003 identity/sessions/admin screens + the
 * PHASE-004 tenancy/platform screens, task P4-T12a). 100% key parity between
 * locales is enforced twice:
 *
 *   1. Statically — both literals are assigned to `Record<Locale, Dictionary>`
 *      so TypeScript rejects a missing or extra key on either side.
 *   2. At runtime — `assertDictionaryParity()` below executes at module load
 *      (every layout render imports this module), satisfying the "parity
 *      check script green" acceptance without a separate test runner.
 *
 * Arabic is the default locale (Arabic-first, docs/ui/RTL_DESIGN_RULES.md).
 */
export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

export interface Dictionary {
  appTitle: string;
  switchLabel: string;
  signOut: string;
  loading: string;
  phaseNote: string;

  navHome: string;
  navUsers: string;
  navSessions: string;
  navMfa: string;
  navRoles: string;
  navPassword: string;

  loginTitle: string;
  loginSubtitle: string;
  loginEmailLabel: string;
  loginPasswordLabel: string;
  loginMfaLabel: string;
  loginMfaHint: string;
  loginMfaShow: string;
  loginMfaHide: string;
  loginSubmit: string;
  loginForgotLink: string;
  loginNoAccount: string;
  loginErrorInvalidCredentials: string;
  loginErrorMfaRequired: string;
  loginErrorMfaBootstrapIneligible: string;
  loginErrorRateLimited: string;
  loginErrorAccountLocked: string;
  loginErrorGeneric: string;

  forgotTitle: string;
  forgotDescription: string;
  forgotEmailLabel: string;
  forgotSubmit: string;
  forgotSuccess: string;
  forgotBack: string;

  acceptTitle: string;
  acceptTenantLabel: string;
  acceptRoleLabel: string;
  acceptEmailLabel: string;
  acceptFullNameLabel: string;
  acceptPasswordLabel: string;
  acceptPasswordHint: string;
  acceptSubmit: string;
  acceptErrorExpired: string;
  acceptErrorRevoked: string;
  acceptErrorAccepted: string;
  acceptErrorNotFound: string;
  acceptErrorGeneric: string;

  homeWelcome: string;
  homeTenantLabel: string;
  homeSwitchTenant: string;
  homeRoleLabel: string;
  homePermissionsLabel: string;
  homeScreens: string;

  usersTitle: string;
  usersNoPermission: string;
  usersColEmail: string;
  usersColName: string;
  usersColRole: string;
  usersColStatus: string;
  usersColLastLogin: string;
  usersNever: string;
  usersEmpty: string;
  usersInviteTitle: string;
  usersInviteEmailLabel: string;
  usersInviteRoleLabel: string;
  usersInviteSubmit: string;
  usersInviteLinkTitle: string;
  usersInviteExpiresLabel: string;
  usersInvitationsTitle: string;
  usersColExpires: string;
  usersColActions: string;
  usersRevoke: string;
  usersNoRoles: string;
  usersEmptyInvitations: string;

  statusActive: string;
  statusPending: string;
  statusRevoked: string;
  statusExpired: string;
  statusAccepted: string;
  statusSuspended: string;

  sessionsTitle: string;
  sessionsHint: string;
  sessionsColUser: string;
  sessionsColCreated: string;
  sessionsColExpires: string;
  sessionsColLastSeen: string;
  sessionsColIp: string;
  sessionsRevoke: string;
  sessionsEmpty: string;

  mfaTitle: string;
  mfaDescription: string;
  mfaEnrollTitle: string;
  mfaEnrollButton: string;
  mfaSecretLabel: string;
  mfaOtpauthLabel: string;
  mfaEnrollHint: string;
  mfaVerifyTitle: string;
  mfaVerifyCodeLabel: string;
  mfaVerifySubmit: string;
  mfaVerified: string;
  mfaRecoveryTitle: string;
  mfaRecoveryDescription: string;
  mfaRecoveryGenerate: string;
  mfaRecoveryRegenerate: string;
  mfaInvalidCode: string;
  mfaNeedConfirmed: string;
  mfaEnforcedNotice: string;

  rolesTitle: string;
  rolesDescription: string;
  rolesTenantTitle: string;
  rolesTemplatesTitle: string;
  rolesColKey: string;
  rolesColName: string;
  rolesColSystem: string;
  rolesColActions: string;
  rolesClone: string;
  rolesCloned: string;
  rolesYes: string;
  rolesNo: string;

  passwordTitle: string;
  passwordDescription: string;
  passwordCurrentLabel: string;
  passwordNextLabel: string;
  passwordNextHint: string;
  passwordSubmit: string;
  passwordSuccess: string;
  passwordErrorCurrent: string;

  errorsForbidden: string;
  errorsUnauthorized: string;
  errorsValidation: string;
  errorsNotFound: string;
  errorsNetwork: string;
  errorsGeneric: string;
  errorsRateLimited: string;

  // -- P4-T12a (PHASE-004): navigation ---------------------------------------
  navOnboarding: string;
  navBranches: string;
  navSettings: string;
  navSupport: string;
  navPlatformSection: string;
  navPlatformConsole: string;
  navPlatformAudit: string;

  // -- P4-T12a: shared labels -------------------------------------------------
  statusInactive: string;
  statusClosed: string;
  statusIssued: string;
  statusRejected: string;
  statusConverted: string;
  statusTerminated: string;
  taxStatusLabel: string;
  taxStatusRegistered: string;
  taxStatusNotRegistered: string;
  taxStatusDeregistered: string;
  taxNumberLabel: string;
  fiscalStartMonthLabel: string;
  numberingAssignAtLabel: string;
  numberingAssignAtPosting: string;
  numberingAssignAtApproval: string;
  localeArabic: string;
  localeEnglish: string;

  // -- P4-T12a: register (public) ----------------------------------------------
  registerTitle: string;
  registerSubtitle: string;
  registerBusinessNameLabel: string;
  registerBusinessNameArLabel: string;
  registerCountryLabel: string;
  registerCurrencyLabel: string;
  registerTemplateLabel: string;
  registerTaxNumberHint: string;
  registerOwnerSection: string;
  registerOwnerEmailLabel: string;
  registerOwnerNameLabel: string;
  registerSubmit: string;
  registerSuccessTitle: string;
  registerSuccessBody: string;
  registerGoLogin: string;
  registerLoginPrompt: string;
  registerErrorEmailTaken: string;
  registerErrorOptions: string;

  // -- P4-T12a: onboarding ------------------------------------------------------
  onboardingTitle: string;
  onboardingSubtitle: string;
  onboardingProvisionButton: string;
  onboardingResultTitle: string;
  onboardingRolesLabel: string;
  onboardingAccountsLabel: string;
  onboardingPurposesLabel: string;
  onboardingSettingsLabel: string;
  onboardingCreatedCount: string;
  onboardingZeroDuplicatesHint: string;
  onboardingGoHome: string;
  onboardingGoBranches: string;

  // -- P4-T12a: branches --------------------------------------------------------
  branchesTitle: string;
  branchesEmpty: string;
  branchesColCode: string;
  branchesColName: string;
  branchesColNameAr: string;
  branchesCreateTitle: string;
  branchesCodeLabel: string;
  branchesNameLabel: string;
  branchesNameArLabel: string;
  branchesCreateSubmit: string;
  branchesActivate: string;
  branchesDeactivate: string;
  branchesErrorCodeTaken: string;

  // -- P4-T12a: tenant settings --------------------------------------------------
  settingsTitle: string;
  settingsProfileTitle: string;
  settingsNameLabel: string;
  settingsNameArLabel: string;
  settingsTimezoneLabel: string;
  settingsProfileSubmit: string;
  settingsProfileSaved: string;
  settingsGeneralTitle: string;
  settingsDefaultLocaleLabel: string;
  settingsNumeralSystemLabel: string;
  settingsNumeralLatn: string;
  settingsNumeralArab: string;
  settingsHijriLabel: string;
  settingsHijriHint: string;
  settingsFiscalNumberingTitle: string;
  settingsSupportTitle: string;
  settingsSupportOptInLabel: string;
  settingsSupportOptInWarning: string;
  settingsTaxTitle: string;
  settingsTaxPairHint: string;
  settingsSave: string;
  settingsSaved: string;
  settingsErrorInvalidValue: string;

  // -- PHASE-024 T4: MFA policy settings card --------------------------------
  mfaPolicyTitle: string;
  mfaPolicyDescription: string;
  mfaPolicyModeLabel: string;
  mfaPolicyModePlan: string;
  mfaPolicyModeCustom: string;
  mfaPolicyModePlanHint: string;
  mfaPolicyModeCustomHint: string;
  mfaPolicyRolesLabel: string;
  mfaPolicyRolesHint: string;
  mfaPolicyRolesUnavailable: string;
  mfaPolicyNoRoles: string;
  mfaPolicyRoleMissing: string;
  mfaPolicySelectedCount: string;
  mfaPolicyRolesMaxError: string;

  // -- P4-T12a: support sessions (tenant plane) ----------------------------------
  supportSessionsTitle: string;
  supportSessionsHint: string;
  supportColReason: string;
  supportColTicket: string;
  supportColOpened: string;
  supportColClosed: string;
  supportColOptIn: string;
  supportEmpty: string;
  supportTerminate: string;
  supportErrorAccessDenied: string;
  supportErrorExpired: string;
  supportErrorNotActive: string;

  // -- P4-T12a: tenancy error strings --------------------------------------------
  tenancyErrorFeatureNotEntitled: string;
  tenancyErrorDependenciesMissing: string;

  // -- P4-T12a: platform console -------------------------------------------------
  platformConsoleTitle: string;
  platformNoAccess: string;
  platformTenantBadge: string;
  platformSearchLabel: string;
  platformSearchSubmit: string;
  platformColTenant: string;
  platformColCountry: string;
  platformColPlan: string;
  platformColCreated: string;
  platformEmpty: string;
  platformProfileTitle: string;
  platformPlanTitle: string;
  platformPlanCurrentLabel: string;
  platformPlanNone: string;
  platformPlanAssignTitle: string;
  platformPlanLabel: string;
  platformTrialDaysLabel: string;
  platformPlanSubmit: string;
  platformPlanAssigned: string;
  platformEntitlementsTitle: string;
  platformColFeatureKey: string;
  platformColSource: string;
  platformEntitlementsEmpty: string;
  platformGrantTitle: string;
  platformGrantFeatureLabel: string;
  platformGrantSourceLabel: string;
  platformGrantExpiresLabel: string;
  platformGrantExpiresHint: string;
  platformGrantReasonLabel: string;
  platformGrantSubmit: string;
  platformGrantDone: string;
  platformRevoke: string;
  platformRevokeReasonLabel: string;
  platformGrantExpiryRequired: string;
  platformGrantUnknownKey: string;
  platformMembershipsTitle: string;
  platformBranchesTitle: string;
  platformLifecycleTitle: string;
  platformReasonLabel: string;
  platformSuspendButton: string;
  platformRestoreButton: string;
  platformSuspendDone: string;
  platformRestoreDone: string;
  platformSupportTitle: string;
  platformSupportOpenTitle: string;
  platformSupportReasonLabel: string;
  platformSupportTicketLabel: string;
  platformSupportHoursLabel: string;
  platformSupportOpenSubmit: string;
  platformSupportClose: string;
  platformSupportCloseReasonLabel: string;
  platformSupportSessionLabel: string;
  platformReadDataTitle: string;
  platformReadResourceLabel: string;
  platformReadSubmit: string;
  platformNoActiveSession: string;
  resourceUsers: string;
  resourceMemberships: string;
  resourceRoles: string;
  resourceBranches: string;
  resourceSettings: string;
  resourceEntitlements: string;
  resourceSubscription: string;
  resourceAccounts: string;
  resourceAuditEvents: string;

  // -- P4-T12a: platform audit viewer ----------------------------------------------
  platformAuditTitle: string;
  platformAuditPlatformOnly: string;
  platformAuditTenantFilter: string;
  platformAuditActionFilter: string;
  platformAuditApply: string;
  platformAuditColAt: string;
  platformAuditColAction: string;
  platformAuditColActor: string;
  platformAuditViaPlatform: string;
  platformAuditNextPage: string;
  platformAuditEmpty: string;
  platformErrorInvalidTransition: string;
  platformErrorPlanNotFound: string;

  // -- PHASE-024 T8: tenant audit review console -------------------------------
  auditReviewTitle: string;
  auditReviewHint: string;
  auditFilterAction: string;
  auditFilterActorId: string;
  auditFilterEntityType: string;
  auditFilterEntityId: string;
  auditFilterCorrelationId: string;
  auditFilterFromAt: string;
  auditFilterToAt: string;
  auditFilterLimit: string;
  auditFilterApply: string;
  auditColAt: string;
  auditColAction: string;
  auditColEntityType: string;
  auditColEntityId: string;
  auditColActor: string;
  auditColCorrelation: string;
  auditEmpty: string;
  auditExportCsv: string;
  auditResultCount: string;
  auditOrderHint: string;

  // -- P5-T12 (PHASE-005): design-system shell + status/stepper labels --------
  shellSkipToContent: string;
  shellCommandSearch: string;
  shellShortcutsTitle: string;
  shellClose: string;
  shellMore: string;
  statusOffboarded: string;
  wizardStepOf: string;
  platformBackToConsole: string;
  rolesEmpty: string;
  retryLabel: string;

  // -- P6-T11a (PHASE-006 master data): shared labels --------------------------
  commonSave: string;
  commonCreate: string;
  commonCancel: string;
  commonOpen: string;
  commonClear: string;
  commonConfirm: string;
  commonUnsavedChanges: string;
  commonVersionConflict: string;
  statusDraft: string;
  statusArchived: string;
  kindLabel: string;
  kindFilterAll: string;
  colStatus: string;
  colName: string;
  listNextPage: string;
  listPrevPage: string;
  listSearchLabel: string;
  namePreviewLabel: string;

  // -- P6-T11a: navigation + breadcrumbs for the master-data groups ------------
  navPartners: string;
  navPartnersDirectory: string;
  navPartnersNew: string;
  navOpeningBalances: string;
  navInventory: string;
  navItems: string;
  navItemsNew: string;
  navPriceLists: string;
  navImport: string;
  // PHASE-035: the tracking surfaces' breadcrumb fallbacks (registry-driven
  // when navigation resolves; these cover nav-fetch failure).
  navBatches: string;
  navSerials: string;
  navAdjustments: string;

  // -- PHASE-007: accounting navigation + screens --------------------------------
  navAccountingCoa: string;
  navAccountingJournals: string;
  navAccountingGl: string;
  navAccountingPeriods: string;
  navAccountingApprovals: string;
  navAccountingRates: string;
  accountingTitle: string;
  accountingJournalsTitle: string;
  accountingJournalsNew: string;
  accountingJournalsEmpty: string;
  accountingColEntryNo: string;
  accountingColEntryDate: string;
  accountingColCurrency: string;
  accountingColTotal: string;
  accountingColStatus: string;
  accountingColCode: string;
  accountingColName: string;
  accountingColType: string;
  accountingColPostable: string;
  accountingColDebit: string;
  accountingColCredit: string;
  accountingColBalance: string;
  accountingSubmit: string;
  accountingApprove: string;
  accountingPost: string;
  accountingReverse: string;
  accountingCancel: string;
  accountingSaveDraft: string;
  accountingAddLine: string;
  accountingRemoveLine: string;
  accountingDuplicateLine: string;
  accountingPartnerRequired: string;
  accountingBalanced: string;
  accountingUnbalanced: string;
  accountingDifference: string;
  accountingLineTotal: string;
  accountingMemo: string;
  accountingCostCenter: string;
  accountingPartner: string;
  accountingTaxCode: string;
  accountingAccount: string;
  accountingDescription: string;
  accountingCoaTitle: string;
  accountingCoaEmpty: string;
  accountingPurposesTitle: string;
  accountingPurposesEmpty: string;
  accountingGlTitle: string;
  accountingGlEmpty: string;
  accountingGlDrill: string;
  accountingPeriodsTitle: string;
  accountingPeriodsEmpty: string;
  accountingYearsTitle: string;
  accountingCreateYear: string;
  accountingYearName: string;
  accountingYearStart: string;
  accountingYearEnd: string;
  accountingSoftClose: string;
  accountingLock: string;
  accountingReopen: string;
  accountingReopenReason: string;
  accountingReopenPrompt: string;
  accountingChecklist: string;
  accountingChecklistOk: string;
  accountingChecklistBroken: string;
  accountingChecklistNotRun: string;
  accountingChecklistNotApplicable: string;
  accountingApprovalsTitle: string;
  accountingApprovalsEmpty: string;
  accountingApprovalsSelfHint: string;
  accountingApprovalsSubmittedBy: string;
  accountingApprovalsTotalBase: string;
  accountingApprovalsPreview: string;
  accountingReject: string;
  accountingRatesTitle: string;
  accountingRatesEmpty: string;
  accountingRatesCurrency: string;
  accountingRatesDate: string;
  accountingRatesRate: string;
  accountingRatesSave: string;
  accountingPostedAt: string;
  accountingSource: string;
  accountingPreviewTitle: string;
  statusPendingApproval: string;
  statusApproved: string;
  statusPosted: string;
  statusReversed: string;
  statusCancelled: string;
  accountingStatusOpen: string;
  accountingStatusSoftClosed: string;
  accountingStatusLocked: string;
  accountingKindRegular: string;
  accountingKindOpening: string;
  accountingKindClosing: string;
  accountingSearchPlaceholder: string;
  accountingNewAccount: string;
  accountingAccountParent: string;
  accountingAccountCurrency: string;
  accountingIsGroup: string;
  accountingMapPurpose: string;
  accountingPurposeKey: string;
  accountingPurposeAccount: string;
  accountingActiveFrom: string;
  accountingLines: string;
  accountingColAmount: string;
  accountingColBase: string;
  accountingColDirection: string;
  accountingColPeriod: string;
  accountingReference: string;
  accountingExchangeRate: string;
  accountingRecurringTitle: string;
  accountingRecurringNew: string;
  accountingRecurringEmpty: string;
  accountingRecurringSchedule: string;
  accountingRecurringNextRun: string;
  accountingRecurringAmountPolicy: string;
  accountingRecurringFixed: string;
  accountingRecurringReenter: string;
  accountingRecurringPause: string;
  accountingRecurringActivate: string;
  accountingRecurringGenerateDue: string;
  accountingPoliciesTitle: string;
  accountingPoliciesEmpty: string;
  accountingPolicyMode: string;
  accountingPolicyThreshold: string;
  accountingRunAr: string;
  accountingRunAp: string;
  accountingReconStatusOk: string;
  accountingReconStatusBroken: string;
  accountingPostOpening: string;
  accountingPostOpeningConfirm: string;
  obPostReadyNote: string;
  accountingYearEndExecute: string;
  accountingYearEndReverse: string;
  accountingYearEndConfirm: string;
  accountingMovementsTitle: string;
  accountingRegisterTitle: string;
  accountingSelectAccount: string;
  accountingFromDate: string;
  accountingToDate: string;
  accountingReversalDate: string;
  accountingReversalReason: string;
  accountingSoftClosePrompt: string;
  accountingRateHint: string;
  accountingErrEntryNotBalanced: string;
  accountingErrPeriodLocked: string;
  accountingErrAccountNotPostable: string;
  accountingErrPurposeNotMapped: string;
  accountingErrMissingPartner: string;
  accountingErrMissingFxRate: string;
  accountingErrAlreadyPosted: string;
  accountingErrAlreadyReversed: string;
  accountingErrApprovalLimit: string;
  accountingErrSelfApproval: string;
  accountingErrImmutable: string;
  accountingErrState: string;
  accountTypeAsset: string;
  accountTypeLiability: string;
  accountTypeEquity: string;
  accountTypeRevenue: string;
  accountTypeExpense: string;
  accountingPostableYes: string;
  accountingPostableNo: string;
  accountingPurposesHint: string;

  // -- T14-UI: PHASE-008 treasury navigation + screens ---------------------------
  navTreasury: string;
  navTreasuryAccounts: string;
  navTreasuryReceipts: string;
  navTreasuryPayments: string;
  navTreasuryExpenses: string;
  navTreasuryTransfers: string;
  navTreasuryShifts: string;
  navTreasuryBankRec: string;
  treasuryAccountsTitle: string;
  treasuryAccountsEmpty: string;
  treasuryAccountOpenTitle: string;
  treasuryAccountName: string;
  treasuryAccountNameAr: string;
  treasuryAccountType: string;
  treasuryAccountTypeCash: string;
  treasuryAccountTypeBank: string;
  treasuryAccountTypePetty: string;
  treasuryAccountGlAccount: string;
  treasuryAccountCurrency: string;
  treasuryAccountBranch: string;
  treasuryColGlCode: string;
  treasuryAccountBalance: string;
  treasuryColMovements: string;
  treasuryAccountCreatedToast: string;
  treasuryAccountCloseBtn: string;
  treasuryAccountCloseReason: string;
  treasuryAccountClosedToast: string;
  treasuryAccountOpenedAt: string;
  treasuryAccountClosedAt: string;
  treasuryAccountMovementsTitle: string;
  treasuryAccountMovementsEmpty: string;
  treasuryColDirectionIn: string;
  treasuryColDirectionOut: string;
  treasuryColBaseAmount: string;
  treasuryColValueDate: string;
  treasuryColRate: string;
  treasuryColSource: string;
  treasuryColMemo: string;
  treasuryMethodCash: string;
  treasuryMethodBank: string;
  treasuryMethodCheque: string;
  treasuryMethodCard: string;
  treasuryMethodTransfer: string;
  treasuryReceiptsTitle: string;
  treasuryReceiptsEmpty: string;
  treasuryReceiptsNew: string;
  treasuryPaymentsTitle: string;
  treasuryPaymentsEmpty: string;
  treasuryPaymentsNew: string;
  treasuryColDocNo: string;
  treasuryColPartner: string;
  treasuryColMethod: string;
  treasuryColAmount: string;
  treasuryColAllocated: string;
  treasuryColFx: string;
  treasuryColPayer: string;
  treasuryColPayee: string;
  treasuryDocCashAccount: string;
  treasuryDocPartner: string;
  treasuryDocMethod: string;
  treasuryDocCurrency: string;
  treasuryDocAmount: string;
  treasuryDocRate: string;
  treasuryDocRateHint: string;
  treasuryDocValueDate: string;
  treasuryDocReference: string;
  treasuryDocDescription: string;
  treasuryDocDescriptionAr: string;
  treasuryDocCreatedToast: string;
  treasuryDocDetailTitle: string;
  treasuryDocPostedToast: string;
  treasuryDocReverseToast: string;
  treasuryDocReverseDate: string;
  treasuryDocReverseReason: string;
  treasuryDocCancelToast: string;
  treasuryDocOnAccount: string;
  treasuryDocJournalNo: string;
  treasuryDocSideHint: string;
  treasuryCancelReason: string;
  treasuryOpenItemsTitle: string;
  treasuryAllocationsTitle: string;
  treasuryAllocationsEmpty: string;
  treasuryAllocationsHint: string;
  treasuryAllocationSuggestBtn: string;
  treasuryAllocationSuggestToast: string;
  treasuryAllocationColOutstanding: string;
  treasuryAllocationTotals: string;
  treasuryAllocationTotalAllocated: string;
  treasuryAllocationRemainder: string;
  treasuryAllocationOnAccountHint: string;
  treasuryAllocationOverError: string;
  treasuryAllocationSaveBtn: string;
  treasuryAllocationSavedToast: string;
  treasuryAllocationReloadBtn: string;
  treasuryExpensesTitle: string;
  treasuryExpensesEmpty: string;
  treasuryExpenseClaimNew: string;
  treasuryExpenseCategoriesTitle: string;
  treasuryExpenseCategoriesEmpty: string;
  treasuryExpenseCategoryNew: string;
  treasuryExpenseCategoryCode: string;
  treasuryExpenseCategoryAccount: string;
  treasuryExpenseCategoryApproval: string;
  treasuryExpenseApprovalNone: string;
  treasuryExpenseApprovalSingle: string;
  treasuryExpenseCategoryCreatedToast: string;
  treasuryExpenseCreatedToast: string;
  treasuryExpenseReceiptNote: string;
  treasuryExpenseReceiptFileId: string;
  treasuryExpenseColNo: string;
  treasuryExpenseColPayee: string;
  treasuryExpenseColCategory: string;
  treasuryTransfersTitle: string;
  treasuryTransfersEmpty: string;
  treasuryTransferNew: string;
  treasuryTransferFrom: string;
  treasuryTransferTo: string;
  treasuryTransferCreatedToast: string;
  treasuryTransferPostedToast: string;
  treasuryTransferCancelledToast: string;
  treasuryTransferSameAccountError: string;
  treasuryColFrom: string;
  treasuryColTo: string;
  treasuryColNo: string;
  treasuryColFee: string;
  treasuryShiftsTitle: string;
  treasuryShiftsEmpty: string;
  treasuryShiftOpenTitle: string;
  treasuryShiftOpenBtn: string;
  treasuryShiftOpeningAmount: string;
  treasuryShiftCreatedToast: string;
  treasuryShiftStatusOpen: string;
  treasuryShiftStatusClosed: string;
  treasuryShiftStatusCancelled: string;
  treasuryShiftColShiftNo: string;
  treasuryShiftColOpenedAt: string;
  treasuryShiftColClosedAt: string;
  treasuryShiftColCapturedIn: string;
  treasuryShiftColCapturedOut: string;
  treasuryShiftExpected: string;
  treasuryShiftCounted: string;
  treasuryShiftDifference: string;
  treasuryShiftVarianceJournal: string;
  treasuryShiftSupervisor: string;
  treasuryShiftSupervisorPin: string;
  treasuryShiftSupervisorHint: string;
  treasuryShiftReason: string;
  treasuryShiftCloseToast: string;
  treasuryShiftCancelBtn: string;
  treasuryShiftCancelledToast: string;
  treasuryShiftPanelTitle: string;
  treasuryShiftCaptureTitle: string;
  treasuryShiftCaptureHint: string;
  treasuryShiftCaptureBtn: string;
  treasuryShiftCloseTitle: string;
  treasuryShiftCloseBtn: string;
  treasuryShiftBalanced: string;
  treasuryShiftVarianceNote: string;
  treasuryShiftClosedNote: string;
  treasuryBankRecTitle: string;
  treasuryBankRecEmpty: string;
  treasuryBankRecImportTitle: string;
  treasuryBankRecAdapter: string;
  treasuryBankRecFile: string;
  treasuryBankRecFileHint: string;
  treasuryBankRecPeriodStart: string;
  treasuryBankRecPeriodEnd: string;
  treasuryBankRecMappingHint: string;
  treasuryBankRecMappingDate: string;
  treasuryBankRecMappingAmount: string;
  treasuryBankRecMappingReference: string;
  treasuryBankRecMappingDescription: string;
  treasuryBankRecImportBtn: string;
  treasuryBankRecImportedToast: string;
  treasuryBankRecStatementsTitle: string;
  treasuryBankRecColFile: string;
  treasuryBankRecColPeriod: string;
  treasuryBankRecColLines: string;
  treasuryBankRecColImportedAt: string;
  treasuryBankRecStatusImported: string;
  treasuryBankRecStatusReconciled: string;
  treasuryBankRecOpeningBalance: string;
  treasuryBankRecClosingBalance: string;
  treasuryBankRecSelectStatement: string;
  treasuryBankRecLinesTitle: string;
  treasuryBankRecColLineNo: string;
  treasuryBankRecColMatchState: string;
  treasuryBankRecMatched: string;
  treasuryBankRecUnmatched: string;
  treasuryBankRecMatchAuto: string;
  treasuryBankRecMatchManual: string;
  treasuryBankRecAutoMatchBtn: string;
  treasuryBankRecAutoMatchToast: string;
  treasuryBankRecManualMatch: string;
  treasuryBankRecMatchMovement: string;
  treasuryBankRecUnmatchBtn: string;
  treasuryBankRecMatchedToast: string;
  treasuryBankRecReconcileBtn: string;
  treasuryBankRecReconcileHint: string;
  treasuryBankRecReconciledToast: string;
  treasuryBankRecAgingTitle: string;
  treasuryBankRecAgingAsOf: string;
  treasuryBankRecUnmatchedLinesTitle: string;
  treasuryBankRecUnmatchedMovementsTitle: string;
  treasuryBankRecColAgeDays: string;
  treasuryBankRecLoadAgingBtn: string;
  treasuryBankRecCashCheckTitle: string;
  treasuryBankRecCashCheckAsOf: string;
  treasuryBankRecCashCheckBtn: string;
  treasuryBankRecCashCheckOk: string;
  treasuryBankRecCashCheckBroken: string;
  treasuryBankRecColControlBalance: string;
  treasuryBankRecColSubledgerBalance: string;
  treasuryBankRecColDiffCount: string;
  treasuryBankRecFilterAccount: string;
  treasuryErrAccountExists: string;
  treasuryErrAccountClosed: string;
  treasuryErrAccountNotCloseable: string;
  treasuryErrCurrencyMismatch: string;
  treasuryErrTypeInvalid: string;
  treasuryErrInvalidAmount: string;
  treasuryErrDocState: string;
  treasuryErrMissingFxRate: string;
  treasuryErrAllocationExceedsDoc: string;
  treasuryErrAllocationExceedsItem: string;
  treasuryErrOpenItemCurrency: string;
  treasuryErrOpenItemPartner: string;
  treasuryErrOpenItemSide: string;
  treasuryErrPettyLimit: string;
  treasuryErrCategoryTaken: string;
  treasuryErrReceiptRequired: string;
  treasuryErrApprovalRequired: string;
  treasuryErrShiftAlreadyOpen: string;
  treasuryErrSupervisorRequired: string;
  treasuryErrSupervisorPin: string;
  treasuryErrShiftReason: string;
  treasuryErrStatementTooLarge: string;
  treasuryErrStatementFormat: string;
  treasuryErrStatementReconciled: string;
  treasuryErrPeriodLocked: string;
  treasuryErrMovementMatched: string;

  // -- P6-T11a: partner directory ------------------------------------------------
  partnersSearchPlaceholder: string;
  partnersKindLabel: string;
  kindCustomer: string;
  kindSupplier: string;
  kindBoth: string;
  partnersColCode: string;
  partnersColCreditLimit: string;
  partnersEmpty: string;
  partnersNewButton: string;
  partnerFormTitleCreate: string;
  partnerCodeLabel: string;
  partnerCodeHint: string;
  partnerNameLabel: string;
  partnerNameArLabel: string;
  partnerTaxNumberLabel: string;
  partnerCreditTermsLabel: string;
  partnerPriceListLabel: string;
  partnerStatusLabel: string;
  partnerCreatedToast: string;
  partnerSavedToast: string;
  partnerCodeTaken: string;
  partnerArchivedError: string;
  partnerKindChangeLabel: string;
  partnerKindChangedToast: string;
  partnerKindImmutable: string;
  partnerArchiveButton: string;
  partnerArchiveConfirmTitle: string;
  partnerArchiveConfirmBody: string;
  partnerArchivedToast: string;
  partnerTabOverview: string;
  partnerContactsTitle: string;
  partnerContactNameLabel: string;
  partnerContactPhoneLabel: string;
  partnerContactEmailLabel: string;
  partnerContactRoleLabel: string;
  partnerContactPrimaryLabel: string;
  partnerContactAdd: string;
  partnerContactsEmpty: string;
  partnerAddressesTitle: string;
  addressTypeLabel: string;
  addressTypeBilling: string;
  addressTypeShipping: string;
  addressTypeOther: string;
  partnerAddressLine1Label: string;
  partnerAddressLine2Label: string;
  partnerAddressCityLabel: string;
  partnerAddressCountryLabel: string;
  partnerAddressAdd: string;
  partnerAddressesEmpty: string;
  partnerBalanceTitle: string;
  partnerBalanceOpenAmount: string;
  partnerBalanceDraftLabel: string;
  partnerBalanceOverdueLabel: string;
  partnerBalanceDraftBadge: string;
  partnerBalanceDraftNote: string;

  // -- P6-T11a: item master --------------------------------------------------------
  itemsSearchPlaceholder: string;
  itemsFilterCategoryLabel: string;
  categoryLabel: string;
  itemsColSku: string;
  itemsColBasePrice: string;
  itemsEmpty: string;
  itemsNewButton: string;
  itemFormTitleCreate: string;
  itemFormTitleEdit: string;
  itemSkuLabel: string;
  itemNameLabel: string;
  itemNameArLabel: string;
  itemKindLabel: string;
  kindStock: string;
  kindService: string;
  kindComposite: string;
  itemUomLabel: string;
  itemCostingLabel: string;
  costingWac: string;
  costingFifo: string;
  itemTrackingLabel: string;
  itemTrackBatch: string;
  itemTrackSerial: string;
  itemTrackImei: string;
  itemHasExpiry: string;
  itemExpiryRequiresBatch: string;
  itemReorderLevelLabel: string;
  itemReorderQtyLabel: string;
  itemBasePriceLabel: string;
  itemCreatedToast: string;
  itemSavedToast: string;
  itemSkuTaken: string;
  itemArchivedError: string;
  itemArchiveButton: string;
  itemArchiveConfirmTitle: string;
  itemArchiveConfirmBody: string;
  itemArchivedToast: string;
  barcodesTitle: string;
  barcodeCodeLabel: string;
  barcodeAdd: string;
  barcodesEmpty: string;
  barcodeTaken: string;

  // -- P6-T11a: price lists ---------------------------------------------------------
  priceListCreateTitle: string;
  priceListsListTitle: string;
  priceListNameLabel: string;
  priceListNameArLabel: string;
  priceListKindLabel: string;
  priceListKindSale: string;
  priceListKindPurchase: string;
  priceListCurrencyLabel: string;
  priceListValidFromLabel: string;
  priceListValidToLabel: string;
  priceListCreateSubmit: string;
  priceListSelectHint: string;
  priceListRowsTitle: string;
  priceListRowItemLabel: string;
  priceListRowUomLabel: string;
  priceListRowPriceLabel: string;
  priceListRowMinQtyLabel: string;
  priceListRowAdd: string;
  priceListRowAddedToast: string;
  priceListRowsEmpty: string;
  priceListsEmpty: string;
  priceListColValidLabel: string;
  priceListCreatedToast: string;
  priceListCurrencySar: string;

  // -- P6-T11a: import & export wizard -----------------------------------------------
  importStep1Title: string;
  importDataKindLabel: string;
  importKindPartners: string;
  importKindItems: string;
  importKindOpeningBalances: string;
  importFormatLabel: string;
  importCarrierLabel: string;
  importCarrierHint: string;
  importFileLabel: string;
  importFileHint: string;
  importSubmitPreview: string;
  importStep2Title: string;
  importColTotal: string;
  importColValid: string;
  importColInvalid: string;
  importColDuplicates: string;
  importCommit: string;
  importCommitToast: string;
  importCommitFailed: string;
  importStep3Title: string;
  importCommittedRows: string;
  importColRow: string;
  importColPreview: string;
  importColErrors: string;
  importColWarnings: string;
  importRowValid: string;
  importRowError: string;
  importRowDuplicate: string;
  importRowWarning: string;
  importPreviewEmpty: string;
  importNewJob: string;
  importCarrierRequired: string;
  importFileRequired: string;
  importFileTooLarge: string;
  importFileTypeInvalid: string;
  importUploadFailed: string;
  importFormatCsv: string;
  importFormatXlsx: string;
  importJobsColCreated: string;
  importJobsTitle: string;
  importJobsEmpty: string;
  importJobColRows: string;
  importStatusPreviewing: string;
  importStatusPreviewReady: string;
  importStatusCommitting: string;
  importStatusCommitted: string;
  importStatusFailed: string;
  importErrorFileInvalid: string;
  // -- PHASE-040 (T-08): the /settings/imports toolkit hub -------------------
  toolkitTitle: string;
  toolkitSubtitle: string;
  toolkitTabWizard: string;
  toolkitTabJobs: string;
  toolkitTabMappings: string;
  toolkitTabAdapters: string;
  toolkitStepKindTitle: string;
  toolkitStepKindHint: string;
  toolkitStepFileTitle: string;
  toolkitFilePick: string;
  toolkitUploadAndAnalyze: string;
  toolkitAnalyzing: string;
  toolkitKindFormats: string;
  toolkitRequiredOption: string;
  toolkitBudgetPick: string;
  toolkitBudgetRequired: string;
  toolkitGridKindNote: string;
  toolkitPiiNote: string;
  toolkitStepMapTitle: string;
  toolkitStepMapHint: string;
  toolkitColCanonical: string;
  toolkitColHeader: string;
  toolkitColRequired: string;
  toolkitColOptional: string;
  toolkitColType: string;
  toolkitMapEmpty: string;
  toolkitAutoDetected: string;
  toolkitSampleTitle: string;
  toolkitUnmappedHeaders: string;
  toolkitSaveMappingName: string;
  toolkitSaveMappingBtn: string;
  toolkitMappingSaveToast: string;
  toolkitStepReviewTitle: string;
  toolkitRunDryRun: string;
  toolkitDryRunRunning: string;
  toolkitReportUnmapped: string;
  toolkitCommitAckLabel: string;
  toolkitCommitAckHint: string;
  toolkitCommitBtn: string;
  toolkitCommitting: string;
  toolkitCommitFailed: string;
  toolkitCommittedTitle: string;
  toolkitCommittedSummary: string;
  toolkitErrorExportBtn: string;
  toolkitStartNew: string;
  toolkitJobsTitle: string;
  toolkitJobsEmpty: string;
  toolkitJobsColFile: string;
  toolkitJobsRefresh: string;
  toolkitMappingsTitle: string;
  toolkitMappingsEmpty: string;
  toolkitMappingColName: string;
  toolkitMappingColKind: string;
  toolkitMappingColDirection: string;
  toolkitMappingColUpdated: string;
  toolkitMappingDirectionImport: string;
  toolkitMappingDirectionExport: string;
  toolkitMappingDeleteBtn: string;
  toolkitMappingDeletedToast: string;
  toolkitAdaptersTitle: string;
  toolkitAdaptersHint: string;
  toolkitAdapterColSource: string;
  toolkitAdapterColTarget: string;
  toolkitAdapterColFormat: string;
  toolkitAdapterTemplateBtn: string;
  toolkitAdapterEngineConsole: string;
  toolkitAdapterRequiresVerification: string;
  toolkitErrKindUnknown: string;
  toolkitErrFileInvalid: string;
  toolkitErrJobNotFound: string;
  toolkitErrCommitConflict: string;
  toolkitErrNotPreviewed: string;
  toolkitErrOptionsMissing: string;
  toolkitErrBudgetInvalid: string;
  toolkitErrMappingInvalid: string;
  toolkitErrDemoRefused: string;
  // -- PHASE-040 (T-06/T-09): the one-click demo-data surface ----------------
  demoDataTitle: string;
  demoDataHint: string;
  demoDataTemplateLabel: string;
  demoDataSeedBtn: string;
  demoDataSeeding: string;
  demoDataSeededBadge: string;
  demoDataSeededAt: string;
  demoDataDoneTitle: string;
  demoDataSummaryLine: string;
  demoDataRefused: string;
  onboardingImportDataCta: string;
  onboardingImportDataHint: string;
  onboardingDemoDataCta: string;
  exportTitle: string;
  exportHint: string;
  exportSubmit: string;
  exportDone: string;
  exportRows: string;
  exportDownloadLabel: string;
  exportExpiresNote: string;

  // -- P6-T11a: opening balances (DRAFT-only) -----------------------------------------
  obTabPartner: string;
  obTabAccount: string;
  obTabStock: string;
  obCreateTitle: string;
  obAmountLabel: string;
  obNoteLabel: string;
  obQtyLabel: string;
  obUnitCostLabel: string;
  obAccountLabel: string;
  obAccountHint: string;
  obCreateSubmit: string;
  obEmpty: string;
  obListTitle: string;
  obDraftOnlyNote: string;
  obCreatedToast: string;
  obColTarget: string;
  obColAmount: string;
  obColQty: string;
  obColNote: string;
  obQtyAtCostLabel: string;
  obTargetUnknown: string;
  obDuplicateError: string;

  // -- P6-T11a: attachments (partners + items) -----------------------------------------
  attachmentsTitle: string;
  attachmentIssueFormTitle: string;
  attachmentFilenameLabel: string;
  attachmentContentTypeLabel: string;
  attachmentSizeLabel: string;
  attachmentTypePdf: string;
  attachmentTypePng: string;
  attachmentTypeJpeg: string;
  attachmentTypeWebp: string;
  attachmentTypeCsv: string;
  attachmentIssueButton: string;
  attachmentIssuedTitle: string;
  attachmentIssuedHint: string;
  attachmentIssuedToast: string;
  attachmentUrlLabel: string;
  attachmentKeyLabel: string;
  attachmentExpiresLabel: string;
  attachmentsEmpty: string;
  attachmentDownloadLabel: string;
  attachmentIssueFailed: string;

  // -- P6-T11a: pickers + command-menu remote groups -------------------------------------
  partnerPickerPlaceholder: string;
  itemPickerPlaceholder: string;
  pickerEmptyText: string;
  commandGroupPartners: string;
  commandGroupItems: string;

  // -- T15-UI: PHASE-009 tax screens ------------------------------------------------------
  // tax codes manager (+ the deterministic resolve preview)
  taxCodesTitle: string;
  taxCodesEmpty: string;
  taxCodesCode: string;
  taxCodesName: string;
  taxCodesNameAr: string;
  taxCodesCountry: string;
  taxCodesTreatment: string;
  taxCodesUsage: string;
  taxCodesCreateTitle: string;
  taxCodesCreatedToast: string;
  taxCodesArchive: string;
  taxCodesArchiveConfirm: string;
  taxCodesArchiveBlocked: string;
  taxCodesArchivedToast: string;
  taxTreatmentStandardRated: string;
  taxTreatmentZeroRated: string;
  taxTreatmentExempt: string;
  taxTreatmentOutOfScope: string;
  taxTreatmentReverseCharge: string;
  taxTreatmentNotSubject: string;
  taxResolveTitle: string;
  taxResolveDate: string;
  taxResolveAmount: string;
  taxResolveCode: string;
  taxResolveAction: string;
  taxResolveTreatment: string;
  taxResolveRate: string;
  taxResolveBase: string;
  taxResolveTax: string;
  taxResolveGross: string;
  taxResolveNotSubject: string;
  taxResolveBoundaryWarning: string;
  // tax registrations (per-jurisdiction status, upserted)
  taxRegistrationsTitle: string;
  taxRegistrationsEmpty: string;
  taxRegistrationsStatus: string;
  taxRegistrationsNumber: string;
  taxRegistrationsEffectiveFrom: string;
  taxRegistrationsEffectiveTo: string;
  taxRegistrationsRegistered: string;
  taxRegistrationsNotRegistered: string;
  taxRegistrationsDeregistered: string;
  taxRegistrationsCreateTitle: string;
  taxRegistrationsSavedToast: string;
  // PHASE-023: e-invoicing status surface + funnel (settings/tax/einvoicing + platform/einvoicing-funnel)
  einvoicingTitle: string;
  einvoicingSubtitle: string;
  einvoicingRegistryTitle: string;
  einvoicingStatus: string;
  einvoicingDocument: string;
  einvoicingAdapter: string;
  einvoicingAttempts: string;
  einvoicingAuthorityRef: string;
  einvoicingLastError: string;
  einvoicingSubmittedAt: string;
  einvoicingEmpty: string;
  einvoicingAdaptersTitle: string;
  einvoicingAdaptersUnverifiedNote: string;
  einvoicingRegimeVerified: string;
  einvoicingRegimeUnverified: string;
  einvoicingCertsTitle: string;
  einvoicingCertLabel: string;
  einvoicingCertFingerprint: string;
  einvoicingCertValidUntil: string;
  einvoicingCertStatus: string;
  einvoicingCertSignCount: string;
  einvoicingCertsEmpty: string;
  einvoicingResubmit: string;
  einvoicingResubmitDone: string;
  einvoicingStatusPending: string;
  einvoicingStatusGenerated: string;
  einvoicingStatusSigned: string;
  einvoicingStatusSubmitted: string;
  einvoicingStatusAccepted: string;
  einvoicingStatusRejected: string;
  einvoicingStatusReported: string;
  einvoicingStatusFailed: string;
  einvoicingFunnelTitle: string;
  einvoicingFunnelSubtitle: string;
  einvoicingFunnelByState: string;
  einvoicingFunnelLatency: string;
  einvoicingFunnelRejectionReasons: string;
  einvoicingFunnelDeadLetter: string;
  einvoicingFunnelRejectRate: string;
  einvoicingFunnelNoData: string;
  // -- WEB-037 (PHASE-037): ZATCA Phase-1 device registry ----------------------
  // the /settings/tax/zatca-devices manager (devices + chain verification +
  // backfill) over the tax/zatca/devices routes (tax.einvoicing.devices.manage)
  zatcaNavLabel: string;
  zatcaDevicesTitle: string;
  zatcaDevicesSubtitle: string;
  zatcaDevicesDevicesTab: string;
  zatcaDevicesChainTab: string;
  zatcaDevicesBackfillTab: string;
  zatcaDevicesPhase2Note: string;
  zatcaDevicesDeviceName: string;
  zatcaDevicesDeviceNameAr: string;
  zatcaDevicesDeviceUuid: string;
  zatcaDevicesDeviceUuidHint: string;
  zatcaDevicesDeviceSerial: string;
  zatcaDevicesProviderName: string;
  zatcaDevicesProviderVat: string;
  zatcaDevicesProviderVatHint: string;
  zatcaDevicesProviderVatInvalid: string;
  zatcaDevicesBranch: string;
  zatcaDevicesBranchAny: string;
  zatcaDevicesNote: string;
  zatcaDevicesOptional: string;
  zatcaDevicesNameRequired: string;
  zatcaDevicesCreateDevice: string;
  zatcaDevicesEditDevice: string;
  zatcaDevicesSaveDevice: string;
  zatcaDevicesCancelEdit: string;
  zatcaDevicesDeleteDisabled: string;
  zatcaDevicesEmpty: string;
  zatcaDevicesColName: string;
  zatcaDevicesColStatus: string;
  zatcaDevicesColCounter: string;
  zatcaDevicesColDeviceUuid: string;
  zatcaDevicesColSerial: string;
  zatcaDevicesColBranch: string;
  zatcaDevicesColCreatedAt: string;
  zatcaDevicesStatusPlaceholder: string;
  zatcaDevicesIcvCounter: string;
  zatcaDevicesChainHead: string;
  zatcaDevicesPickDevice: string;
  zatcaDevicesPickDeviceFirst: string;
  zatcaDevicesChainTitle: string;
  zatcaDevicesChainEmpty: string;
  zatcaDevicesChainColInvoice: string;
  zatcaDevicesChainColIcv: string;
  zatcaDevicesChainColPih: string;
  zatcaDevicesChainColHash: string;
  zatcaDevicesChainColHashVersion: string;
  zatcaDevicesChainColQr: string;
  zatcaDevicesChainColClassification: string;
  zatcaDevicesChainColPosted: string;
  zatcaDevicesChainColAmount: string;
  zatcaDevicesClassificationStandard: string;
  zatcaDevicesClassificationSimplified: string;
  zatcaDevicesClassificationNone: string;
  zatcaDevicesQrPresent: string;
  zatcaDevicesQrMissing: string;
  zatcaDevicesGenesisPih: string;
  zatcaDevicesHashTruncated: string;
  zatcaDevicesVerificationTitle: string;
  zatcaDevicesVerificationOk: string;
  zatcaDevicesVerificationChecked: string;
  zatcaDevicesVerificationFailed: string;
  zatcaDevicesVerificationFailureIcv: string;
  zatcaDevicesVerificationFailureReason: string;
  zatcaDevicesVerifyNow: string;
  zatcaDevicesVerifyDone: string;
  zatcaDevicesBackfillTitle: string;
  zatcaDevicesBackfillPlan: string;
  zatcaDevicesBackfillPlanNote: string;
  zatcaDevicesBackfillDryRunNote: string;
  zatcaDevicesBackfillLimit: string;
  zatcaDevicesBackfillCandidates: string;
  zatcaDevicesBackfillColInvoice: string;
  zatcaDevicesBackfillColPosted: string;
  zatcaDevicesBackfillColGross: string;
  zatcaDevicesBackfillStampable: string;
  zatcaDevicesBackfillRun: string;
  zatcaDevicesConfirmBackfill: string;
  zatcaDevicesBackfillStamped: string;
  zatcaDevicesBackfillSkipped: string;
  zatcaDevicesBackfillEmpty: string;
  zatcaDevicesBackfillResults: string;
  zatcaDevicesBackfillColIcv: string;
  zatcaDevicesIssuanceOrder: string;
  zatcaDevicesIdempotentNote: string;
  zatcaDevicesBackfillRequiresVat: string;
  zatcaDevicesCreateSuccess: string;
  zatcaDevicesUpdateSuccess: string;
  zatcaDevicesBackfillSuccess: string;
  zatcaDevicesErrorsGeneric: string;
  // jurisdiction packs (registry + version viewer + staged apply)
  taxPacksTitle: string;
  taxPacksEmpty: string;
  taxPacksCountry: string;
  taxPacksVatStatus: string;
  taxPacksVatInForce: string;
  taxPacksVatPlanned: string;
  taxPacksVatNoVat: string;
  taxPacksVersion: string;
  taxPacksVerification: string;
  taxPacksVerified: string;
  taxPacksRequiresVerification: string;
  taxPacksRate: string;
  taxPacksEffectiveFrom: string;
  taxPacksEffectiveTo: string;
  taxPacksSource: string;
  taxPacksWindowsTitle: string;
  taxPacksNoRates: string;
  taxPacksApply: string;
  taxPacksApplied: string;
  taxPacksBinding: string;
  taxPacksBindingNone: string;
  taxPacksPreviewNote: string;
  // VAT return workspace (summary + INV-012 cross-check + filing + export)
  vatReturnTitle: string;
  vatReturnEmpty: string;
  vatReturnCountry: string;
  vatReturnPeriod: string;
  vatReturnPeriodStart: string;
  vatReturnPeriodEnd: string;
  vatReturnStatus: string;
  vatReturnDraft: string;
  vatReturnReady: string;
  vatReturnFiled: string;
  vatReturnCreateTitle: string;
  vatReturnCreatedToast: string;
  vatReturnPrepare: string;
  vatReturnPreparedToast: string;
  vatReturnMarkFiled: string;
  vatReturnFiledToast: string;
  vatReturnFilingReference: string;
  vatReturnFilingNote: string;
  vatReturnExport: string;
  vatReturnExportCsv: string;
  vatReturnExportXlsx: string;
  vatReturnSummaryTitle: string;
  vatReturnDirection: string;
  vatReturnDirectionOutput: string;
  vatReturnDirectionInput: string;
  vatReturnTaxableBase: string;
  vatReturnTaxAmount: string;
  vatReturnCrossCheck: string;
  vatReturnDocumentSide: string;
  vatReturnGlSide: string;
  vatReturnOutputTax: string;
  vatReturnInputTax: string;
  vatReturnInputTaxExpensed: string;
  vatReturnMismatch: string;
  vatReturnReadyNote: string;
  // tax error mapping (stable ERROR_MODEL codes → localized messages)
  taxErrCodeTaken: string;
  taxErrCodeInUse: string;
  taxErrCodeArchived: string;
  taxErrRegistrationNumber: string;
  taxErrJurisdiction: string;
  taxErrNoRateForDate: string;
  taxErrWindowTaken: string;
  taxErrCrossCheck: string;
  taxErrState: string;
  taxErrAlreadyFiled: string;
  taxErrPackBinding: string;

  // -- T14-UI (PHASE-010): inventory & warehousing ---------------------------------
  // navigation
  navInventoryWarehouses: string;
  navInventoryStock: string;
  navInventoryMoves: string;
  navInventoryTransfers: string;
  navInventoryCounts: string;
  // warehouses (list + create + deactivate/reactivate)
  warehousesTitle: string;
  warehousesEmpty: string;
  warehousesCreateTitle: string;
  warehousesCodeLabel: string;
  warehousesNameLabel: string;
  warehousesNameArLabel: string;
  warehousesBranchLabel: string;
  warehousesGlAccountLabel: string;
  warehousesNoteLabel: string;
  warehousesCreatedToast: string;
  warehousesDeactivate: string;
  warehousesDeactivateTitle: string;
  warehousesDeactivateConfirm: string;
  warehousesDeactivatedToast: string;
  warehousesReactivate: string;
  warehousesReactivatedToast: string;
  warehousesColCode: string;
  warehousesColBranch: string;
  warehousesColGlAccount: string;
  // stock on hand
  stockTitle: string;
  stockEmpty: string;
  stockFilterWarehouse: string;
  stockColItem: string;
  stockColWarehouse: string;
  stockColQty: string;
  stockColAvgCost: string;
  stockNegativeBadge: string;
  // stock movements ledger
  movesTitle: string;
  movesEmpty: string;
  movesFilterDirection: string;
  movesFilterKind: string;
  movesColDate: string;
  movesColDirection: string;
  movesColKind: string;
  movesColUnitCost: string;
  movesColValue: string;
  movesColReason: string;
  movesColBatch: string;
  movesColSerial: string;
  movesColSource: string;
  movesDirectionIn: string;
  movesDirectionOut: string;
  movesKindReceipt: string;
  movesKindIssue: string;
  movesKindTransferIn: string;
  movesKindTransferOut: string;
  movesKindAdjust: string;
  movesReasonDamage: string;
  movesReasonExpired: string;
  movesReasonCountLoss: string;
  movesReasonCountGain: string;
  movesReasonCustomerReturn: string;
  movesReasonOther: string;
  // PHASE-035 (T-02): the batch & expiry registry
  batchesTitle: string;
  batchesEmpty: string;
  batchesSearchLabel: string;
  batchesFilterExpired: string;
  batchesExpiredOnly: string;
  batchesExpiredBadge: string;
  batchesColNo: string;
  batchesColExpiry: string;
  batchesColSource: string;
  batchesStatusActive: string;
  batchesStatusWrittenOff: string;
  batchesNewTitle: string;
  batchesItemLabel: string;
  batchesNoLabel: string;
  batchesExpiryLabel: string;
  batchesSourceLabel: string;
  batchesCreate: string;
  batchesCreatedToast: string;
  batchesWriteOff: string;
  batchesWriteOffTitle: string;
  batchesWriteOffHint: string;
  batchesWriteOffDate: string;
  batchesWriteOffConfirm: string;
  batchesWriteOffCancel: string;
  batchesWrittenOffToast: string;
  // PHASE-035 (T-03): the serial/IMEI registry
  serialsTitle: string;
  serialsEmpty: string;
  serialsSearchLabel: string;
  serialsFilterStatus: string;
  serialsColNo: string;
  serialsColImei: string;
  serialsColSoldAt: string;
  serialsColReturnedAt: string;
  serialsStatusInStock: string;
  serialsStatusSold: string;
  serialsStatusReturned: string;
  serialsSaleView: string;
  serialsNewTitle: string;
  serialsItemLabel: string;
  serialsNoLabel: string;
  serialsImeiLabel: string;
  serialsImeiHint: string;
  serialsCreate: string;
  serialsCreatedToast: string;
  serialsSaleTitle: string;
  serialsSaleClose: string;
  serialsSaleLoading: string;
  serialsSaleNone: string;
  serialsSaleUnitCost: string;
  serialsSaleMovedAt: string;
  serialsSaleWarehouse: string;
  // PHASE-035 (T-04): the stock-adjustments read register
  adjustmentsTitle: string;
  adjustmentsEmpty: string;
  adjustmentsSearchLabel: string;
  adjustmentsFilterStatus: string;
  adjustmentsColNo: string;
  adjustmentsColItem: string;
  adjustmentsColDelta: string;
  adjustmentsColPostingDate: string;
  adjustmentsColNote: string;
  adjustmentsStatusDraft: string;
  adjustmentsStatusPosted: string;
  adjustmentsStatusCancelled: string;
  adjustmentsReadNote: string;
  // warehouse-to-warehouse transfers
  transfersTitle: string;
  transfersEmpty: string;
  transfersColNo: string;
  transfersColFrom: string;
  transfersColTo: string;
  transfersColLines: string;
  transfersColDispatchDate: string;
  transfersColReceiveDate: string;
  transfersStatusInTransit: string;
  transfersNewTitle: string;
  transfersFromLabel: string;
  transfersToLabel: string;
  transfersNoteLabel: string;
  transfersLinesTitle: string;
  transfersLineItemLabel: string;
  transfersLineQtyLabel: string;
  transfersAddLine: string;
  transfersRemoveLine: string;
  transfersSameWarehouseError: string;
  transfersLineMissingError: string;
  transfersCreatedToast: string;
  transfersDispatch: string;
  transfersDispatchedToast: string;
  transfersReceive: string;
  transfersReceivedToast: string;
  transfersCancel: string;
  transfersCancelledToast: string;
  // stock counting workspace
  countingTitle: string;
  countingEmpty: string;
  countingNewTitle: string;
  countingWarehouseLabel: string;
  countingBlindLabel: string;
  countingPickItemsTitle: string;
  countingPickSearchPlaceholder: string;
  countingPickEmpty: string;
  countingSelectedCount: string;
  countingCreate: string;
  countingCreatedToast: string;
  countingColNo: string;
  countingColBlind: string;
  countingBlindYes: string;
  countingBlindNo: string;
  countingColVariance: string;
  countingOpenSession: string;
  countingCloseSession: string;
  countingSnapshotAt: string;
  countingSessionLinesTitle: string;
  countingColLineNo: string;
  countingColSystemQty: string;
  countingColCountedQty: string;
  countingColDiff: string;
  countingColValueImpact: string;
  countingSaveEntries: string;
  countingEntriesSavedToast: string;
  countingSubmit: string;
  countingSubmittedToast: string;
  countingReviewTitle: string;
  countingReviewHint: string;
  countingApprove: string;
  countingApproveSupervisor: string;
  countingApprovedToast: string;
  countingCancel: string;
  countingCancelledToast: string;
  countingRecountTitle: string;
  countingRecountLineLabel: string;
  countingRecountNoteLabel: string;
  countingRecountedToast: string;
  countingStatusCounted: string;
  countingStatusVarianceReview: string;
  // inventory error mapping (stable ERROR_MODEL codes → localized messages)
  inventoryErrWarehouseCodeTaken: string;
  inventoryErrWarehouseInactive: string;
  inventoryErrWarehouseNotDeactivatable: string;
  inventoryErrItemNotStocked: string;
  inventoryErrInsufficientStock: string;
  inventoryErrBatchInsufficient: string;
  inventoryErrBatchRequired: string;
  inventoryErrBatchTaken: string;
  inventoryErrSerialRequired: string;
  inventoryErrSerialNotInStock: string;
  inventoryErrSerialTaken: string;
  inventoryErrSerialReturnBinding: string;
  inventoryErrState: string;
  inventoryErrTransferEmpty: string;
  inventoryErrTransferSameWarehouse: string;
  inventoryErrCountTolerance: string;
  inventoryErrMethodSwitchInFlight: string;
  inventoryErrMethodSwitchInvalid: string;
  inventoryErrMethodSwitchSame: string;
  // PHASE-011 purchasing (T13-UI).
  purchasingEmpty: string;
  purchasingNoticeCreated: string;
  purchasingNoticeUpdated: string;
  purchasingNoticePosted: string;
  expensesColAccount: string;
  navPurchasingOrders: string;
  navPurchasingReceipts: string;
  navPurchasingInvoices: string;
  navPurchasingDebitNotes: string;
  navPurchasingAp: string;
  purchasingOrdersTitle: string;
  purchasingReceiptsTitle: string;
  purchasingInvoicesTitle: string;
  purchasingDebitNotesTitle: string;
  purchasingApTitle: string;
  purchasingRequestsSection: string;
  purchasingOrdersSection: string;
  purchasingNewRequest: string;
  purchasingNewOrder: string;
  purchasingRequestNo: string;
  purchasingNeededBy: string;
  purchasingSubmit: string;
  purchasingApprove: string;
  purchasingReject: string;
  purchasingIssue: string;
  purchasingClose: string;
  purchasingCancel: string;
  purchasingOrderNo: string;
  purchasingOrderDate: string;
  purchasingExpectedDate: string;
  purchasingSupplier: string;
  purchasingLines: string;
  purchasingAddLine: string;
  purchasingRemoveLine: string;
  purchasingItem: string;
  purchasingQty: string;
  purchasingUnitPrice: string;
  purchasingTaxCode: string;
  purchasingUnitCost: string;
  purchasingTotalNet: string;
  purchasingTotalTax: string;
  purchasingTotalGross: string;
  purchasingStatus: string;
  purchasingNewReceipt: string;
  purchasingReceiptNo: string;
  purchasingReceiptDate: string;
  purchasingWarehouse: string;
  purchasingPo: string;
  purchasingPoLessReason: string;
  purchasingPost: string;
  purchasingBatchNo: string;
  purchasingBatchExpiry: string;
  purchasingNewInvoice: string;
  purchasingInvoiceNo: string;
  purchasingInvoiceDate: string;
  purchasingDueDate: string;
  purchasingInternalNo: string;
  purchasingMatchStatus: string;
  purchasingMatchPreview: string;
  purchasingRecordMatch: string;
  purchasingDisposition: string;
  purchasingDispositionReason: string;
  purchasingDispositionAccept: string;
  purchasingMatchOutcomeMatched: string;
  purchasingMatchOutcomeException: string;
  purchasingMatchOutcomeDispositioned: string;
  purchasingMatchOutcomePending: string;
  purchasingQtyVariance: string;
  purchasingPriceVariance: string;
  purchasingNewDebitNote: string;
  purchasingNoteNo: string;
  purchasingNoteDate: string;
  purchasingRefInvoice: string;
  purchasingApAging: string;
  purchasingApStatement: string;
  purchasingGrniRegister: string;
  purchasingAgingNotDue: string;
  purchasingAging1_30: string;
  purchasingAging31_60: string;
  purchasingAging61_90: string;
  purchasingAging90Plus: string;
  purchasingAgingTotal: string;
  purchasingAsOf: string;
  purchasingOpeningBalance: string;
  purchasingClosingBalance: string;
  purchasingDebit: string;
  purchasingCredit: string;
  purchasingBalance: string;
  purchasingOutstanding: string;
  purchasingReceivedValue: string;
  purchasingInvoicedValue: string;
  purchasingGrniRemaining: string;
  purchasingSelectSupplier: string;
  purchasingSelectWarehouse: string;
  purchasingSelectPo: string;
  purchasingNoPo: string;
  purchasingErrState: string;
  purchasingErrDuplicate: string;
  purchasingErrMatchMissing: string;
  purchasingErrMatchException: string;
  purchasingErrPoLess: string;
  purchasingErrPoLessReason: string;
  purchasingErrOverReceipt: string;
  purchasingErrOverInvoice: string;
  purchasingErrNotSupplier: string;
  purchasingErrGrnSupplier: string;
  purchasingErrSelfApproval: string;
  purchasingErrReallocation: string;
  // PHASE-012 sales (T13-UI).
  salesEmpty: string;
  salesNoticeCreated: string;
  salesNoticeUpdated: string;
  salesNoticePosted: string;
  navSalesQuotes: string;
  navSalesOrders: string;
  navSalesDeliveries: string;
  navSalesInvoices: string;
  navSalesCreditNotes: string;
  navSalesAr: string;
  salesQuotesTitle: string;
  salesOrdersTitle: string;
  salesDeliveriesTitle: string;
  salesInvoicesTitle: string;
  salesCreditNotesTitle: string;
  salesArTitle: string;
  salesQuotesSection: string;
  salesOrdersSection: string;
  salesStatus: string;
  salesStatusSent: string;
  salesNewQuote: string;
  salesNewOrder: string;
  salesQuoteNo: string;
  salesQuoteDate: string;
  salesValidUntil: string;
  salesOrderNo: string;
  salesOrderDate: string;
  salesExpectedDate: string;
  salesSalesOrder: string;
  salesNoOrder: string;
  salesCustomer: string;
  salesSelectCustomer: string;
  salesBranch: string;
  salesSelectBranch: string;
  salesWarehouse: string;
  salesSelectWarehouse: string;
  salesCurrency: string;
  salesExchangeRate: string;
  salesItem: string;
  salesQty: string;
  salesUnitPrice: string;
  salesDiscount: string;
  salesTaxCode: string;
  salesAccount: string;
  salesLines: string;
  salesAddLine: string;
  salesRemoveLine: string;
  salesTotalNet: string;
  salesTotalTax: string;
  salesTotalGross: string;
  salesSend: string;
  salesAccept: string;
  salesReject: string;
  salesSubmit: string;
  salesApprove: string;
  salesIssue: string;
  salesClose: string;
  salesPost: string;
  salesCancel: string;
  salesCancelReason: string;
  salesReserve: string;
  salesAcceptWarehouse: string;
  salesNewDelivery: string;
  salesDeliveryNo: string;
  salesDeliveryDate: string;
  salesDelivery: string;
  salesCogsValue: string;
  salesNewInvoice: string;
  salesInvoiceNo: string;
  salesInvoiceDate: string;
  salesDueDate: string;
  salesKind: string;
  salesKindCash: string;
  salesKindCredit: string;
  salesCashAccount: string;
  salesSelectCashAccount: string;
  salesOverrideCredit: string;
  salesCreditCheck: string;
  salesCreditAllow: string;
  salesCreditWarn: string;
  salesCreditBlock: string;
  salesNewCreditNote: string;
  salesNoteNo: string;
  salesNoteDate: string;
  salesRefInvoice: string;
  salesInvoiceLineId: string;
  salesReturnToStock: string;
  salesArAging: string;
  salesArStatement: string;
  salesArOpenItems: string;
  salesOpenItemsHint: string;
  salesAgingNotDue: string;
  salesAging1_30: string;
  salesAging31_60: string;
  salesAging61_90: string;
  salesAging90Plus: string;
  salesAgingTotal: string;
  salesAsOf: string;
  salesOpeningBalance: string;
  salesClosingBalance: string;
  salesDebit: string;
  salesCredit: string;
  salesBalance: string;
  salesOutstanding: string;
  salesBaseBalance: string;
  salesSubledgerTie: string;
  salesTieOk: string;
  salesTieBroken: string;
  salesSource: string;
  salesAmount: string;
  salesRunOverdueScan: string;
  salesOverdueScanDone: string;
  salesPrint: string;
  salesPrintDisabled: string;
  salesErrState: string;
  salesErrQuotationExpired: string;
  salesErrCreditLimit: string;
  salesErrReturnWindow: string;
  salesErrPriceChanged: string;
  salesErrItemInactive: string;
  salesErrDeliveryInvoiced: string;
  salesErrCreditNoteExceeds: string;
  salesErrReallocation: string;

  // -- T-WEB (PHASE-013): the report workspace (report archetype §7) --------
  navReports: string;
  reportsNavWorkspace: string;
  reportWorkspaceTitle: string;
  reportWorkspaceCatalog: string;
  reportWorkspaceNoReport: string;
  reportWorkspaceDateFrom: string;
  reportWorkspaceDateTo: string;
  reportWorkspaceAsOfLabel: string;
  reportWorkspaceLocale: string;
  reportWorkspaceRun: string;
  reportWorkspaceQueued: string;
  reportWorkspaceRunning: string;
  reportWorkspaceStage: string;
  reportWorkspaceStatus: string;
  reportWorkspaceStatusSucceeded: string;
  reportWorkspaceStatusFailed: string;
  reportWorkspaceDuration: string;
  reportWorkspaceTotals: string;
  reportWorkspaceAssertions: string;
  reportWorkspaceAssertionFailed: string;
  reportWorkspaceAsOf: string;
  reportWorkspaceComputedAt: string;
  reportWorkspaceEmpty: string;
  reportWorkspaceSavedViews: string;
  reportWorkspaceSaveView: string;
  reportWorkspaceViewNameAr: string;
  reportWorkspaceViewNameEn: string;
  reportWorkspaceApply: string;
  reportWorkspaceDeleteView: string;
  reportWorkspaceRunHistory: string;
  reportWorkspaceRefresh: string;
  reportWorkspaceBack: string;
  reportWorkspaceExportPdf: string;
  reportWorkspaceExportXlsx: string;
  reportWorkspaceExportCsv: string;
  reportWorkspacePrintPreview: string;
  reportWorkspaceExportBlocked: string;
  reportWorkspaceViewSaved: string;
  reportWorkspaceColReport: string;
  reportWorkspaceNoRuns: string;

  // -- T19-WEB (PHASE-014): subscription, billing, onboarding & dashboards --
  navDashboard: string;
  statusTrial: string;
  statusPastDue: string;
  statusGraceReadOnly: string;
  readOnlyBanner: string;
  readOnlyPayNow: string;
  readOnlyError: string;
  readOnlyReason: string;

  pricingTitle: string;
  pricingIntro: string;
  pricingPlaceholderNote: string;
  pricingPlaceholderBadge: string;
  pricingPlansHeading: string;
  pricingMonthly: string;
  pricingAnnual: string;
  pricingHighlightBadge: string;
  pricingCta: string;
  pricingMatrixHeading: string;
  pricingMatrixHint: string;
  pricingMatrixArea: string;
  pricingMatrixCellOf: string;
  pricingFamilyPlatform: string;
  pricingFamilyAccounting: string;
  pricingFamilyTrade: string;
  pricingFamilyTreasuryTax: string;
  pricingFamilyReporting: string;
  pricingFamilyGrowth: string;
  pricingHaveAccount: string;
  pricingGoLogin: string;

  // -- Marketing landing page (FR-PLT-007 / USER_JOURNEYS Journey A1; the
  //    public site anonymous visitors see at /{locale} before any session) --
  landingKicker: string;
  landingHeroTitle: string;
  landingHeroSubtitle: string;
  landingCtaStartFree: string;
  landingCtaStartFreeNote: string;
  landingCtaPricing: string;
  landingCtaLogin: string;
  landingTrustCore: string;
  landingTrustBilingual: string;
  landingTrustIndustries: string;
  landingTrustOffline: string;
  landingFeaturesHeading: string;
  landingFeaturesIntro: string;
  landingFeatureCoreTitle: string;
  landingFeatureCoreBody: string;
  landingFeatureBilingualTitle: string;
  landingFeatureBilingualBody: string;
  landingFeatureIndustriesTitle: string;
  landingFeatureIndustriesBody: string;
  landingFeatureJurisdictionTitle: string;
  landingFeatureJurisdictionBody: string;
  landingFeatureOfflineTitle: string;
  landingFeatureOfflineBody: string;
  landingFeaturePlatformTitle: string;
  landingFeaturePlatformBody: string;
  landingIndustriesHeading: string;
  landingIndustriesIntro: string;
  landingIndustriesUnavailable: string;
  landingIndustriesCountLabel: string;
  landingIndustriesVersionLabel: string;
  landingIndustriesCta: string;
  landingPlansHeading: string;
  landingPlansIntro: string;
  landingPlansCta: string;
  landingFooterNote: string;
  landingSkipToRegister: string;

  checkoutTitle: string;
  checkoutGraceNote: string;
  checkoutPlansHeading: string;
  checkoutCurrentPlan: string;
  checkoutSelected: string;
  checkoutChoose: string;
  checkoutConfirmTitle: string;
  checkoutConfirmMeta: string;
  checkoutPeriodLabel: string;
  checkoutPeriodMonths: string;
  checkoutConfirmButton: string;
  checkoutCancelSelection: string;
  checkoutSessionTitle: string;
  checkoutInvoiceMeta: string;
  checkoutPeriod: string;
  checkoutDueDate: string;
  checkoutAmount: string;
  checkoutPayNow: string;
  checkoutSimulateFailure: string;
  checkoutSandboxNote: string;
  checkoutSuccessTitle: string;
  checkoutSuccessBody: string;
  checkoutFailureTitle: string;
  checkoutFailureBody: string;
  checkoutGoBilling: string;
  checkoutGoDashboard: string;
  checkoutBackToPlans: string;
  checkoutAlreadySettled: string;
  checkoutBlockersTitle: string;
  checkoutBlockerLine: string;
  checkoutLimitUsers: string;
  checkoutLimitBranches: string;
  checkoutLimitWarehouses: string;
  checkoutErrorDowngradeBlocked: string;
  checkoutErrorPlanUnchanged: string;
  checkoutErrorSessionNotFound: string;
  checkoutErrorSessionSettled: string;
  checkoutErrorTransition: string;
  checkoutErrorLimitExceeded: string;
  checkoutErrorNoSessionRef: string;

  billingTitle: string;
  billingGraceNote: string;
  billingPlanCardTitle: string;
  billingNoSubscription: string;
  billingPrice: string;
  billingPeriod: string;
  billingTrialEndsAt: string;
  billingTrialCountdown: string;
  billingTrialDaysNote: string;
  billingChangePlan: string;
  billingUsageTitle: string;
  billingUnlimited: string;
  billingWarn80: string;
  billingWarn100: string;
  billingInvoicesTitle: string;
  billingNoInvoices: string;
  billingColNumber: string;
  billingColPlan: string;
  billingColPeriod: string;
  billingColAmount: string;
  billingColDueDate: string;
  billingColPaidVia: string;
  billingPaidViaWebhook: string;
  billingPaidViaManual: string;
  billingEventsTitle: string;
  billingNoEvents: string;
  billingViaPlatformAdmin: string;
  billingEventTrialStarted: string;
  billingEventTrialExpired: string;
  billingEventGraceEntered: string;
  billingEventDunningWarned: string;
  billingEventPlanChangeRequested: string;
  billingEventPlanChanged: string;
  billingEventDowngradeBlocked: string;
  billingEventCheckoutCreated: string;
  billingEventManualPaymentRecorded: string;
  billingEventSuspensionExecuted: string;
  billingEventSubscriptionRestored: string;
  billingEventEntitlementsChanged: string;

  dashboardTitle: string;
  dashboardFreshness: string;
  dashboardSalesToday: string;
  dashboardCashPosition: string;
  dashboardArOverdue: string;
  dashboardStockAlerts: string;
  dashboardInvoicesCount: string;
  dashboardAccountsCount: string;
  dashboardCustomersCount: string;
  dashboardStockPreviewHeading: string;
  dashboardDrillAria: string;
  dashboardWidgetFailed: string;
  dashboardAssertionFailed: string;
  dashboardUsageHeading: string;
  dashboardUsageUnavailable: string;
  dashboardTrialBanner: string;
  dashboardPastDueBanner: string;
  dashboardGoBilling: string;
  dashboardGraceNote: string;

  notificationsTitle: string;
  notificationsUnreadCount: string;
  notificationsUnreadOnly: string;
  notificationsRefresh: string;
  notificationsSyncLine: string;
  notificationsInboxHeading: string;
  notificationsEmpty: string;
  notificationsMarkRead: string;
  notificationsReadAt: string;
  notificationsPrefsTitle: string;
  notificationsPrefsHint: string;
  notificationsPrefsCategory: string;
  notificationsPrefsInApp: string;
  notificationsPrefsEmail: string;
  notificationsPrefsSaved: string;
  notificationsCategoryLimits: string;
  notificationsCategorySubscription: string;
  notificationsCategoryReconciliation: string;
  notificationsCategoryInvoiceOverdue: string;

  onboardingStepItem: string;
  onboardingStepCustomer: string;
  onboardingStepInvoice: string;
  onboardingStepPrint: string;
  onboardingContinueJourney: string;
  onboardingNeedPcsUom: string;
  onboardingItemSku: string;
  onboardingItemName: string;
  onboardingItemNameAr: string;
  onboardingItemPrice: string;
  onboardingItemFixed: string;
  onboardingCreateItem: string;
  onboardingSkipItem: string;
  onboardingCustomerCode: string;
  onboardingCustomerName: string;
  onboardingCustomerNameAr: string;
  onboardingCustomerFixed: string;
  onboardingCreateCustomer: string;
  onboardingSkipCustomer: string;
  onboardingSelectItem: string;
  onboardingTaxPreview: string;
  onboardingPreviewEstimate: string;
  onboardingPreviewPending: string;
  onboardingNoTaxNote: string;
  onboardingInvoiceStageCreated: string;
  onboardingInvoiceStageSubmitted: string;
  onboardingInvoiceStageApproved: string;
  onboardingInvoiceStagePosted: string;
  onboardingCreateInvoice: string;
  onboardingSkipInvoice: string;
  onboardingInvoiceSummary: string;
  onboardingNoPostedInvoice: string;
  onboardingPrintQueueNote: string;
  onboardingSkipPrint: string;
  onboardingFinish: string;
  onboardingGoInvoices: string;
  onboardingGoDashboard: string;
  onboardingCompletedNote: string;
  onboardingSkippedNote: string;

  billingAdminTitle: string;
  billingAdminCaption: string;
  billingAdminSubscription: string;
  billingAdminNoSubscription: string;
  billingAdminManualTitle: string;
  billingAdminInvoice: string;
  billingAdminSelectInvoice: string;
  billingAdminVia: string;
  billingAdminViaBankTransfer: string;
  billingAdminViaCash: string;
  billingAdminViaCheque: string;
  billingAdminReference: string;
  billingAdminReason: string;
  billingAdminRecordButton: string;
  billingAdminNoOpenInvoices: string;
  billingAdminManualDone: string;
  billingAdminLifecycleTitle: string;
  billingAdminSuspendButton: string;
  billingAdminRestoreButton: string;
  billingAdminSuspendDone: string;
  billingAdminRestoreDone: string;
  billingAdminDailyPassTitle: string;
  billingAdminDailyPassHint: string;
  billingAdminDailyPassButton: string;
  billingAdminDailyPassDone: string;
  billingAdminAuditNote: string;
  billingAdminConfirmSuspend: string;
  billingAdminConfirmSuspendBody: string;
  billingAdminConfirmRestore: string;
  billingAdminConfirmRestoreBody: string;
  billingAdminConfirmButton: string;
  billingAdminErrorNotOpen: string;
  billingAdminErrorReasonRequired: string;

  // -- PHASE-015 T11 (3-a): onboarding industry step -------------------------
  onboardingStepIndustry: string;
  industryIntro: string;
  industryActivityQuestion: string;
  industryActivityOther: string;
  industryActivityResolve: string;
  industryResolvedExact: string;
  industryResolvedSuggested: string;
  industryNoMatch: string;
  industryTemplatesLabel: string;
  industryCapabilitiesLabel: string;
  industryCapabilitiesPending: string;
  industryCapIncluded: string;
  industryCapPhaseGated: string;
  industryCapOptional: string;
  industryCapBlocked: string;
  industryCapRequired: string;
  industrySelect: string;
  industryDeselect: string;
  industrySelectedBadge: string;
  industryBlockedBadge: string;
  industrySkipPlain: string;
  industryContinue: string;
  industryApplyAfterProvisionNote: string;
  industryAlreadyAppliedTitle: string;
  industryAlreadyApplied: string;
  industryLoadError: string;
  industryOutcomeTitle: string;
  industryPlainChosen: string;
  industryAppliedOk: string;
  industryApplyAlready: string;
  industryApplyForbidden: string;
  industryApplyFailedContinue: string;
  industryApplyBlockedPrefix: string;
  industryRetryHint: string;

  // -- PHASE-015 T11 (3-a): template-derived navigation labels -----------------
  industryNavComingPhase: string;
  industryNavNotInWebApp: string;

  // -- PHASE-015 T11 (3-a): admin "Industry & templates" screen --------------
  templatesTitle: string;
  templatesAppliedCard: string;
  templatesNoneApplied: string;
  templatesAppliedNotInRegistry: string;
  templatesKey: string;
  templatesName: string;
  templatesAppliedVersion: string;
  templatesHash: string;
  templatesStatus: string;
  templatesStatusActive: string;
  templatesAppliedNote: string;
  templatesDriftTitle: string;
  templatesDriftPending: string;
  templatesDriftCurrent: string;
  templatesDriftBehind: string;
  templatesDriftAvailable: string;
  templatesDriftMajor: string;
  templatesDriftWhatNext: string;
  templatesDriftRecorded: string;
  templatesDriftReview: string;
  templatesDriftNeverAuto: string;
  templatesRegistryTitle: string;
  templatesNoPermission: string;
  templatesAppliedBadge: string;
  templatesApplyButton: string;
  templatesPreviewSwitch: string;
  templatesPreviewExtend: string;
  templatesApplyDone: string;
  templatesApplyAlready: string;
  templatesBlockedGeneric: string;
  templatesSwitchDone: string;
  templatesExtendDone: string;
  templatesAckRequiredNote: string;
  templatesAckLabel: string;
  templatesDiffTitle: string;
  templatesDiffDescription: string;
  templatesModeSwitch: string;
  templatesModeExtend: string;
  templatesDiffFromTo: string;
  templatesDiffBlocked: string;
  templatesDiffAddedCaps: string;
  templatesDiffAddedIncluded: string;
  templatesDiffAddedPhaseGated: string;
  templatesDiffAddedOptionalMissing: string;
  templatesDiffEmpty: string;
  templatesDiffArchived: string;
  templatesDiffArchivedNote: string;
  templatesDiffRenamed: string;
  templatesDiffSeries: string;
  templatesDiffKeptSeries: string;
  templatesDiffInventory: string;
  templatesDiffInventoryNote: string;
  templatesDiffPolicies: string;
  templatesDiffPolicyConflict: string;
  templatesDiffPins: string;
  templatesDiffPinsAdded: string;
  templatesDiffPinsRemoved: string;
  templatesDiffChecklist: string;
  templatesSwitchButton: string;
  templatesExtendButton: string;
  templatesPoliciesTitle: string;
  templatesPoliciesNote: string;
  templatesPolicyKey: string;
  templatesPolicyValue: string;
  templatesPolicySource: string;
  templatesPolicySourceTemplate: string;
  templatesPolicySourceTenant: string;
  templatesPolicyOn: string;
  templatesPolicyOff: string;
  templatesPolicyLegend: string;

  // -- PHASE-017 (T6/T14): automotive + distribution navigation & crumbs ------
  navSales: string;
  distributionNavSection: string;
  jobCardsTitle: string;
  vehiclesTitle: string;
  commissionsTitle: string;
  distributionRoutesTitle: string;
  distributionVanTitle: string;
  distributionSettlementsTitle: string;
  distributionTiersTitle: string;

  // -- PHASE-017-T6 automotive screens (job cards + vehicles) ------------------
  jobCardsEmpty: string;
  jobCardsNew: string;
  jcFilterAll: string;
  jcCardNo: string;
  jcCustomer: string;
  jcVehicle: string;
  jcBranch: string;
  jcWarehouse: string;
  jcPartsIssueMode: string;
  jcModeReserve: string;
  jcModeIssueImmediate: string;
  jcOdometer: string;
  jcComplaints: string;
  jcDiagnosis: string;
  jcNote: string;
  jcLaborHoursTotal: string;
  jcLineParts: string;
  jcLineLabor: string;
  jcItem: string;
  jcQty: string;
  jcUnitPrice: string;
  jcHourlyRate: string;
  jcEstimatedHours: string;
  jcLoggedHours: string;
  jcDiscount: string;
  jcTaxCode: string;
  jcAddLine: string;
  jcRemoveLine: string;
  jcStatusDraft: string;
  jcStatusInProgress: string;
  jcStatusCompleted: string;
  jcStatusInvoiced: string;
  jcStatusCancelled: string;
  jcActionQuotation: string;
  jcActionApprove: string;
  jcActionComplete: string;
  jcActionInvoice: string;
  jcActionCancel: string;
  jcCancelReason: string;
  jcLogHours: string;
  jcSearchPlaceholder: string;
  jcClose: string;
  jcCreated: string;
  jcNoticeCreated: string;
  jcNoticeQuotation: string;
  jcNoticeUpdated: string;
  jcNoticeHoursLogged: string;
  jcErrState: string;
  jcErrNotCancelable: string;
  jcErrLineInvalid: string;
  jcErrPosting: string;
  vehiclesEmpty: string;
  vehNew: string;
  vehNote: string;
  vehPartner: string;
  vehMake: string;
  vehModel: string;
  vehModelYear: string;
  vehChassis: string;
  vehPlate: string;
  vehColor: string;
  vehEngineNo: string;
  vehOdometer: string;
  vehSearchPlaceholder: string;
  vehStatusActive: string;
  vehStatusArchived: string;
  vehArchive: string;
  vehArchiveHint: string;
  vehHistory: string;
  vehHistoryKindJobCard: string;
  vehHistoryKindInvoice: string;
  vehHistoryKindCreditNote: string;
  vehHistoryEmpty: string;
  vehNoticeCreated: string;
  vehNoticeArchived: string;
  vehErrChassisTaken: string;
  vehErrArchived: string;
  vehErrChassisInvalid: string;

  // -- PHASE-017-T14 distribution + commissions screens ------------------------
  // (9a-dist) routes & visits + van stock + rep settlements + tiers/FOC + commissions

  // routes & visits (T14 routes screen)
  distRoutesCreate: string;
  distRoutesCode: string;
  distRoutesName: string;
  distRoutesRep: string;
  distRoutesVan: string;
  distRoutesDayPattern: string;
  distRoutesDayPatternHint: string;
  distRoutesEmpty: string;
  distRoutesCreatedToast: string;
  distRoutesErrCodeTaken: string;
  distRoutesErrPlanning: string;
  distDayMon: string;
  distDayTue: string;
  distDayWed: string;
  distDayThu: string;
  distDayFri: string;
  distDaySat: string;
  distDaySun: string;
  distCompTitle: string;
  distCompHint: string;
  distCompDerivedHint: string;
  distCompCount: string;
  distCompOrder: string;
  distCompPinned: string;
  distCompAddCustomer: string;
  distCompRemove: string;
  distCompSave: string;
  distCompEmpty: string;
  distCompSavedToast: string;
  distPlanTitle: string;
  distPlanDate: string;
  distPlanBtn: string;
  distPlanToast: string;
  distBoardTitle: string;
  distBoardDate: string;
  distBoardAllStatuses: string;
  distVisitPlanned: string;
  distVisitCompleted: string;
  distVisitSkipped: string;
  distVisitMissed: string;
  distVisitCheckIn: string;
  distVisitComplete: string;
  distVisitSkip: string;
  distVisitCheckedIn: string;
  distVisitCustomer: string;
  distVisitRoute: string;
  distVisitNote: string;
  distVisitEmpty: string;
  distCompleteTitle: string;
  distCompleteInvoice: string;
  distCompleteCreditNote: string;
  distCompleteReceipt: string;
  distCompleteHint: string;
  distVisitCheckedInToast: string;
  distVisitCompletedToast: string;
  distVisitSkippedToast: string;
  distErrVisitState: string;
  distErrVisitDocument: string;

  // van stock (T14 van screen)
  distVanRegister: string;
  distVanCode: string;
  distVanName: string;
  distVanBranch: string;
  distVanRep: string;
  distVanEmpty: string;
  distVanRegisteredToast: string;
  distVanBalancesTitle: string;
  distVanPickVan: string;
  distVanItem: string;
  distVanSku: string;
  distVanQty: string;
  distVanValue: string;
  distVanTotals: string;
  distVanBalancesEmpty: string;
  distLoadOutTitle: string;
  distLoadOutFrom: string;
  distLoadOutVan: string;
  distLoadOutAddLine: string;
  distLoadOutBtn: string;
  distLoadOutToast: string;
  distUnloadTitle: string;
  distUnloadVan: string;
  distUnloadTo: string;
  distUnloadBtn: string;
  distUnloadToast: string;
  distTransfersTitle: string;
  distTransfersEmpty: string;
  distTransfersVanOnly: string;
  distTransfersReceiveToast: string;
  distErrVanCodeTaken: string;
  distErrVanRepBinding: string;
  distErrVanLoadOut: string;
  distErrVanNotFound: string;

  // rep settlements (T14 settlements screen)
  distSettlementsOpen: string;
  distSettlementsRep: string;
  distSettlementsCashAccount: string;
  distSettlementsVan: string;
  distSettlementsDate: string;
  distSettlementsOpening: string;
  distSettlementsNo: string;
  distSettlementsEmpty: string;
  distSettlementsOpenedToast: string;
  distSettlementAllStatuses: string;
  distSettlementDraft: string;
  distSettlementCounted: string;
  distSettlementApproved: string;
  distSettlementPosted: string;
  distSettlementCancelled: string;
  distSettlementDetail: string;
  distSettlementLines: string;
  distSettlementLineNo: string;
  distSettlementComponent: string;
  distSettlementAmount: string;
  distSettlementDescription: string;
  distSettlementCashSales: string;
  distSettlementCollections: string;
  distSettlementRefunds: string;
  distSettlementExpenses: string;
  distSettlementExpected: string;
  distSettlementCountedCash: string;
  distSettlementVariance: string;
  distSettlementShortage: string;
  distSettlementSurplus: string;
  distSettlementNone: string;
  distSettlementVarianceReason: string;
  distSettlementApprovalBadge: string;
  distSettlementCountAction: string;
  distSettlementApproveAction: string;
  distSettlementPostAction: string;
  distSettlementCancelAction: string;
  distSettlementCancelReason: string;
  distSettlementDepositAccount: string;
  distSettlementDepositAmount: string;
  distSettlementDepositHint: string;
  distSettlementShift: string;
  distSettlementCountedToast: string;
  distSettlementApprovedToast: string;
  distSettlementPostedToast: string;
  distSettlementCancelledToast: string;
  distComponentOpeningCash: string;
  distComponentCashSale: string;
  distComponentCollection: string;
  distComponentCashRefund: string;
  distComponentRepExpense: string;
  distComponentVariance: string;
  distComponentBankDeposit: string;
  distErrSettlementPendingDocs: string;
  distErrSettlementDayLocked: string;
  distErrSettlementApprovalRequired: string;
  distErrSettlementVarianceReason: string;
  distErrSettlementSelfApproval: string;
  distErrSettlementState: string;
  distErrSettlementNotFound: string;

  // customer tiers + free goods (T14 tiers screen)
  distTiersCreate: string;
  distTiersEdit: string;
  distTiersCode: string;
  distTiersName: string;
  distTiersPriceList: string;
  distTiersDiscountCap: string;
  distTiersDiscountCapHint: string;
  distTiersVisitFrequency: string;
  distTiersVisitFrequencyHint: string;
  distTiersEmpty: string;
  distTiersSavedToast: string;
  distErrTierCodeTaken: string;
  distErrTierPriceList: string;
  distErrTierInvalid: string;
  distFocTitle: string;
  distFocCreate: string;
  distFocCode: string;
  distFocName: string;
  distFocBuy: string;
  distFocBuyQty: string;
  distFocGet: string;
  distFocGetQty: string;
  distFocPerMultiple: string;
  distFocMaxFree: string;
  distFocMaxFreeHint: string;
  distFocTier: string;
  distFocAnyTier: string;
  distFocReason: string;
  distFocReasonHint: string;
  distFocValidFrom: string;
  distFocValidTo: string;
  distFocEmpty: string;
  distFocSavedToast: string;
  distFocErrInvalid: string;

  // commissions (T14 commissions screen)
  commissionsRunsTitle: string;
  commissionsNewRun: string;
  commissionsPeriodFrom: string;
  commissionsPeriodTo: string;
  commissionsBasis: string;
  commissionsBasisInvoiced: string;
  commissionsBasisCollected: string;
  commissionsTotalBase: string;
  commissionsTotalCommission: string;
  commissionsEmpty: string;
  commissionsAllStatuses: string;
  commissionsStatusDraft: string;
  commissionsStatusPosted: string;
  commissionsStatusCancelled: string;
  commissionsRunCreatedToast: string;
  commissionsRunPostedToast: string;
  commissionsRunCancelledToast: string;
  commissionsDetail: string;
  commissionsLines: string;
  commissionsRep: string;
  commissionsBase: string;
  commissionsRate: string;
  commissionsAmount: string;
  commissionsPayout: string;
  commissionsPayoutAccrued: string;
  commissionsPayoutPaid: string;
  commissionsExcluded: string;
  commissionsNoLines: string;
  commissionsPostRun: string;
  commissionsCancelRun: string;
  commissionsCancelReason: string;
  commissionsRulesTitle: string;
  commissionsRulesHint: string;
  commissionsRuleRep: string;
  commissionsRuleMethod: string;
  commissionsMethodNone: string;
  commissionsMethodPercentage: string;
  commissionsRuleRate: string;
  commissionsRuleRateHint: string;
  commissionsRuleBasis: string;
  commissionsRuleTiers: string;
  commissionsRuleTiersHint: string;
  commissionsRuleSavedToast: string;
  commErrRuleInvalid: string;
  commErrRunState: string;

  // -- PHASE-016 T4/T10 — POS (counter, floor, reconciliation, terminals, offline) --

  posNavSection: string;
  posNavCounter: string;
  posNavFloor: string;
  posNavReconciliation: string;
  posNavTerminals: string;

  posCounterTitle: string;
  posCounterNoTerminals: string;
  posCounterRegisterTerminal: string;
  posCounterTerminalLabel: string;
  posCounterShiftOpen: string;
  posCounterShiftNone: string;
  posCounterOpenShiftBtn: string;
  posCounterCloseShiftBtn: string;
  posCounterZReportLink: string;
  posCounterScanLabel: string;
  posCounterScanPlaceholder: string;
  posCounterScanNotFound: string;
  posCounterScanPerf: string;
  posCounterItemsTitle: string;
  posCounterItemsEmpty: string;
  posCounterSearchPlaceholder: string;
  posCounterCartTitle: string;
  posCounterCartEmpty: string;
  posCounterQty: string;
  posCounterRemove: string;
  posCounterTotal: string;
  posCounterTaxNote: string;
  posCounterPayBtn: string;
  posCounterClearBtn: string;
  posCounterCustomer: string;
  posCounterWalkIn: string;
  posCounterPickCustomer: string;
  posCounterCustomerSearch: string;
  posCounterNewSale: string;
  posCounterSalePosted: string;
  posCounterPreloadedCheck: string;
  posCounterErrTerminalRequired: string;
  posCounterErrCartEmpty: string;
  posCounterErrTerminalInactive: string;
  posCounterErrDiscountCeiling: string;
  posCounterReturnBtn: string;
  posCounterOfflineQueued: string;

  posShiftOpenTitle: string;
  posShiftOpeningAmount: string;
  posShiftDenominations: string;
  posShiftDenomination: string;
  posShiftCount: string;
  posShiftCountedTotal: string;
  posShiftOpenAction: string;
  posShiftAlreadyOpen: string;
  posShiftOpenedToast: string;
  posShiftCloseTitle: string;
  posShiftBlindNote: string;
  posShiftCloseAction: string;
  posShiftClosedToast: string;
  posShiftSupervisorRequired: string;
  posShiftErrOpenMismatch: string;
  posShiftErrNotOnTerminal: string;

  posTenderTitle: string;
  posTenderMethod: string;
  posTenderAmount: string;
  posTenderCash: string;
  posTenderCard: string;
  posTenderRemaining: string;
  posTenderChangeDue: string;
  posTenderAddRow: string;
  posTenderConfirm: string;
  posTenderErrInvalid: string;
  posTenderErrOverflow: string;
  posTenderErrUnderpaid: string;

  posReceiptTitle: string;
  posReceiptPrint: string;
  posReceiptLoading: string;
  posReceiptErrLoad: string;
  posReceiptOfflineNote: string;

  posReturnTitle: string;
  posReturnInvoiceLabel: string;
  posReturnLoad: string;
  posReturnLines: string;
  posReturnReason: string;
  posReturnNote: string;
  posReturnSubmit: string;
  posReturnPosted: string;
  posReturnErrNoLines: string;
  posReturnErrInvoice: string;

  posFloorTitle: string;
  posFloorBranch: string;
  posFloorZone: string;
  posFloorSeats: string;
  posFloorSortKey: string;
  posFloorFree: string;
  posFloorOccupied: string;
  posFloorTableLabel: string;
  posFloorOpenCheck: string;
  posFloorOrderType: string;
  posFloorGuests: string;
  posFloorAddTable: string;
  posFloorTableAdded: string;
  posFloorEmpty: string;
  posFloorOpenChecks: string;
  posFloorCheckNo: string;
  posFloorLines: string;
  posFloorAddItem: string;
  posFloorSaveLines: string;
  posFloorLinesSaved: string;
  posFloorKitchenSend: string;
  posFloorKitchenSent: string;
  posFloorTickets: string;
  posFloorTransfer: string;
  posFloorTransferTo: string;
  posFloorTransferred: string;
  posFloorSplit: string;
  posFloorSplitHint: string;
  posFloorSplitDone: string;
  posFloorGuestCheck: string;
  posFloorPay: string;
  posFloorCancelCheck: string;
  posFloorCancelReason: string;
  posFloorCheckCancelled: string;
  posFloorSent: string;
  posFloorUnsent: string;
  posFloorOrderDineIn: string;
  posFloorOrderTakeaway: string;
  posFloorOrderDelivery: string;
  posFloorOrderCounter: string;
  posFloorCheckPaid: string;
  posFloorErrCheckNotOpen: string;
  posFloorErrOpenTables: string;

  posReconciliationTitle: string;
  posReconciliationDate: string;
  posReconciliationBranch: string;
  posReconciliationLoad: string;
  posReconciliationZNumber: string;
  posReconciliationTotals: string;
  posReconciliationInvoiceCount: string;
  posReconciliationByOrderType: string;
  posReconciliationByTender: string;
  posReconciliationByTerminal: string;
  posReconciliationByHour: string;
  posReconciliationOfflinePairs: string;
  posReconciliationOfflineNo: string;
  posReconciliationOfficialNo: string;
  posReconciliationPrint: string;
  posReconciliationEmpty: string;
  posReconciliationOpenChecks: string;
  posReconciliationRejections: string;
  posReconciliationColType: string;
  posReconciliationColCount: string;
  posReconciliationColTax: string;

  posTerminalsTitle: string;
  posTerminalsCode: string;
  posTerminalsName: string;
  posTerminalsBranch: string;
  posTerminalsTill: string;
  posTerminalsWarehouse: string;
  posTerminalsReceiptSize: string;
  posTerminalsStatus: string;
  posTerminalsDevice: string;
  posTerminalsLastSeen: string;
  posTerminalsActive: string;
  posTerminalsInactive: string;
  posTerminalsRegister: string;
  posTerminalsRegisterAction: string;
  posTerminalsRegistered: string;
  posTerminalsActivate: string;
  posTerminalsDeactivate: string;
  posTerminalsActivated: string;
  posTerminalsDeactivated: string;
  posTerminalsEnrollDevice: string;
  posTerminalsDeviceName: string;
  posTerminalsDeviceKey: string;
  posTerminalsDeviceKeyNote: string;
  posTerminalsEnrollAction: string;
  posTerminalsEnrolled: string;
  posTerminalsRevoke: string;
  posTerminalsRevoked: string;
  posTerminalsErrCodePattern: string;
  posTerminalsErrCodeTaken: string;
  posTerminalsEmpty: string;

  posOfflineBanner: string;
  posOfflineQueue: string;
  posOfflinePendingSync: string;
  posOfflineSynced: string;
  posOfflineRejected: string;
  posOfflineKept: string;
  posOfflineRetry: string;
  posOfflineKeep: string;
  posOfflineRemove: string;
  posOfflineSyncNow: string;
  posOfflineSyncedToast: string;
  posOfflineRejectionReason: string;
  posOfflineEditResend: string;
  posOfflineAcceptPrice: string;
  posOfflineCancelWithReason: string;
  posOfflineCancelledLocal: string;
  posOfflineReasonPeriodLocked: string;
  posOfflineReasonPriceChanged: string;
  posOfflineReasonInsufficientStock: string;
  posOfflineReasonCreditLimit: string;
  posOfflineReasonValidation: string;
  posOfflineLocalReceiptTitle: string;

  // -- PHASE-018 (T41): manufacturing navigation & screens ---------------------
  // (boms + production orders + QC inspections + batch genealogy; the
  // food_manufacturing template's production/traceability surfaces)

  manufacturingNavSection: string;
  mfgBomsTitle: string;
  mfgOrdersTitle: string;
  mfgQcTitle: string;
  mfgGenealogyTitle: string;

  // BOM screen (the version registry + the lines editor + explosion preview)
  mfgBomsNew: string;
  mfgBomsEmpty: string;
  mfgBomFilterItem: string;
  mfgBomsAllStatuses: string;
  mfgBomStatusDraft: string;
  mfgBomStatusActive: string;
  mfgBomStatusArchived: string;
  mfgBomItem: string;
  mfgBomVersion: string;
  mfgBomYield: string;
  mfgBomYieldHint: string;
  mfgBomEffectiveFrom: string;
  mfgBomNote: string;
  mfgBomOutputUom: string;
  mfgBomComponent: string;
  mfgBomQtyPerOutput: string;
  mfgBomScrapPct: string;
  mfgBomLines: string;
  mfgBomLineNo: string;
  mfgBomAddLine: string;
  mfgBomRemoveLine: string;
  mfgBomCreateTitle: string;
  mfgBomEditTitle: string;
  mfgBomDraftOnlyHint: string;
  mfgBomActivate: string;
  mfgBomActivateTitle: string;
  mfgBomArchive: string;
  mfgBomArchiveHint: string;
  mfgBomCreatedToast: string;
  mfgBomSavedToast: string;
  mfgBomActivatedToast: string;
  mfgBomArchivedToast: string;
  mfgBomWorkspace: string;
  mfgExplodeTitle: string;
  mfgExplodeQty: string;
  mfgExplodeBom: string;
  mfgExplodeBomAuto: string;
  mfgExplodeRun: string;
  mfgExplodeLevels: string;
  mfgExplodeColVia: string;
  mfgExplodeTotals: string;
  mfgExplodeEmpty: string;
  mfgExplodeHint: string;
  mfgColLevel: string;

  // Production-order screen (list + create + the lifecycle workspace)
  mfgOrdersNew: string;
  mfgOrdersEmpty: string;
  mfgOrdersAllStatuses: string;
  mfgOrderStatusDraft: string;
  mfgOrderStatusReleased: string;
  mfgOrderStatusInProgress: string;
  mfgOrderStatusCompleted: string;
  mfgOrderStatusCancelled: string;
  mfgOrderNo: string;
  mfgOrderPlannedQty: string;
  mfgOrderActualQty: string;
  mfgOrderFgValue: string;
  mfgOrderCompletedAt: string;
  mfgOrderBranch: string;
  mfgOrderBom: string;
  mfgOrderBomActive: string;
  mfgOrderPlannedDate: string;
  mfgOrderMaterialsWarehouse: string;
  mfgOrderFgWarehouse: string;
  mfgOrderLaborRate: string;
  mfgOrderOverheadRate: string;
  mfgOrderRatesHint: string;
  mfgOrderCreatedToast: string;
  mfgOrderDetail: string;
  mfgOrderBatch: string;
  mfgOrderExpiry: string;
  mfgOrderWipCredit: string;
  mfgOrderLabor: string;
  mfgOrderOverhead: string;
  mfgOrderNoEditHint: string;
  mfgOrderPlanLines: string;
  mfgOrderOverPlan: string;
  mfgOrderRelease: string;
  mfgOrderStart: string;
  mfgOrderConsume: string;
  mfgOrderScrap: string;
  mfgOrderComplete: string;
  mfgOrderCancel: string;
  mfgOrderCancelTitle: string;
  mfgOrderCancelReason: string;
  mfgOrderReleasedToast: string;
  mfgOrderStartedToast: string;
  mfgOrderCancelledToast: string;
  mfgConsumeQty: string;
  mfgConsumeBatch: string;
  mfgConsumeBatchAuto: string;
  mfgConsumeAt: string;
  mfgConsumeAddLine: string;
  mfgConsumeToast: string;
  mfgScrapTitle: string;
  mfgScrapQty: string;
  mfgScrapReason: string;
  mfgScrapValue: string;
  mfgScrapAt: string;
  mfgScrapToast: string;
  mfgCompleteTitle: string;
  mfgCompleteActualQty: string;
  mfgCompleteBatchNo: string;
  mfgCompleteToast: string;
  mfgConsumptions: string;
  mfgConsumptionBatch: string;
  mfgConsumptionUnitCost: string;
  mfgConsumptionValue: string;
  mfgConsumptionJournal: string;
  mfgScraps: string;

  // QC screen (the inspection log + the entry dialog)
  mfgQcNew: string;
  mfgQcEmpty: string;
  mfgQcAllTargets: string;
  mfgQcResultPass: string;
  mfgQcResultFail: string;
  mfgQcDispAccept: string;
  mfgQcDispScrap: string;
  mfgQcDispRework: string;
  mfgQcDispReturn: string;
  mfgQcDispNone: string;
  mfgQcTargetProductionOrder: string;
  mfgQcTargetGoodsReceipt: string;
  mfgQcColInspectedAt: string;
  mfgQcColTarget: string;
  mfgQcColGrn: string;
  mfgQcColBatch: string;
  mfgQcColSampled: string;
  mfgQcCreateTitle: string;
  mfgQcTargetType: string;
  mfgQcOrder: string;
  mfgQcGrnId: string;
  mfgQcGrnHint: string;
  mfgQcResult: string;
  mfgQcSampled: string;
  mfgQcSampleSize: string;
  mfgQcDisposition: string;
  mfgQcDispositionHint: string;
  mfgQcCreatedToast: string;
  mfgQcReleasedToast: string;
  mfgQcScrapToast: string;

  // Genealogy screen (the read-only recall search)
  mfgGenealogyItem: string;
  mfgGenealogyBatchId: string;
  mfgGenealogyBatchHint: string;
  mfgGenealogyUpstream: string;
  mfgGenealogyDownstream: string;
  mfgGenealogySummary: string;
  mfgGenealogyBatchCard: string;
  mfgGenealogyOnHand: string;
  mfgGenealogyProducingOrder: string;
  mfgGenealogyConsumedBy: string;
  mfgGenealogySalesCount: string;
  mfgGenealogyInspectionsCount: string;
  mfgBatchStatusActive: string;
  mfgBatchStatusQuarantined: string;
  mfgBatchStatusWrittenOff: string;
  mfgGenealogyMaterials: string;
  mfgGenealogyColConsumedBy: string;
  mfgGenealogyColProducedBy: string;
  mfgGenealogyProductions: string;
  mfgGenealogyColFromBatch: string;
  mfgGenealogyColOrder: string;
  mfgGenealogySales: string;
  mfgGenealogyColDocType: string;
  mfgGenealogyColDocId: string;
  mfgGenealogyColDocDate: string;
  mfgGenealogyIdsHint: string;
  mfgDocSalesInvoice: string;
  mfgDocDeliveryNote: string;
  mfgGenealogyKindMaterial: string;
  mfgGenealogyKindProduced: string;
  mfgGenealogyKindSold: string;

  // Manufacturing typed errors (manufacturing-errors.ts codes → mfgErr*)
  mfgErrBomNotFound: string;
  mfgErrBomVersionConflict: string;
  mfgErrBomNotDraft: string;
  mfgErrBomNotActive: string;
  mfgErrBomActiveExists: string;
  mfgErrBomLineInvalid: string;
  mfgErrBomCycle: string;
  mfgErrBomTooDeep: string;
  mfgErrBomItemNotStock: string;
  mfgErrBomSelfReference: string;
  mfgErrBomYieldInvalid: string;
  mfgErrBomUomMismatch: string;
  mfgErrBomRequired: string;
  mfgErrOrderNotFound: string;
  mfgErrOrderState: string;
  mfgErrOrderInputInvalid: string;
  mfgErrOrderItemNotStock: string;
  mfgErrConsumptionNotPlanned: string;
  mfgErrScrapReasonRequired: string;
  mfgErrScrapExceedsWip: string;
  mfgErrCompleteWithoutConsumption: string;
  mfgErrCostRounding: string;
  mfgErrFgShelfLifeRequired: string;
  mfgErrOrderNotCancelable: string;
  mfgErrInspectionNotFound: string;
  mfgErrInspectionTargetNotFound: string;
  mfgErrInspectionTargetInvalid: string;
  mfgErrInspectionInputInvalid: string;
  mfgErrDispositionRequired: string;
  mfgErrDispositionInvalid: string;
  mfgErrQcScrapBatchNotQuarantined: string;
  mfgErrQcScrapEmptyBatch: string;
  mfgErrGenealogyBatchNotFound: string;

  // -- PHASE-019 (T50): crm navigation & screens ---------------------
  // (leads pipeline + tasks/activities + service contracts + recurring
  // billing + time entries + service orders + the projects dimension +
  // the GL project filter + the dashboard CRM card)

  crmNavSection: string;
  crmPipelineTitle: string;
  crmTasksTitle: string;
  crmContractsTitle: string;
  crmBillingTitle: string;
  crmTimeTitle: string;
  crmServiceOrdersTitle: string;
  accountingProjectsTitle: string;

  // GL project filter (the T44 projectId query param)
  accountingGlProjectFilter: string;
  accountingGlAllProjects: string;

  // Lead pipeline screen (the board + conversion wizard + lose dialog)
  crmLeadsNew: string;
  crmLeadsEmpty: string;
  crmLeadsAllStatuses: string;
  crmLeadStatusNew: string;
  crmLeadStatusQualified: string;
  crmLeadStatusConverted: string;
  crmLeadStatusLost: string;
  crmLeadColName: string;
  crmLeadColCompany: string;
  crmLeadColContact: string;
  crmLeadColSource: string;
  crmLeadColOwner: string;
  crmLeadColPartner: string;
  crmLeadColCreated: string;
  crmLeadColLostReason: string;
  crmLeadSourceWalkIn: string;
  crmLeadSourceReferral: string;
  crmLeadSourceWebsite: string;
  crmLeadSourceCampaign: string;
  crmLeadSourceCall: string;
  crmLeadSourceOther: string;
  crmLeadCreateTitle: string;
  crmLeadEditTitle: string;
  crmLeadName: string;
  crmLeadNameAr: string;
  crmLeadPhone: string;
  crmLeadEmail: string;
  crmLeadCompany: string;
  crmLeadSource: string;
  crmLeadOwner: string;
  crmLeadNote: string;
  crmLeadConvert: string;
  crmLeadConvertTitle: string;
  crmLeadConvertMode: string;
  crmLeadConvertNewPartner: string;
  crmLeadConvertMerge: string;
  crmLeadConvertPartner: string;
  crmLeadConvertHint: string;
  crmLeadLose: string;
  crmLeadLoseTitle: string;
  crmLeadLoseReason: string;
  crmLeadCreatedToast: string;
  crmLeadSavedToast: string;
  crmLeadConvertedToast: string;
  crmLeadLostToast: string;

  // Tasks + activities screen (future work + the logged-past timeline)
  crmTasksNew: string;
  crmTasksEmpty: string;
  crmTasksAllStatuses: string;
  crmTaskStatusOpen: string;
  crmTaskStatusDone: string;
  crmTaskStatusCancelled: string;
  crmTaskColTitle: string;
  crmTaskColDue: string;
  crmTaskColRemind: string;
  crmTaskColAssignee: string;
  crmTaskColRelated: string;
  crmTaskCreateTitle: string;
  crmTaskEditTitle: string;
  crmTaskTitleLabel: string;
  crmTaskAssignee: string;
  crmTaskDueDate: string;
  crmTaskRemindAt: string;
  crmTaskRemindTime: string;
  crmTaskNote: string;
  crmTaskRelatedType: string;
  crmTaskRelatedLead: string;
  crmTaskRelatedPartner: string;
  crmTaskRelatedContract: string;
  crmTaskRelatedServiceOrder: string;
  crmTaskRelatedTarget: string;
  crmTaskCreatedToast: string;
  crmTaskSavedToast: string;
  crmTaskComplete: string;
  crmTaskCompletedToast: string;
  crmTaskCancelledToast: string;
  crmActivitiesTitle: string;
  crmActivitiesEmpty: string;
  crmActivitiesHint: string;
  crmActivityColOccurredAt: string;
  crmActivityColKind: string;
  crmActivityColSummary: string;
  crmActivityColDuration: string;
  crmActivityKindCall: string;
  crmActivityKindMeeting: string;
  crmActivityKindEmail: string;
  crmActivityKindNote: string;
  crmActivityLogTitle: string;
  crmActivityKindLabel: string;
  crmActivityOccurredAt: string;
  crmActivityOccurredTime: string;
  crmActivitySummary: string;
  crmActivityDuration: string;
  crmActivityLoggedToast: string;

  // Service contracts screen (list + create/edit + schedule + preview + advances)
  crmContractsNew: string;
  crmContractsEmpty: string;
  crmContractsAllStatuses: string;
  crmContractStatusDraft: string;
  crmContractStatusActive: string;
  crmContractStatusCancelled: string;
  crmContractStatusRenewed: string;
  crmContractExpiredChip: string;
  crmContractColNo: string;
  crmContractColPartner: string;
  crmContractColTitle: string;
  crmContractColFeeModel: string;
  crmContractColTerm: string;
  crmContractColMonthly: string;
  crmFeeModelRetainer: string;
  crmFeeModelMilestones: string;
  crmFeeModelHourly: string;
  crmContractCreateTitle: string;
  crmContractPartner: string;
  crmContractProject: string;
  crmContractTitleLabel: string;
  crmContractTitleAr: string;
  crmContractScope: string;
  crmContractFeeModel: string;
  crmContractStartDate: string;
  crmContractEndDate: string;
  crmContractMonthlyAmount: string;
  crmContractFeeItem: string;
  crmContractFeeItemHint: string;
  crmContractNote: string;
  crmContractMilestones: string;
  crmContractMilestoneLabel: string;
  crmContractMilestoneDue: string;
  crmContractMilestoneAmount: string;
  crmContractAddMilestone: string;
  crmContractRemoveMilestone: string;
  crmContractEditTitle: string;
  crmContractWorkspace: string;
  crmContractActivatedAt: string;
  crmContractRenewedTo: string;
  crmContractCancelReasonLabel: string;
  crmContractActivate: string;
  crmContractActivateHint: string;
  crmContractCancelAction: string;
  crmContractCancelTitle: string;
  crmContractRenew: string;
  crmContractRenewTitle: string;
  crmContractRenewStart: string;
  crmContractRenewEnd: string;
  crmContractRenewHint: string;
  crmContractCreatedToast: string;
  crmContractSavedToast: string;
  crmContractActivatedToast: string;
  crmContractCancelledToast: string;
  crmContractRenewedToast: string;
  crmScheduleTitle: string;
  crmScheduleEmpty: string;
  crmScheduleColEntryType: string;
  crmScheduleColPeriod: string;
  crmScheduleColWindow: string;
  crmScheduleColBillDate: string;
  crmScheduleColAmount: string;
  crmScheduleColMilestone: string;
  crmScheduleEntryRetainer: string;
  crmScheduleEntryMilestone: string;
  crmScheduleEntryHourly: string;
  crmScheduleStatusPlanned: string;
  crmScheduleStatusInvoiced: string;
  crmScheduleStatusSkipped: string;
  crmPreviewTitle: string;
  crmPreviewAsOf: string;
  crmPreviewRun: string;
  crmPreviewEmpty: string;
  crmPreviewLockedChip: string;
  crmPreviewNarrativeChip: string;
  crmPreviewPullable: string;
  crmPreviewNeedsNarrative: string;
  crmAdvancesTitle: string;
  crmAdvancesEmpty: string;
  crmAdvancesTag: string;
  crmAdvancesTagTitle: string;
  crmAdvanceReceipt: string;
  crmAdvanceNote: string;
  crmAdvancePolicyHint: string;
  crmAdvanceColReceipt: string;
  crmAdvanceColAmount: string;
  crmAdvanceColStatus: string;
  crmAdvanceColJournals: string;
  crmAdvanceStatusHeld: string;
  crmAdvanceStatusReleased: string;
  crmAdvanceTaggedToast: string;

  // Recurring billing screen (runs history + manual run + drafts review)
  crmBillingRunsTitle: string;
  crmBillingRunsEmpty: string;
  crmBillingColAt: string;
  crmBillingColActor: string;
  crmBillingColAsOf: string;
  crmBillingColScanned: string;
  crmBillingColDrafts: string;
  crmBillingColLocked: string;
  crmBillingColDuplicates: string;
  crmBillingColNarrative: string;
  crmBillingRunAction: string;
  crmBillingRunTitle: string;
  crmBillingRunAsOf: string;
  crmBillingPreviewAll: string;
  crmBillingPreviewTitle: string;
  crmBillingPreviewEmpty: string;
  crmBillingPreviewContract: string;
  crmBillingRunToast: string;
  crmBillingDraftsTitle: string;
  crmBillingDraftsEmpty: string;
  crmBillingDraftsColContract: string;
  crmBillingDraftsColInvoice: string;
  crmBillingDraftsColPeriod: string;
  crmBillingDraftsColMilestone: string;
  crmBillingDraftsColCreatedAt: string;
  crmBillingDraftsLink: string;

  // Time entries screen (timeslips + weekly review)
  crmTimeNew: string;
  crmTimeEmpty: string;
  crmTimeColDate: string;
  crmTimeColProject: string;
  crmTimeColFeeItem: string;
  crmTimeColHours: string;
  crmTimeColRate: string;
  crmTimeColNarrative: string;
  crmTimeColBillable: string;
  crmTimeColEarner: string;
  crmTimeCreateTitle: string;
  crmTimeEditTitle: string;
  crmTimeEntryDate: string;
  crmTimeHours: string;
  crmTimeFeeItem: string;
  crmTimeProject: string;
  crmTimeCaseHint: string;
  crmTimeContract: string;
  crmTimeFeeEarner: string;
  crmTimeRate: string;
  crmTimeRateHint: string;
  crmTimeNarrative: string;
  crmTimeBillable: string;
  crmTimeYes: string;
  crmTimeNo: string;
  crmTimeCreatedToast: string;
  crmTimeSavedToast: string;
  crmTimeVoid: string;
  crmTimeVoidedToast: string;
  crmTimeStatusDraft: string;
  crmTimeStatusApproved: string;
  crmTimeStatusBilled: string;
  crmTimeStatusVoid: string;
  crmTimeReviewTitle: string;
  crmTimeReviewWeek: string;
  crmTimeReviewHint: string;
  crmTimeReviewToast: string;

  // Service orders screen (the job-card workspace pattern)
  crmServiceOrdersNew: string;
  crmServiceOrdersEmpty: string;
  crmServiceOrdersAllStatuses: string;
  crmServiceOrderStatusDraft: string;
  crmServiceOrderStatusInProgress: string;
  crmServiceOrderStatusCompleted: string;
  crmServiceOrderStatusInvoiced: string;
  crmServiceOrderStatusCancelled: string;
  crmServiceOrderColNo: string;
  crmServiceOrderColPartner: string;
  crmServiceOrderColContract: string;
  crmServiceOrderCreateTitle: string;
  crmServiceOrderPartner: string;
  crmServiceOrderContract: string;
  crmServiceOrderContractHint: string;
  crmServiceOrderLines: string;
  crmServiceOrderLineType: string;
  crmServiceOrderLineService: string;
  crmServiceOrderLineParts: string;
  crmServiceOrderItem: string;
  crmServiceOrderDescription: string;
  crmServiceOrderHours: string;
  crmServiceOrderQty: string;
  crmServiceOrderUnitPrice: string;
  crmServiceOrderAddLine: string;
  crmServiceOrderRemoveLine: string;
  crmServiceOrderWorkspace: string;
  crmServiceOrderEditTitle: string;
  crmServiceOrderApprove: string;
  crmServiceOrderApproveTitle: string;
  crmServiceOrderIssueMode: string;
  crmServiceOrderIssueReserve: string;
  crmServiceOrderIssueImmediate: string;
  crmServiceOrderLogHours: string;
  crmServiceOrderLogHoursTitle: string;
  crmServiceOrderLine: string;
  crmServiceOrderComplete: string;
  crmServiceOrderInvoiceAction: string;
  crmServiceOrderCancelAction: string;
  crmServiceOrderCancelTitle: string;
  crmServiceOrderCancelReason: string;
  crmServiceOrderCreatedToast: string;
  crmServiceOrderSavedToast: string;
  crmServiceOrderApprovedToast: string;
  crmServiceOrderHoursToast: string;
  crmServiceOrderCompletedToast: string;
  crmServiceOrderInvoicedToast: string;
  crmServiceOrderCancelledToast: string;
  crmServiceOrderColLineNo: string;
  crmServiceOrderColLineType: string;
  crmServiceOrderColItem: string;
  crmServiceOrderColHours: string;
  crmServiceOrderColQty: string;
  crmServiceOrderColPrice: string;
  crmServiceOrderColLogged: string;
  crmServiceOrderColStatus: string;
  crmServiceOrderLineStatusPending: string;
  crmServiceOrderLineStatusReserved: string;
  crmServiceOrderLineStatusIssued: string;
  crmServiceOrderLineStatusInvoiced: string;
  crmServiceOrderLineStatusVoid: string;
  crmServiceOrderIssueValue: string;

  // Projects screen (accounting.projects — the cost-center mirror)
  accountingProjectsNew: string;
  accountingProjectsEmpty: string;
  accountingProjectColParent: string;
  accountingProjectCreateTitle: string;
  accountingProjectCode: string;
  accountingProjectCodeHint: string;
  accountingProjectNameAr: string;
  accountingProjectParent: string;
  accountingProjectStatusOpen: string;
  accountingProjectStatusClosed: string;
  accountingProjectEditTitle: string;
  accountingProjectClose: string;
  accountingProjectReopen: string;
  accountingProjectCloseTitle: string;
  accountingProjectCloseHint: string;
  accountingProjectCreatedToast: string;
  accountingProjectSavedToast: string;
  accountingProjectStatusToast: string;
  accountingProjectErrCodeTaken: string;

  // Dashboard CRM card (the permission-gated summary section)
  dashboardCrmTitle: string;
  dashboardCrmPipeline: string;
  dashboardCrmFollowUps: string;
  dashboardCrmExpiring: string;
  dashboardCrmUpcoming: string;
  dashboardCrmOpen: string;

  // CRM typed errors (crm-errors.ts codes → crmErr*)
  crmErrLeadNotFound: string;
  crmErrLeadInputInvalid: string;
  crmErrLeadConverted: string;
  crmErrLeadLostReason: string;
  crmErrLeadMergeTarget: string;
  crmErrTaskNotFound: string;
  crmErrTaskState: string;
  crmErrTaskInput: string;
  crmErrActivityInput: string;
  crmErrContractNotFound: string;
  crmErrContractState: string;
  crmErrContractInput: string;
  crmErrContractTerm: string;
  crmErrScheduleNotFound: string;
  crmErrAdvanceState: string;
  crmErrAdvanceInsufficient: string;
  crmErrTimeNotFound: string;
  crmErrTimeState: string;
  crmErrTimeInput: string;
  crmErrTimeCaseRequired: string;
  crmErrTimesheetEmpty: string;
  crmErrServiceOrderNotFound: string;
  crmErrServiceOrderState: string;
  crmErrServiceOrderInput: string;
  crmErrServiceOrderLine: string;
  crmErrServiceOrderPosting: string;

  // -- PHASE-020 (T14): the sync admin screens (device registry, sync
  // health dashboard, revoked-device reconciliation) ------------------
  syncDevicesTitle: string;
  syncHealthTitle: string;
  syncReconciliationTitle: string;
  syncDevicesSubtitle: string;
  syncHealthSubtitle: string;
  syncReconciliationSubtitle: string;

  // Device registry screen (/platform/devices)
  syncDevicesEmpty: string;
  syncDevicesColName: string;
  syncDevicesColClass: string;
  syncDevicesColPlatform: string;
  syncDevicesColContract: string;
  syncDevicesColAttestation: string;
  syncDevicesColTrustFlags: string;
  syncDevicesColLastPull: string;
  syncDevicesColLastPush: string;
  syncDevicesColStatus: string;
  syncDevicesColDataExpiry: string;
  syncDevicesColPending: string;
  syncDevicesFilterClass: string;
  syncDevicesFilterClassAll: string;
  syncDevicesFilterStatus: string;
  syncDevicesFilterStatusAll: string;
  syncDevicesFilterStatusActive: string;
  syncDevicesFilterStatusRevoked: string;
  syncDevicesFilterApply: string;
  syncDevicesClassPosTerminal: string;
  syncDevicesClassTauriDesktop: string;
  syncDevicesClassAndroidField: string;
  syncDevicesClassAndroidPersonal: string;
  syncDevicesAttested: string;
  syncDevicesAttestationPending: string;
  syncDevicesStatusActive: string;
  syncDevicesStatusRevoked: string;
  syncDevicesTrustFlagsNone: string;
  syncDevicesActionRevoke: string;
  syncDevicesActionFlag: string;
  syncDevicesActionExpiry: string;
  syncDevicesActionDetail: string;
  syncDevicesRevokeTitle: string;
  syncDevicesRevokeReason: string;
  syncDevicesRevokeReasonPlaceholder: string;
  syncDevicesRevokeConfirm: string;
  syncDevicesRevokeAction: string;
  syncDevicesRevokedToast: string;
  syncDevicesFlagTitle: string;
  syncDevicesFlagKey: string;
  syncDevicesFlagValue: string;
  syncDevicesFlagHint: string;
  syncDevicesFlagAction: string;
  syncDevicesFlaggedToast: string;
  syncDevicesExpiryTitle: string;
  syncDevicesExpiryAt: string;
  syncDevicesExpiryClear: string;
  syncDevicesExpiryAction: string;
  syncDevicesExpirySetToast: string;
  syncDevicesExpiryClearedToast: string;
  syncDevicesDetailTitle: string;
  syncDevicesDetailCursors: string;
  syncDevicesDetailEntity: string;
  syncDevicesDetailLastSeq: string;
  syncDevicesDetailAckedAt: string;
  syncDevicesDetailNoCursors: string;
  syncDevicesDetailLoadError: string;
  syncDevicesPendingCommands: string;

  // Sync health dashboard (/platform/sync-health)
  syncHealthPushTitle: string;
  syncHealthPushTotal: string;
  syncHealthPushAccepted: string;
  syncHealthPushRejected: string;
  syncHealthPushDeferred: string;
  syncHealthPushSuccessRate: string;
  syncHealthPushP95: string;
  syncHealthPushP95None: string;
  syncHealthPullLagTitle: string;
  syncHealthPullLagEntity: string;
  syncHealthPullLagMaxLag: string;
  syncHealthPullLagDevices: string;
  syncHealthPullLagEmpty: string;
  syncHealthPullLagNeverAck: string;
  syncHealthConflictsTitle: string;
  syncHealthRejectionsTitle: string;
  syncHealthBreakdownCount: string;
  syncHealthBreakdownEmpty: string;
  syncHealthOutboxTitle: string;
  syncHealthOutboxNever: string;
  syncHealthOutboxLt1h: string;
  syncHealthOutboxLt6h: string;
  syncHealthOutboxLt24h: string;
  syncHealthOutboxLt7d: string;
  syncHealthOutboxGt7d: string;
  syncHealthOutboxDevices: string;
  syncHealthRevokedTitle: string;
  syncHealthRevokedDevices: string;
  syncHealthRevokedPending: string;
  syncHealthRevokedDrafts: string;
  syncHealthTombstones: string;
  syncHealthAlertsTitle: string;
  syncHealthAlertsEmpty: string;
  syncHealthAlertSyncCursorStall: string;
  syncHealthAlertSyncPushFailSpike: string;
  syncHealthGeneratedAt: string;
  syncHealthLagDays: string;
  syncHealthLagHours: string;
  syncHealthLagMinutes: string;

  // Revoked-device reconciliation queue (/platform/sync-reconciliation)
  syncReconciliationEmpty: string;
  syncReconciliationColDevice: string;
  syncReconciliationColName: string;
  syncReconciliationColRevokedAt: string;
  syncReconciliationColPending: string;
  syncReconciliationColDrafts: string;
  syncReconciliationColOldest: string;
  syncReconciliationReassign: string;
  syncReconciliationReassignTitle: string;
  syncReconciliationReassignFrom: string;
  syncReconciliationReassignTo: string;
  syncReconciliationReassignToPlaceholder: string;
  syncReconciliationReassignNoTargets: string;
  syncReconciliationReassignAction: string;
  syncReconciliationReassignedToast: string;

  // -- PHASE-021 (T2-b): the Offline Console (DR-P21-06 / MASTER-PLAN §6) —
  // shell states, honest states, the CONFLICT_RESOLUTION §3 rejection UX,
  // the 9 OFFLINE-DRAFT flows, cached reads, reprint, unlock (D-04), and
  // the nav + dashboard affordances. Bilingual AR/EN with 100% parity.

  // Console + shell states
  offlineNavSection: string;
  offlineConsoleTitle: string;
  offlineConsoleIntro: string;
  offlinePhaseBrowser: string;
  offlinePhaseIdle: string;
  offlinePhaseSyncing: string;
  offlinePhaseReadOnly: string;
  offlinePhaseRevoked: string;
  offlinePhaseCorrupt: string;
  offlineQueueLabel: string;
  offlineAsOfLabel: string;
  offlineAsOfNever: string;
  offlineOnlineLabel: string;
  offlineOfflineLabel: string;
  offlineSyncNow: string;
  offlinePushNow: string;
  offlineSyncUnavailable: string;
  offlineUpdatePrompt: string;
  offlineUpdateAction: string;
  offlineBannerReadOnly: string;
  offlineBannerRevoked: string;
  offlineBannerCorrupt: string;
  offlineReadOnlyGate: string;

  // Online-only reasons (capability gating — never a silent no-op)
  offlineOnlineOnlyTitle: string;
  offlineReasonBrowser: string;
  offlineReasonNoStore: string;
  offlineReasonNoSync: string;
  offlineReasonNoPrint: string;

  // Honest states (draft_docs local_status + outbox status)
  offlineStateDraftLocal: string;
  offlineStatePendingMerge: string;
  offlineStateSyncFailed: string;
  offlineStateMerged: string;
  offlineStateCancelledLocal: string;
  offlineStatusQueued: string;
  offlineStatusInFlight: string;
  offlineStatusAcked: string;
  offlineStatusRejected: string;
  offlineStatusCancelled: string;

  // Outbox / rejection queue view
  offlineOutboxTitle: string;
  offlineOutboxIntro: string;
  offlineOutboxEmpty: string;
  offlineOutboxColCommand: string;
  offlineOutboxColStatus: string;
  offlineOutboxColCreated: string;
  offlineOutboxOfficialNo: string;
  offlineOutboxServerResponse: string;
  offlineOutboxNoDraft: string;

  // Rejection reasons + meanings (CONFLICT_RESOLUTION §3 — the full table)
  offlineRejPeriodLocked: string;
  offlineRejPriceChanged: string;
  offlineRejInsufficientStock: string;
  offlineRejCreditLimitExceeded: string;
  offlineRejStaleVersion: string;
  offlineRejItemInactive: string;
  offlineRejPartnerInactive: string;
  offlineRejValidationError: string;
  offlineRejDeviceRevoked: string;
  offlineRejTenantSuspended: string;
  offlineRejMeaningPeriodLocked: string;
  offlineRejMeaningPriceChanged: string;
  offlineRejMeaningInsufficientStock: string;
  offlineRejMeaningCreditLimitExceeded: string;
  offlineRejMeaningStaleVersion: string;
  offlineRejMeaningItemInactive: string;
  offlineRejMeaningPartnerInactive: string;
  offlineRejMeaningValidationError: string;
  offlineRejMeaningDeviceRevoked: string;
  offlineRejMeaningTenantSuspended: string;
  offlineRejAdminNote: string;

  // Rejection actions (every choice is audit-logged via local_events)
  offlineActionEditResend: string;
  offlineActionAcceptServerPrice: string;
  offlineActionCancel: string;
  offlineActionAcceptPartial: string;
  offlineActionRequestApproval: string;
  offlineActionReviewMerge: string;
  offlineActionDiscard: string;
  offlineActionSubstitute: string;
  offlineChoiceRecorded: string;
  offlineEffectAcceptPrice: string;
  offlineEffectAcceptPartial: string;
  offlineEffectApproval: string;
  offlineEffectDiscard: string;
  offlineActionUnavailable: string;
  offlineDiffServerRow: string;
  offlineDiffLocalRow: string;

  // The 9 draft-flow tabs + shared capability notes
  offlineTabInvoice: string;
  offlineTabQuotation: string;
  offlineTabDelivery: string;
  offlineTabStockCount: string;
  offlineTabPartnerContact: string;
  offlineTabPartnerCreate: string;
  offlineTabExpense: string;
  offlineTabCashTransfer: string;
  offlineTabStockTransfer: string;
  offlineNoteDraft: string;
  offlineNoteMerge: string;
  offlineNoteCount: string;

  // Form fields (shared across the 9 forms)
  offlineFieldCustomer: string;
  offlineFieldItem: string;
  offlineFieldQty: string;
  offlineFieldUnitPrice: string;
  offlineFieldServerPriceHint: string;
  offlineFieldDiscount: string;
  offlineFieldTaxCode: string;
  offlineFieldNote: string;
  offlineFieldNoteAr: string;
  offlineFieldDescription: string;
  offlineFieldDescriptionAr: string;
  offlineFieldAmount: string;
  offlineFieldFee: string;
  offlineFieldCurrency: string;
  offlineFieldExchangeRate: string;
  offlineFieldReference: string;
  offlineFieldDate: string;
  offlineFieldValidUntil: string;
  offlineFieldValueDate: string;
  offlineFieldWarehouseId: string;
  offlineFieldFromWarehouse: string;
  offlineFieldToWarehouse: string;
  offlineFieldFromAccount: string;
  offlineFieldToAccount: string;
  offlineFieldCategoryId: string;
  offlineFieldCashAccountId: string;
  offlineFieldCountSession: string;
  offlineFieldOrderId: string;
  offlineFieldPartnerId: string;
  offlineFieldKind: string;
  offlineFieldCode: string;
  offlineFieldName: string;
  offlineFieldNameAr: string;
  offlineFieldTaxNumber: string;
  offlineFieldCreditLimit: string;
  offlineFieldCreditTermsId: string;
  offlineFieldPriceListId: string;
  offlineFieldPhone: string;
  offlineFieldPhone2: string;
  offlineFieldEmail: string;
  offlineFieldAddress1: string;
  offlineFieldAddress2: string;
  offlineFieldCity: string;
  offlineFieldContactPerson: string;
  offlineFieldPayee: string;
  offlineFieldBatchRef: string;
  offlineFieldBatchId: string;
  offlineFieldSerialIds: string;
  offlineFieldSerialIdsHint: string;
  offlineFieldOptional: string;
  offlineFieldNoCatalog: string;
  offlineLinesTitle: string;
  offlineLinesAdd: string;
  offlineLinesRemove: string;

  // Validation errors (per-field AR/EN, mapped from zod issues)
  offlineErrRequired: string;
  offlineErrUuid: string;
  offlineErrMoney: string;
  offlineErrQty: string;
  offlineErrUnitPrice: string;
  offlineErrCountedQty: string;
  offlineErrDate: string;
  offlineErrFx: string;
  offlineErrCurrency: string;
  offlineErrKind: string;
  offlineErrMinLen: string;
  offlineErrMaxLen: string;
  offlineErrLinesMin: string;
  offlineErrLinesMax: string;
  offlineErrSameWarehouse: string;
  offlineErrSameAccount: string;
  offlineErrAmountPositive: string;
  offlineErrFeeRange: string;
  offlineErrContactOneField: string;

  // Submit + queue feedback
  offlineSubmitQueue: string;
  offlineSubmitting: string;
  offlineQueuedToast: string;

  // Cached reads + reprint
  offlineReadsTitle: string;
  offlineReadsIntro: string;
  offlineReadsSearchItems: string;
  offlineReadsSearchPartners: string;
  offlineReadsItemsEmpty: string;
  offlineReadsPartnersEmpty: string;
  offlineReadsInvoicesTitle: string;
  offlineReadsInvoicesEmpty: string;
  offlineReadsColDocNo: string;
  offlineReadsColStatus: string;
  offlineReadsColDate: string;
  offlineReadsColTotal: string;
  offlineReadsColActions: string;
  offlineReadsReprint: string;
  offlineReadsReprintNotPosted: string;
  offlineReadsReprintSent: string;

  // The unlock screen (D-04 — cached permission snapshot, 7-day watermark)
  unlockTitle: string;
  unlockIntro: string;
  unlockModeFull: string;
  unlockModeReadOnly: string;
  unlockReasonExpired: string;
  unlockReasonNone: string;
  unlockSnapshotAt: string;
  unlockPermissionsHeading: string;
  unlockGoOffline: string;
  unlockBrowserNote: string;
  unlockRuleNote: string;

  // Dashboard quick action (the entry affordance)
  dashboardOfflineNote: string;

  // -- T14 (PHASE-024): public security disclosure policy page (/{locale}/security) --
  disclosureTitle: string;
  disclosureIntro: string;
  disclosureContactHeading: string;
  disclosureContactBody: string;
  disclosureContactAddress: string;
  disclosureContactPlaceholderNote: string;
  disclosureCommitmentHeading: string;
  disclosureCommitmentAck: string;
  disclosureCommitmentUpdates: string;
  disclosureCommitmentCoordinated: string;
  disclosureSafeHarborHeading: string;
  disclosureSafeHarborBody: string;
  disclosureGuidelinesHeading: string;
  disclosureGuidelineTesting: string;
  disclosureGuidelineNoDegrade: string;
  disclosureGuidelineReport: string;
  disclosureScopeHeading: string;
  disclosureScopeBody: string;
  disclosureTriageHeading: string;
  disclosureTriageBody: string;
  disclosureBountyNote: string;
  loginSecurityLink: string;

  // -- PHASE-025 (T9d): the SLO / error-budget dashboard (/platform/slo) --
  sloTitle: string;
  sloSubtitle: string;
  sloStateOk: string;
  sloStateBurning2x: string;
  sloStateBurning4x: string;
  sloStateNoData: string;
  sloNoDataNote: string;
  sloBudgetLabel: string;
  sloBudgetExhausted: string;
  sloBurnLabel: string;
  sloCardApiAvailability: string;
  sloCardApiLatency: string;
  sloCardPosting: string;
  sloCardBackup: string;
  sloCardSync: string;
  sloCardReport: string;
  sloSummaryTitle: string;
  sloAvailabilityRequests: string;
  sloAvailabilityErrors: string;
  sloPostingAttempts: string;
  sloPostingInvariantFailures: string;
  sloSyncDeferred: string;
  sloLatencyColGroup: string;
  sloLatencyColP50: string;
  sloLatencyColP95: string;
  sloLatencyColP99: string;
  sloLatencyColBudget: string;
  sloLatencyColOverBudget: string;
  sloRouteGroupIdentity: string;
  sloRouteGroupAccounting: string;
  sloRouteGroupSales: string;
  sloRouteGroupPurchasing: string;
  sloRouteGroupTreasury: string;
  sloRouteGroupInventory: string;
  sloRouteGroupSync: string;
  sloRouteGroupPlatform: string;
  sloReportColClass: string;
  sloReportColRenders: string;
  sloReportColBudget: string;
  sloReportColOverBudget: string;
  sloReportClassInline: string;
  sloReportClassJob: string;
  sloReportTemplatesTitle: string;
  sloBackupNoteTitle: string;
  sloBackupExternalCadence: string;
  sloBackupNoFailuresNote: string;
  sloBurnAlertsTitle: string;
  sloBurnAlertsEmpty: string;
  sloAlertSev1: string;
  sloAlertSev2: string;
  sloAlertSloBurn: string;
  sloAlertPostingInvariant: string;
  sloDataSourceTitle: string;
  sloDataSourceNote: string;
  sloWindowNote: string;
  sloGeneratedAt: string;

  // -- PHASE-026 (T13-UI): fixed assets & depreciation ------------------------
  // (asset register + categories + the depreciation-run workspace + the
  // disposal wizard + the module report page; every string in BOTH locales)

  commonEdit: string;
  navAccounting: string;
  navFixedAssets: string;

  // asset statuses + methods (§9 enums)
  faStatusActive: string;
  faStatusFullyDepreciated: string;
  faStatusDisposed: string;
  faStatusWrittenOff: string;
  faMethodSl: string;
  faMethodDb: string;
  faMethodUop: string;

  // asset list (§2)
  faTitle: string;
  faAssetsEmpty: string;
  faAssetsNewButton: string;
  faSearchPlaceholder: string;
  faAllStatuses: string;
  faFilterCategory: string;
  faFilterBranch: string;
  faFilterCustodian: string;
  faColCode: string;
  faColAcquisitionDate: string;
  faColCost: string;
  faColAccumulated: string;
  faColNbv: string;
  faColBranch: string;
  faColCustodian: string;

  // asset create/edit (§3)
  faFormTitleCreate: string;
  faFormTitleEdit: string;
  faFormCode: string;
  faFormCodeHint: string;
  faFormName: string;
  faFormNameAr: string;
  faFormCategory: string;
  faFormCategoryHint: string;
  faFormAcquisitionDate: string;
  faFormCost: string;
  faFormSalvage: string;
  faFormSalvageHint: string;
  faFormLife: string;
  faFormMethod: string;
  faFormBranch: string;
  faFormCustodian: string;
  faFormNote: string;
  faFormNoteAr: string;
  faFormUnitsTotal: string;
  faFormUnitsHint: string;
  faFormOpeningAccumulated: string;
  faFormOpeningHint: string;
  faFormCreatedToast: string;
  faFormSavedToast: string;
  faFormImmutableHint: string;

  // asset detail (§5)
  faOverviewTitle: string;
  faFinancialTitle: string;
  faAccumulatedCard: string;
  faNbvCard: string;
  faSourceLabel: string;
  faSourceNone: string;
  faHistoryTitle: string;
  faHistoryColDate: string;
  faHistoryColAmount: string;
  faHistoryColAccumAfter: string;
  faHistoryColUnits: string;
  faHistoryEmpty: string;
  faReversedBadge: string;
  faLifecycleTitle: string;
  faJournalEntry: string;

  // capitalization (G-21)
  faCapitalizeTitle: string;
  faCapitalizeHint: string;
  faCapitalizeFunding: string;
  faFundingCredit: string;
  faFundingCash: string;
  faFundingOpening: string;
  faCapitalizePartner: string;
  faCapitalizeOpeningNote: string;
  faCapitalizeButton: string;
  faCapitalizePostedToast: string;

  // revaluation (BR-044)
  faRevaluateTitle: string;
  faRevNewGross: string;
  faRevNewAccum: string;
  faRevDeltaPreview: string;
  faRevReason: string;
  faRevCreateButton: string;
  faRevPostButton: string;
  faRevCreatedToast: string;
  faRevPostedToast: string;

  // categories (§8)
  faCategoriesTitle: string;
  faCategoriesEmpty: string;
  faCatNewButton: string;
  faCatColLife: string;
  faCatColMethod: string;
  faCatColActive: string;
  faCatInUseBadge: string;
  faCatCode: string;
  faCatCodeHint: string;
  faCatName: string;
  faCatNameAr: string;
  faCatLife: string;
  faCatMethod: string;
  faCatPurposesTitle: string;
  faCatPurposesHint: string;
  faCatPurposeAsset: string;
  faCatPurposeAccum: string;
  faCatPurposeExpense: string;
  faCatActive: string;
  faCatEditTitle: string;
  faCatCreatedToast: string;
  faCatSavedToast: string;

  // depreciation runs + workspace (§4)
  faDepTitle: string;
  faDepEmpty: string;
  faDepPeriodLabel: string;
  faDepPeriodYear: string;
  faDepPeriodPeriod: string;
  faDepAssembleButton: string;
  faDepAssembleHint: string;
  faDepAssembledToast: string;
  faDepApplyUsage: string;
  faDepApplyUsageHint: string;
  faDepPostButton: string;
  faDepPostConfirmTitle: string;
  faDepPostConfirmBody: string;
  faDepPostedToast: string;
  faDepReverseTitle: string;
  faDepReverseReason: string;
  faDepReverseButton: string;
  faDepReversedToast: string;
  faDepColPeriod: string;
  faDepColAssets: string;
  faDepColTotal: string;
  faDepColPostedAt: string;
  faDepWorkspaceTitle: string;
  faDepColMethod: string;
  faDepColUnits: string;
  faDepColPeriodAmount: string;
  faDepColAccumAfter: string;
  faDepColNbvAfter: string;
  faDepNoLines: string;
  faDepUopHint: string;
  faDepPreviewNote: string;

  // disposals + wizard (§9)
  faDisposalsTitle: string;
  faDisposalsEmpty: string;
  faDispNewButton: string;
  faDispColNo: string;
  faDispColAsset: string;
  faDispColKind: string;
  faDispColDate: string;
  faDispColProceeds: string;
  faDispColNbv: string;
  faDispColGainLoss: string;
  faDispKindSale: string;
  faDispKindScrap: string;
  faDispWizardTitle: string;
  faDispStep1: string;
  faDispStep2: string;
  faDispStep3: string;
  faDispNext: string;
  faDispBack: string;
  faDispCreatedToast: string;
  faDispAssetLabel: string;
  faDispAssetHint: string;
  faDispKindLabel: string;
  faDispDateLabel: string;
  faDispProceedsLabel: string;
  faDispProceedsHint: string;
  faDispScrapZeroLabel: string;
  faDispReviewTitle: string;
  faDispReviewCost: string;
  faDispReviewAccum: string;
  faDispReviewNbv: string;
  faDispReviewGainLoss: string;
  faDispSubmitButton: string;
  faDispApproveHint: string;
  faDispApproveButton: string;
  faDispApprovedToast: string;
  faDispPostButton: string;
  faDispPostedToast: string;
  faDispVoucherTitle: string;
  faDispPrintButton: string;
  faDispVoucherTotalsProceeds: string;
  faDispVoucherTotalsAccum: string;
  faDispVoucherTotalsCost: string;
  faDispVoucherTotalsGainLoss: string;

  // module report page (§7)
  faReportsTitle: string;
  faReportsHint: string;
  faReportsEmpty: string;

  // fixed-assets error pack
  faErrCategoryCodeTaken: string;
  faErrAssetCodeTaken: string;
  faErrAssetImmutable: string;
  faErrPurposesNotMapped: string;
  faErrInvalidAmount: string;
  faErrUopUnitsRequired: string;
  faErrImmutableDocument: string;
  faErrRunNotDraft: string;
  faErrRunDuplicate: string;
  faErrPeriodLocked: string;
  faErrNbvFloor: string;
  faErrDisposalState: string;
  faErrDisposalSod: string;
  faErrDisposalProceeds: string;
  faErrRevalState: string;
  faErrCapitalizeState: string;
  faErrAssetDisposedReuse: string;

  // -- PHASE-027 (wave F): cheques & notes + installment plans ---------------
  // (the notes register + custody lifecycle + the PDC maturity calendar +
  // the module report pages + the installments wizard/schedule; every
  // string in BOTH locales. Nav labels ride the registry (contracts
  // NAV_ITEMS); the nav* keys below are the app-shell breadcrumb fallbacks,
  // the navFixedAssets precedent.)

  navChequesNotes: string;
  navPdcCalendar: string;
  navInstallmentPlans: string;

  // notes kinds/directions/statuses (register §C enums)
  notesKindCheque: string;
  notesKindPromissoryNote: string;
  notesDirectionReceived: string;
  notesDirectionIssued: string;
  notesStatusInCustody: string;
  notesStatusEndorsedOut: string;
  notesStatusDeposited: string;
  notesStatusCollected: string;
  notesStatusDishonored: string;
  notesStatusDiscounted: string;
  notesStatusReturned: string;

  // notes register (§2) + module tabs/reports
  notesTitle: string;
  notesNewTitle: string;
  notesCalendarTitle: string;
  notesReportsTitle: string;
  notesReportsHint: string;
  notesReportsEmpty: string;
  notesEmpty: string;
  notesNewButton: string;
  notesSearchPlaceholder: string;
  notesAllStatuses: string;
  notesFilterKind: string;
  notesFilterDirection: string;
  notesFilterPartner: string;
  notesFilterMaturityRange: string;

  // note create (§3) — receive-against-invoice / issue-against-supplier-invoice
  notesFormDirection: string;
  notesFormDirectionHint: string;
  notesFormPartner: string;
  notesFormNumber: string;
  notesFormNumberHint: string;
  notesFormBank: string;
  notesFormBankHint: string;
  notesFormAmount: string;
  notesFormCurrency: string;
  notesFormRate: string;
  notesFormRateHint: string;
  notesFormIssueDate: string;
  notesFormMaturityDate: string;
  notesFormSourceInvoice: string;
  notesFormSourceInvoiceHint: string;
  notesFormSourceNone: string;
  notesFormNote: string;
  notesFormNoteAr: string;
  notesFormSubmit: string;
  notesFormInvalid: string;
  notesFormCreatedToast: string;

  // note document detail (§5)
  notesOverviewTitle: string;
  notesCustodyTitle: string;
  notesCustodyEmpty: string;
  notesJournalEntry: string;
  notesCashAccountLabel: string;
  notesSourceLabel: string;
  notesTerminalHint: string;
  notesActionsTitle: string;

  // custody event kinds (the append-only log)
  notesEventReceive: string;
  notesEventIssue: string;
  notesEventEndorse: string;
  notesEventDeposit: string;
  notesEventCollect: string;
  notesEventDishonor: string;
  notesEventDiscount: string;
  notesEventReturn: string;
  notesEventReclassify: string;

  // custody actions + dialogs + toasts
  notesActionEndorse: string;
  notesActionDeposit: string;
  notesActionCollect: string;
  notesActionDishonor: string;
  notesActionDiscount: string;
  notesActionReturn: string;
  notesActionEndorsee: string;
  notesActionDate: string;
  notesActionReason: string;
  notesActionReasonHint: string;
  notesActionBankFee: string;
  notesActionFee: string;
  notesActionAccount: string;
  notesActionRate: string;
  notesEndorseToast: string;
  notesDepositToast: string;
  notesCollectToast: string;
  notesDishonorToast: string;
  notesDiscountToast: string;
  notesReturnToast: string;

  // PDC maturity calendar (§1 dashboard)
  pdcAsOfLabel: string;
  pdcComputedAtLabel: string;
  pdcStaleWarning: string;
  pdcStaleHint: string;
  pdcBucketOverdue: string;
  pdcBucketThisWeek: string;
  pdcBucket30: string;
  pdcBucket60: string;
  pdcBucket90: string;
  pdcBucketBeyond: string;
  pdcCountLabel: string;
  pdcAmountBaseLabel: string;
  pdcReceivedSide: string;
  pdcIssuedSide: string;
  pdcByPartnerTitle: string;
  pdcByBankTitle: string;
  pdcNotesTitle: string;
  pdcBankUnspecified: string;
  pdcDrillLink: string;
  pdcEmpty: string;

  // notes error pack (§6 failure codes → bilingual messages)
  notesErrSourceInvalid: string;
  notesErrAlreadyPosted: string;
  notesErrCustodyTransition: string;
  notesErrDishonorReason: string;
  notesErrRateMismatch: string;
  notesErrCurrencyMismatch: string;
  notesErrAccountRequired: string;
  notesErrFeeInvalid: string;
  notesErrDiscountCurrency: string;
  notesErrFieldsImmutable: string;
  notesErrAccountCurrency: string;

  // installment plans list (§2) + module tabs/reports
  instTitle: string;
  instNewTitle: string;
  instReportsTitle: string;
  instReportsHint: string;
  instReportsEmpty: string;
  instEmpty: string;
  instNewButton: string;
  instSearchPlaceholder: string;
  instAllStatuses: string;
  instStatusDraft: string;
  instStatusActive: string;
  instStatusClosed: string;
  instStatusDefaulted: string;
  instFilterPartner: string;
  instFilterStatus: string;
  instFilterSource: string;
  instSourceSalesInvoice: string;
  instSourceServiceContract: string;
  instColSource: string;
  instColTotal: string;
  instColSeq: string;
  instColAmount: string;
  instColReceipts: string;
  instColCollected: string;
  instColLateFee: string;

  // frequencies (§9 wizard vocabulary)
  instFreqWeekly: string;
  instFreqBiweekly: string;
  instFreqMonthly: string;
  instFreqQuarterly: string;

  // plan detail + schedule lines (§5)
  instDetailOverview: string;
  instDetailSchedule: string;
  instDetailScheduleEmpty: string;
  instDetailPolicy: string;
  instLineStatusPending: string;
  instLineStatusDue: string;
  instLineStatusPaid: string;
  instLineStatusOverdue: string;
  instLineStatusWaived: string;
  instWaiveAction: string;
  instWaiveReason: string;
  instWaiveToast: string;
  instChargeLateFeeAction: string;
  instChargeLateFeeToast: string;

  // plan wizard (§9)
  instWizStepSource: string;
  instWizStepSchedule: string;
  instWizStepPolicy: string;
  instWizStepOf: string;
  instWizBack: string;
  instWizNext: string;
  instWizSourceType: string;
  instWizSourceInvoice: string;
  instWizSourceContract: string;
  instWizSourceTotal: string;
  instWizEstimateChip: string;
  instWizDownPayment: string;
  instWizCount: string;
  instWizStartDate: string;
  instWizFrequency: string;
  instWizPreviewTitle: string;
  instWizPreviewInvalid: string;
  instWizPolicyTitle: string;
  instWizPolicyHint: string;
  instWizPolicyRate: string;
  instWizPolicyCap: string;
  instWizPolicyGrace: string;
  instWizPolicyAuto: string;
  instWizPolicyDefaulted: string;
  instWizPlaceholderChip: string;
  instWizCreate: string;
  instWizActivate: string;
  instWizActivateHint: string;
  instWizCreatedToast: string;
  instWizActivatedToast: string;
  instWizBrTotal: string;

  // installments error pack
  instErrSourceInvalid: string;
  instErrScheduleImmutable: string;
  instErrSourceTaken: string;
  instErrTotalMismatch: string;
  instErrScheduleInvalid: string;
  instErrSourceCurrency: string;
  instErrPolicyInvalid: string;
  instErrLateFeeNotChargeable: string;
  instErrWaiveReason: string;

  // -- PHASE-028 (budgeting): the period-column planning grid -------------------
  // (the version register + the grid workspace + the lifecycle actions +
  // consumption banners + the XLSX import wizard + the module report page;
  // every string in BOTH locales. Nav label rides the registry (contracts
  // NAV_ITEMS `accounting.budgets`); the navBudgets key below is the
  // app-shell breadcrumb fallback, the navFixedAssets precedent.)

  navBudgets: string;

  // budgets register (§2 List+Search) + module tabs/reports
  budgetsTitle: string;
  budgetsNewTitle: string;
  budgetsImportTitle: string;
  budgetsImportLink: string;
  budgetReportsTitle: string;
  budgetReportsHint: string;
  budgetReportsEmpty: string;
  budgetsEmpty: string;
  budgetsNewButton: string;
  budgetsSearchPlaceholder: string;
  budgetsAllStatuses: string;
  budgetsFilterStatus: string;
  budgetsFilterScope: string;
  budgetsFilterYear: string;

  // budget statuses (the BR-050 machine states) + scopes (§9 enums)
  budgetStatusDraft: string;
  budgetStatusPendingApproval: string;
  budgetStatusActive: string;
  budgetStatusRevised: string;
  budgetStatusClosed: string;
  budgetScopeAccounts: string;
  budgetScopeCostCenters: string;
  budgetScopeProjects: string;
  budgetScopeBranches: string;

  // register columns
  budgetColCode: string;
  budgetColName: string;
  budgetColScope: string;
  budgetColStatus: string;
  budgetColYear: string;
  budgetColRevision: string;
  budgetColLines: string;
  budgetColTotal: string;

  // budget create (§3)
  budgetFormName: string;
  budgetFormNameAr: string;
  budgetFormFiscalYear: string;
  budgetFormScope: string;
  budgetFormScopeHint: string;
  budgetFormNote: string;
  budgetFormNoteAr: string;
  budgetFormSubmit: string;
  budgetFormInvalid: string;
  budgetFormCreatedToast: string;

  // grid workspace (§4 variant — fiscal-period columns)
  budgetGridTitle: string;
  budgetGridDimension: string;
  budgetGridRowTotal: string;
  budgetGridPeriodTotals: string;
  budgetGridYearTotal: string;
  budgetGridAccount: string;
  budgetGridAddLine: string;
  budgetGridRemoveLine: string;
  budgetGridSave: string;
  budgetGridSavedToast: string;
  budgetGridReadOnly: string;
  budgetGridEmpty: string;
  budgetLiveTotals: string;

  // lifecycle actions (BR-050 + SoD)
  budgetSubmit: string;
  budgetApprove: string;
  budgetActivate: string;
  budgetSupersede: string;
  budgetClose: string;
  budgetSubmitToast: string;
  budgetApproveToast: string;
  budgetActivateToast: string;
  budgetSupersedeToast: string;
  budgetCloseToast: string;
  budgetSupersedeHint: string;

  // consumption banner (BR-051 — ADVISORY by default)
  budgetConsumption: string;
  budgetActual: string;
  budgetVariance: string;
  budgetOverBudget: string;
  budgetAtOverBudget: string;
  budgetAdvisoryNote: string;
  budgetStaleWarning: string;
  budgetComputedAt: string;
  budgetConsumptionEmpty: string;

  // XLSX import wizard (§9) + export
  budgetImportChooseFile: string;
  budgetImportFileRequired: string;
  budgetImportFileTooLarge: string;
  budgetImportBudgetRequired: string;
  budgetImportNoDrafts: string;
  budgetImportStepSetup: string;
  budgetImportStepReview: string;
  budgetImportDryRun: string;
  budgetImportDryRunTitle: string;
  budgetImportRowCount: string;
  budgetImportValidRows: string;
  budgetImportTotalsPreview: string;
  budgetImportErrors: string;
  budgetImportClean: string;
  budgetImportCommit: string;
  budgetImportCommitToast: string;
  budgetImportRowCap: string;
  budgetExportLabel: string;
  budgetExportAr: string;
  budgetExportEn: string;

  // module reports (the budgeting.* registry family)
  budgetReportVsActual: string;
  budgetReportVarianceAnalysis: string;

  // detail (§5): the supersede chain + stamps
  budgetChainHistory: string;
  budgetChainEmpty: string;
  budgetSupersedes: string;
  budgetSupersededBy: string;
  budgetCreatedAt: string;

  // budgets error pack (BR-050/051 + import failure codes → bilingual messages)
  budgetErrImmutable: string;
  budgetErrState: string;
  budgetErrSelfApproval: string;
  budgetErrActiveExists: string;
  budgetErrPeriodMismatch: string;
  budgetErrExceeded: string;
  budgetErrNotApproved: string;
  budgetErrScopeDimension: string;
  budgetErrDuplicateLine: string;
  budgetErrLineLimit: string;
  budgetErrImportFormat: string;
  budgetErrImportRowLimit: string;
  budgetErrImportRow: string;

  // -- PHASE-029 (payroll): salaries, loans & end-of-service ---------
  // (the employee register + the structure builder + the run workspace +
  // loans + EOS + the module report page + the typed error map; every
  // string in BOTH locales. Nav labels ride the registry (contracts
  // NAV_ITEMS `hr.*`); the navHr/navPayroll* keys below are the app-shell
  // breadcrumb fallbacks, the navBudgets precedent.)

  navHr: string;
  navPayrollEmployees: string;
  navPayrollStructures: string;
  navPayrollRuns: string;
  navPayrollLoans: string;
  payTitle: string;
  payEmployeesTitle: string;
  payEmployeesNew: string;
  payEmployeesSearch: string;
  payEmployeesEmpty: string;
  payEmployeeCode: string;
  payEmployeeName: string;
  payEmployeeHireDate: string;
  payEmployeeContract: string;
  payEmployeeBasicSalary: string;
  payEmployeeStructure: string;
  payEmployeeBranch: string;
  payEmployeeCostCenter: string;
  payEmployeeProject: string;
  payEmployeeNationalId: string;
  payEmployeeBank: string;
  payEmployeeStatus: string;
  payEmployeeEosBalance: string;
  payStatusActive: string;
  payStatusSuspended: string;
  payStatusTerminated: string;
  payContractFullTime: string;
  payContractPartTime: string;
  payContractContractor: string;
  payEmployeeCreateTitle: string;
  payEmployeeEditTitle: string;
  payEmployeeTerminate: string;
  payEmployeeTerminateDate: string;
  payEmployeeTerminateReason: string;
  payEmployeeSuspend: string;
  payEmployeeReactivate: string;
  payEmployeeSave: string;
  payEmployeeCreatedToast: string;
  payEmployeeUpdatedToast: string;
  payEmployeeTerminatedToast: string;
  payPiiNote: string;
  payEmployeeTerminatedNote: string;
  payStructuresTitle: string;
  payStructureNew: string;
  payStructureCode: string;
  payStructureName: string;
  payStructureCurrency: string;
  payStructureStatus: string;
  payStructureComponents: string;
  payComponentKey: string;
  payComponentKind: string;
  payComponentCalc: string;
  payComponentAmount: string;
  payComponentRate: string;
  payComponentAccount: string;
  payComponentEosBase: string;
  payKindAllowance: string;
  payKindDeduction: string;
  payKindEmployer: string;
  payCalcFixed: string;
  payCalcPercentBasic: string;
  payCalcPercentGross: string;
  payStructureAddComponent: string;
  payStructureRemoveComponent: string;
  payStructureSave: string;
  payStructureArchived: string;
  payStructureVersion: string;
  payStructureVersionedToast: string;
  payStructureSavedToast: string;
  payStructureInUseNote: string;
  payRunsTitle: string;
  payRunNew: string;
  payRunPeriod: string;
  payRunStatus: string;
  payRunGross: string;
  payRunDeductions: string;
  payRunNet: string;
  payRunEmployer: string;
  payRunEos: string;
  payRunPaid: string;
  payRunNumber: string;
  payRunLines: string;
  payRunCalculate: string;
  payRunSubmit: string;
  payRunApprove: string;
  payRunPost: string;
  payRunPayout: string;
  payRunReverse: string;
  payRunPayslips: string;
  payRunDraft: string;
  payRunPending: string;
  payRunPosted: string;
  payRunCalculatedToast: string;
  payRunSubmittedToast: string;
  payRunApprovedToast: string;
  payRunPostedToast: string;
  payRunPayoutToast: string;
  payRunEmptyLines: string;
  payRunLoanClampWarning: string;
  payRunSkippedWarning: string;
  payRunOutstanding: string;
  payLoansTitle: string;
  payLoanNew: string;
  payLoanCode: string;
  payLoanEmployee: string;
  payLoanAmount: string;
  payLoanInstallments: string;
  payLoanStartPeriod: string;
  payLoanCashAccount: string;
  payLoanSchedule: string;
  payLoanLineAmount: string;
  payLoanLineStatus: string;
  payLoanPending: string;
  payLoanDeducted: string;
  payLoanWaived: string;
  payLoanWaive: string;
  payLoanWaiveReason: string;
  payLoanWriteOff: string;
  payLoanWriteOffReason: string;
  payLoanActive: string;
  payLoanClosed: string;
  payLoanWriteOffStatus: string;
  payLoanDisbursedToast: string;
  payLoanWaivedToast: string;
  payLoanWrittenOffToast: string;
  payEosTitle: string;
  payEosAccrued: string;
  payEosSettled: string;
  payEosBalance: string;
  payEosSettle: string;
  payEosSettleAmount: string;
  payEosPolicy: string;
  payEosDisabled: string;
  payEosSettledToast: string;
  payReportsTitle: string;
  payReportsEmpty: string;
  payErrNotFound: string;
  payErrStateInvalid: string;
  payErrSelfApproval: string;
  payErrImmutable: string;
  payErrRunPeriodExists: string;
  payErrStructureInUse: string;
  payErrStructureNotActive: string;
  payErrStructureCurrency: string;
  payErrEmployeeStructureMissing: string;
  payErrLoanCap: string;
  payErrLoanUnmapped: string;
  payErrEosBasis: string;
  payErrEosExceeds: string;
  payErrPayoutExceeds: string;
  payErrEmployeeState: string;
  payErrCodeConflict: string;
  payErrEngineOnly: string;
  payErrPurposeNotMapped: string;
  payErrPeriodLocked: string;

  // -- PHASE-034 (T11): multi-entity consolidation (القوائم الموحدة) ---------
  // (the consolidation workspace: groups + members (Settings §8), the
  // elimination Transaction Entry workspace (§4) with the live DR/CR preview,
  // and the run Report Page (§7) with the snapshot viewer; every string in
  // BOTH locales. Nav labels ride the registry (reports.consolidated —
  // contracts NAV_ITEMS); the nav* keys below are the app-shell breadcrumb
  // fallbacks, the navFixedAssets precedent.)

  navConsolidated: string;
  consolidationGroupsNav: string;
  consolidationEliminationsNav: string;
  consolidationRunsNav: string;

  // shared module vocabulary
  consolidationTitle: string;
  consolidationHubHint: string;
  consolidationDisclaimer: string;
  consolidationColGroup: string;
  consolidationFiscalPeriod: string;
  consolidationColCreated: string;
  consolidationStatusActive: string;
  consolidationStatusArchived: string;
  consolidationFxMethodClosingRate: string;
  consolidationFxMethodTemporary: string;
  consolidationNoteEn: string;
  consolidationNoteAr: string;
  consolidationRunStatusQueued: string;
  consolidationRunStatusRunning: string;
  consolidationRunStatusCompleted: string;
  consolidationRunStatusFailed: string;

  // groups hub (the workspace landing surface)
  consolidationEmptyGroups: string;
  consolidationNewGroupButton: string;
  consolidationCreateGroupTitle: string;
  consolidationGroupName: string;
  consolidationGroupNameAr: string;
  consolidationGroupBaseCurrency: string;
  consolidationGroupFxMethod: string;
  consolidationGroupCreateToast: string;
  consolidationGroupMembersLabel: string;
  consolidationRecentRunsCard: string;
  consolidationViewRuns: string;
  consolidationViewEliminations: string;
  consolidationNewElimination: string;
  consolidationNewRun: string;
  consolidationRunsEmpty: string;

  // group settings (§8 detail surface)
  consolidationGroupSettingsCard: string;
  consolidationGroupArchivedWarning: string;
  consolidationArchiveGroupAction: string;
  consolidationReactivateGroupAction: string;
  consolidationGroupStatusToast: string;
  consolidationMembersCard: string;
  consolidationAddMemberTitle: string;
  consolidationMemberTenantId: string;
  consolidationMemberTenantIdHint: string;
  consolidationMemberOwnershipPercent: string;
  consolidationMemberIncludeFrom: string;
  consolidationAddMemberButton: string;
  consolidationMemberAddedToast: string;
  consolidationMemberStatusRemoved: string;
  consolidationUpdateMemberTitle: string;
  consolidationMemberUpdateAction: string;
  consolidationMemberRemoveAction: string;
  consolidationMemberUpdatedToast: string;
  consolidationGroupEliminationsCard: string;
  consolidationGroupRunsCard: string;

  // eliminations log (the §2 list surface)
  eliminationsTitle: string;
  eliminationsEmpty: string;
  eliminationsFilterKind: string;
  eliminationsKindIntercompany: string;
  eliminationsKindInvestmentEquity: string;
  eliminationsColNo: string;
  eliminationsColDescription: string;
  eliminationsColLines: string;
  eliminationsColJournals: string;
  eliminationsColReversalOf: string;
  eliminationsApprovedBadge: string;
  eliminationsReverseAction: string;
  eliminationsApproveToast: string;
  eliminationsPostToast: string;
  eliminationsReverseToast: string;
  eliminationsSodHint: string;
  eliminationsPostConfirmTitle: string;
  eliminationsPostConfirmBody: string;
  eliminationsReverseConfirmTitle: string;
  eliminationsLinesTitle: string;
  eliminationsLinePurpose: string;
  eliminationsLineDirection: string;
  eliminationsLineMember: string;
  eliminationsLineMemoEn: string;
  eliminationsLineMemoAr: string;
  eliminationsPurposeArControl: string;
  eliminationsPurposeApControl: string;
  eliminationsPurposeConsolidationAdjustment: string;
  eliminationsAddLine: string;
  eliminationsRemoveLine: string;

  // elimination workspace (§4 transaction entry)
  eliminationFormKind: string;
  eliminationFormMemberA: string;
  eliminationFormMemberB: string;
  eliminationFormMemberHint: string;
  eliminationSuggestionsCard: string;
  eliminationSuggestionsButton: string;
  eliminationSuggestionsAsOf: string;
  eliminationSuggestionsEmpty: string;
  eliminationSuggestionColPartner: string;
  eliminationSuggestionColAr: string;
  eliminationSuggestionColAp: string;
  eliminationPreviewTitle: string;
  eliminationSubmitButton: string;
  eliminationCreatedToast: string;
  eliminationCreatedCard: string;

  // runs report page (§7)
  consolidationRunCreateHint: string;
  consolidationRunCreateButton: string;
  consolidationRunCreatedToast: string;
  consolidationRunExecuteAction: string;
  consolidationRunExecutedToast: string;
  consolidationRunErrorCodeCol: string;
  consolidationRunSnapshotCard: string;
  consolidationSnapshotPending: string;
  consolidationSnapshotMembersCard: string;
  consolidationSnapshotColType: string;
  consolidationSnapshotColNet: string;
  consolidationSnapshotColRates: string;
  consolidationSnapshotConsolidatedCard: string;
  consolidationSnapshotEliminationsCard: string;
  consolidationInv026Pass: string;
  consolidationInv026Fail: string;
  consolidationInv026Compared: string;

  // -- WEB-036 (PHASE-036): custom fields extensibility core ---------------------
  // the /settings/custom-fields manager (definitions + picklists + form
  // designer), the shared CustomFieldSurface and the typed-error family
  customFieldsTitle: string;
  customFieldsSubtitle: string;
  customFieldsDefinitionsTab: string;
  customFieldsPicklistsTab: string;
  customFieldsLayoutsTab: string;
  customFieldsEntityFilter: string;
  customFieldsAllEntities: string;
  customFieldsColEntity: string;
  customFieldsColKey: string;
  customFieldsColLabel: string;
  customFieldsColDataType: string;
  customFieldsColRequired: string;
  customFieldsColOptions: string;
  customFieldsColVersion: string;
  customFieldsColOrder: string;
  customFieldsDefinitionsNote: string;
  customFieldsEmpty: string;
  customFieldsAddField: string;
  customFieldsCreateTitle: string;
  customFieldsEditTitle: string;
  customFieldsEntityLabel: string;
  customFieldsEntityPlaceholder: string;
  customFieldsKeyLabel: string;
  customFieldsKeyHint: string;
  customFieldsLabelEn: string;
  customFieldsLabelAr: string;
  customFieldsDataTypeLabel: string;
  customFieldsTypeText: string;
  customFieldsTypeNumber: string;
  customFieldsTypeDate: string;
  customFieldsTypeBoolean: string;
  customFieldsTypeSelect: string;
  customFieldsTypeMultiselect: string;
  customFieldsTypeReference: string;
  customFieldsPicklistLabel: string;
  customFieldsPicklistPlaceholder: string;
  customFieldsReferenceEntityLabel: string;
  customFieldsPrecisionLabel: string;
  customFieldsPrecisionHint: string;
  customFieldsRequiredLabel: string;
  customFieldsValidationTitle: string;
  customFieldsValidationTextOnly: string;
  customFieldsValidationNumberOnly: string;
  customFieldsRegexLabel: string;
  customFieldsMinLengthLabel: string;
  customFieldsMaxLengthLabel: string;
  customFieldsMinValueLabel: string;
  customFieldsMaxValueLabel: string;
  customFieldsImmutableNote: string;
  customFieldsCreatedToast: string;
  customFieldsSavedToast: string;
  customFieldsArchivedToast: string;
  customFieldsRestoredToast: string;
  customFieldsArchiveAction: string;
  customFieldsRestoreAction: string;
  customFieldsArchiveConfirm: string;
  customFieldsPicklistsNote: string;
  customFieldsPicklistsEmpty: string;
  customFieldsPicklistCreateTitle: string;
  customFieldsPicklistNameEn: string;
  customFieldsPicklistNameAr: string;
  customFieldsPicklistKeyHint: string;
  customFieldsPicklistCreatedToast: string;
  customFieldsPicklistSavedToast: string;
  customFieldsPicklistArchivedToast: string;
  customFieldsPicklistRestoredToast: string;
  customFieldsManageOptions: string;
  customFieldsOptionsTitle: string;
  customFieldsPicklistOptionsForTitle: string;
  customFieldsOptionsEmpty: string;
  customFieldsOptionLabelEn: string;
  customFieldsOptionLabelAr: string;
  customFieldsOptionAdd: string;
  customFieldsOptionAddedToast: string;
  customFieldsOptionSavedToast: string;
  customFieldsOptionArchivedToast: string;
  customFieldsOptionRestoredToast: string;
  customFieldsOptionMoveUp: string;
  customFieldsOptionMoveDown: string;
  customFieldsOptionsReorderedToast: string;
  customFieldsOptionEdit: string;
  customFieldsLayoutsNote: string;
  customFieldsLayoutsEmpty: string;
  customFieldsLayoutEntityLabel: string;
  customFieldsLayoutDefaultLabel: string;
  customFieldsLayoutDefaultBadge: string;
  customFieldsLayoutRoleLabel: string;
  customFieldsLayoutNewOverride: string;
  customFieldsLayoutOverrideBadge: string;
  customFieldsLayoutOverridesList: string;
  customFieldsLayoutEditingDefault: string;
  customFieldsLayoutEditingOverride: string;
  customFieldsLayoutNameLabel: string;
  customFieldsLayoutNoLayout: string;
  customFieldsLayoutDefaultNote: string;
  customFieldsLayoutOverrideNote: string;
  customFieldsLayoutSectionsTitle: string;
  customFieldsLayoutAddSection: string;
  customFieldsLayoutSectionNew: string;
  customFieldsLayoutSectionLabelEn: string;
  customFieldsLayoutSectionLabelAr: string;
  customFieldsLayoutSectionUp: string;
  customFieldsLayoutSectionDown: string;
  customFieldsLayoutRemoveSection: string;
  customFieldsLayoutCollapsedLabel: string;
  customFieldsLayoutColumnsLabel: string;
  customFieldsLayoutFieldsTitle: string;
  customFieldsLayoutAddField: string;
  customFieldsLayoutFieldPlaceholder: string;
  customFieldsNativeFieldsGroup: string;
  customFieldsCustomFieldsGroup: string;
  customFieldsLayoutFieldNative: string;
  customFieldsLayoutFieldCustom: string;
  customFieldsLayoutMandatoryBadge: string;
  customFieldsLayoutLockHint: string;
  customFieldsLayoutFieldUp: string;
  customFieldsLayoutFieldDown: string;
  customFieldsLayoutRemoveField: string;
  customFieldsLayoutSavedToast: string;
  customFieldsLayoutOverrideSavedToast: string;
  customFieldsLayoutDeleteOverride: string;
  customFieldsLayoutOverrideDeletedToast: string;
  customFieldsRoleOwner: string;
  customFieldsRoleAccountant: string;
  customFieldsRoleSales: string;
  customFieldsRolePurchasing: string;
  customFieldsRoleWarehouse: string;
  customFieldsRoleCashier: string;
  customFieldsRoleViewer: string;
  customFieldsRolePayrollOfficer: string;
  customFieldsErrorKeyTaken: string;
  customFieldsErrorKeyInvalid: string;
  customFieldsErrorConfigInvalid: string;
  customFieldsErrorEntityUnknown: string;
  customFieldsErrorValidationMismatch: string;
  customFieldsErrorNotFound: string;
  customFieldsErrorArchived: string;
  customFieldsErrorUnknownKey: string;
  customFieldsErrorRequired: string;
  customFieldsErrorValueInvalid: string;
  customFieldsErrorImmutable: string;
  customFieldsErrorPicklistKeyTaken: string;
  customFieldsErrorPicklistNotFound: string;
  customFieldsErrorPicklistOptionNotFound: string;
  customFieldsErrorPicklistArchived: string;
  customFieldsErrorPicklistOrderInvalid: string;
  customFieldsErrorLayoutNotFound: string;
  customFieldsErrorLayoutInvalid: string;
  customFieldsErrorLayoutProtected: string;
  customFieldsErrorLayoutProtectedHint: string;
  customFieldsFormSectionTitle: string;
  customFieldsFormSectionDescription: string;
  customFieldsYesOption: string;
  customFieldsNoOption: string;
  customFieldsSelectEmpty: string;
  customFieldsMultiselectEmpty: string;
  customFieldsReferenceHint: string;
  // -- WEB-038 (PHASE-038): procurement sourcing & supplier collaboration ------
  // the back-office sourcing screens (/purchasing/rfq, /purchasing/
  // blanket-orders, /purchasing/supplier-scorecards, /purchasing/capex-
  // requests) over the purchasing sourcing routes (matrix §3.16; the
  // seeded keys purchasing.rfqs.* / purchasing.suppliers.rate /
  // purchasing.capex.*). The supplier-facing portal needs NO screen.
  navPurchasing: string;
  sourcingRfqsNav: string;
  sourcingBlanketNav: string;
  sourcingScorecardsNav: string;
  sourcingCapexNav: string;
  sourcingRfqTitle: string;
  sourcingRfqSubtitle: string;
  sourcingBlanketTitle: string;
  sourcingBlanketSubtitle: string;
  sourcingScorecardsTitle: string;
  sourcingScorecardsSubtitle: string;
  sourcingCapexTitle: string;
  sourcingCapexSubtitle: string;
  sourcingRfqsTab: string;
  sourcingQuotesTab: string;
  sourcingComparisonTab: string;
  sourcingColRfqNo: string;
  sourcingColTitle: string;
  sourcingColMode: string;
  sourcingColStatus: string;
  sourcingColDue: string;
  sourcingColQuotes: string;
  sourcingColQuoteRef: string;
  sourcingColSubmitted: string;
  sourcingColSubmittedVia: string;
  sourcingColExpires: string;
  sourcingColBlanketNo: string;
  sourcingColValidity: string;
  sourcingColReleased: string;
  sourcingColProgress: string;
  sourcingColWindow: string;
  sourcingColDelivery: string;
  sourcingColQuality: string;
  sourcingColPrice: string;
  sourcingColOverall: string;
  sourcingColSample: string;
  sourcingColRequestNo: string;
  sourcingColAmount: string;
  sourcingColBudgetEval: string;
  sourcingColLine: string;
  sourcingColOfferSupplier: string;
  sourcingColOfferPrice: string;
  sourcingColLineTotal: string;
  sourcingColLeadTime: string;
  sourcingColWeighted: string;
  sourcingColWinner: string;
  sourcingModeOpen: string;
  sourcingModeInvited: string;
  sourcingStatusRfqDraft: string;
  sourcingStatusRfqIssued: string;
  sourcingStatusRfqQuoted: string;
  sourcingStatusRfqAwarded: string;
  sourcingStatusRfqClosed: string;
  sourcingStatusRfqCancelled: string;
  sourcingStatusQuoteSubmitted: string;
  sourcingStatusQuoteWithdrawn: string;
  sourcingViaPortal: string;
  sourcingViaBackOffice: string;
  sourcingStatusComparisonPrepared: string;
  sourcingStatusComparisonAwarded: string;
  sourcingStatusComparisonCancelled: string;
  sourcingStatusBlanketActive: string;
  sourcingStatusBlanketExpired: string;
  sourcingStatusBlanketClosed: string;
  sourcingStatusBlanketCancelled: string;
  sourcingStatusApproved: string;
  sourcingStatusSuspended: string;
  sourcingStatusCapexDraft: string;
  sourcingStatusCapexPending: string;
  sourcingStatusCapexApproved: string;
  sourcingStatusCapexConverted: string;
  sourcingStatusCapexRejected: string;
  sourcingStatusCapexCancelled: string;
  sourcingBudgetModeOff: string;
  sourcingBudgetModeAdvisory: string;
  sourcingBudgetModeEnforce: string;
  sourcingFormTitle: string;
  sourcingFormTitleAr: string;
  sourcingFormMode: string;
  sourcingFormCurrency: string;
  sourcingFormDue: string;
  sourcingFormInvitedSuppliers: string;
  sourcingFormTargetPrice: string;
  sourcingFormOptional: string;
  sourcingFormQuoteRef: string;
  sourcingFormLeadTime: string;
  sourcingFormValidUntil: string;
  sourcingFormRfqLine: string;
  sourcingFormExpiresAt: string;
  sourcingFormBranch: string;
  sourcingFormAccount: string;
  sourcingFormDescription: string;
  sourcingFormEstimatedAmount: string;
  sourcingFormNeededBy: string;
  sourcingFormContractId: string;
  sourcingFormValidFrom: string;
  sourcingFormValidTo: string;
  sourcingFormMinCommitment: string;
  sourcingFormMaxCommitment: string;
  sourcingFormPriceLock: string;
  sourcingFormWindowDays: string;
  sourcingFormStatus: string;
  sourcingFormExpires: string;
  sourcingFormReason: string;
  sourcingActionCreate: string;
  sourcingActionEdit: string;
  sourcingActionIssue: string;
  sourcingActionCancel: string;
  sourcingActionClose: string;
  sourcingActionCompare: string;
  sourcingActionAward: string;
  sourcingActionCancelComparison: string;
  sourcingActionMintInvite: string;
  sourcingActionRecompute: string;
  sourcingActionRelease: string;
  sourcingActionSubmit: string;
  sourcingActionApprove: string;
  sourcingActionReject: string;
  sourcingActionBack: string;
  sourcingActionCopy: string;
  sourcingActionCopyDone: string;
  sourcingActionDismiss: string;
  sourcingActionViewQuotes: string;
  sourcingQuotesFor: string;
  sourcingQuotesEmpty: string;
  sourcingQuotesPickFirst: string;
  sourcingQuoteFormTitle: string;
  sourcingLeadTimeDays: string;
  sourcingInviteTitle: string;
  sourcingInviteExpiresHint: string;
  sourcingInviteTokenTitle: string;
  sourcingInviteTokenOnce: string;
  sourcingComparisonNone: string;
  sourcingComparisonPrepareHint: string;
  sourcingComparisonPreparedAt: string;
  sourcingComparisonAwardHint: string;
  sourcingComparisonAwardedDocs: string;
  sourcingDocKindPo: string;
  sourcingDocKindRelease: string;
  sourcingReleaseTitle: string;
  sourcingReleasedOf: string;
  sourcingApprovedItemsTitle: string;
  sourcingApprovedItemsEmpty: string;
  sourcingRfqsEmpty: string;
  sourcingBlanketEmpty: string;
  sourcingScorecardsEmpty: string;
  sourcingCapexEmpty: string;
  sourcingConfirmIssue: string;
  sourcingConfirmCancel: string;
  sourcingConfirmClose: string;
  sourcingConfirmAward: string;
  sourcingConfirmRelease: string;
  sourcingConfirmRecompute: string;
  sourcingToastCreated: string;
  sourcingToastDone: string;
  sourcingToastCopied: string;
  sourcingErrState: string;
  sourcingErrThreeBid: string;
  sourcingErrOverRelease: string;
  sourcingErrDuePassed: string;
  sourcingErrNotInvited: string;
  sourcingErrCurrencyMismatch: string;
  sourcingErrNoQuotes: string;

  // -- WEB-039 (PHASE-039): returns & collections -----------------------------
  // the returns & collections surfaces (/sales/returns with the warranties
  // tab, /sales/dunning, /purchasing/returns) over the 0055/0057/0059
  // routes (matrix §3.2/§3.3; the seeded sales.rma.* / sales.warranties /
  // sales.dunning.* / sales.late-fees / sales.collection-agencies /
  // purchasing.rma.* keys).
  returnsNav: string;
  dunningNav: string;
  supplierReturnsNav: string;
  returnsTitle: string;
  returnsSubtitle: string;
  dunningTitle: string;
  dunningSubtitle: string;
  supplierReturnsTitle: string;
  supplierReturnsSubtitle: string;
  returnsTabRmas: string;
  returnsTabWarranties: string;
  dunningTabLetters: string;
  dunningTabPolicies: string;
  dunningTabActions: string;
  dunningTabReviews: string;
  dunningTabAgencies: string;
  returnsColRmaNo: string;
  returnsColPartner: string;
  returnsColInvoice: string;
  returnsColStatus: string;
  returnsColDisposition: string;
  returnsColTotal: string;
  returnsColRequested: string;
  returnsColCompleted: string;
  returnsColLine: string;
  returnsColItem: string;
  returnsColQty: string;
  returnsColUnitPrice: string;
  returnsColNet: string;
  returnsColTax: string;
  returnsColNote: string;
  returnsStatusRequested: string;
  returnsStatusApproved: string;
  returnsStatusReceived: string;
  returnsStatusInspected: string;
  returnsStatusRestocked: string;
  returnsStatusScrapped: string;
  returnsStatusRefunded: string;
  returnsStatusCancelled: string;
  returnsDispositionRestock: string;
  returnsDispositionScrap: string;
  returnsDispositionRefund: string;
  returnsDispositionNone: string;
  returnsReasonDamaged: string;
  returnsReasonDefective: string;
  returnsReasonWrongItem: string;
  returnsReasonLateDelivery: string;
  returnsReasonCustomerRemorse: string;
  returnsReasonOverShipment: string;
  returnsReasonExpired: string;
  returnsReasonRecall: string;
  returnsReasonOther: string;
  returnsFormInvoice: string;
  returnsFormPickInvoice: string;
  returnsFormReasonCode: string;
  returnsFormReason: string;
  returnsFormReasonAr: string;
  returnsFormNote: string;
  returnsFormInvoiceLine: string;
  returnsActionCreate: string;
  returnsActionView: string;
  returnsActionApprove: string;
  returnsActionReceive: string;
  returnsActionInspect: string;
  returnsActionComplete: string;
  returnsActionCancel: string;
  returnsActionVoid: string;
  returnsCreateTitle: string;
  returnsDetailTitle: string;
  returnsInspectTitle: string;
  returnsCompleteTitle: string;
  returnsCancelReasonLabel: string;
  returnsCashAccountLabel: string;
  returnsRefundHint: string;
  returnsInvoiceHint: string;
  returnsConfirmApprove: string;
  returnsConfirmReceive: string;
  returnsConfirmComplete: string;
  returnsConfirmCancel: string;
  returnsToastCreated: string;
  returnsToastDone: string;
  returnsRmasEmpty: string;
  returnsInvoiceLinesEmpty: string;
  returnsColSerial: string;
  returnsColStart: string;
  returnsColEnd: string;
  returnsColCoverage: string;
  returnsColDuration: string;
  returnsColMileage: string;
  returnsWarrantyActive: string;
  returnsWarrantyExpired: string;
  returnsWarrantyVoid: string;
  returnsCoverageRepair: string;
  returnsCoverageReplace: string;
  returnsCoverageRefund: string;
  returnsCoverageLaborOnly: string;
  returnsCoveragePartsOnly: string;
  returnsBasisInvoiceDate: string;
  returnsBasisDeliveryDate: string;
  returnsDurationMonths: string;
  returnsMileageKm: string;
  returnsWarrantyCreateTitle: string;
  returnsFormSerial: string;
  returnsFormStart: string;
  returnsFormDuration: string;
  returnsFormCoverage: string;
  returnsFormBasis: string;
  returnsFormMileageOptional: string;
  returnsFormInvoiceOptional: string;
  returnsConfirmVoid: string;
  returnsWarrantiesEmpty: string;
  returnsErrState: string;
  returnsErrQtyExceeds: string;
  returnsErrDisposition: string;
  returnsErrScrapUnmapped: string;
  returnsErrWarrantyTerms: string;
  dunningColPartner: string;
  dunningColInvoice: string;
  dunningColStep: string;
  dunningColDays: string;
  dunningColChannel: string;
  dunningColLetterDate: string;
  dunningColSent: string;
  dunningColSubject: string;
  dunningColFee: string;
  dunningColFeeInvoice: string;
  dunningColWaiver: string;
  dunningChannelEmail: string;
  dunningChannelWhatsapp: string;
  dunningChannelSms: string;
  dunningLetterQueued: string;
  dunningLetterSent: string;
  dunningLetterFailed: string;
  dunningFeeWaived: string;
  dunningDaysValue: string;
  dunningActionRunSweep: string;
  dunningSweepHint: string;
  dunningSweepAsOfLabel: string;
  dunningSweepResult: string;
  dunningActionChargeFee: string;
  dunningActionWaiveFee: string;
  dunningWaiveTitle: string;
  dunningWaiveReasonLabel: string;
  dunningConfirmCharge: string;
  dunningConfirmWaive: string;
  dunningToastSweepDone: string;
  dunningPolicyDraft: string;
  dunningPolicyActive: string;
  dunningPolicyArchived: string;
  dunningFeeModeDisabled: string;
  dunningFeeModeContractRate: string;
  dunningFeeModeStatutoryCap: string;
  dunningDefaultBadge: string;
  dunningEscalateBadge: string;
  dunningReferAgencyBadge: string;
  dunningLadderTitle: string;
  dunningLateFeeTitle: string;
  dunningLateFeeRateLabel: string;
  dunningLateFeeGraceLabel: string;
  dunningLateFeeMaxLabel: string;
  dunningPolicyCreateTitle: string;
  dunningFormPolicyName: string;
  dunningFormPolicyNameAr: string;
  dunningFormIsDefault: string;
  dunningFormStepNo: string;
  dunningFormDaysOverdue: string;
  dunningFormChannel: string;
  dunningFormTemplateKey: string;
  dunningFormEscalate: string;
  dunningFormReferToAgency: string;
  dunningAddStep: string;
  dunningRemoveStep: string;
  dunningFormFeeMode: string;
  dunningFormRatePct: string;
  dunningFormGraceDays: string;
  dunningFormMaxAmount: string;
  dunningFormFeeSource: string;
  dunningActionCreatePolicy: string;
  dunningActionActivate: string;
  dunningActionArchive: string;
  dunningConfirmActivate: string;
  dunningConfirmArchive: string;
  dunningActionTypeCall: string;
  dunningActionTypeEmail: string;
  dunningActionTypePromiseToPay: string;
  dunningActionTypeDispute: string;
  dunningActionTypeFieldVisit: string;
  dunningActionTypePaymentPlan: string;
  dunningActionTypeWriteOffRequest: string;
  dunningActionTypeAgencyReferral: string;
  dunningActionTypeOther: string;
  dunningOutcomePending: string;
  dunningOutcomePromised: string;
  dunningOutcomeBroken: string;
  dunningOutcomePaid: string;
  dunningOutcomeEscalated: string;
  dunningOutcomeNoAnswer: string;
  dunningOutcomeOther: string;
  dunningColActionType: string;
  dunningColActionDate: string;
  dunningColOutcome: string;
  dunningColPromised: string;
  dunningColAmount: string;
  dunningActionLogTitle: string;
  dunningFormActionType: string;
  dunningFormActionDate: string;
  dunningFormOutcome: string;
  dunningFormPromisedDate: string;
  dunningFormFollowUpDate: string;
  dunningFormAmount: string;
  dunningFormNote: string;
  dunningPromiseDateHint: string;
  dunningFormInvoiceOptional: string;
  dunningColCode: string;
  dunningColClass: string;
  dunningColNextReview: string;
  dunningColLastReview: string;
  dunningNoClass: string;
  dunningRecordReviewTitle: string;
  dunningFormScoreClass: string;
  dunningFormNextReview: string;
  dunningFormReviewNote: string;
  dunningAgencyActive: string;
  dunningAgencySuspended: string;
  dunningColAgency: string;
  dunningColContact: string;
  dunningColCommissionMode: string;
  dunningColCommissionPct: string;
  dunningColFlatFee: string;
  dunningColTokenIssued: string;
  dunningColReferralDate: string;
  dunningColReferredAmount: string;
  dunningColSettledAmount: string;
  dunningColCommissionAmount: string;
  dunningCommissionPctOfCollected: string;
  dunningCommissionFlatFee: string;
  dunningAgencyCreateTitle: string;
  dunningFormContactName: string;
  dunningFormEmail: string;
  dunningFormPhone: string;
  dunningFormCommissionMode: string;
  dunningActionIssueToken: string;
  dunningActionSuspend: string;
  dunningAgencyTokenTitle: string;
  dunningAgencyTokenOnce: string;
  dunningConfirmIssueToken: string;
  dunningConfirmSuspend: string;
  dunningReferralReferred: string;
  dunningReferralAcknowledged: string;
  dunningReferralPartial: string;
  dunningReferralSettled: string;
  dunningReferralCommissionPosted: string;
  dunningReferralClosed: string;
  dunningReferralCancelled: string;
  dunningReferralCreateTitle: string;
  dunningSettleTitle: string;
  dunningFormAgency: string;
  dunningFormPartner: string;
  dunningFormReferredAmount: string;
  dunningFormReferralDate: string;
  dunningFormSettledAmount: string;
  dunningActionRefer: string;
  dunningActionSettle: string;
  dunningActionPostCommission: string;
  dunningActionCloseReferral: string;
  dunningConfirmPostCommission: string;
  dunningConfirmClose: string;
  dunningToastDone: string;
  dunningLettersEmpty: string;
  dunningPoliciesEmpty: string;
  dunningActionsEmpty: string;
  dunningReviewsEmpty: string;
  dunningAgenciesEmpty: string;
  dunningReferralsEmpty: string;
  dunningErrSteps: string;
  dunningErrLateFee: string;
  dunningErrFeeAlreadyCharged: string;
  dunningErrFeeNotWaivable: string;
  dunningErrReview: string;
  dunningErrReferralState: string;
  dunningErrCommissionUnmapped: string;
  srmaColNo: string;
  srmaColSupplier: string;
  srmaColPo: string;
  srmaColTotal: string;
  srmaColRequested: string;
  srmaColLine: string;
  srmaColItem: string;
  srmaColQty: string;
  srmaColUnitCost: string;
  srmaColNet: string;
  srmaStatusRequested: string;
  srmaStatusApproved: string;
  srmaStatusShipped: string;
  srmaStatusCredited: string;
  srmaStatusCancelled: string;
  srmaActionCreate: string;
  srmaActionView: string;
  srmaActionApprove: string;
  srmaActionShip: string;
  srmaActionCredit: string;
  srmaActionCancel: string;
  srmaCreateTitle: string;
  srmaDetailTitle: string;
  srmaShipTitle: string;
  srmaFormPo: string;
  srmaFormPickPo: string;
  srmaFormPoLine: string;
  srmaFormWarehouse: string;
  srmaConfirmApprove: string;
  srmaConfirmShip: string;
  srmaConfirmCredit: string;
  srmaConfirmCancel: string;
  srmaToastCreated: string;
  srmaToastDone: string;
  srmaEmpty: string;
  srmaLinesEmpty: string;
  srmaErrState: string;
  srmaErrQtyExceeds: string;
  srmaErrUnmapped: string;
  // -- PHASE-041 (T-10): the communications hub surfaces ---------------------
  commTitle: string;
  commSubtitle: string;
  commTabTemplates: string;
  commTabProviders: string;
  commTabDefaults: string;
  commTemplatesHint: string;
  commTplColKey: string;
  commTplColChannel: string;
  commTplColLocale: string;
  commTplColModule: string;
  commTplColStatus: string;
  commTplColAction: string;
  commTplChannelEmail: string;
  commTplChannelWhatsapp: string;
  commTplChannelSms: string;
  commTplOverrideBadge: string;
  commTplBuiltinBadge: string;
  commTplActive: string;
  commTplInactive: string;
  commTplEditBtn: string;
  commTplPreviewBtn: string;
  commTplDeleteBtn: string;
  commTplDeletedToast: string;
  commTplEditorNewTitle: string;
  commTplEditorEditTitle: string;
  commTplFormKey: string;
  commTplFormModule: string;
  commTplFormSubject: string;
  commTplFormBody: string;
  commTplFormVars: string;
  commTplFormActive: string;
  commTplSaveBtn: string;
  commTplSavedToast: string;
  commTplCancelBtn: string;
  commTplPreviewTitle: string;
  commTplPreviewVarsHint: string;
  commTplPreviewRunBtn: string;
  commTplPreviewSubject: string;
  commTplPreviewBody: string;
  commTplPreviewWhatsappParams: string;
  commTplErrInvalid: string;
  commProvidersHint: string;
  commProvColProvider: string;
  commProvColChannel: string;
  commProvColStatus: string;
  commProvColAction: string;
  commProvSelectLabel: string;
  commProvSelectSandbox: string;
  commProvLiveBadge: string;
  commProvSandboxBadge: string;
  commProvBlockedBadge: string;
  commProvRequiresVerification: string;
  commProvCredsTitle: string;
  commProvCredsHint: string;
  commProvCredsConfigured: string;
  commProvCredsNotConfigured: string;
  commProvCredSaveBtn: string;
  commProvCredsSavedToast: string;
  commProvMarketsTitle: string;
  commProvMarketsHint: string;
  commProvMarketCodeLabel: string;
  commProvMarketWhatsappId: string;
  commProvMarketSmsSender: string;
  commProvMarketEmailFrom: string;
  commProvMarketRemoveBtn: string;
  commProvMarketAddBtn: string;
  commProvCapTitle: string;
  commProvCapHint: string;
  commProvCapLabel: string;
  commProvCapSavedToast: string;
  commDefaultsHint: string;
  commPrefColModule: string;
  commPrefChInApp: string;
  commPrefChEmail: string;
  commPrefChSms: string;
  commPrefChWhatsapp: string;
  commPrefSavedToast: string;
  commInboxTitle: string;
  commInboxSubtitle: string;
  commInboxTabTimeline: string;
  commInboxTabCall: string;
  commInboxTabPrefs: string;
  commInboxFilterKind: string;
  commInboxFilterChannel: string;
  commInboxFilterDirection: string;
  commInboxFilterAll: string;
  commInboxKindMessage: string;
  commInboxKindCall: string;
  commInboxDirInbound: string;
  commInboxDirOutbound: string;
  commInboxColAt: string;
  commInboxColKind: string;
  commInboxColChannel: string;
  commInboxColCounterparty: string;
  commInboxColSummary: string;
  commInboxColOutcome: string;
  commInboxColDuration: string;
  commInboxColUser: string;
  commInboxEmpty: string;
  commInboxRefresh: string;
  commInboxDurationValue: string;
  commCallFormTitle: string;
  commCallFormHint: string;
  commCallPartnerLabel: string;
  commCallDirectionLabel: string;
  commCallOutcomeLabel: string;
  commCallSummaryLabel: string;
  commCallBodyLabel: string;
  commCallDurationLabel: string;
  commCallAtLabel: string;
  commCallSubmitBtn: string;
  commCallLoggedToast: string;
  commCallOutcomeCompleted: string;
  commCallOutcomeNoAnswer: string;
  commCallOutcomeBusy: string;
  commCallOutcomeVoicemail: string;
  commCallOutcomeFailed: string;
  commCallOutcomeScheduled: string;
  commCallErrInvalid: string;
  commMyPrefsTitle: string;
  commMyPrefsHint: string;
  commMyPrefsExplicitBadge: string;
  commMyPrefsInheritNote: string;
  commMyPrefsSavedToast: string;
  commPrefModuleLimits: string;
  commPrefModuleSubscription: string;
  commPrefModuleReconciliation: string;
  commPrefModuleInvoiceOverdue: string;
  commPrefModuleStock: string;
  commPrefModuleTemplates: string;
  commPrefModuleCrm: string;
  commPrefModuleEinvoicing: string;
  commPrefModuleNotes: string;
  commPrefModuleInstallments: string;
  commPrefModuleBudgeting: string;
  commPrefModulePurchasing: string;
  commPrefModuleCollections: string;
  commPrefModuleWarranties: string;
  commPrefModuleDigest: string;
}

const ar: Dictionary = {
  appTitle: "منصة الأعمال الشاملة",
  switchLabel: "English",
  signOut: "تسجيل الخروج",
  loading: "جارٍ التحميل...",
  phaseNote: "واجهة المرحلة 003 (PHASE-003) — الدخول والجلسات والشاشات الإدارية عبر وسيط الويب الآمن (BFF).",

  navHome: "الرئيسية",
  navUsers: "المستخدمون والدعوات",
  navSessions: "الجلسات",
  navMfa: "التحقق بخطوتين",
  navRoles: "الأدوار",
  navPassword: "كلمة المرور",

  loginTitle: "تسجيل الدخول",
  loginSubtitle: "أدخل بيانات حسابك للوصول إلى المنصة.",
  loginEmailLabel: "البريد الإلكتروني",
  loginPasswordLabel: "كلمة المرور",
  loginMfaLabel: "رمز التحقق (MFA)",
  loginMfaHint: "ستة أرقام من تطبيق المصادقة.",
  loginMfaShow: "إظهار حقل رمز التحقق",
  loginMfaHide: "إخفاء حقل رمز التحقق",
  loginSubmit: "دخول",
  loginForgotLink: "نسيت كلمة المرور؟",
  loginNoAccount: "لا تملك حسابًا؟",
  loginErrorInvalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  loginErrorMfaRequired: "هذا الحساب محمي بالتحقق بخطوتين — أدخل رمز التحقق.",
  loginErrorMfaBootstrapIneligible:
    "لا يمكن استخدام مسار التسجيل الإجباري لهذا الحساب — سجّل الدخول بالطريقة المعتادة.",
  loginErrorRateLimited: "محاولات كثيرة — أعد المحاولة بعد {seconds} ثانية.",
  loginErrorAccountLocked: "الحساب مقفل مؤقتًا — أعد المحاولة بعد {seconds} ثانية.",
  loginErrorGeneric: "تعذّر تسجيل الدخول — حاول مرة أخرى.",

  forgotTitle: "استعادة كلمة المرور",
  forgotDescription: "أدخل بريدك الإلكتروني، وستصلك رسالة برابط إعادة التعيين إذا كان الحساب مسجلًا.",
  forgotEmailLabel: "البريد الإلكتروني",
  forgotSubmit: "إرسال رابط الاستعادة",
  forgotSuccess: "إذا كان هذا البريد مسجلًا لدينا فستصله رسالة تحتوي رابط إعادة التعيين.",
  forgotBack: "العودة إلى تسجيل الدخول",

  acceptTitle: "قبول الدعوة",
  acceptTenantLabel: "المنشأة",
  acceptRoleLabel: "الدور",
  acceptEmailLabel: "البريد الإلكتروني المدعو",
  acceptFullNameLabel: "الاسم الكامل",
  acceptPasswordLabel: "كلمة مرور جديدة",
  acceptPasswordHint: "10 أحرف على الأقل.",
  acceptSubmit: "إنشاء الحساب والدخول",
  acceptErrorExpired: "انتهت صلاحية هذه الدعوة.",
  acceptErrorRevoked: "تم إلغاء هذه الدعوة.",
  acceptErrorAccepted: "تم استخدام هذه الدعوة مسبقًا.",
  acceptErrorNotFound: "رابط الدعوة غير صالح.",
  acceptErrorGeneric: "تعذّر قبول الدعوة.",

  homeWelcome: "مرحبًا، {name}",
  homeTenantLabel: "المنشأة النشطة",
  homeSwitchTenant: "تبديل المنشأة",
  homeRoleLabel: "دورك الحالي",
  homePermissionsLabel: "عدد الصلاحيات الممنوحة: {count}",
  homeScreens: "الشاشات الإدارية",

  usersTitle: "المستخدمون والدعوات",
  usersNoPermission: "ليست لديك صلاحية عرض هذه الشاشة.",
  usersColEmail: "البريد الإلكتروني",
  usersColName: "الاسم",
  usersColRole: "الدور",
  usersColStatus: "الحالة",
  usersColLastLogin: "آخر دخول",
  usersNever: "لم يسجل الدخول بعد",
  usersEmpty: "لا يوجد مستخدمون في هذه المنشأة بعد.",
  usersInviteTitle: "دعوة مستخدم",
  usersInviteEmailLabel: "بريد المدعو",
  usersInviteRoleLabel: "الدور عند الانضمام",
  usersInviteSubmit: "إرسال دعوة",
  usersInviteLinkTitle: "رابط القبول (بيئة التطوير — لا يوجد إرسال بريد فعلي):",
  usersInviteExpiresLabel: "تنتهي في:",
  usersInvitationsTitle: "الدعوات",
  usersColExpires: "تنتهي في",
  usersColActions: "إجراءات",
  usersRevoke: "إلغاء",
  usersNoRoles: "لا توجد أدوار متاحة للإسناد.",
  usersEmptyInvitations: "لا توجد دعوات.",

  statusActive: "نشط",
  statusPending: "معلّق",
  statusRevoked: "ملغى",
  statusExpired: "منتهي",
  statusAccepted: "مقبول",
  statusSuspended: "موقوف",

  sessionsTitle: "الجلسات النشطة",
  sessionsHint: "إلغاء أي جلسة يخرج صاحبها فورًا؛ ولإخراج نفسك من كل الأجهزة ألغِ جلساتك واحدة تلو الأخرى.",
  sessionsColUser: "المستخدم",
  sessionsColCreated: "بدأت في",
  sessionsColExpires: "تنتهي في",
  sessionsColLastSeen: "آخر نشاط",
  sessionsColIp: "عنوان IP",
  sessionsRevoke: "إلغاء الجلسة",
  sessionsEmpty: "لا توجد جلسات نشطة.",

  mfaTitle: "التحقق بخطوتين (TOTP)",
  mfaDescription: "اربط تطبيق مصادقة بحسابك، وأكّد الرمز، ثم أنشئ رموز الاستعادة.",
  mfaEnrollTitle: "1) بدء التسجيل",
  mfaEnrollButton: "بدء التسجيل",
  mfaSecretLabel: "المفتاح السري (أدخله يدويًا في تطبيق المصادقة):",
  mfaOtpauthLabel: "بيانات الربط otpauth (محتوى رمز QR):",
  mfaEnrollHint: "أدخل الرمز الحالي من تطبيق المصادقة لتأكيد التسجيل.",
  mfaVerifyTitle: "2) تأكيد الرمز",
  mfaVerifyCodeLabel: "رمز التحقق",
  mfaVerifySubmit: "تأكيد",
  mfaVerified: "تم تفعيل التحقق بخطوتين بنجاح.",
  mfaRecoveryTitle: "3) رموز الاستعادة",
  mfaRecoveryDescription: "تُعرض رموز الاستعادة مرة واحدة فقط — احفظها الآن في مكان آمن.",
  mfaRecoveryGenerate: "إنشاء رموز الاستعادة",
  mfaRecoveryRegenerate: "إعادة إنشاء الرموز",
  mfaInvalidCode: "رمز التحقق غير صحيح.",
  mfaNeedConfirmed: "أكّد التسجيل أولًا ثم أنشئ رموز الاستعادة.",
  mfaEnforcedNotice:
    "مؤسستك تفرض التحقق بخطوتين — أكمل التسجيل للمتابعة. تنتهي صلاحية هذه الجلسة خلال 15 دقيقة.",

  rolesTitle: "الأدوار",
  rolesDescription: "استنسخ قالبًا معياريًا لإنشاء دور خاص بمنشأتك.",
  rolesTenantTitle: "أدوار المنشأة",
  rolesTemplatesTitle: "القوالب المعيارية (النظام)",
  rolesColKey: "المفتاح",
  rolesColName: "الاسم",
  rolesColSystem: "دور نظام؟",
  rolesColActions: "إجراءات",
  rolesClone: "استنساخ",
  rolesCloned: "تم إنشاء الدور {name}.",
  rolesYes: "نعم",
  rolesNo: "لا",

  passwordTitle: "تغيير كلمة المرور",
  passwordDescription: "بعد التغيير تُلغى جلساتك الأخرى ويبقى هذا المتصفح مسجلًا.",
  passwordCurrentLabel: "كلمة المرور الحالية",
  passwordNextLabel: "كلمة المرور الجديدة",
  passwordNextHint: "10 أحرف على الأقل.",
  passwordSubmit: "تغيير كلمة المرور",
  passwordSuccess: "تم تغيير كلمة المرور.",
  passwordErrorCurrent: "كلمة المرور الحالية غير صحيحة.",

  errorsForbidden: "ليست لديك صلاحية تنفيذ هذا الإجراء.",
  errorsUnauthorized: "انتهت الجلسة — سجّل الدخول من جديد.",
  errorsValidation: "بيانات غير صالحة — راجع الحقول.",
  errorsNotFound: "العنصر غير موجود.",
  errorsNetwork: "تعذّر الاتصال بالخادم.",
  errorsGeneric: "حدث خطأ غير متوقع.",
  errorsRateLimited: "محاولات كثيرة — أعد المحاولة بعد {seconds} ثانية.",

  navOnboarding: "تهيئة",
  navBranches: "الفروع",
  navSettings: "الإعدادات",
  navSupport: "جلسات الدعم",
  navPlatformSection: "إدارة المنصة",
  navPlatformConsole: "المنصة",
  navPlatformAudit: "سجل المنصة",

  statusInactive: "غير نشط",
  statusClosed: "مغلقة",
  statusIssued: "مُصدر",
  statusRejected: "مرفوض",
  statusConverted: "محوّل",
  statusTerminated: "موقوفة بالإنهاء",
  taxStatusLabel: "حالة التسجيل الضريبي",
  taxStatusRegistered: "مسجّل",
  taxStatusNotRegistered: "غير مسجّل",
  taxStatusDeregistered: "ملغى التسجيل",
  taxNumberLabel: "الرقم الضريبي",
  fiscalStartMonthLabel: "شهر بداية السنة المالية",
  numberingAssignAtLabel: "إسناد أرقام المستندات",
  numberingAssignAtPosting: "عند الترحيل",
  numberingAssignAtApproval: "عند الاعتماد",
  localeArabic: "العربية",
  localeEnglish: "English",

  registerTitle: "إنشاء منشأة جديدة",
  registerSubtitle: "أنشئ حساب مالك ومنشأة جديدة في خطوة واحدة، ثم ابدأ فترة تجريبية.",
  registerBusinessNameLabel: "اسم المنشأة (بالإنجليزية)",
  registerBusinessNameArLabel: "اسم المنشأة (بالعربية، اختياري)",
  registerCountryLabel: "الدولة",
  registerCurrencyLabel: "العملة الأساس (تُشتق من الدولة)",
  registerTemplateLabel: "قالب النشاط",
  registerTaxNumberHint: "مطلوب عند اختيار «مسجّل».",
  registerOwnerSection: "حساب المالك",
  registerOwnerEmailLabel: "بريد المالك الإلكتروني",
  registerOwnerNameLabel: "الاسم الكامل للمالك",
  registerSubmit: "إنشاء المنشأة",
  registerSuccessTitle: "تم إنشاء المنشأة بنجاح",
  registerSuccessBody: "راجع بريدك الإلكتروني ({email}) ثم سجّل الدخول. تنتهي الفترة التجريبية في {date}.",
  registerGoLogin: "سجّل الدخول",
  registerLoginPrompt: "لديك حساب بالفعل؟",
  registerErrorEmailTaken: "هذا البريد الإلكتروني مسجّل مسبقًا — سجّل الدخول بدلًا من إنشاء حساب جديد.",
  registerErrorOptions: "تعذّر تحميل خيارات التسجيل (الدول والقوالب) — أعد تحميل الصفحة.",

  onboardingTitle: "تهيئة مساحة العمل",
  onboardingSubtitle:
    "تُنشئ التهيئة أدوار المنشأة ودليل الحسابات وسياسات الترقيم الافتراضية. العملية آمنة للتكرار: إعادة تشغيلها لا تُنشئ نسخًا مكررة.",
  onboardingProvisionButton: "إعداد مساحة العمل",
  onboardingResultTitle: "نتيجة التهيئة",
  onboardingRolesLabel: "الأدوار",
  onboardingAccountsLabel: "الحسابات",
  onboardingPurposesLabel: "أغراض الحسابات",
  onboardingSettingsLabel: "الإعدادات",
  onboardingCreatedCount: "جديد: {created} — موجود مسبقًا: {existing}",
  onboardingZeroDuplicatesHint:
    "لم يُنشأ أي عنصر جديد — مساحة العمل مهيأة مسبقًا، وهذا يؤكد أن إعادة التشغيل لا تُنتج تكرارات.",
  onboardingGoHome: "الذهاب إلى الرئيسية",
  onboardingGoBranches: "إدارة الفروع",

  branchesTitle: "الفروع",
  branchesEmpty: "لا توجد فروع بعد.",
  branchesColCode: "الرمز",
  branchesColName: "الاسم",
  branchesColNameAr: "الاسم العربي",
  branchesCreateTitle: "إنشاء فرع",
  branchesCodeLabel: "رمز الفرع",
  branchesNameLabel: "اسم الفرع",
  branchesNameArLabel: "الاسم العربي (اختياري)",
  branchesCreateSubmit: "إضافة الفرع",
  branchesActivate: "تنشيط",
  branchesDeactivate: "تعطيل",
  branchesErrorCodeTaken: "رمز الفرع مستخدم مسبقًا في هذه المنشأة.",

  settingsTitle: "إعدادات المنشأة",
  settingsProfileTitle: "الملف التعريفي",
  settingsNameLabel: "الاسم (بالإنجليزية)",
  settingsNameArLabel: "الاسم العربي",
  settingsTimezoneLabel: "المنطقة الزمنية",
  settingsProfileSubmit: "حفظ الملف",
  settingsProfileSaved: "تم حفظ الملف التعريفي.",
  settingsGeneralTitle: "الإعدادات العامة",
  settingsDefaultLocaleLabel: "اللغة الافتراضية",
  settingsNumeralSystemLabel: "نظام الأرقام",
  settingsNumeralLatn: "أرقام غربية (123)",
  settingsNumeralArab: "أرقام عربية (١٢٣)",
  settingsHijriLabel: "عرض التاريخ الهجري",
  settingsHijriHint: "تراكب عرض فقط — السنوات المالية تبقى ميلادية.",
  settingsFiscalNumberingTitle: "التقويم المالي والترقيم",
  settingsSupportTitle: "الدعم",
  settingsSupportOptInLabel: "السماح بجلسات الدعم",
  settingsSupportOptInWarning:
    "تنبيه: تمكين هذا الخيار يسمح لفريق المنصة بفتح جلسات دعم محدودة الوقت ومُدقّقة لقراءة بيانات منشأتك.",
  settingsTaxTitle: "التسجيل الضريبي",
  settingsTaxPairHint:
    "يُتحقق من الحالة والرقم معًا: الرقم مطلوب أثناء «مسجّل» وممنوع في غير ذلك.",
  settingsSave: "حفظ",
  settingsSaved: "تم الحفظ.",
  settingsErrorInvalidValue: "قيمة غير صالحة لهذا الإعداد.",

  // -- PHASE-024 T4: MFA policy settings card
  mfaPolicyTitle: "سياسة التحقق بخطوتين",
  mfaPolicyDescription: "حدّد الأدوار التي يُفرض عليها التحقق بخطوتين عند تسجيل الدخول.",
  mfaPolicyModeLabel: "الوضع",
  mfaPolicyModePlan: "وراثة الخطة",
  mfaPolicyModeCustom: "مخصص",
  mfaPolicyModePlanHint: "في وضع وراثة الخطة تُطبَّق الأدوار الإلزامية المحددة في خطة اشتراك منشأتك.",
  mfaPolicyModeCustomHint:
    "في الوضع المخصص تحل قائمة الأدوار أدناه محل قائمة الخطة — قائمة فارغة تعني أن التحقق اختياري للجميع.",
  mfaPolicyRolesLabel: "الأدوار المطلوب منها التحقق بخطوتين",
  mfaPolicyRolesHint:
    "اختر أدوار المنشأة التي سيُطلب منها إكمال تسجيل التحقق بخطوتين عند دخولها التالي (حتى 20 دورًا).",
  mfaPolicyRolesUnavailable: "تعذّر تحميل قائمة الأدوار — تُعرض المفاتيح المحددة حاليًا فقط.",
  mfaPolicyNoRoles: "لا توجد أدوار في هذه المنشأة بعد.",
  mfaPolicyRoleMissing: "دور محفوظ غير موجود في القائمة الحالية:",
  mfaPolicySelectedCount: "المحدد: {count} من {max}",
  mfaPolicyRolesMaxError: "الحد الأقصى {max} دورًا.",

  supportSessionsTitle: "جلسات الدعم",
  supportSessionsHint:
    "هذه الجلسات التي يفتحها فريق المنصة عند طلبك أو بموافقتك؛ يمكنك إنهاء أي جلسة نشطة قائمة على الموافقة في أي وقت.",
  supportColReason: "السبب",
  supportColTicket: "مرجع التذكرة",
  supportColOpened: "بدأت",
  supportColClosed: "أُغلقت",
  supportColOptIn: "بالموافقة؟",
  supportEmpty: "لا توجد جلسات دعم.",
  supportTerminate: "إنهاء الجلسة",
  supportErrorAccessDenied: "فتح جلسة الدعم يتطلب موافقة المنشأة أو مرجع تذكرة حادثة معلنًا.",
  supportErrorExpired: "انتهت صلاحية جلسة الدعم.",
  supportErrorNotActive: "هذه الجلسة ليست نشطة.",

  tenancyErrorFeatureNotEntitled: "هذه الميزة غير مفعّلة لمنشأتك.",
  tenancyErrorDependenciesMissing: "تفعيل الميزة يتطلب مفاتيح تابعة غير ممنوحة بعد: {keys}",

  platformConsoleTitle: "لوحة إدارة المنصة",
  platformNoAccess: "هذه منطقة إدارة المنصة — متاحة فقط لفريق عمليات المنصة.",
  platformTenantBadge: "منصة",
  platformSearchLabel: "البحث عن منشأة",
  platformSearchSubmit: "بحث",
  platformColTenant: "المنشأة",
  platformColCountry: "الدولة",
  platformColPlan: "الخطة",
  platformColCreated: "أُنشئت",
  platformEmpty: "لا توجد منشآت مطابقة.",
  platformProfileTitle: "الملف",
  platformPlanTitle: "الخطة والاشتراك",
  platformPlanCurrentLabel: "الخطة الحالية",
  platformPlanNone: "لا يوجد اشتراك نشط.",
  platformPlanAssignTitle: "تعيين خطة",
  platformPlanLabel: "الخطة",
  platformTrialDaysLabel: "أيام التجربة (اختياري)",
  platformPlanSubmit: "تعيين الخطة",
  platformPlanAssigned: "تم تعيين الخطة «{plan}» — المفاتيح الممنوحة: {count}.",
  platformEntitlementsTitle: "الميزات الممنوحة",
  platformColFeatureKey: "المفتاح",
  platformColSource: "المصدر",
  platformEntitlementsEmpty: "لا توجد ميزات ممنوحة.",
  platformGrantTitle: "منح ميزة",
  platformGrantFeatureLabel: "مفتاح الميزة",
  platformGrantSourceLabel: "المصدر",
  platformGrantExpiresLabel: "تاريخ الانتهاء",
  platformGrantExpiresHint: "مطلوب للمنح اليدوي (MANUAL).",
  platformGrantReasonLabel: "السبب",
  platformGrantSubmit: "منح",
  platformGrantDone: "تم منح الميزة.",
  platformRevoke: "سحب",
  platformRevokeReasonLabel: "سبب السحب",
  platformGrantExpiryRequired: "المنح اليدوي يتطلب تاريخ انتهاء صريحًا.",
  platformGrantUnknownKey: "مفتاح ميزة غير معروف.",
  platformMembershipsTitle: "الأعضاء",
  platformBranchesTitle: "فروع المنشأة",
  platformLifecycleTitle: "إيقاف واستعادة",
  platformReasonLabel: "السبب (مطلوب)",
  platformSuspendButton: "إيقاف المنشأة",
  platformRestoreButton: "استعادة المنشأة",
  platformSuspendDone: "تم إيقاف المنشأة — أُنهيت {count} جلسة مستخدم.",
  platformRestoreDone: "تمت استعادة المنشأة إلى الحالة النشطة.",
  platformSupportTitle: "جلسات الدعم",
  platformSupportOpenTitle: "فتح جلسة دعم",
  platformSupportReasonLabel: "السبب",
  platformSupportTicketLabel: "مرجع التذكرة (اختياري)",
  platformSupportHoursLabel: "المدة بالساعات (1-4)",
  platformSupportOpenSubmit: "فتح الجلسة",
  platformSupportClose: "إغلاق",
  platformSupportCloseReasonLabel: "سبب الإغلاق",
  platformSupportSessionLabel: "الجلسة النشطة",
  platformReadDataTitle: "قراءة بيانات المنشأة",
  platformReadResourceLabel: "المورد",
  platformReadSubmit: "قراءة",
  platformNoActiveSession: "لا توجد جلسة دعم نشطة — افتح جلسة أولًا.",
  resourceUsers: "المستخدمون",
  resourceMemberships: "العضويات",
  resourceRoles: "الأدوار",
  resourceBranches: "الفروع",
  resourceSettings: "الإعدادات",
  resourceEntitlements: "الميزات",
  resourceSubscription: "الاشتراك",
  resourceAccounts: "الحسابات",
  resourceAuditEvents: "أحداث التدقيق",

  platformAuditTitle: "سجل تدقيق المنصة",
  platformAuditPlatformOnly: "أحداث المنصة فقط",
  platformAuditTenantFilter: "معرّف المنشأة (اختياري)",
  platformAuditActionFilter: "الإجراء (اختياري)",
  platformAuditApply: "تصفية",
  platformAuditColAt: "الوقت",
  platformAuditColAction: "الإجراء",
  platformAuditColActor: "الفاعل",
  platformAuditViaPlatform: "عبر مشرف المنصة",
  platformAuditNextPage: "الصفحة التالية",
  platformAuditEmpty: "لا توجد أحداث.",
  platformErrorInvalidTransition: "حالة المنشأة لا تسمح بهذا الانتقال.",
  platformErrorPlanNotFound: "خطة غير معروفة.",

  // -- PHASE-024 T8: tenant audit review console
  auditReviewTitle: "سجل التدقيق",
  auditReviewHint:
    "راجع أحداث التدقيق في منشأتك: الإجراء والفاعل والكيان ومعرّف الارتباط لكل عملية — مع تصدير CSV لنفس التصفيحة.",
  auditFilterAction: "الإجراء (اختياري)",
  auditFilterActorId: "معرّف الفاعل (UUID، اختياري)",
  auditFilterEntityType: "نوع الكيان (اختياري)",
  auditFilterEntityId: "معرّف الكيان (UUID، اختياري)",
  auditFilterCorrelationId: "معرّف الارتباط (UUID، اختياري)",
  auditFilterFromAt: "من (توقيت UTC)",
  auditFilterToAt: "إلى (توقيت UTC)",
  auditFilterLimit: "الحد الأقصى للصفوف",
  auditFilterApply: "تصفية",
  auditColAt: "الوقت",
  auditColAction: "الإجراء",
  auditColEntityType: "نوع الكيان",
  auditColEntityId: "معرّف الكيان",
  auditColActor: "الفاعل",
  auditColCorrelation: "معرّف الارتباط",
  auditEmpty: "لا توجد أحداث مطابقة.",
  auditExportCsv: "تصدير CSV",
  auditResultCount: "عدد النتائج: {count}",
  auditOrderHint: "النتائج مرتبة تصاعديًا حسب الوقت.",

  shellSkipToContent: "تخطَّ إلى المحتوى",
  shellCommandSearch: "ابحث أو انتقل إلى…",
  shellShortcutsTitle: "اختصارات لوحة المفاتيح",
  shellClose: "إغلاق",
  shellMore: "المزيد",
  statusOffboarded: "تم إنهاء الخدمة",
  wizardStepOf: "الخطوة {current} من {total}",
  platformBackToConsole: "العودة إلى لوحة المنصة",
  rolesEmpty: "لا توجد أدوار بعد.",
  retryLabel: "إعادة المحاولة",

  // -- P6-T11a: shared labels -------------------------------------------------
  commonSave: "حفظ",
  commonCreate: "إنشاء",
  commonCancel: "إلغاء",
  commonOpen: "فتح",
  commonClear: "مسح",
  commonConfirm: "تأكيد",
  commonUnsavedChanges: "توجد تغييرات غير محفوظة — هل تريد المتابعة؟",
  commonVersionConflict: "تم تعديل السجل من مستخدم آخر — أعد التحميل وحاول مجددًا.",
  statusDraft: "مسودة",
  statusArchived: "مؤرشف",
  kindLabel: "النوع",
  kindFilterAll: "الكل",
  colStatus: "الحالة",
  colName: "الاسم",
  listNextPage: "الصفحة التالية",
  listPrevPage: "الصفحة السابقة",
  listSearchLabel: "بحث",
  namePreviewLabel: "معاينة الاسم",

  // -- P6-T11a: navigation + breadcrumbs ----------------------------------------
  navPartners: "الجهات",
  navPartnersDirectory: "دليل الجهات",
  navPartnersNew: "جهة جديدة",
  navOpeningBalances: "الأرصدة الافتتاحية",
  navInventory: "المخزون",
  navItems: "الأصناف",
  navItemsNew: "صنف جديد",
  navPriceLists: "قوائم الأسعار",
  navImport: "استيراد وتصدير",
  // PHASE-035: fallbacks لشاشات التتبع (الدفعات/التسلسلات/التسويات)
  navBatches: "الدفعات والصلاحية",
  navSerials: "الأرقام التسلسلية",
  navAdjustments: "تسويات المخزون",

  // -- PHASE-007: accounting -----------------------------------------------------
  navAccountingCoa: "دليل الحسابات",
  navAccountingJournals: "قيود اليومية",
  navAccountingGl: "دفتر الأستاذ العام",
  navAccountingPeriods: "الفترات المالية",
  navAccountingApprovals: "الاعتمادات",
  navAccountingRates: "أسعار الصرف",
  accountingTitle: "المحاسبة",
  accountingJournalsTitle: "قيود اليومية",
  accountingJournalsNew: "قيد جديد",
  accountingJournalsEmpty: "لا قيود بعد",
  accountingColEntryNo: "رقم القيد",
  accountingColEntryDate: "التاريخ",
  accountingColCurrency: "العملة",
  accountingColTotal: "الإجمالي",
  accountingColStatus: "الحالة",
  accountingColCode: "الرمز",
  accountingColName: "الاسم",
  accountingColType: "النوع",
  accountingColPostable: "قابل للترحيل",
  accountingColDebit: "مدين",
  accountingColCredit: "دائن",
  accountingColBalance: "الرصيد",
  accountingSubmit: "إرسال",
  accountingApprove: "اعتماد",
  accountingPost: "ترحيل",
  accountingReverse: "عكس",
  accountingCancel: "إلغاء",
  accountingSaveDraft: "حفظ المسودة",
  accountingAddLine: "إضافة سطر",
  accountingRemoveLine: "حذف السطر",
  accountingDuplicateLine: "تكرار السطر",
  accountingPartnerRequired: "مطلوب تحديد الجهة لهذا الحساب",
  accountingBalanced: "متوازن",
  accountingUnbalanced: "القيد غير متوازن",
  accountingDifference: "الفرق",
  accountingLineTotal: "السطر",
  accountingMemo: "البيان",
  accountingCostCenter: "مركز التكلفة",
  accountingPartner: "الجهة",
  accountingTaxCode: "الرمز الضريبي",
  accountingAccount: "الحساب",
  accountingDescription: "الوصف",
  accountingCoaTitle: "دليل الحسابات",
  accountingCoaEmpty: "لا حسابات",
  accountingPurposesTitle: "أغراض الحسابات",
  accountingPurposesEmpty: "لا ارتباطات أغراض",
  accountingGlTitle: "دفتر الأستاذ العام",
  accountingGlEmpty: "لا حركات",
  accountingGlDrill: "فتح القيد",
  accountingPeriodsTitle: "الفترات المالية",
  accountingPeriodsEmpty: "لا فترات",
  accountingYearsTitle: "السنوات المالية",
  accountingCreateYear: "إنشاء سنة مالية",
  accountingYearName: "اسم السنة",
  accountingYearStart: "تاريخ البداية",
  accountingYearEnd: "تاريخ النهاية",
  accountingSoftClose: "إغلاق مؤقت",
  accountingLock: "إقفال",
  accountingReopen: "إعادة فتح",
  accountingReopenReason: "سبب إعادة الفتح",
  accountingReopenPrompt: "أدخل سبب إعادة الفتح (إلزامي)",
  accountingChecklist: "قائمة فحص الإغلاق",
  accountingChecklistOk: "سليم",
  accountingChecklistBroken: "مخالف",
  accountingChecklistNotRun: "لم يُفحص",
  accountingChecklistNotApplicable: "غير منطبق بعد",
  accountingApprovalsTitle: "بانتظار الموافقة",
  accountingApprovalsEmpty: "لا عناصر بانتظار الموافقة",
  accountingApprovalsSelfHint: "لا يمكنك اعتماد قيدك الخاص",
  accountingApprovalsSubmittedBy: "مقدم بواسطة",
  accountingApprovalsTotalBase: "الإجمالي (بالعملة الأساسية)",
  accountingApprovalsPreview: "معاينة",
  accountingReject: "رفض",
  accountingRatesTitle: "أسعار الصرف",
  accountingRatesEmpty: "لا أسعار",
  accountingRatesCurrency: "العملة",
  accountingRatesDate: "التاريخ",
  accountingRatesRate: "السعر",
  accountingRatesSave: "حفظ السعر",
  accountingPostedAt: "تاريخ الترحيل",
  accountingSource: "المصدر",
  accountingPreviewTitle: "معاينة القيد",
  statusPendingApproval: "بانتظار الاعتماد",
  statusApproved: "معتمد",
  statusPosted: "مرحّل",
  statusReversed: "معكوس",
  statusCancelled: "ملغى",
  accountingStatusOpen: "مفتوحة",
  accountingStatusSoftClosed: "مغلقة مؤقتاً",
  accountingStatusLocked: "مقفلة",
  accountingKindRegular: "عادية",
  accountingKindOpening: "افتتاحية",
  accountingKindClosing: "ختامية",
  accountingSearchPlaceholder: "ابحث بالرمز أو الاسم…",
  accountingNewAccount: "حساب جديد",
  accountingAccountParent: "الحساب الأب",
  accountingAccountCurrency: "عملة الحساب (اختياري)",
  accountingIsGroup: "حساب تجميعي (غير قابل للترحيل)",
  accountingMapPurpose: "ربط غرض بحساب",
  accountingPurposeKey: "الغرض",
  accountingPurposeAccount: "الحساب",
  accountingActiveFrom: "ساري من",
  accountingLines: "سطور القيد",
  accountingColAmount: "المبلغ",
  accountingColBase: "المبلغ بالعملة الأساسية",
  accountingColDirection: "الاتجاه",
  accountingColPeriod: "الفترة",
  accountingReference: "المرجع",
  accountingExchangeRate: "سعر الصرف",
  accountingRecurringTitle: "القيود الدورية",
  accountingRecurringNew: "قيد دوري جديد",
  accountingRecurringEmpty: "لا قيود دورية",
  accountingRecurringSchedule: "التكرار",
  accountingRecurringNextRun: "التشغيل القادم",
  accountingRecurringAmountPolicy: "سياسة المبلغ",
  accountingRecurringFixed: "ثابت",
  accountingRecurringReenter: "إعادة إدخال",
  accountingRecurringPause: "إيقاف مؤقت",
  accountingRecurringActivate: "تنشيط",
  accountingRecurringGenerateDue: "توليد القيود المستحقة",
  accountingPoliciesTitle: "سياسات الاعتماد",
  accountingPoliciesEmpty: "لا سياسات معرّفة",
  accountingPolicyMode: "النمط",
  accountingPolicyThreshold: "الحد (بالعملة الأساسية)",
  accountingRunAr: "تشغيل مطابقة العملاء",
  accountingRunAp: "تشغيل مطابقة الموردين",
  accountingReconStatusOk: "مطابقة سليمة",
  accountingReconStatusBroken: "مطابقة مخالفة",
  accountingPostOpening: "ترحيل الأرصدة الافتتاحية",
  accountingPostOpeningConfirm: "سيتم ترحيل الأرصدة الافتتاحية مرة واحدة عبر الفترة الافتتاحية. هل تريد المتابعة؟",
  obPostReadyNote: "المسودات جاهزة — الترحيل يتم مرة واحدة عبر الفترة الافتتاحية للسنة المالية المحددة.",
  accountingYearEndExecute: "تنفيذ إقفال السنة",
  accountingYearEndReverse: "عكس إقفال السنة",
  accountingYearEndConfirm: "سيتم إنشاء قيد الإقفال النظامي للسنة. هل تريد المتابعة؟",
  accountingMovementsTitle: "حركات الحساب",
  accountingRegisterTitle: "سجل اليومية",
  accountingSelectAccount: "اختر حساباً",
  accountingFromDate: "من تاريخ",
  accountingToDate: "إلى تاريخ",
  accountingReversalDate: "تاريخ القيد العكسي",
  accountingReversalReason: "سبب العكس",
  accountingSoftClosePrompt: "سبب الترحيل في فترة مغلقة مؤقتاً (اختياري)",
  accountingRateHint: "السعر = وحدات العملة الأساسية مقابل 1 من العملة الأجنبية",
  accountingErrEntryNotBalanced: "القيد غير متوازن — مجموع المدين يجب أن يساوي مجموع الدائن.",
  accountingErrPeriodLocked: "الفترة المالية مقفلة — لا يمكن الترحيل فيها.",
  accountingErrAccountNotPostable: "الحساب غير قابل للترحيل (أرشيف أو تجميعي).",
  accountingErrPurposeNotMapped: "الغرض غير مربوط بأي حساب نشط — لا ترحيل احتياطي إطلاقاً.",
  accountingErrMissingPartner: "سطور حسابات العملاء/الموردين تتطلب تحديد الجهة.",
  accountingErrMissingFxRate: "لا يوجد سعر صرف للتاريخ المحدد.",
  accountingErrAlreadyPosted: "تم ترحيل هذا المستند مسبقاً.",
  accountingErrAlreadyReversed: "تم عكس هذا القيد مسبقاً.",
  accountingErrApprovalLimit: "المبلغ يتجاوز حد الاعتماد المسموح.",
  accountingErrSelfApproval: "لا يمكنك اعتماد مستند أنشأته بنفسك.",
  accountingErrImmutable: "القيود المرحّلة غير قابلة للتعديل — التصحيح بالعكس فقط.",
  accountingErrState: "حالة المستند لا تسمح بهذه العملية.",
  accountTypeAsset: "أصول",
  accountTypeLiability: "التزامات",
  accountTypeEquity: "حقوق ملكية",
  accountTypeRevenue: "إيرادات",
  accountTypeExpense: "مصروفات",
  accountingPostableYes: "قابل للترحيل",
  accountingPostableNo: "تجميعي",
  accountingPurposesHint: "غرض واحد نشط لكل مفتاح — المحرك يفشل مغلقاً عند أي غرض غير مربوط (لا ترحيل احتياطي).",

  // -- T14-UI: PHASE-008 treasury --------------------------------------------------
  navTreasury: "الخزينة",
  navTreasuryAccounts: "الحسابات النقدية",
  navTreasuryReceipts: "سندات القبض",
  navTreasuryPayments: "سندات الصرف",
  navTreasuryExpenses: "المصروفات",
  navTreasuryTransfers: "التحويلات النقدية",
  navTreasuryShifts: "ورديات الصندوق",
  navTreasuryBankRec: "التسوية البنكية",
  treasuryAccountsTitle: "الحسابات النقدية",
  treasuryAccountsEmpty: "لا حسابات نقدية بعد — افتح أول حساب.",
  treasuryAccountOpenTitle: "فتح حساب نقدي",
  treasuryAccountName: "الاسم (إنجليزي)",
  treasuryAccountNameAr: "الاسم (عربي)",
  treasuryAccountType: "نوع الحساب",
  treasuryAccountTypeCash: "نقدي",
  treasuryAccountTypeBank: "بنكي",
  treasuryAccountTypePetty: "الصندوق النقدي الصغير",
  treasuryAccountGlAccount: "الحساب المقابل في دليل الحسابات",
  treasuryAccountCurrency: "العملة",
  treasuryAccountBranch: "الفرع (اختياري)",
  treasuryColGlCode: "رمز الحساب المقابل",
  treasuryAccountBalance: "الرصيد",
  treasuryColMovements: "عدد الحركات",
  treasuryAccountCreatedToast: "تم فتح الحساب النقدي.",
  treasuryAccountCloseBtn: "إغلاق الحساب",
  treasuryAccountCloseReason: "سبب الإغلاق",
  treasuryAccountClosedToast: "تم إغلاق الحساب النقدي.",
  treasuryAccountOpenedAt: "تاريخ الفتح",
  treasuryAccountClosedAt: "تاريخ الإغلاق",
  treasuryAccountMovementsTitle: "حركات الحساب النقدي",
  treasuryAccountMovementsEmpty: "لا حركات بعد.",
  treasuryColDirectionIn: "قبض",
  treasuryColDirectionOut: "صرف",
  treasuryColBaseAmount: "المبلغ بالعملة الأساسية",
  treasuryColValueDate: "تاريخ القيمة",
  treasuryColRate: "سعر الصرف",
  treasuryColSource: "المصدر",
  treasuryColMemo: "البيان",
  treasuryMethodCash: "نقداً",
  treasuryMethodBank: "تحويل بنكي",
  treasuryMethodCheque: "شيك",
  treasuryMethodCard: "بطاقة",
  treasuryMethodTransfer: "حوالة",
  treasuryReceiptsTitle: "سندات القبض",
  treasuryReceiptsEmpty: "لا سندات قبض بعد.",
  treasuryReceiptsNew: "سند قبض جديد",
  treasuryPaymentsTitle: "سندات الصرف",
  treasuryPaymentsEmpty: "لا سندات صرف بعد.",
  treasuryPaymentsNew: "سند صرف جديد",
  treasuryColDocNo: "رقم السند",
  treasuryColPartner: "الجهة",
  treasuryColMethod: "طريقة الدفع",
  treasuryColAmount: "المبلغ",
  treasuryColAllocated: "المخصص",
  treasuryColFx: "فرق العملة",
  treasuryColPayer: "الدافع",
  treasuryColPayee: "المستفيد",
  treasuryDocCashAccount: "الحساب النقدي",
  treasuryDocPartner: "الجهة",
  treasuryDocMethod: "طريقة الدفع",
  treasuryDocCurrency: "العملة",
  treasuryDocAmount: "المبلغ",
  treasuryDocRate: "سعر الصرف (اختياري)",
  treasuryDocRateHint: "اتركه فارغاً لاستخدام سعر تاريخ القيمة",
  treasuryDocValueDate: "تاريخ القيمة",
  treasuryDocReference: "المرجع",
  treasuryDocDescription: "الوصف",
  treasuryDocDescriptionAr: "الوصف (عربي)",
  treasuryDocCreatedToast: "تم إنشاء السند.",
  treasuryDocDetailTitle: "تفاصيل السند",
  treasuryDocPostedToast: "تم ترحيل السند {no} — القيد {entry}.",
  treasuryDocReverseToast: "تم عكس السند.",
  treasuryDocReverseDate: "تاريخ القيد العكسي",
  treasuryDocReverseReason: "سبب العكس",
  treasuryDocCancelToast: "تم إلغاء السند.",
  treasuryDocOnAccount: "المتبقي على الحساب",
  treasuryDocJournalNo: "رقم القيد",
  treasuryDocSideHint: "سندات القبض تُخصص بنود العملاء (المدينين)، وسندات الصرف تُخصص بنود الموردين (الدائنين).",
  treasuryCancelReason: "سبب الإلغاء",
  treasuryOpenItemsTitle: "البنود المفتوحة",
  treasuryAllocationsTitle: "تخصيص السند",
  treasuryAllocationsEmpty: "لا بنود مفتوحة لهذه الجهة.",
  treasuryAllocationsHint: "خصّص المبلغ على البنود المفتوحة — المتبقي يُرحّل على الحساب.",
  treasuryAllocationSuggestBtn: "اقتراح تخصيص (الأقدم أولاً)",
  treasuryAllocationSuggestToast: "تم تطبيق الاقتراح على {count} بنداً.",
  treasuryAllocationColOutstanding: "المتبقي",
  treasuryAllocationTotals: "ملخص التخصيص",
  treasuryAllocationTotalAllocated: "إجمالي المخصص",
  treasuryAllocationRemainder: "غير المخصص",
  treasuryAllocationOnAccountHint: "المبلغ غير المخصص يُرحّل على حساب الجهة.",
  treasuryAllocationOverError: "مجموع التخصيص يتجاوز مبلغ السند.",
  treasuryAllocationSaveBtn: "حفظ التخصيص",
  treasuryAllocationSavedToast: "تم حفظ التخصيص.",
  treasuryAllocationReloadBtn: "تحديث البنود",
  treasuryExpensesTitle: "المصروفات",
  treasuryExpensesEmpty: "لا مصروفات بعد.",
  treasuryExpenseClaimNew: "تسجيل مصروف",
  treasuryExpenseCategoriesTitle: "فئات المصروفات",
  treasuryExpenseCategoriesEmpty: "لا فئات بعد — أنشئ أول فئة.",
  treasuryExpenseCategoryNew: "فئة جديدة",
  treasuryExpenseCategoryCode: "رمز الفئة",
  treasuryExpenseCategoryAccount: "حساب المصروف",
  treasuryExpenseCategoryApproval: "نمط الاعتماد",
  treasuryExpenseApprovalNone: "بدون اعتماد",
  treasuryExpenseApprovalSingle: "معتمد واحد",
  treasuryExpenseCategoryCreatedToast: "تم إنشاء الفئة.",
  treasuryExpenseCreatedToast: "تم تسجيل المصروف.",
  treasuryExpenseReceiptNote: "إرفاق ملفات الإيصالات يصل مع مساحة الملفات في مرحلة لاحقة — أدخل معرف ملف الإيصال مباشرة إن وُجد.",
  treasuryExpenseReceiptFileId: "معرف ملف الإيصال (اختياري)",
  treasuryExpenseColNo: "رقم المصروف",
  treasuryExpenseColPayee: "المستفيد",
  treasuryExpenseColCategory: "الفئة",
  treasuryTransfersTitle: "التحويلات النقدية",
  treasuryTransfersEmpty: "لا تحويلات بعد.",
  treasuryTransferNew: "تحويل جديد",
  treasuryTransferFrom: "من حساب",
  treasuryTransferTo: "إلى حساب",
  treasuryTransferCreatedToast: "تم إنشاء التحويل.",
  treasuryTransferPostedToast: "تم ترحيل التحويل.",
  treasuryTransferCancelledToast: "تم إلغاء التحويل.",
  treasuryTransferSameAccountError: "لا يمكن التحويل إلى الحساب نفسه.",
  treasuryColFrom: "من",
  treasuryColTo: "إلى",
  treasuryColNo: "الرقم",
  treasuryColFee: "الرسوم",
  treasuryShiftsTitle: "ورديات الصندوق",
  treasuryShiftsEmpty: "لا ورديات بعد.",
  treasuryShiftOpenTitle: "فتح وردية",
  treasuryShiftOpenBtn: "فتح الوردية",
  treasuryShiftOpeningAmount: "العهدة الافتتاحية",
  treasuryShiftCreatedToast: "تم فتح الوردية.",
  treasuryShiftStatusOpen: "مفتوحة",
  treasuryShiftStatusClosed: "مغلقة",
  treasuryShiftStatusCancelled: "ملغاة",
  treasuryShiftColShiftNo: "رقم الوردية",
  treasuryShiftColOpenedAt: "تاريخ الفتح",
  treasuryShiftColClosedAt: "تاريخ الإغلاق",
  treasuryShiftColCapturedIn: "القبض المُسجّل",
  treasuryShiftColCapturedOut: "الصرف المُسجّل",
  treasuryShiftExpected: "المتوقع",
  treasuryShiftCounted: "المعدود",
  treasuryShiftDifference: "الفرق",
  treasuryShiftVarianceJournal: "قيد فرق الوردية",
  treasuryShiftSupervisor: "المشرف",
  treasuryShiftSupervisorPin: "رمز المشرف",
  treasuryShiftSupervisorHint: "مطلوب عند تجاوز الفرق حد التسامح",
  treasuryShiftReason: "سبب الإغلاق",
  treasuryShiftCloseToast: "تم إغلاق الوردية.",
  treasuryShiftCancelBtn: "إلغاء الوردية",
  treasuryShiftCancelledToast: "تم إلغاء الوردية.",
  treasuryShiftPanelTitle: "وردية الصندوق",
  treasuryShiftCaptureTitle: "تسجيل حركة نقدية",
  treasuryShiftCaptureHint: "سجّل الإيداعات والمصروفات النقدية خلال الوردية.",
  treasuryShiftCaptureBtn: "تسجيل",
  treasuryShiftCloseTitle: "إغلاق الوردية",
  treasuryShiftCloseBtn: "إغلاق",
  treasuryShiftBalanced: "مطابق للعدّ",
  treasuryShiftVarianceNote: "الفرق لا يساوي صفراً — أدخل السبب، وبيانات المشرف عند تجاوز حد التسامح.",
  treasuryShiftClosedNote: "الوردية مغلقة — الملخص للعرض فقط.",
  treasuryBankRecTitle: "التسوية البنكية",
  treasuryBankRecEmpty: "لا كشوف بعد — استورد أول كشف.",
  treasuryBankRecImportTitle: "استيراد كشف حساب",
  treasuryBankRecAdapter: "محول الاستيراد",
  treasuryBankRecFile: "الملف",
  treasuryBankRecFileHint: "ملف CSV أو Excel",
  treasuryBankRecPeriodStart: "بداية الفترة",
  treasuryBankRecPeriodEnd: "نهاية الفترة",
  treasuryBankRecMappingHint: "تخطيط الأعمدة — اختياري مع المؤشر العام",
  treasuryBankRecMappingDate: "عمود التاريخ",
  treasuryBankRecMappingAmount: "عمود المبلغ",
  treasuryBankRecMappingReference: "عمود المرجع",
  treasuryBankRecMappingDescription: "عمود البيان",
  treasuryBankRecImportBtn: "استيراد الكشف",
  treasuryBankRecImportedToast: "تم استيراد الكشف.",
  treasuryBankRecStatementsTitle: "كشوف الحساب",
  treasuryBankRecColFile: "الملف",
  treasuryBankRecColPeriod: "الفترة",
  treasuryBankRecColLines: "عدد السطور",
  treasuryBankRecColImportedAt: "تاريخ الاستيراد",
  treasuryBankRecStatusImported: "مستورد",
  treasuryBankRecStatusReconciled: "مسوّى",
  treasuryBankRecOpeningBalance: "الرصيد الافتتاحي",
  treasuryBankRecClosingBalance: "الرصيد الختامي",
  treasuryBankRecSelectStatement: "اختر كشفاً من القائمة للعمل على سطوره.",
  treasuryBankRecLinesTitle: "سطور الكشف",
  treasuryBankRecColLineNo: "السطر",
  treasuryBankRecColMatchState: "حالة المطابقة",
  treasuryBankRecMatched: "مطابق",
  treasuryBankRecUnmatched: "غير مطابق",
  treasuryBankRecMatchAuto: "تلقائي",
  treasuryBankRecMatchManual: "يدوي",
  treasuryBankRecAutoMatchBtn: "مطابقة تلقائية",
  treasuryBankRecAutoMatchToast: "تمت مطابقة {count} سطراً.",
  treasuryBankRecManualMatch: "مطابقة يدوية",
  treasuryBankRecMatchMovement: "الحركة المطابقة",
  treasuryBankRecUnmatchBtn: "إزالة المطابقة",
  treasuryBankRecMatchedToast: "تم تحديث المطابقة.",
  treasuryBankRecReconcileBtn: "تسوية الكشف",
  treasuryBankRecReconcileHint: "التسوية تُقفل فترة الكشف لهذا الحساب.",
  treasuryBankRecReconciledToast: "تمت التسوية وقُفلت الفترة.",
  treasuryBankRecAgingTitle: "التقادم — العناصر غير المطابقة",
  treasuryBankRecAgingAsOf: "تاريخ احتساب التقادم",
  treasuryBankRecUnmatchedLinesTitle: "سطور كشف غير مطابقة",
  treasuryBankRecUnmatchedMovementsTitle: "حركات دفتر غير مطابقة",
  treasuryBankRecColAgeDays: "العمر (أيام)",
  treasuryBankRecLoadAgingBtn: "عرض التقادم",
  treasuryBankRecCashCheckTitle: "فحص مطابقة النقدية",
  treasuryBankRecCashCheckAsOf: "كما في تاريخ",
  treasuryBankRecCashCheckBtn: "تشغيل الفحص",
  treasuryBankRecCashCheckOk: "النقدية مطابقة — لا فرق.",
  treasuryBankRecCashCheckBroken: "فرق في مطابقة النقدية.",
  treasuryBankRecColControlBalance: "رصيد حساب الرقابة",
  treasuryBankRecColSubledgerBalance: "رصيد السجل المساعد",
  treasuryBankRecColDiffCount: "عدد الفروقات",
  treasuryBankRecFilterAccount: "تصفية بالحساب النقدي",
  treasuryErrAccountExists: "يوجد حساب نقدي بهذا الاسم مسبقاً.",
  treasuryErrAccountClosed: "الحساب النقدي مغلق — لا يستقبل مستندات جديدة.",
  treasuryErrAccountNotCloseable: "لا يمكن إغلاق هذا الحساب في وضعه الحالي.",
  treasuryErrCurrencyMismatch: "عملة الحساب النقدي لا تطابق عملة المستند.",
  treasuryErrTypeInvalid: "نوع الحساب النقدي غير صالح.",
  treasuryErrInvalidAmount: "المبلغ غير صالح — يجب أن يكون رقماً موجباً.",
  treasuryErrDocState: "حالة المستند لا تسمح بهذه العملية.",
  treasuryErrMissingFxRate: "لا يوجد سعر صرف للتاريخ المحدد.",
  treasuryErrAllocationExceedsDoc: "مجموع التخصيصات يتجاوز مبلغ السند.",
  treasuryErrAllocationExceedsItem: "التخصيص يتجاوز المتبقي من البند المفتوح.",
  treasuryErrOpenItemCurrency: "عملة البند المفتوح تختلف عن عملة السند.",
  treasuryErrOpenItemPartner: "البند المفتوح لا يخص هذه الجهة.",
  treasuryErrOpenItemSide: "نوع السند يخصص بنوداً من الجانب المقابل فقط (عملاء للقبض، موردون للصرف).",
  treasuryErrPettyLimit: "المبلغ يتجاوز حدود الصندوق النقدي الصغير — استخدم الترحيل البنكي أو قسّم المبلغ.",
  treasuryErrCategoryTaken: "رمز فئة المصروف مستخدم مسبقاً.",
  treasuryErrReceiptRequired: "إرفاق إيصال مطلوب لهذا المبلغ.",
  treasuryErrApprovalRequired: "يجب اعتماد المصروف قبل الترحيل.",
  treasuryErrShiftAlreadyOpen: "توجد وردية مفتوحة لهذا الحساب مسبقاً.",
  treasuryErrSupervisorRequired: "الفرق يتجاوز حد التسامح — مطلوب مشرف ورمز وسبب.",
  treasuryErrSupervisorPin: "رمز المشرف غير صحيح أو غير مضبوط.",
  treasuryErrShiftReason: "السبب مطلوب عند إغلاق وردية بفرق.",
  treasuryErrStatementTooLarge: "الكشف يتجاوز الحد الأقصى لعدد السطور.",
  treasuryErrStatementFormat: "تعذر تحليل ملف الكشف — تحقق من التنسيق أو محول الاستيراد.",
  treasuryErrStatementReconciled: "الكشف مسوّى مسبقاً — الفترة مقفلة.",
  treasuryErrPeriodLocked: "التاريخ يقع ضمن فترة مسوّاة لهذا الحساب.",
  treasuryErrMovementMatched: "الحركة مطابقة لسطر كشف آخر مسبقاً.",

  // -- P6-T11a: partner directory ------------------------------------------------
  partnersSearchPlaceholder: "ابحث بالاسم أو الرمز أو الرقم الضريبي…",
  partnersKindLabel: "نوع الجهة",
  kindCustomer: "عميل",
  kindSupplier: "مورّد",
  kindBoth: "عميل ومورّد",
  partnersColCode: "الرمز",
  partnersColCreditLimit: "حد الائتمان",
  partnersEmpty: "لا توجد جهات بعد — أنشئ أول جهة.",
  partnersNewButton: "جهة جديدة",
  partnerFormTitleCreate: "إضافة جهة جديدة",
  partnerCodeLabel: "رمز الجهة",
  partnerCodeHint: "اتركه فارغًا للترقيم التلقائي (P-000001).",
  partnerNameLabel: "الاسم (إنجليزي)",
  partnerNameArLabel: "الاسم (عربي)",
  partnerTaxNumberLabel: "الرقم الضريبي",
  partnerCreditTermsLabel: "شروط الدفع",
  partnerPriceListLabel: "قائمة الأسعار",
  partnerStatusLabel: "الحالة",
  partnerCreatedToast: "تم إنشاء الجهة.",
  partnerSavedToast: "تم حفظ التعديلات.",
  partnerCodeTaken: "رمز الجهة مستخدم مسبقًا.",
  partnerArchivedError: "الجهة مؤرشفة — لا يمكن تعديلها.",
  partnerKindChangeLabel: "تغيير نوع الجهة",
  partnerKindChangedToast: "تم تغيير نوع الجهة.",
  partnerKindImmutable: "لا يمكن تغيير النوع بعد وجود حركات مرحّلة.",
  partnerArchiveButton: "أرشفة الجهة",
  partnerArchiveConfirmTitle: "تأكيد أرشفة الجهة",
  partnerArchiveConfirmBody: "لن تظهر الجهة المؤرشفة في القوائم الجديدة. هل تريد المتابعة؟",
  partnerArchivedToast: "تمت أرشفة الجهة.",
  partnerTabOverview: "البيانات",
  partnerContactsTitle: "جهات الاتصال",
  partnerContactNameLabel: "الاسم",
  partnerContactPhoneLabel: "الهاتف",
  partnerContactEmailLabel: "البريد الإلكتروني",
  partnerContactRoleLabel: "الصفة",
  partnerContactPrimaryLabel: "أساسي",
  partnerContactAdd: "إضافة جهة اتصال",
  partnerContactsEmpty: "لا توجد جهات اتصال.",
  partnerAddressesTitle: "العناوين",
  addressTypeLabel: "نوع العنوان",
  addressTypeBilling: "فوترة",
  addressTypeShipping: "شحن",
  addressTypeOther: "أخرى",
  partnerAddressLine1Label: "العنوان (سطر 1)",
  partnerAddressLine2Label: "العنوان (سطر 2)",
  partnerAddressCityLabel: "المدينة",
  partnerAddressCountryLabel: "رمز الدولة (حرفان)",
  partnerAddressAdd: "إضافة عنوان",
  partnerAddressesEmpty: "لا توجد عناوين.",
  partnerBalanceTitle: "الرصيد",
  partnerBalanceOpenAmount: "الرصيد الافتتاحي (مسودة)",
  partnerBalanceDraftLabel: "رصيد المسودات",
  partnerBalanceOverdueLabel: "المتأخر",
  partnerBalanceDraftBadge: "مسودات فقط",
  partnerBalanceDraftNote: "تُحتسب الأرصدة في هذه المرحلة من مسودات الأرصدة الافتتاحية فقط — لا ترحيل بعد (الترحيل يصل مع المحاسبة).",

  // -- P6-T11a: item master ----------------------------------------------------------
  itemsSearchPlaceholder: "ابحث بالاسم أو SKU…",
  itemsFilterCategoryLabel: "التصنيف",
  categoryLabel: "التصنيف",
  itemsColSku: "رمز الصنف (SKU)",
  itemsColBasePrice: "السعر الأساسي",
  itemsEmpty: "لا توجد أصناف بعد — أنشئ أول صنف.",
  itemsNewButton: "صنف جديد",
  itemFormTitleCreate: "إضافة صنف جديد",
  itemFormTitleEdit: "بيانات الصنف",
  itemSkuLabel: "رمز الصنف (SKU)",
  itemNameLabel: "الاسم (إنجليزي)",
  itemNameArLabel: "الاسم (عربي)",
  itemKindLabel: "نوع الصنف",
  kindStock: "مخزني",
  kindService: "خدمي",
  kindComposite: "مركّب",
  itemUomLabel: "وحدة القياس",
  itemCostingLabel: "طريقة التكلفة",
  costingWac: "متوسط مرجّح (WAC)",
  costingFifo: "الوارد أولًا يصدر أولًا (FIFO)",
  itemTrackingLabel: "التتبع",
  itemTrackBatch: "تتبع الدفعات",
  itemTrackSerial: "أرقام تسلسلية",
  itemTrackImei: "IMEI",
  itemHasExpiry: "تاريخ انتهاء",
  itemExpiryRequiresBatch: "تاريخ الانتهاء يتطلب تتبع الدفعات — فُعِّل تتبع الدفعات تلقائيًا.",
  itemReorderLevelLabel: "حد إعادة الطلب",
  itemReorderQtyLabel: "كمية إعادة الطلب",
  itemBasePriceLabel: "السعر الأساسي",
  itemCreatedToast: "تم إنشاء الصنف.",
  itemSavedToast: "تم حفظ التعديلات.",
  itemSkuTaken: "رمز الصنف (SKU) مستخدم مسبقًا.",
  itemArchivedError: "الصنف مؤرشف — لا يمكن تعديله.",
  itemArchiveButton: "أرشفة الصنف",
  itemArchiveConfirmTitle: "تأكيد أرشفة الصنف",
  itemArchiveConfirmBody: "لن يظهر الصنف المؤرشف في المستندات الجديدة. هل تريد المتابعة؟",
  itemArchivedToast: "تمت أرشفة الصنف.",
  barcodesTitle: "الباركود",
  barcodeCodeLabel: "رقم الباركود",
  barcodeAdd: "إضافة باركود",
  barcodesEmpty: "لا توجد باركود.",
  barcodeTaken: "الباركود مستخدم مسبقًا (فريد على مستوى المنشأة).",

  // -- P6-T11a: price lists -----------------------------------------------------------
  priceListCreateTitle: "قائمة أسعار جديدة",
  priceListsListTitle: "القوائم",
  priceListNameLabel: "الاسم (إنجليزي)",
  priceListNameArLabel: "الاسم (عربي)",
  priceListKindLabel: "نوع القائمة",
  priceListKindSale: "بيع",
  priceListKindPurchase: "شراء",
  priceListCurrencyLabel: "العملة",
  priceListValidFromLabel: "سارٍ من (اختياري)",
  priceListValidToLabel: "سارٍ إلى (اختياري)",
  priceListCreateSubmit: "إنشاء القائمة",
  priceListSelectHint: "اختر قائمة من الجدول لتحرير صفوفها.",
  priceListRowsTitle: "صفوف القائمة",
  priceListRowItemLabel: "الصنف",
  priceListRowUomLabel: "وحدة القياس",
  priceListRowPriceLabel: "سعر الوحدة",
  priceListRowMinQtyLabel: "أقل كمية",
  priceListRowAdd: "إضافة صف",
  priceListRowAddedToast: "تمت إضافة الصف.",
  priceListRowsEmpty: "لا توجد صفوف بعد — أضف أول سعر.",
  priceListsEmpty: "لا توجد قوائم أسعار بعد.",
  priceListColValidLabel: "الفترة",
  priceListCreatedToast: "تم إنشاء قائمة الأسعار.",
  priceListCurrencySar: "ريال سعودي (SAR)",

  // -- P6-T11a: import & export wizard ---------------------------------------------------
  importStep1Title: "الملف والنوع",
  importDataKindLabel: "نوع البيانات",
  importKindPartners: "الجهات",
  importKindItems: "الأصناف",
  importKindOpeningBalances: "الأرصدة الافتتاحية",
  importFormatLabel: "الصيغة",
  importCarrierLabel: "جهة الرفع (الناقل)",
  importCarrierHint: "يُرفع ملف الاستيراد عبر خانة مرفقات الجهة المختارة — هذا هو نمط الرفع المباشر المتاح في هذه المرحلة.",
  importFileLabel: "الملف",
  importFileHint: "ملف CSV أو XLSX حتى 8 ميغابايت وبحد أقصى 5000 صف.",
  importSubmitPreview: "رفع ومعاينة",
  importStep2Title: "المعاينة",
  importColTotal: "إجمالي الصفوف",
  importColValid: "صالحة",
  importColInvalid: "غير صالحة",
  importColDuplicates: "مكررة",
  importCommit: "تطبيق الاستيراد",
  importCommitToast: "تم تطبيق الاستيراد.",
  importCommitFailed: "فشل تطبيق الاستيراد — راجع حالة المهمة.",
  importStep3Title: "تم التطبيق",
  importCommittedRows: "تم تطبيق {count} صف.",
  importColRow: "الصف",
  importColPreview: "المعاينة",
  importColErrors: "الأخطاء",
  importColWarnings: "تحذيرات",
  importRowValid: "صالح",
  importRowError: "خطأ",
  importRowDuplicate: "مكرر",
  importRowWarning: "تحذير",
  importPreviewEmpty: "لا توجد صفوف في الملف.",
  importNewJob: "استيراد جديد",
  importCarrierRequired: "اختر جهة الرفع أولًا.",
  importFileRequired: "اختر ملفًا أولًا.",
  importFileTooLarge: "حجم الملف يتجاوز 8 ميغابايت.",
  importFileTypeInvalid: "صيغة غير مدعومة — CSV أو XLSX فقط.",
  importUploadFailed: "تعذّر رفع الملف إلى التخزين.",
  importFormatCsv: "CSV",
  importFormatXlsx: "XLSX (Excel)",
  importJobsColCreated: "أُنشئت",
  importJobsTitle: "سجل الاستيراد",
  importJobsEmpty: "لا توجد مهام استيراد.",
  importJobColRows: "الصفوف",
  importStatusPreviewing: "قيد المعاينة",
  importStatusPreviewReady: "جاهزة للتطبيق",
  importStatusCommitting: "قيد التطبيق",
  importStatusCommitted: "مطبّقة",
  importStatusFailed: "فاشلة",
  importErrorFileInvalid: "ملف غير صالح — تأكد من الصيغة والحدود.",
  // -- PHASE-040 (T-08): مركز استيراد البيانات والترحيل -----------------------
  toolkitTitle: "استيراد البيانات والترحيل",
  toolkitSubtitle: "ارفع ملفك، اربط الأعمدة، عاين بلا كتابة، ثم طبّق — من QuickBooks وOdoo أو ملف Excel عام.",
  toolkitTabWizard: "معالج الاستيراد",
  toolkitTabJobs: "سجل المهام",
  toolkitTabMappings: "الخرائط المحفوظة",
  toolkitTabAdapters: "محوّلات الترحيل",
  toolkitStepKindTitle: "١. نوع البيانات",
  toolkitStepKindHint: "اختر نوع البيانات الذي تريد استيراده — كل نوع له أعمدته المعيارية وقواعده.",
  toolkitStepFileTitle: "٢. الملف",
  toolkitFilePick: "اختر ملف CSV أو XLSX",
  toolkitUploadAndAnalyze: "رفع الملف وتحليل الأعمدة",
  toolkitAnalyzing: "جارٍ التحليل…",
  toolkitKindFormats: "الصيغ المقبولة",
  toolkitRequiredOption: "خيار مطلوب",
  toolkitBudgetPick: "الموازنة المستهدفة (مسودة)",
  toolkitBudgetRequired: "نوع شبكة الموازنة يتطلب اختيار موازنة مسودة أولاً.",
  toolkitGridKindNote: "هذا النوع يستورد بشبكة الفترات القياسية (PHASE-028) — لا حاجة لربط الأعمدة.",
  toolkitPiiNote: "يتضمن بيانات شخصية",
  toolkitStepMapTitle: "٣. ربط الأعمدة",
  toolkitStepMapHint: "طابق كل عمود معياري مع عمود الملف — الربط التلقائي يقترح، وأنت توافق أو تعدّل.",
  toolkitColCanonical: "العمود المعياري",
  toolkitColHeader: "عمود الملف",
  toolkitColRequired: "مطلوب",
  toolkitColOptional: "اختياري",
  toolkitColType: "النوع",
  toolkitMapEmpty: "لم يُربط أي عمود بعد.",
  toolkitAutoDetected: "تم اقتراح الربط تلقائياً",
  toolkitSampleTitle: "أول صفوف الملف (معاينة)",
  toolkitUnmappedHeaders: "أعمدة لم تُربط",
  toolkitSaveMappingName: "اسم الخريطة المحفوظة",
  toolkitSaveMappingBtn: "حفظ الخريطة لإعادة استخدامها",
  toolkitMappingSaveToast: "تم حفظ الخريطة.",
  toolkitStepReviewTitle: "٤. المعاينة والتطبيق",
  toolkitRunDryRun: "تشغيل المعاينة (بلا كتابة)",
  toolkitDryRunRunning: "جارٍ فحص الصفوف…",
  toolkitReportUnmapped: "أعمدة معيارية مطلوبة لم تُربط",
  toolkitCommitAckLabel: "أقرّ بوجود صفوف مرفوضة/مكرّرة وأرغب في تطبيق الصفوف الصالحة فقط",
  toolkitCommitAckHint: "التطبيق ذرّي: إمّا كل الصفوف الصالحة دفعة واحدة أو لا شيء (BR-066).",
  toolkitCommitBtn: "تطبيق الاستيراد",
  toolkitCommitting: "جارٍ التطبيق…",
  toolkitCommitFailed: "فشل التطبيق — لم يُكتب أي صف (يمكن إعادة المحاولة).",
  toolkitCommittedTitle: "تم الاستيراد",
  toolkitCommittedSummary: "تم تطبيق {count} صف بنجاح.",
  toolkitErrorExportBtn: "تنزيل تقرير الأخطاء (عربي/إنجليزي)",
  toolkitStartNew: "استيراد جديد",
  toolkitJobsTitle: "سجل مهام الاستيراد",
  toolkitJobsEmpty: "لا توجد مهام بعد.",
  toolkitJobsColFile: "الملف",
  toolkitJobsRefresh: "تحديث",
  toolkitMappingsTitle: "الخرائط المحفوظة",
  toolkitMappingsEmpty: "لا توجد خرائط محفوظة بعد — أنشئ واحدة من خطوة ربط الأعمدة.",
  toolkitMappingColName: "الاسم",
  toolkitMappingColKind: "النوع",
  toolkitMappingColDirection: "الاتجاه",
  toolkitMappingColUpdated: "آخر تحديث",
  toolkitMappingDirectionImport: "استيراد",
  toolkitMappingDirectionExport: "تصدير",
  toolkitMappingDeleteBtn: "حذف",
  toolkitMappingDeletedToast: "تم حذف الخريطة.",
  toolkitAdaptersTitle: "محوّلات الترحيل من أنظمة أخرى",
  toolkitAdaptersHint: "حمّل قالب CSV المطابق لنظامك، صدّر بياناتك به، ثم استورده عبر المعالج — الربط موثّق لكل عمود.",
  toolkitAdapterColSource: "النظام المصدر",
  toolkitAdapterColTarget: "النوع المستهدف",
  toolkitAdapterColFormat: "الصيغة",
  toolkitAdapterTemplateBtn: "تنزيل القالب",
  toolkitAdapterEngineConsole: "يُستورد عبر لوحة المخزون الأساسية",
  toolkitAdapterRequiresVerification: "يتطلب تحققاً",
  toolkitErrKindUnknown: "نوع استيراد غير معروف.",
  toolkitErrFileInvalid: "ملف غير صالح — تأكد من الصيغة وحدود الحجم.",
  toolkitErrJobNotFound: "مهمة الاستيراد غير موجودة.",
  toolkitErrCommitConflict: "المهمة قيد التطبيق بالفعل.",
  toolkitErrNotPreviewed: "لا توجد صفوف معاينة لتطبيقها.",
  toolkitErrOptionsMissing: "خيار مطلوب غير مكتمل.",
  toolkitErrBudgetInvalid: "الموازنة غير صالحة للاستيراد (مسودات فقط).",
  toolkitErrMappingInvalid: "خريطة أعمدة غير صالحة.",
  toolkitErrDemoRefused: "لا يمكن بذر بيانات تجريبية — هذا المستأجر يحمل مستندات فعلية مرحّلة.",
  // -- PHASE-040 (T-06/T-09): بيانات تجريبية بضغطة واحدة --------------------
  demoDataTitle: "ابدأ ببيانات تجريبية واقعية",
  demoDataHint: "اضغطة واحدة تبذر شركاء وأصناف وفواتير مرحّلة وقيوداً محاسبية كاملة لقطاعك — مناسبة للتجربة والعرض.",
  demoDataTemplateLabel: "القالب القطاعي",
  demoDataSeedBtn: "بذر البيانات التجريبية",
  demoDataSeeding: "جارٍ البذر…",
  demoDataSeededBadge: "مبذورة",
  demoDataSeededAt: "بُذرت في",
  demoDataDoneTitle: "تم بذر البيانات التجريبية",
  demoDataSummaryLine: "شركاء: {partners} · أصناف: {items} · فواتير: {invoices} · سندات قبض: {receipts} — كلها عبر محرك الترحيل.",
  demoDataRefused: "تعذّر البذر — قد يكون هناك مستندات فعلية أو بذرة سابقة بقالب آخر.",
  onboardingImportDataCta: "استورد بياناتك من نظامك السابق",
  onboardingImportDataHint: "دليل الحسابات، الأرصدة الافتتاحية، الأصول، الموظفون، قوائم الأسعار، العقود — من QuickBooks أو Odoo أو Excel.",
  onboardingDemoDataCta: "أو ابدأ ببيانات تجريبية جاهزة",
  exportTitle: "تصدير",
  exportHint: "تصدير فوري بحد 10000 صف — يصدر رابط تنزيل مؤقت.",
  exportSubmit: "تصدير",
  exportDone: "تم التصدير — {rows} صف.",
  exportRows: "عدد الصفوف",
  exportDownloadLabel: "تنزيل الملف",
  exportExpiresNote: "الرابط صالح لمدة {seconds} ثانية.",

  // -- P6-T11a: opening balances (DRAFT only) ------------------------------------------
  obTabPartner: "جهة",
  obTabAccount: "حساب",
  obTabStock: "مخزون",
  obCreateTitle: "إنشاء رصيد افتتاحي (مسودة)",
  obAmountLabel: "المبلغ",
  obNoteLabel: "ملاحظة",
  obQtyLabel: "الكمية",
  obUnitCostLabel: "تكلفة الوحدة",
  obAccountLabel: "معرّف الحساب",
  obAccountHint: "شجرة الحسابات القانونية تصل مع المحاسبة (المرحلة 007) — أدخل معرّف الحساب الحالي.",
  obCreateSubmit: "إنشاء المسودة",
  obEmpty: "لا توجد مسودات بعد.",
  obListTitle: "المسودات الحالية",
  obDraftOnlyNote: "لا يوجد ترحيل في هذه المرحلة — كل رصيد افتتاحي يُنشأ كمسودة فقط.",
  obCreatedToast: "تم إنشاء المسودة.",
  obColTarget: "الهدف",
  obColAmount: "المبلغ",
  obColQty: "الكمية",
  obColNote: "ملاحظة",
  obQtyAtCostLabel: "{qty} × {cost}",
  obTargetUnknown: "هدف غير معروف",
  obDuplicateError: "توجد مسودة لهذا الهدف بالفعل — مسودة واحدة لكل هدف.",

  // -- P6-T11a: attachments --------------------------------------------------------------
  attachmentsTitle: "المرفقات",
  attachmentIssueFormTitle: "إصدار خانة رفع",
  attachmentFilenameLabel: "اسم الملف",
  attachmentContentTypeLabel: "نوع المحتوى",
  attachmentSizeLabel: "الحجم (بايت)",
  attachmentTypePdf: "PDF",
  attachmentTypePng: "PNG",
  attachmentTypeJpeg: "JPEG",
  attachmentTypeWebp: "WebP",
  attachmentTypeCsv: "CSV",
  attachmentIssueButton: "إصدار رابط رفع",
  attachmentIssuedTitle: "رابط الرفع الصادر",
  attachmentIssuedHint: "ارفع الملف إلى الرابط أعلاه بأمر PUT خلال {seconds} ثانية من الإصدار — الرفع المباشر من المتصفح يكتمل مع وحدة الملفات الكاملة.",
  attachmentIssuedToast: "تم إصدار رابط الرفع.",
  attachmentUrlLabel: "الرابط",
  attachmentKeyLabel: "مفتاح التخزين",
  attachmentExpiresLabel: "تنتهي الصلاحية خلال (ثوانٍ)",
  attachmentsEmpty: "لا توجد مرفقات.",
  attachmentDownloadLabel: "تنزيل",
  attachmentIssueFailed: "تعذّر إصدار رابط الرفع.",

  // -- P6-T11a: pickers + command-menu remote groups ---------------------------------------
  partnerPickerPlaceholder: "اختر جهة…",
  itemPickerPlaceholder: "اختر صنفًا…",
  pickerEmptyText: "لا نتائج",
  commandGroupPartners: "الجهات",
  commandGroupItems: "الأصناف",

  // -- T15-UI: PHASE-009 tax screens --------------------------------------------------------
  taxCodesTitle: "الرموز الضريبية",
  taxCodesEmpty: "لا توجد رموز ضريبية بعد — أنشئ أول رمز.",
  taxCodesCode: "الرمز",
  taxCodesName: "الاسم (إنجليزي)",
  taxCodesNameAr: "الاسم (عربي)",
  taxCodesCountry: "الدولة",
  taxCodesTreatment: "المعاملة الضريبية",
  taxCodesUsage: "الاستخدام",
  taxCodesCreateTitle: "إنشاء رمز ضريبي",
  taxCodesCreatedToast: "تم إنشاء الرمز الضريبي.",
  taxCodesArchive: "أرشفة الرمز",
  taxCodesArchiveConfirm: "سيختفي الرمز المؤرشف من المستندات الجديدة. هل تريد المتابعة؟",
  taxCodesArchiveBlocked: "لا يمكن أرشفة رمز مستخدم في أصناف أو فئات — أعد تعيينها أولًا.",
  taxCodesArchivedToast: "تمت أرشفة الرمز الضريبي.",
  taxTreatmentStandardRated: "خاضع للنسبة الأساسية",
  taxTreatmentZeroRated: "نسبة صفرية",
  taxTreatmentExempt: "معفى",
  taxTreatmentOutOfScope: "خارج نطاق الضريبة",
  taxTreatmentReverseCharge: "احتساب عكسي",
  taxTreatmentNotSubject: "غير خاضع",
  taxResolveTitle: "تجربة احتساب الضريبة",
  taxResolveDate: "تاريخ المستند",
  taxResolveAmount: "المبلغ",
  taxResolveCode: "الرمز الضريبي",
  taxResolveAction: "احتساب",
  taxResolveTreatment: "المعاملة",
  taxResolveRate: "النسبة",
  taxResolveBase: "الوعاء الضريبي",
  taxResolveTax: "الضريبة",
  taxResolveGross: "الإجمالي مع الضريبة",
  taxResolveNotSubject: "هذا السطر غير خاضع للضريبة — لا تُحتسب عليه ضريبة.",
  taxResolveBoundaryWarning:
    "تنبيه حدودي (BR-033): تسري نسبة {rate} اعتبارًا من {date} — المسودات الممتدة عبر هذا الحد تُنبَّه عند الفتح، واللقطات المرحّلة لا تتغير.",
  taxRegistrationsTitle: "التسجيلات الضريبية",
  taxRegistrationsEmpty: "لا توجد تسجيلات ضريبية بعد.",
  taxRegistrationsStatus: "حالة التسجيل",
  taxRegistrationsNumber: "رقم التسجيل الضريبي",
  taxRegistrationsEffectiveFrom: "ساري من",
  taxRegistrationsEffectiveTo: "ساري حتى",
  taxRegistrationsRegistered: "مسجل",
  taxRegistrationsNotRegistered: "غير مسجل",
  taxRegistrationsDeregistered: "مُلغى التسجيل",
  taxRegistrationsCreateTitle: "تحديث حالة التسجيل",
  taxRegistrationsSavedToast: "تم حفظ حالة التسجيل الضريبي.",
  einvoicingTitle: "الفوترة الإلكترونية",
  einvoicingSubtitle: "حالة تسليمات السجل — المصدر الوحيد لحقيقة الجهات الضريبية",
  einvoicingRegistryTitle: "سجل التسليمات",
  einvoicingStatus: "الحالة",
  einvoicingDocument: "المستند",
  einvoicingAdapter: "المحوّل",
  einvoicingAttempts: "المحاولات",
  einvoicingAuthorityRef: "مرجع الجهة",
  einvoicingLastError: "آخر خطأ",
  einvoicingSubmittedAt: "وقت الإرسال",
  einvoicingEmpty: "لا توجد تسليمات بعد — المحوّلات معطلة افتراضيًا حتى تهيئة الشهادات.",
  einvoicingAdaptersTitle: "المحوّلات",
  einvoicingAdaptersUnverifiedNote: "المحوّل غير مُتحقَّق منه: يرفض أي إرسال فعلي حتى اجتياز بوابة التحقق (لا ادعاء امتثال بلا دليل).",
  einvoicingRegimeVerified: "نظام مُتحقَّق منه",
  einvoicingRegimeUnverified: "غير مُتحقَّق منه",
  einvoicingCertsTitle: "الشهادات",
  einvoicingCertLabel: "التسمية",
  einvoicingCertFingerprint: "البصمة",
  einvoicingCertValidUntil: "صالحة حتى",
  einvoicingCertStatus: "الحالة",
  einvoicingCertSignCount: "عدد التوقيعات",
  einvoicingCertsEmpty: "لا شهادات مسجلة.",
  einvoicingResubmit: "إعادة الإرسال",
  einvoicingResubmitDone: "أُنشئ تسليم جديد — السجل السابق محفوظ في التاريخ.",
  einvoicingStatusPending: "بالانتظار",
  einvoicingStatusGenerated: "مُولَّد",
  einvoicingStatusSigned: "موقَّع",
  einvoicingStatusSubmitted: "مُرسَل",
  einvoicingStatusAccepted: "مقبول",
  einvoicingStatusRejected: "مرفوض",
  einvoicingStatusReported: "مُبلَّغ",
  einvoicingStatusFailed: "فاشل",
  einvoicingFunnelTitle: "قمع الفوترة الإلكترونية",
  einvoicingFunnelSubtitle: "لوحة مراقبة العمليات — التسليمات والزمن وأسباب الرفض",
  einvoicingFunnelByState: "التسليمات حسب الحالة",
  einvoicingFunnelLatency: "زمن الاستجابة",
  einvoicingFunnelRejectionReasons: "أسباب الرفض",
  einvoicingFunnelDeadLetter: "رسائل ميتة",
  einvoicingFunnelRejectRate: "نسبة الرفض (15 دقيقة)",
  einvoicingFunnelNoData: "لا بيانات بعد.",
  // WEB-037 (PHASE-037) — ZATCA Phase-1 device registry (Arabic-first).
  zatcaNavLabel: "أجهزة ZATCA",
  zatcaDevicesTitle: "أجهزة الفاتورة الإلكترونية (ZATCA)",
  zatcaDevicesSubtitle:
    "سجل أجهزة EIAS — توليد رمز QR (المرحلة الأولى) مع سلسلة هاش وعدّاد ICV لكل جهاز.",
  zatcaDevicesDevicesTab: "الأجهزة",
  zatcaDevicesChainTab: "السلسلة والتحقق",
  zatcaDevicesBackfillTab: "الإضافة الرجعية",
  zatcaDevicesPhase2Note:
    "المرحلة الأولى (توليد QR) فقط — الترحيل/الإبلاغ وتسجيل CSID لدى ZATCA مرحلة لاحقة (PHASE-054) وغير مُنفَّذة هنا عمدًا.",
  zatcaDevicesDeviceName: "اسم الجهاز",
  zatcaDevicesDeviceNameAr: "الاسم بالعربية",
  zatcaDevicesDeviceUuid: "معرّف الجهاز (UUID)",
  zatcaDevicesDeviceUuidHint: "المعرّف الفريد للجهاز لدى هيئة الزكاة والضريبة والجمارك — اختياري في المرحلة الأولى.",
  zatcaDevicesDeviceSerial: "الرقم التسلسلي",
  zatcaDevicesProviderName: "مزوّد الحل",
  zatcaDevicesProviderVat: "الرقم الضريبي للمزوّد",
  zatcaDevicesProviderVatHint: "15 رقمًا — الرقم الضريبي لجهة حل الفاتورة الإلكترونية.",
  zatcaDevicesProviderVatInvalid: "الرقم الضريبي للمزوّد يجب أن يكون 15 رقمًا بالضبط.",
  zatcaDevicesBranch: "الفرع",
  zatcaDevicesBranchAny: "بدون فرع",
  zatcaDevicesNote: "ملاحظة",
  zatcaDevicesOptional: "اختياري",
  zatcaDevicesNameRequired: "اسم الجهاز مطلوب.",
  zatcaDevicesCreateDevice: "جهاز جديد",
  zatcaDevicesEditDevice: "تعديل الجهاز",
  zatcaDevicesSaveDevice: "حفظ الجهاز",
  zatcaDevicesCancelEdit: "إلغاء التعديل",
  zatcaDevicesDeleteDisabled: "لا حذف للأجهزة — كل جهاز مرساة لسلسلة أختام ICV وحذفه يكسر التتبع.",
  zatcaDevicesEmpty: "لا أجهزة بعد — أنشئ جهاز EIAS لبدء ختم الفواتير برمز QR.",
  zatcaDevicesColName: "الجهاز",
  zatcaDevicesColStatus: "التسجيل",
  zatcaDevicesColCounter: "عدّاد ICV",
  zatcaDevicesColDeviceUuid: "UUID",
  zatcaDevicesColSerial: "التسلسلي",
  zatcaDevicesColBranch: "الفرع",
  zatcaDevicesColCreatedAt: "أُنشئ",
  zatcaDevicesStatusPlaceholder: "غير مسجَّل — تسجيل المرحلة الثانية (CSID) لاحقًا",
  zatcaDevicesIcvCounter: "عدّاد ICV",
  zatcaDevicesChainHead: "رأس السلسلة (أعلى ICV)",
  zatcaDevicesPickDevice: "اختر جهازًا",
  zatcaDevicesPickDeviceFirst: "اختر جهازًا لعرض سلسلته.",
  zatcaDevicesChainTitle: "سلسلة الفواتير المختومة",
  zatcaDevicesChainEmpty: "لا فواتير مختومة على هذا الجهاز بعد.",
  zatcaDevicesChainColInvoice: "الفاتورة",
  zatcaDevicesChainColIcv: "ICV",
  zatcaDevicesChainColPih: "PIH (هاش السابق)",
  zatcaDevicesChainColHash: "هاش الفاتورة",
  zatcaDevicesChainColHashVersion: "إصدار الهاش",
  zatcaDevicesChainColQr: "QR",
  zatcaDevicesChainColClassification: "التصنيف",
  zatcaDevicesChainColPosted: "وقت الترحيل",
  zatcaDevicesChainColAmount: "الإجمالي",
  zatcaDevicesClassificationStandard: "قياسية",
  zatcaDevicesClassificationSimplified: "مبسَّطة",
  zatcaDevicesClassificationNone: "غير مصنَّفة",
  zatcaDevicesQrPresent: "موجود",
  zatcaDevicesQrMissing: "غير موجود",
  zatcaDevicesGenesisPih: "أول فاتورة تحمل PIH التكويني (genesis) — لا سلف لها.",
  zatcaDevicesHashTruncated: "قيمة مجتزأة للعرض — القيمة الكاملة محفوظة في السجل.",
  zatcaDevicesVerificationTitle: "التحقق من السلسلة",
  zatcaDevicesVerificationOk: "سلسلة سليمة",
  zatcaDevicesVerificationChecked: "عدد الفواتير المفحوصة: {checked}",
  zatcaDevicesVerificationFailed: "التحقق فشل — السلسلة مكسورة",
  zatcaDevicesVerificationFailureIcv: "عند ICV",
  zatcaDevicesVerificationFailureReason: "السبب",
  zatcaDevicesVerifyNow: "إعادة التحقق",
  zatcaDevicesVerifyDone: "اكتمل التحقق — السلسلة سليمة.",
  zatcaDevicesBackfillTitle: "الإضافة الرجعية للأختام",
  zatcaDevicesBackfillPlan: "تقرير جاف",
  zatcaDevicesBackfillPlanNote: "الفواتير المرحّلة غير المختومة التي ستُختم على هذا الجهاز.",
  zatcaDevicesBackfillDryRunNote: "التقرير الجاف أولاً — لا كتابة قبل التأكيد",
  zatcaDevicesBackfillLimit: "الحد الأقصى",
  zatcaDevicesBackfillCandidates: "الفواتير المرشحة",
  zatcaDevicesBackfillColInvoice: "الفاتورة",
  zatcaDevicesBackfillColPosted: "وقت الترحيل",
  zatcaDevicesBackfillColGross: "الإجمالي",
  zatcaDevicesBackfillStampable: "قابلة للختم: {count}",
  zatcaDevicesBackfillRun: "تشغيل الختم",
  zatcaDevicesConfirmBackfill:
    "سيُختم حتى {count} فاتورة على هذا الجهاز ويُمدَّد عدّاد ICV — هل تريد المتابعة؟",
  zatcaDevicesBackfillStamped: "ما خُتم: {stamped}",
  zatcaDevicesBackfillSkipped: "ما تم تجاوزه: {skipped}",
  zatcaDevicesBackfillEmpty: "لا فواتير مرحّلة غير مختومة — لا شيء للإضافة الرجعية.",
  zatcaDevicesBackfillResults: "نتائج التشغيل",
  zatcaDevicesBackfillColIcv: "ICV الممنوح",
  zatcaDevicesIssuanceOrder: "بترتيب الإصدار (posted_at ثم created_at ثم id).",
  zatcaDevicesIdempotentNote: "العملية آمنة للتكرار وقابلة للاستئناف — المختوم سابقًا يُتجاوَز تلقائيًا.",
  zatcaDevicesBackfillRequiresVat:
    "تعذّر الختم: تتطلب أختام ZATCA تسجيل ضريبة قيمة مضافة ساريًا في السعودية (رقم البائع داخل QR).",
  zatcaDevicesCreateSuccess: "أُنشئ الجهاز — الحالة: غير مسجَّل (المرحلة الأولى).",
  zatcaDevicesUpdateSuccess: "حُفظت تعديلات الجهاز.",
  zatcaDevicesBackfillSuccess: "اكتملت الإضافة الرجعية.",
  zatcaDevicesErrorsGeneric: "تعذّر إكمال إجراء ZATCA — أعد المحاولة.",
  taxPacksTitle: "حزم الولايات القضائية",
  taxPacksEmpty: "لا توجد حزم مزروعة.",
  taxPacksCountry: "الدولة",
  taxPacksVatStatus: "حالة ضريبة القيمة المضافة",
  taxPacksVatInForce: "سارية",
  taxPacksVatPlanned: "مخططة",
  taxPacksVatNoVat: "بدون ضريبة",
  taxPacksVersion: "إصدار الحزمة",
  taxPacksVerification: "حالة التحقق",
  taxPacksVerified: "مُتحقق",
  taxPacksRequiresVerification: "يتطلب تحققًا",
  taxPacksRate: "النسبة",
  taxPacksEffectiveFrom: "ساري من",
  taxPacksEffectiveTo: "ساري حتى",
  taxPacksSource: "المرجع",
  taxPacksWindowsTitle: "نوافذ النسب",
  taxPacksNoRates: "لا توجد نوافذ نسب لهذه الحزمة.",
  taxPacksApply: "تثبيت الإصدار",
  taxPacksApplied: "تم تثبيت إصدار الحزمة للمنشأة.",
  taxPacksBinding: "الإصدار المثبَّت للمنشأة",
  taxPacksBindingNone: "لا يوجد تثبيت — تُطبَّق النسخة المزروعة تلقائيًا.",
  taxPacksPreviewNote:
    "ترقية الحزمة لا تعيد كتابة اللقطات المرحّلة — النوافذ الجديدة تسري على المستندات الجديدة فقط (BR-033).",
  vatReturnTitle: "الإقرار الضريبي",
  vatReturnEmpty: "لا توجد إقرارات ضريبية بعد.",
  vatReturnCountry: "الدولة",
  vatReturnPeriod: "الفترة",
  vatReturnPeriodStart: "بداية الفترة",
  vatReturnPeriodEnd: "نهاية الفترة",
  vatReturnStatus: "الحالة",
  vatReturnDraft: "مسودة",
  vatReturnReady: "جاهز",
  vatReturnFiled: "مقدَّم",
  vatReturnCreateTitle: "إنشاء إقرار ضريبي",
  vatReturnCreatedToast: "تم إنشاء الإقرار الضريبي.",
  vatReturnPrepare: "إعداد الإقرار",
  vatReturnPreparedToast: "تم إعداد الإقرار الضريبي.",
  vatReturnMarkFiled: "تسجيل التقديم",
  vatReturnFiledToast: "تم تسجيل تقديم الإقرار الضريبي.",
  vatReturnFilingReference: "مرجع التقديم",
  vatReturnFilingNote: "ملاحظة التقديم",
  vatReturnExport: "تصدير",
  vatReturnExportCsv: "تصدير CSV",
  vatReturnExportXlsx: "تصدير XLSX",
  vatReturnSummaryTitle: "ملخص الفترة حسب المعاملة",
  vatReturnDirection: "الاتجاه",
  vatReturnDirectionOutput: "مخرجات",
  vatReturnDirectionInput: "مدخلات",
  vatReturnTaxableBase: "الوعاء الضريبي",
  vatReturnTaxAmount: "قيمة الضريبة",
  vatReturnCrossCheck: "المطابقة مع دفتر الأستاذ",
  vatReturnDocumentSide: "جانب المستندات",
  vatReturnGlSide: "جانب دفتر الأستاذ",
  vatReturnOutputTax: "ضريبة المخرجات",
  vatReturnInputTax: "ضريبة المدخلات القابلة للخصم",
  vatReturnInputTaxExpensed: "ضريبة مدخلات محمّلة على المصروف",
  vatReturnMismatch:
    "فشلت المطابقة (INV-012) — قيم المستندات تختلف عن دفتر الأستاذ؛ يُحظر تسجيل التقديم حتى التطابق.",
  vatReturnReadyNote: "الإقرار جاهز — التطابق مع الأستاذ سليم",
  taxErrCodeTaken: "هذا الرمز الضريبي مستخدم مسبقًا لهذه الدولة.",
  taxErrCodeInUse: "الرمز مستخدم في أصناف أو فئات — أعد تعيينها قبل الأرشفة.",
  taxErrCodeArchived: "الرمز الضريبي مؤرشف ولا يمكن استخدامه في مستندات جديدة.",
  taxErrRegistrationNumber: "رقم التسجيل الضريبي مطلوب عندما تكون الحالة «مسجل» (٣ إلى ٥٠ حرفًا) ولا يُقبل في غيرها.",
  taxErrJurisdiction: "لا توجد حزمة مزروعة لهذه الدولة.",
  taxErrNoRateForDate: "لا توجد نسبة مزروعة تغطي هذا التاريخ — الاحتساب يفشل بشكل آمن.",
  taxErrWindowTaken: "يوجد إقرار ضريبي لهذه الفترة مسبقًا.",
  taxErrCrossCheck: "فشلت المطابقة مع دفتر الأستاذ — راجع الفروقات ثم أعد الإعداد.",
  taxErrState: "حالة الإقرار الضريبي لا تسمح بهذا الإجراء.",
  taxErrAlreadyFiled: "الإقرار الضريبي مقدَّم ولا يمكن تعديله.",
  taxErrPackBinding: "إصدار الحزمة غير مزروع — تُطبَّق الترقيات عبر بذور الهجرات فقط.",

  // -- T14-UI (PHASE-010): inventory & warehousing (AR canonical per GLOSSARY) ----
  navInventoryWarehouses: "المستودعات",
  navInventoryStock: "الأرصدة المتوفرة",
  navInventoryMoves: "حركات المخزون",
  navInventoryTransfers: "تحويلات المخزون",
  navInventoryCounts: "جرد المخزون",
  warehousesTitle: "المستودعات",
  warehousesEmpty: "لا توجد مستودعات بعد.",
  warehousesCreateTitle: "إنشاء مستودع",
  warehousesCodeLabel: "رمز المستودع",
  warehousesNameLabel: "الاسم (إنجليزي)",
  warehousesNameArLabel: "الاسم (عربي)",
  warehousesBranchLabel: "الفرع",
  warehousesGlAccountLabel: "حساب المخزون في الأستاذ (اختياري)",
  warehousesNoteLabel: "ملاحظة",
  warehousesCreatedToast: "تم إنشاء المستودع.",
  warehousesDeactivate: "تعطيل",
  warehousesDeactivateTitle: "تعطيل المستودع",
  warehousesDeactivateConfirm: "تعطيل المستودع يمنع الحركات الجديدة عليه؛ تاريخ الحركات يبقى كما هو.",
  warehousesDeactivatedToast: "تم تعطيل المستودع.",
  warehousesReactivate: "إعادة التفعيل",
  warehousesReactivatedToast: "تمت إعادة تفعيل المستودع.",
  warehousesColCode: "الرمز",
  warehousesColBranch: "الفرع",
  warehousesColGlAccount: "حساب الأستاذ",
  stockTitle: "الأرصدة المتوفرة",
  stockEmpty: "لا توجد أرصدة مخزنية بعد.",
  stockFilterWarehouse: "المستودع",
  stockColItem: "الصنف",
  stockColWarehouse: "المستودع",
  stockColQty: "الكمية",
  stockColAvgCost: "متوسط التكلفة",
  stockNegativeBadge: "رصيد سالب",
  movesTitle: "حركات المخزون",
  movesEmpty: "لا توجد حركات مخزون بعد.",
  movesFilterDirection: "الاتجاه",
  movesFilterKind: "نوع الحركة",
  movesColDate: "التاريخ",
  movesColDirection: "الاتجاه",
  movesColKind: "النوع",
  movesColUnitCost: "تكلفة الوحدة",
  movesColValue: "القيمة",
  movesColReason: "السبب",
  movesColBatch: "الدفعة",
  movesColSerial: "الرقم التسلسلي",
  movesColSource: "المصدر",
  movesDirectionIn: "إدخال",
  movesDirectionOut: "إخراج",
  movesKindReceipt: "استلام",
  movesKindIssue: "صرف",
  movesKindTransferIn: "تحويل وارد",
  movesKindTransferOut: "تحويل صادر",
  movesKindAdjust: "تسوية",
  movesReasonDamage: "تلف",
  movesReasonExpired: "انتهاء صلاحية",
  movesReasonCountLoss: "عجز جرد",
  movesReasonCountGain: "زيادة جرد",
  movesReasonCustomerReturn: "مرتجع عميل",
  movesReasonOther: "أخرى",
  // PHASE-035 (T-02): سجل الدفعات والصلاحية
  batchesTitle: "الدفعات والصلاحية",
  batchesEmpty: "لا توجد دفعات مسجلة",
  batchesSearchLabel: "بحث (رمز الصنف / رقم الدفعة / المرجع)",
  batchesFilterExpired: "الصلاحية",
  batchesExpiredOnly: "المنتهية فقط",
  batchesExpiredBadge: "منتهية",
  batchesColNo: "رقم الدفعة",
  batchesColExpiry: "تاريخ الصلاحية",
  batchesColSource: "المرجع",
  batchesStatusActive: "نشطة",
  batchesStatusWrittenOff: "مشطوبة",
  batchesNewTitle: "تسجيل دفعة",
  batchesItemLabel: "الصنف",
  batchesNoLabel: "رقم الدفعة",
  batchesExpiryLabel: "تاريخ الصلاحية",
  batchesSourceLabel: "المرجع (اختياري)",
  batchesCreate: "تسجيل",
  batchesCreatedToast: "تم تسجيل الدفعة",
  batchesWriteOff: "شطب منتهي الصلاحية",
  batchesWriteOffTitle: "شطب دفعة",
  batchesWriteOffHint: "يشطب رصيد الدفعة بالكامل بقيد مصروف منتهي الصلاحية واحد",
  batchesWriteOffDate: "تاريخ القيد",
  batchesWriteOffConfirm: "تأكيد الشطب",
  batchesWriteOffCancel: "إلغاء",
  batchesWrittenOffToast: "تم شطب الدفعة وترحيل قيدها",
  // PHASE-035 (T-03): سجل الأرقام التسلسلية
  serialsTitle: "الأرقام التسلسلية",
  serialsEmpty: "لا توجد أرقام تسلسلية مسجلة",
  serialsSearchLabel: "بحث (رمز الصنف / الرقم التسلسلي / IMEI)",
  serialsFilterStatus: "الحالة",
  serialsColNo: "الرقم التسلسلي",
  serialsColImei: "IMEI",
  serialsColSoldAt: "تاريخ البيع",
  serialsColReturnedAt: "تاريخ الإرجاع",
  serialsStatusInStock: "متوفر",
  serialsStatusSold: "مبيع",
  serialsStatusReturned: "مُرْجَع",
  serialsSaleView: "عرض حركة البيع",
  serialsNewTitle: "تسجيل رقم تسلسلي",
  serialsItemLabel: "الصنف",
  serialsNoLabel: "الرقم التسلسلي",
  serialsImeiLabel: "IMEI (اختياري)",
  serialsImeiHint: "من ١٥ إلى ١٧ رقمًا",
  serialsCreate: "تسجيل",
  serialsCreatedToast: "تم تسجيل الرقم التسلسلي",
  serialsSaleTitle: "حركة البيع الأصلية",
  serialsSaleClose: "إغلاق",
  serialsSaleLoading: "جارٍ التحميل…",
  serialsSaleNone: "لم يُبَع هذا الرقم التسلسلي بعد",
  serialsSaleUnitCost: "تكلفة الوحدة",
  serialsSaleMovedAt: "تاريخ الحركة",
  serialsSaleWarehouse: "المستودع",
  // PHASE-035 (T-04): سجل تسويات المخزون (عرض فقط)
  adjustmentsTitle: "تسويات المخزون",
  adjustmentsEmpty: "لا توجد تسويات",
  adjustmentsSearchLabel: "بحث (رمز الصنف / رقم التسوية / الملاحظة)",
  adjustmentsFilterStatus: "الحالة",
  adjustmentsColNo: "رقم التسوية",
  adjustmentsColItem: "الصنف",
  adjustmentsColDelta: "فرق الكمية",
  adjustmentsColPostingDate: "تاريخ الترحيل",
  adjustmentsColNote: "ملاحظة",
  adjustmentsStatusDraft: "مسودة",
  adjustmentsStatusPosted: "مرحّلة",
  adjustmentsStatusCancelled: "ملغاة",
  adjustmentsReadNote: "هذه شاشة عرض فقط — تُنشأ التسويات وتُرحّل من خلال جلسات جرد المخزون (نية تصميمية موثقة).",
  transfersTitle: "تحويلات المخزون",
  transfersEmpty: "لا توجد تحويلات بعد.",
  transfersColNo: "رقم التحويل",
  transfersColFrom: "من مستودع",
  transfersColTo: "إلى مستودع",
  transfersColLines: "البنود",
  transfersColDispatchDate: "تاريخ الإرسال",
  transfersColReceiveDate: "تاريخ الاستلام",
  transfersStatusInTransit: "في الطريق",
  transfersNewTitle: "تحويل جديد",
  transfersFromLabel: "من مستودع",
  transfersToLabel: "إلى مستودع",
  transfersNoteLabel: "ملاحظة",
  transfersLinesTitle: "بنود التحويل",
  transfersLineItemLabel: "الصنف",
  transfersLineQtyLabel: "الكمية",
  transfersAddLine: "إضافة بند",
  transfersRemoveLine: "حذف البند",
  transfersSameWarehouseError: "يجب أن يختلف مستودع الإرسال عن مستودع الاستلام.",
  transfersLineMissingError: "كل بند يحتاج صنفًا وكمية موجبة.",
  transfersCreatedToast: "تم إنشاء التحويل (مسودة).",
  transfersDispatch: "إرسال",
  transfersDispatchedToast: "تم إرسال التحويل — المخزون في الطريق (غير متاح للبيع).",
  transfersReceive: "استلام",
  transfersReceivedToast: "تم استلام التحويل في المستودع الوجهة.",
  transfersCancel: "إلغاء",
  transfersCancelledToast: "تم إلغاء التحويل.",
  countingTitle: "جرد المخزون",
  countingEmpty: "لا توجد جلسات جرد بعد.",
  countingNewTitle: "جلسة جرد جديدة",
  countingWarehouseLabel: "المستودع",
  countingBlindLabel: "جرد أعمى (إخفاء الكميات الدفترية)",
  countingPickItemsTitle: "اختيار الأصناف",
  countingPickSearchPlaceholder: "ابحث بالرمز أو الاسم…",
  countingPickEmpty: "لا توجد أصناف مطابقة.",
  countingSelectedCount: "الأصناف المختارة",
  countingCreate: "إنشاء الجلسة",
  countingCreatedToast: "تم إنشاء جلسة الجرد وتجميد لقطة الكميات.",
  countingColNo: "رقم الجرد",
  countingColBlind: "أعمى",
  countingBlindYes: "نعم",
  countingBlindNo: "لا",
  countingColVariance: "الفروقات",
  countingOpenSession: "فتح الجلسة",
  countingCloseSession: "إغلاق الجلسة",
  countingSnapshotAt: "تاريخ اللقطة",
  countingSessionLinesTitle: "بنود الجرد",
  countingColLineNo: "البند",
  countingColSystemQty: "الكمية الدفترية",
  countingColCountedQty: "الكمية المعدودة",
  countingColDiff: "الفرق",
  countingColValueImpact: "الأثر القيمي",
  countingSaveEntries: "حفظ العدّ",
  countingEntriesSavedToast: "تم حفظ كميات العدّ.",
  countingSubmit: "تقديم للمراجعة",
  countingSubmittedToast: "تم تقديم الجلسة لمراجعة الفروقات.",
  countingReviewTitle: "مراجعة الفروقات",
  countingReviewHint: "راجع الفروقات قبل الاعتماد — الاعتماد يرحّل تسوية الجرد (عجز/زيادة) عبر محرك الترحيل.",
  countingApprove: "اعتماد",
  countingApproveSupervisor: "اعتماد بموافقة مشرف",
  countingApprovedToast: "تم اعتماد الجرد وترحيل التسوية.",
  countingCancel: "إلغاء",
  countingCancelledToast: "تم إلغاء جلسة الجرد.",
  countingRecountTitle: "إعادة عدّ بند",
  countingRecountLineLabel: "رقم البند",
  countingRecountNoteLabel: "سبب إعادة العدّ",
  countingRecountedToast: "تم تسجيل إعادة العدّ بمراجعة.",
  countingStatusCounted: "معدود",
  countingStatusVarianceReview: "مراجعة الفروقات",
  inventoryErrWarehouseCodeTaken: "رمز المستودع مستخدم مسبقًا.",
  inventoryErrWarehouseInactive: "المستودع غير مفعّل.",
  inventoryErrWarehouseNotDeactivatable: "لا يمكن تعطيل المستودع (حركات أو جلسات جرد جارية).",
  inventoryErrItemNotStocked: "الصنف غير مُخزّن في هذا المستودع.",
  inventoryErrInsufficientStock: "الكمية المتوفرة لا تكفي (السماح بالسالب معطّل افتراضيًا).",
  inventoryErrBatchInsufficient: "كمية الدفعة لا تكفي.",
  inventoryErrBatchRequired: "الصنف يتتبع الدفعات — الدفعة مطلوبة.",
  inventoryErrBatchTaken: "رقم الدفعة مستخدم مسبقًا لهذا الصنف.",
  inventoryErrSerialRequired: "الصنف يتتبع الأرقام التسلسلية — حدد الوحدات.",
  inventoryErrSerialNotInStock: "الوحدة التسلسلية غير متوفرة في المخزون.",
  inventoryErrSerialTaken: "الرقم التسلسلي مستخدم مسبقًا.",
  inventoryErrSerialReturnBinding: "مرتجع الصنف التسلسلي يجب أن يشير إلى الوحدة المبيعة أصلًا.",
  inventoryErrState: "حالة المستند لا تسمح بهذا الإجراء.",
  inventoryErrTransferEmpty: "التحويل يحتاج بندًا واحدًا على الأقل.",
  inventoryErrTransferSameWarehouse: "يجب أن يختلف مستودعا الإرسال والاستلام.",
  inventoryErrCountTolerance: "الفروق يتجاوز الحد المسموح — يلزم اعتماد المشرف.",
  inventoryErrMethodSwitchInFlight: "لا يمكن تغيير طريقة التقييم مع حركات جارية.",
  inventoryErrMethodSwitchInvalid: "تغيير طريقة التقييم غير صالح (لا يوجد رصيد أو نفس الطريقة).",
  inventoryErrMethodSwitchSame: "الصنف يستخدم هذه الطريقة بالفعل.",
  // PHASE-011 purchasing (T13-UI).
  purchasingEmpty: "لا توجد مستندات بعد",
  purchasingNoticeCreated: "تم إنشاء المستند",
  purchasingNoticeUpdated: "تم التحديث",
  purchasingNoticePosted: "تم الترحيل",
  expensesColAccount: "الحساب",
  navPurchasingOrders: "أوامر الشراء",
  navPurchasingReceipts: "سندات الاستلام",
  navPurchasingInvoices: "فواتير الموردين",
  navPurchasingDebitNotes: "الإشعارات المدينة",
  navPurchasingAp: "حسابات الموردين",
  purchasingOrdersTitle: "المشتريات — أوامر الشراء",
  purchasingReceiptsTitle: "المشتريات — سندات الاستلام",
  purchasingInvoicesTitle: "المشتريات — فواتير الموردين",
  purchasingDebitNotesTitle: "المشتريات — الإشعارات المدينة",
  purchasingApTitle: "المشتريات — حسابات الموردين",
  purchasingRequestsSection: "طلبات الشراء",
  purchasingOrdersSection: "أوامر الشراء",
  purchasingNewRequest: "طلب شراء جديد",
  purchasingNewOrder: "أمر شراء جديد",
  purchasingRequestNo: "رقم الطلب",
  purchasingNeededBy: "مطلوب بحلول",
  purchasingSubmit: "إرسال",
  purchasingApprove: "اعتماد",
  purchasingReject: "رفض",
  purchasingIssue: "إصدار",
  purchasingClose: "إغلاق",
  purchasingCancel: "إلغاء",
  purchasingOrderNo: "رقم الأمر",
  purchasingOrderDate: "تاريخ الأمر",
  purchasingExpectedDate: "تاريخ التسليم المتوقع",
  purchasingSupplier: "المورد",
  purchasingLines: "البنود",
  purchasingAddLine: "إضافة بند",
  purchasingRemoveLine: "حذف البند",
  purchasingItem: "الصنف",
  purchasingQty: "الكمية",
  purchasingUnitPrice: "سعر الوحدة",
  purchasingTaxCode: "رمز الضريبة",
  purchasingUnitCost: "تكلفة الوحدة",
  purchasingTotalNet: "الصافي",
  purchasingTotalTax: "الضريبة",
  purchasingTotalGross: "الإجمالي",
  purchasingStatus: "الحالة",
  purchasingNewReceipt: "سند استلام جديد",
  purchasingReceiptNo: "رقم السند",
  purchasingReceiptDate: "تاريخ الاستلام",
  purchasingWarehouse: "المستودع",
  purchasingPo: "أمر الشراء",
  purchasingPoLessReason: "سبب الشراء المباشر (بدون أمر)",
  purchasingPost: "ترحيل",
  purchasingBatchNo: "رقم التشغيلة",
  purchasingBatchExpiry: "تاريخ الانتهاء",
  purchasingNewInvoice: "فاتورة مورد جديدة",
  purchasingInvoiceNo: "رقم فاتورة المورد",
  purchasingInvoiceDate: "تاريخ الفاتورة",
  purchasingDueDate: "تاريخ الاستحقاق",
  purchasingInternalNo: "الرقم الداخلي",
  purchasingMatchStatus: "حالة المطابقة",
  purchasingMatchPreview: "معاينة المطابقة الثلاثية",
  purchasingRecordMatch: "تسجيل المطابقة",
  purchasingDisposition: "المعالجة",
  purchasingDispositionReason: "سبب المعالجة",
  purchasingDispositionAccept: "قبول مع السبب",
  purchasingMatchOutcomeMatched: "مطابقة",
  purchasingMatchOutcomeException: "استثناء",
  purchasingMatchOutcomeDispositioned: "معالَج",
  purchasingMatchOutcomePending: "قيد المطابقة",
  purchasingQtyVariance: "فرق الكمية %",
  purchasingPriceVariance: "فرق السعر %",
  purchasingNewDebitNote: "إشعار مدين جديد",
  purchasingNoteNo: "رقم الإشعار",
  purchasingNoteDate: "تاريخ الإشعار",
  purchasingRefInvoice: "الفاتورة المرجعية",
  purchasingApAging: "أعمار الديون",
  purchasingApStatement: "كشف حساب المورد",
  purchasingGrniRegister: "سجل البضاعة غير المفوترة",
  purchasingAgingNotDue: "غير مستحق",
  purchasingAging1_30: "١-٣٠ يوم",
  purchasingAging31_60: "٣١-٦٠ يوم",
  purchasingAging61_90: "٦١-٩٠ يوم",
  purchasingAging90Plus: "أكثر من ٩٠",
  purchasingAgingTotal: "الإجمالي",
  purchasingAsOf: "كما في",
  purchasingOpeningBalance: "الرصيد الافتتاحي",
  purchasingClosingBalance: "الرصيد الختامي",
  purchasingDebit: "مدين",
  purchasingCredit: "دائن",
  purchasingBalance: "الرصيد",
  purchasingOutstanding: "المتبقي",
  purchasingReceivedValue: "القيمة المستلمة",
  purchasingInvoicedValue: "القيمة المفوترة",
  purchasingGrniRemaining: "غير مفوتر",
  purchasingSelectSupplier: "اختر المورد",
  purchasingSelectWarehouse: "اختر المستودع",
  purchasingSelectPo: "اختر أمر الشراء",
  purchasingNoPo: "بدون أمر شراء",
  purchasingErrState: "حالة المستند لا تسمح بهذه العملية",
  purchasingErrDuplicate: "فاتورة مكررة للمورد (الرقم والمبلغ)",
  purchasingErrMatchMissing: "سجّل نتيجة المطابقة الثلاثية أولاً",
  purchasingErrMatchException: "استثناءات مطابقة بلا معالجة — عالجها أولاً",
  purchasingErrPoLess: "السياسة تمنع الاستلام بدون أمر شراء",
  purchasingErrPoLessReason: "سبب الشراء المباشر مطلوب",
  purchasingErrOverReceipt: "الكمية المستلمة تتجاوز بند أمر الشراء",
  purchasingErrOverInvoice: "الكمية المفوترة تتجاوز الكمية المستلمة",
  purchasingErrNotSupplier: "الجهة ليست موردًا",
  purchasingErrGrnSupplier: "بند الاستلام يخص موردًا آخر",
  purchasingErrSelfApproval: "لا يمكن لمنشئ المستند اعتماده",
  purchasingErrReallocation: "إعادة التخصيص تتجاوز الحدود المسموحة",
  // PHASE-012 sales (T13-UI).
  salesEmpty: "لا توجد مستندات بعد",
  salesNoticeCreated: "تم إنشاء المستند",
  salesNoticeUpdated: "تم التحديث",
  salesNoticePosted: "تم الترحيل",
  navSalesQuotes: "عروض الأسعار",
  navSalesOrders: "أوامر البيع",
  navSalesDeliveries: "سندات التسليم",
  navSalesInvoices: "فواتير البيع",
  navSalesCreditNotes: "الإشعارات الدائنة",
  navSalesAr: "حسابات العملاء",
  salesQuotesTitle: "المبيعات — عروض الأسعار وأوامر البيع",
  salesOrdersTitle: "المبيعات — أوامر البيع",
  salesDeliveriesTitle: "المبيعات — سندات التسليم",
  salesInvoicesTitle: "المبيعات — فواتير البيع",
  salesCreditNotesTitle: "المبيعات — الإشعارات الدائنة",
  salesArTitle: "المبيعات — حسابات العملاء",
  salesQuotesSection: "عروض الأسعار",
  salesOrdersSection: "أوامر البيع",
  salesStatus: "الحالة",
  salesStatusSent: "مُرسل",
  salesNewQuote: "عرض سعر جديد",
  salesNewOrder: "أمر بيع جديد",
  salesQuoteNo: "رقم العرض",
  salesQuoteDate: "تاريخ العرض",
  salesValidUntil: "صالح حتى",
  salesOrderNo: "رقم الأمر",
  salesOrderDate: "تاريخ الأمر",
  salesExpectedDate: "تاريخ التسليم المتوقع",
  salesSalesOrder: "أمر البيع",
  salesNoOrder: "بدون أمر بيع",
  salesCustomer: "العميل",
  salesSelectCustomer: "اختر العميل",
  salesBranch: "الفرع",
  salesSelectBranch: "اختر الفرع",
  salesWarehouse: "المستودع",
  salesSelectWarehouse: "اختر المستودع",
  salesCurrency: "العملة",
  salesExchangeRate: "سعر الصرف",
  salesItem: "الصنف",
  salesQty: "الكمية",
  salesUnitPrice: "سعر الوحدة",
  salesDiscount: "الخصم",
  salesTaxCode: "رمز الضريبة",
  salesAccount: "الحساب",
  salesLines: "البنود",
  salesAddLine: "إضافة بند",
  salesRemoveLine: "حذف البند",
  salesTotalNet: "الصافي",
  salesTotalTax: "الضريبة",
  salesTotalGross: "الإجمالي",
  salesSend: "إرسال",
  salesAccept: "قبول وتحويل",
  salesReject: "رفض",
  salesSubmit: "إرسال للاعتماد",
  salesApprove: "اعتماد",
  salesIssue: "إصدار",
  salesClose: "إغلاق",
  salesPost: "ترحيل",
  salesCancel: "إلغاء",
  salesCancelReason: "سبب الإلغاء",
  salesReserve: "حجز المخزون",
  salesAcceptWarehouse: "مستودع التحويل",
  salesNewDelivery: "سند تسليم جديد",
  salesDeliveryNo: "رقم السند",
  salesDeliveryDate: "تاريخ التسليم",
  salesDelivery: "سند التسليم",
  salesCogsValue: "تكلفة البضاعة المباعة",
  salesNewInvoice: "فاتورة بيع جديدة",
  salesInvoiceNo: "رقم الفاتورة",
  salesInvoiceDate: "تاريخ الفاتورة",
  salesDueDate: "تاريخ الاستحقاق",
  salesKind: "نوع الفاتورة",
  salesKindCash: "نقدية",
  salesKindCredit: "آجلة",
  salesCashAccount: "الحساب النقدي",
  salesSelectCashAccount: "اختر الحساب النقدي",
  salesOverrideCredit: "تجاوز حد الائتمان",
  salesCreditCheck: "فحص الائتمان",
  salesCreditAllow: "مسموح",
  salesCreditWarn: "تحذير",
  salesCreditBlock: "ممنوع",
  salesNewCreditNote: "إشعار دائن جديد",
  salesNoteNo: "رقم الإشعار",
  salesNoteDate: "تاريخ الإشعار",
  salesRefInvoice: "الفاتورة المرجعية",
  salesInvoiceLineId: "معرّف بند الفاتورة",
  salesReturnToStock: "إرجاع إلى المخزون",
  salesArAging: "أعمار الديون",
  salesArStatement: "كشف حساب العميل",
  salesArOpenItems: "البنود المفتوحة",
  salesOpenItemsHint: "هذه البنود هي سطح التخصيص الذي تستهلكه سندات القبض (FIFO / جزئي / دفعة مقدمة)",
  salesAgingNotDue: "غير مستحق",
  salesAging1_30: "١-٣٠ يوم",
  salesAging31_60: "٣١-٦٠ يوم",
  salesAging61_90: "٦١-٩٠ يوم",
  salesAging90Plus: "أكثر من ٩٠",
  salesAgingTotal: "الإجمالي",
  salesAsOf: "كما في",
  salesOpeningBalance: "الرصيد الافتتاحي",
  salesClosingBalance: "الرصيد الختامي",
  salesDebit: "مدين",
  salesCredit: "دائن",
  salesBalance: "الرصيد",
  salesOutstanding: "المتبقي",
  salesBaseBalance: "الرصيد بالعملة الأساسية",
  salesSubledgerTie: "ربط دفتر العملاء المساعد",
  salesTieOk: "متطابق",
  salesTieBroken: "غير متطابق",
  salesSource: "المصدر",
  salesAmount: "المبلغ",
  salesRunOverdueScan: "فحص الفواتير المتأخرة",
  salesOverdueScanDone: "اكتمل الفحص: {overdue} فاتورة متأخرة، {alerted} تنبيه",
  salesPrint: "طباعة",
  salesPrintDisabled: "الطباعة متاحة عند إصدار التقارير (PHASE-013)",
  salesErrState: "حالة المستند لا تسمح بهذه العملية",
  salesErrQuotationExpired: "انتهت صلاحية عرض السعر — أصدر عرضًا جديدًا",
  salesErrCreditLimit: "تجاوز حد الائتمان (المنع أو التحذير وفق السياسة)",
  salesErrReturnWindow: "مرتجع خارج فترة الإرجاع المسموحة",
  salesErrPriceChanged: "تغيّر السعر — أعد فتح المستند لإعادة الاحتساب",
  salesErrItemInactive: "الصنف غير مفعّل ولا يقبل مستندات البيع",
  salesErrDeliveryInvoiced: "الكمية المفوترة تتجاوز الكمية المسلّمة",
  salesErrCreditNoteExceeds: "الإشعار الدائن يتجاوز المتبقي على الفاتورة",
  salesErrReallocation: "إعادة التخصيص تتجاوز الحدود المسموحة",

  // -- T-WEB (PHASE-013): مساحة التقارير (النموذج §7) -----------------------
  navReports: "التقارير",
  reportsNavWorkspace: "تقارير المنشأة",
  reportWorkspaceTitle: "تقارير المنشأة",
  reportWorkspaceCatalog: "كتالوج التقارير",
  reportWorkspaceNoReport: "لم يتم اختيار تقرير بعد — اختر تقريرًا من الكتالوج",
  reportWorkspaceDateFrom: "من تاريخ",
  reportWorkspaceDateTo: "إلى تاريخ",
  reportWorkspaceAsOfLabel: "تاريخ اللقطة",
  reportWorkspaceLocale: "لغة التقرير",
  reportWorkspaceRun: "تشغيل التقرير",
  reportWorkspaceQueued: "في قائمة الانتظار",
  reportWorkspaceRunning: "قيد التنفيذ",
  reportWorkspaceStage: "المرحلة",
  reportWorkspaceStatus: "الحالة",
  reportWorkspaceStatusSucceeded: "مكتملة",
  reportWorkspaceStatusFailed: "فاشلة",
  reportWorkspaceDuration: "المدة",
  reportWorkspaceTotals: "الإجماليات",
  reportWorkspaceAssertions: "تأكيدات المطابقة",
  reportWorkspaceAssertionFailed: "فشل تأكيد المطابقة — التصدير معطّل",
  reportWorkspaceAsOf: "كما في {date}",
  reportWorkspaceComputedAt: "وقت الاحتساب {datetime}",
  reportWorkspaceEmpty: "لا توجد صفوف في هذه النتيجة",
  reportWorkspaceSavedViews: "المشاهدات المحفوظة",
  reportWorkspaceSaveView: "حفظ المشهد الحالي",
  reportWorkspaceViewNameAr: "اسم المشهد (عربي)",
  reportWorkspaceViewNameEn: "اسم المشهد (إنجليزي)",
  reportWorkspaceApply: "تطبيق",
  reportWorkspaceDeleteView: "حذف",
  reportWorkspaceRunHistory: "سجل التشغيلات",
  reportWorkspaceRefresh: "تحديث",
  reportWorkspaceBack: "العودة إلى الكتالوج",
  reportWorkspaceExportPdf: "تصدير PDF",
  reportWorkspaceExportXlsx: "تصدير XLSX",
  reportWorkspaceExportCsv: "تصدير CSV",
  reportWorkspacePrintPreview: "معاينة الطباعة",
  reportWorkspaceExportBlocked: "التصدير محجوب: فشل فحص المطابقة لهذه النتيجة",
  reportWorkspaceViewSaved: "تم حفظ المشهد",
  reportWorkspaceColReport: "التقرير",
  reportWorkspaceNoRuns: "لا توجد تشغيلات سابقة",

  // -- T19-WEB (PHASE-014): subscription, billing, onboarding & dashboards --
  navDashboard: "لوحة المعلومات",
  statusTrial: "تجريبي",
  statusPastDue: "متأخر السداد",
  statusGraceReadOnly: "فترة سماحية (قراءة فقط)",
  readOnlyBanner:
    "وضع القراءة فقط: الفترة السماحية — الترحيل معلّق مؤقتًا؛ التقارير والتصدير والطباعة متاحة. ادفع أو قم بترقية الخطة لاستعادة القدرة على الترحيل.",
  readOnlyPayNow: "الدفع الآن",
  readOnlyError:
    "وضع القراءة فقط: الترحيل معلّق مؤقتًا خلال الفترة السماحية — الدفع هو إجراء الحل",
  readOnlyReason:
    "الوضع للقراءة فقط خلال الفترة السماحية — إجراءات الإنشاء والتعديل تعود بعد الدفع",

  pricingTitle: "الأسعار والخطط",
  pricingIntro:
    "خطط الخدمة الذاتية الثلاث — كل الأسعار والحدود قيم تمهيدية من بيانات الخطة نفسها (لا أرقام ثابتة في الصفحة).",
  pricingPlaceholderNote:
    "⚠ جميع الأسعار قيم تمهيدية (OQ-002) — بانتظار اعتماد الأسعار؛ الأرقام المعروضة تأتي من إعداد الخطط فقط.",
  pricingPlaceholderBadge: "سعر تمهيدي — بانتظار اعتماد الأسعار (OQ-002)",
  pricingPlansHeading: "الخطط",
  pricingMonthly: "شهريًا",
  pricingAnnual: "سنويًا",
  pricingHighlightBadge: "الأكثر ملاءمة",
  pricingCta: "اختر الخطة",
  pricingMatrixHeading: "مقارنة الميزات",
  pricingMatrixHint:
    "عدد مفاتيح الميزات المتاحة لكل خطة من مجموع مفاتيح العائلة عبر الخطط الثلاث (مشتق من مفاتيح ميزات الخطة).",
  pricingMatrixArea: "المجال",
  pricingMatrixCellOf: "{present} من {total}",
  pricingFamilyPlatform: "المنصة",
  pricingFamilyAccounting: "المحاسبة",
  pricingFamilyTrade: "البيانات الأساسية والتجارة",
  pricingFamilyTreasuryTax: "الخزينة والضرائب",
  pricingFamilyReporting: "التقارير",
  pricingFamilyGrowth: "طبقة النمو",
  pricingHaveAccount: "لديك حساب بالفعل؟",
  pricingGoLogin: "تسجيل الدخول",

  landingKicker: "منصة ERP للأعمال في المنطقة",
  landingHeroTitle:
    "منصة واحدة صارمة المحاسبة… تتحوّل إلى نشاطك التجاري",
  landingHeroSubtitle:
    "قاعدة مالية موثوقة بقيد مزدوج ومحرك ترحيل مركزي، بواجهة عربية أولًا من اليمين إلى اليسار، وقوالب جاهزة لثلاثة عشر نشاطًا تجاريًا — من متجر التجزئة إلى المصنع والمعمل والمزرعة.",
  landingCtaStartFree: "ابدأ مجانًا",
  landingCtaStartFreeNote: "تجربة بدون بطاقة — تنشئ حسابك ومساحة عملك خلال دقائق",
  landingCtaPricing: "اطّلع على الخطط والأسعار",
  landingCtaLogin: "لديك حساب؟ سجّل الدخول",
  landingTrustCore: "قيد مزدوج ومحرك ترحيل مركزي لكل مستند",
  landingTrustBilingual: "عربي/إنجليزي كامل مع RTL أصيل وطباعة عربية صحيحة",
  landingTrustIndustries: "قوالب صناعات جاهزة — إعدادات لا فروع كود",
  landingTrustOffline: "نقاط البيع والمبيعات الميدانية تعمل دون اتصال",
  landingFeaturesHeading: "لماذا هذه المنصة؟",
  landingFeaturesIntro:
    "أربعة أعمدة صمّمت لأعمال تنمو: من كاونتر واحد إلى فروع متعددة ومصنع ومندوبين ومزارع — على نفس النواة المالية الصارمة.",
  landingFeatureCoreTitle: "نواة محاسبية واحدة لا تُساوَم",
  landingFeatureCoreBody:
    "قيد مزدوج، دليل حسابات ثنائي اللغة، فترات مالية وإقفالات، وتقارير مالية جاهزة — كل مستند يمر عبر محرك الترحيل المركزي نفسه، لأي نشاط وأي خطة. الصحة المحاسبية ليست خدمة إضافية مدفوعة.",
  landingFeatureBilingualTitle: "عربي أولاً — لا ترجمة متأخرة",
  landingFeatureBilingualBody:
    "واجهة عربية أصيلة من اليمين إلى اليسار مع مرادفات لكل نشاط (المريض، المطالبة، بوليصة الشحن…)، وطباعة فواتير A4 و94مم عربية صحيحة، وإنجليزية كاملة عند الحاجة — لكل مستخدم وكل شاشة وكل تقرير.",
  landingFeatureIndustriesTitle: "قوالب الصناعات بدل فروع الكود",
  landingFeatureIndustriesBody:
    "اختر نشاطك عند التسجيل: تجزئة، بقالة، مطعم، ورشة سيارات، توزيع ميداني، مصنع غذائي، مكتب مهني، تأجير ولوجستيات، جملة، إلكترونيات، رعاية صحية، تعليم، زراعة — القالب يضبط المصطلحات والقوائم والتقارير والسياسات فوق النواة المشتركة.",
  landingFeatureJurisdictionTitle: "حزم ضريبية حسب الدولة",
  landingFeatureJurisdictionBody:
    "حزم ولايات مُصدّرة (السعودية 15%، الإمارات 5%، ودول بلا ضريبة مثل الكويت واليمن) تدير الأكواد والإقرارات والفوترة الإلكترونية عبر محولات قابلة للتحقق — القانون نسخ مُدارة لا كود مكتوب يدويًا.",
  landingFeatureOfflineTitle: "يعمل حيث تنقطع الشبكة",
  landingFeatureOfflineBody:
    "نقاط البيع تكمل البيع دون إنترنت بأرقام OFF- قابلة للمطابقة، والمندوب الميداني يبيع من مخزون السيارة ثم يزامن — الخادم يبقى المرجع للسجلات المالية المرحّلة، بلا كتابة عمياء للمال.",
  landingFeaturePlatformTitle: "منصة تديرها لوحة تحكم واحدة",
  landingFeaturePlatformBody:
    "إدارة مستأجرين وخطط واستحقاقات من لوحة المنصة، مع أدوار وصلاحيات دقيقة لكل فرع، ومسارات موافقات، وسجل تدقيق لا يُمحى — من مشروع شخص واحد إلى مؤسسة متعددة الكيانات بتوحيد مالي.",
  landingIndustriesHeading: "الأنشطة التجارية المدعومة",
  landingIndustriesIntro:
    "القوالب المسجلة في محرّك الصناعات (تُقرأ مباشرة من السجل — المصدر الوحيد للحقيقة): اختر نشاطك عند التسجيل أو من معالج التهيئة، وبدّله لاحقًا دون فقدان بياناتك.",
  landingIndustriesUnavailable:
    "تعذّر تحميل قائمة الأنشطة الآن — تفضل بالانتقال إلى صفحة التسجيل لاختيار النشاط.",
  landingIndustriesCountLabel: "نشاطًا تجاريًا جاهزًا",
  landingIndustriesVersionLabel: "الإصدار",
  landingIndustriesCta: "اختر نشاطك وابدأ",
  landingPlansHeading: "ثلاث خطط للخدمة الذاتية",
  landingPlansIntro:
    "كل خطة تشمل النواة المحاسبية كاملة — الأسعار والحدود تُقرأ من إعداد الخطط (قيم تمهيدية OQ-002).",
  landingPlansCta: "مقارنة الخطط كاملة",
  landingFooterNote:
    "«المنصة» — منصة ERP شاملة للأعمال في المنطقة: محاسبة صارمة، تجارة ومخزون، خزينة وضرائب، تقارير، عمل دون اتصال، وتطبيقات سطح مكتب وأندرويد.",
  landingSkipToRegister: "انتقل مباشرة إلى التسجيل",

  checkoutTitle: "إتمام الدفع",
  checkoutGraceNote: "هذه الصفحة متاحة في وضع القراءة فقط — الدفع هو إجراء الحل.",
  checkoutPlansHeading: "اختر الخطة",
  checkoutCurrentPlan: "خطتك الحالية",
  checkoutSelected: "محددة",
  checkoutChoose: "اختر",
  checkoutConfirmTitle: "تأكيد طلب الخطة",
  checkoutConfirmMeta: "الخطة: {plan} — {price} (سعر تمهيدي)",
  checkoutPeriodLabel: "مدة الفترة",
  checkoutPeriodMonths: "{months} شهر",
  checkoutConfirmButton: "متابعة إلى الدفع",
  checkoutCancelSelection: "إلغاء التحديد",
  checkoutSessionTitle: "جلسة الدفع",
  checkoutInvoiceMeta: "الفاتورة {number} — خطة {plan}",
  checkoutPeriod: "الفترة",
  checkoutDueDate: "تاريخ الاستحقاق",
  checkoutAmount: "المبلغ",
  checkoutPayNow: "ادفع الآن (وضع الاختبار)",
  checkoutSimulateFailure: "محاكاة فشل الدفع",
  checkoutSandboxNote:
    "وضع الاختبار: بوابة الدفع في وضع الحماية (sandbox) — لا مدفوعات حقيقية؛ الدفع يمر عبر خط الويب هوك نفسه.",
  checkoutSuccessTitle: "تم الدفع بنجاح",
  checkoutSuccessBody:
    "تمت تسوية الفاتورة وتفعيل الخطة. ستظهر الفاتورة مسددة في سجل الفواتير، ويمكنك متابعة عملك من لوحة المعلومات.",
  checkoutFailureTitle: "فشل الدفع (محاكاة)",
  checkoutFailureBody:
    "تم تسجيل فشل الدفع — تستمر خطوات التحصيل وفق السياسة، ويمكنك المحاولة مجددًا من صفحة الفواتير.",
  checkoutGoBilling: "الذهاب إلى الفواتير والاشتراك",
  checkoutGoDashboard: "لوحة المعلومات",
  checkoutBackToPlans: "العودة إلى الخطط",
  checkoutAlreadySettled: "هذه الجلسة مسددة بالفعل.",
  checkoutBlockersTitle: "التنزيل لخطة أدنى محجوب",
  checkoutBlockerLine:
    "يوجد {usage} {limit}؛ خطة {plan} تسمح بـ {limitValue} — خفّض العدد إلى {limitValue} أو أقل ثم أعد المحاولة.",
  checkoutLimitUsers: "مستخدمين",
  checkoutLimitBranches: "فروع",
  checkoutLimitWarehouses: "مستودعات",
  checkoutErrorDowngradeBlocked:
    "التنزيل محجوب لأن الاستخدام الحالي يتجاوز حدود الخطة الهدف — راجع القائمة أدناه.",
  checkoutErrorPlanUnchanged: "الاشتراك على هذه الخطة بالفعل.",
  checkoutErrorSessionNotFound: "جلسة دفع غير معروفة — ربما انتهت صلاحيتها.",
  checkoutErrorSessionSettled: "جلسة الدفع مسددة بالفعل.",
  checkoutErrorTransition: "حالة الاشتراك لا تسمح بهذه العملية.",
  checkoutErrorLimitExceeded:
    "حد الخطة: {limit} — الاستخدام {usage} من {limitValue}. قم بترقية الخطة أو حرّر مقعدًا.",
  checkoutErrorNoSessionRef: "تعذر استخراج مرجع جلسة الدفع من رابط المزود.",

  billingTitle: "الفواتير والاشتراك",
  billingGraceNote:
    "وضع القراءة فقط حتى {date} — الدفع متاح من هذه الصفحة لاستعادة الترحيل.",
  billingPlanCardTitle: "الخطة الحالية",
  billingNoSubscription: "لا يوجد اشتراك نشط لهذا المستأجر.",
  billingPrice: "السعر",
  billingPeriod: "الفترة",
  billingTrialEndsAt: "نهاية التجربة",
  billingTrialCountdown: "متبقٍ {days} يومًا",
  billingTrialDaysNote: "مدة التجربة {days} يومًا (قيمة تمهيدية).",
  billingChangePlan: "تغيير الخطة",
  billingUsageTitle: "الاستخدام",
  billingUnlimited: "غير محدود",
  billingWarn80: "حدّ 80%",
  billingWarn100: "100%",
  billingInvoicesTitle: "سجل الفواتير",
  billingNoInvoices: "لا توجد فواتير بعد.",
  billingColNumber: "الرقم",
  billingColPlan: "الخطة",
  billingColPeriod: "الفترة",
  billingColAmount: "المبلغ",
  billingColDueDate: "الاستحقاق",
  billingColPaidVia: "طريقة السداد",
  billingPaidViaWebhook: "بوابة الدفع",
  billingPaidViaManual: "تسجيل يدوي",
  billingEventsTitle: "أحداث الفواتير",
  billingNoEvents: "لا توجد أحداث بعد.",
  billingViaPlatformAdmin: "عبر مسؤول المنصة",
  billingEventTrialStarted: "بدء التجربة",
  billingEventTrialExpired: "انتهاء التجربة",
  billingEventGraceEntered: "دخول الفترة السماحية",
  billingEventDunningWarned: "تحذير تحصيل",
  billingEventPlanChangeRequested: "طلب تغيير خطة",
  billingEventPlanChanged: "تغيّرت الخطة",
  billingEventDowngradeBlocked: "تنزيل محجوب",
  billingEventCheckoutCreated: "إنشاء جلسة دفع",
  billingEventManualPaymentRecorded: "تسجيل دفعة يدوية",
  billingEventSuspensionExecuted: "تنفيذ الإيقاف",
  billingEventSubscriptionRestored: "استعادة الاشتراك",
  billingEventEntitlementsChanged: "تغيّر الاستحقاقات",

  dashboardTitle: "لوحة المعلومات",
  dashboardFreshness:
    "ملخّص اليوم {date} — كل رقم في هذه اللوحة من تشغيل تقرير ملزم بنفس المعاملات (لا حساب موازٍ).",
  dashboardSalesToday: "مبيعات اليوم",
  dashboardCashPosition: "المركز النقدي (صافي اليوم)",
  dashboardArOverdue: "ذمم متأخرة",
  dashboardStockAlerts: "تنبيهات إعادة الطلب",
  dashboardInvoicesCount: "{count} فاتورة",
  dashboardAccountsCount: "{count} حساب نقدي",
  dashboardCustomersCount: "{count} عميلًا",
  dashboardStockPreviewHeading: "أول ٥ تنبيهات (الرمز · المستودع — المتوفر / حد إعادة الطلب)",
  dashboardDrillAria: "افتح التقرير بالمعاملات نفسها",
  dashboardWidgetFailed: "تعذر تشغيل التقرير",
  dashboardAssertionFailed: "فشل فحص المطابقة: {ids}",
  dashboardUsageHeading: "ملخص الاستخدام",
  dashboardUsageUnavailable: "ملخص الاستخدام غير متاح — يتطلب صلاحية إدارة الاشتراك.",
  dashboardTrialBanner: "الفترة التجريبية تنتهي خلال {days} يومًا",
  dashboardPastDueBanner: "هناك فاتورة مستحقة السداد",
  dashboardGoBilling: "إدارة الاشتراك",
  dashboardGraceNote: "لوحة المعلومات تعمل بالكامل في وضع القراءة فقط — التقارير والتصدير متاحة.",

  notificationsTitle: "الإشعارات",
  notificationsUnreadCount: "غير مقروءة: {count}",
  notificationsUnreadOnly: "غير المقروءة فقط",
  notificationsRefresh: "تحديث",
  notificationsSyncLine: "غير مقروءة: {count}",
  notificationsInboxHeading: "الوارد",
  notificationsEmpty: "لا توجد إشعارات.",
  notificationsMarkRead: "تحديد كمقروء",
  notificationsReadAt: "قُرئ:",
  notificationsPrefsTitle: "تفضيلات الإشعارات",
  notificationsPrefsHint: "غياب الصف يعني تفعيل القناتين؛ التفضيلات تكبح فقط ولا تُنشئ إشعارات.",
  notificationsPrefsCategory: "الفئة",
  notificationsPrefsInApp: "داخل التطبيق",
  notificationsPrefsEmail: "البريد الإلكتروني",
  notificationsPrefsSaved: "تم حفظ التفضيل.",
  notificationsCategoryLimits: "حدود الاستخدام",
  notificationsCategorySubscription: "الاشتراك",
  notificationsCategoryReconciliation: "المطابقات",
  notificationsCategoryInvoiceOverdue: "الفواتير المتأخرة",

  onboardingStepItem: "أول صنف",
  onboardingStepCustomer: "أول عميل",
  onboardingStepInvoice: "أول فاتورة",
  onboardingStepPrint: "الطباعة",
  onboardingContinueJourney: "متابعة الرحلة الإرشادية",
  onboardingNeedPcsUom:
    "تعذر العثور على وحدة القياس «قطعة» (PCS) — أضفها من شاشة وحدات القياس ثم أعد المحاولة.",
  onboardingItemSku: "الرمز (SKU)",
  onboardingItemName: "الاسم (إنجليزي)",
  onboardingItemNameAr: "الاسم (عربي)",
  onboardingItemPrice: "سعر البيع",
  onboardingItemFixed:
    "قيم ثابتة لهذه الخطوة: النوع مخزني · الوحدة {uom} — يمكن تغييرهما لاحقًا من شاشة الأصناف.",
  onboardingCreateItem: "إنشاء الصنف",
  onboardingSkipItem: "تخطي هذه الخطوة",
  onboardingCustomerCode: "الرمز",
  onboardingCustomerName: "الاسم (إنجليزي)",
  onboardingCustomerNameAr: "الاسم (عربي)",
  onboardingCustomerFixed: "النوع لهذه الخطوة: عميل — قابل للتغيير لاحقًا من شاشة الجهات.",
  onboardingCreateCustomer: "إنشاء العميل",
  onboardingSkipCustomer: "تخطي هذه الخطوة",
  onboardingSelectItem: "اختر صنفًا",
  onboardingTaxPreview: "معاينة الضريبة",
  onboardingPreviewEstimate: "(تقدير — الأرقام النهائية عند الإنشاء)",
  onboardingPreviewPending: "أدخل الكمية والسعر لعرض المعاينة.",
  onboardingNoTaxNote: "بدون ضريبة — لا يوجد رمز ضريبي على سطر الفاتورة الإرشادية.",
  onboardingInvoiceStageCreated: "تم إنشاء المسودة (DRAFT)…",
  onboardingInvoiceStageSubmitted: "تم الإرسال (PENDING_APPROVAL)…",
  onboardingInvoiceStageApproved: "تم الاعتماد (APPROVED)…",
  onboardingInvoiceStagePosted: "تم الترحيل (POSTED) — تم تعيين الرقم الرسمي.",
  onboardingCreateInvoice: "إنشاء الفاتورة وترحيلها",
  onboardingSkipInvoice: "تخطي هذه الخطوة",
  onboardingInvoiceSummary: "ملخص الفاتورة المرحّلة",
  onboardingNoPostedInvoice: "لا توجد فاتورة مرحّلة بعد.",
  onboardingPrintQueueNote:
    "طباعة الفواتير تصل مع طابور طباعة المستندات — سُجلت هذه الخطوة كمكتملة مع ملاحظة، ولا يُختلق أي مسار طباعة.",
  onboardingSkipPrint: "تخطي الطباعة",
  onboardingFinish: "إتمام الرحلة",
  onboardingGoInvoices: "فواتير البيع",
  onboardingGoDashboard: "لوحة المعلومات",
  onboardingCompletedNote: "اكتملت رحلة التهيئة — يمكنك الآن إدارة أعمالك من لوحة المعلومات.",
  onboardingSkippedNote:
    "تم تسجيل التوقف عند «ترحيل أول فاتورة» — الرحلة قابلة للاستئناف من هنا في أي وقت.",

  billingAdminTitle: "فواتير الاشتراك (لوحة المنصة)",
  billingAdminCaption:
    "التسجيلات من هذه اللوحة تُوثق في سجل التدقيق باسم مسؤول المنصة (via_platform_admin).",
  billingAdminSubscription: "الاشتراك",
  billingAdminNoSubscription: "لا يوجد اشتراك لهذا المستأجر.",
  billingAdminManualTitle: "تسجيل دفعة يدوية (الفواتير اليدوية)",
  billingAdminInvoice: "الفاتورة",
  billingAdminSelectInvoice: "اختر فاتورة (مفتوحة فقط)",
  billingAdminVia: "الطريقة",
  billingAdminViaBankTransfer: "حوالة بنكية",
  billingAdminViaCash: "نقدًا",
  billingAdminViaCheque: "شيك",
  billingAdminReference: "المرجع (٣ أحرف على الأقل)",
  billingAdminReason: "السبب (٣ أحرف على الأقل)",
  billingAdminRecordButton: "تسجيل الدفعة",
  billingAdminNoOpenInvoices: "لا توجد فواتير مفتوحة لتسجيل دفعة.",
  billingAdminManualDone: "تم تسجيل الدفعة للفاتورة {number} — حالة الاشتراك: {status}",
  billingAdminLifecycleTitle: "إيقاف/استعادة (مدفوعات)",
  billingAdminSuspendButton: "إيقاف",
  billingAdminRestoreButton: "استعادة",
  billingAdminSuspendDone: "تم الإيقاف — أُنهيت {count} جلسة.",
  billingAdminRestoreDone: "تمت الاستعادة.",
  billingAdminDailyPassTitle: "المرور اليومي",
  billingAdminDailyPassHint:
    "يجري المرور عند الطلب: انتهاء التجارب، انتهاء الفترات السماحية، تنفيذ التنزيلات المجدولة، وتسوية عداد المستندات.",
  billingAdminDailyPassButton: "تشغيل المرور اليومي",
  billingAdminDailyPassDone:
    "تم: تجارب منتهية {trials} · إيقافات {suspensions} · تنزيلات مطبقة {applied} · تنزيلات محجوبة {blocked} · فواتير متأخرة {overdue} · مستندات مسوّاة {reconciled}",
  billingAdminAuditNote:
    "كل إجراء من هذه اللوحة يظهر في سجل التدقيق مع علامة via_platform_admin — السبب والمرجع إلزاميان.",
  billingAdminConfirmSuspend: "تأكيد الإيقاف",
  billingAdminConfirmSuspendBody:
    "سيؤدي الإيقاف إلى إنهاء جلسات المستأجر فورًا وفق سياسة الإيقاف. هل تريد المتابعة؟",
  billingAdminConfirmRestore: "تأكيد الاستعادة",
  billingAdminConfirmRestoreBody:
    "ستستعاد العضوية وتُفعّل مفعوليات الخطة بوضع مدفوع. هل تريد المتابعة؟",
  billingAdminConfirmButton: "تأكيد",
  billingAdminErrorNotOpen: "الفاتورة المستهدفة ليست مفتوحة.",
  billingAdminErrorReasonRequired: "تسجيل الدفعة يتطلب سببًا ومرجعًا.",

  // -- PHASE-015 T11 (3-a): onboarding industry step -------------------------
  onboardingStepIndustry: "اختيار القطاع",
  industryIntro:
    "ابدأ بتحديد قطاع نشاطك — نجهّز لك مساحة عمل بلغة قطاعك: قوائمه، ومصطلحاته، وإعداداته الافتراضية. يمكنك أيضًا المتابعة بدون قالب.",
  industryActivityQuestion: "ما طبيعة نشاطك التجاري؟",
  industryActivityOther: "اوصف نشاطك بكلماتك (اختياري)",
  industryActivityResolve: "اقترح القالب",
  industryResolvedExact: "تطابق مؤكد: القالب المقترح هو «{template}».",
  industryResolvedSuggested:
    "بناءً على وصفك نقترح قالب «{template}» — راجعه وأكّد اختياره، أو اختر قالبًا آخر بنفسك.",
  industryNoMatch:
    "لم نجد قالبًا يطابق وصفك. يمكنك اختيار قالب من القائمة أدناه أو المتابعة بدون قالب.",
  industryTemplatesLabel: "قوالب القطاعات",
  industryCapabilitiesLabel: "الميزات والقدرات",
  industryCapabilitiesPending: "جارٍ تحميل معاينة الميزات…",
  industryCapIncluded: "متاح",
  industryCapPhaseGated: "قادم مع المرحلة {phase}",
  industryCapOptional: "اختياري — غير مفعّل في خطتك",
  industryCapBlocked: "يتطلب خطة أعلى",
  industryCapRequired: "أساسي",
  industrySelect: "اختيار",
  industryDeselect: "إلغاء الاختيار",
  industrySelectedBadge: "مختار",
  industryBlockedBadge: "غير متاح لخطتك",
  industrySkipPlain: "بدون قالب قطاع — مساحة عمل أساسية",
  industryContinue: "متابعة",
  industryApplyAfterProvisionNote:
    "سيُطبَّق القالب تلقائيًا بعد نجاح تجهيز مساحة العمل — ولن يتوقف الإعداد إذا تعذّر التطبيق.",
  industryAlreadyAppliedTitle: "القالب مطبّق بالفعل",
  industryAlreadyApplied: "تعمل مساحة العمل حاليًا بقالب «{template}»",
  industryLoadError:
    "تعذّر تحميل قوالب القطاعات — يمكنك المتابعة بدون قالب وإعادة المحاولة لاحقًا من شاشة «القوالب القطاعية».",
  industryOutcomeTitle: "قالب القطاع",
  industryPlainChosen:
    "تمت المتابعة بدون قالب قطاع — تعمل مساحة العمل بالإعدادات الأساسية، ويمكنك تطبيق قالب لاحقًا من شاشة «القوالب القطاعية».",
  industryAppliedOk: "تم تطبيق قالب «{template}» (الإصدار {version}).",
  industryApplyAlready: "القالب مطبّق بالفعل — لم يتم أي تغيير.",
  industryApplyForbidden: "لم يتم تطبيق القالب — لا تملك صلاحية تطبيق القوالب.",
  industryApplyFailedContinue:
    "تابع الإعداد على الإعدادات الأساسية — لن يتوقف تجهيز مساحة العمل بسبب ذلك.",
  industryApplyBlockedPrefix: "لم يتم تطبيق القالب:",
  industryRetryHint:
    "يمكنك مراجعة القوالب وخيارات الخطة لاحقًا من الإعدادات ← «القوالب القطاعية».",

  // -- PHASE-015 T11 (3-a): template-derived navigation labels -----------------
  industryNavComingPhase: "قادم مع المرحلة {phase}",
  industryNavNotInWebApp: "غير متوفر بعد في الواجهة",

  // -- PHASE-015 T11 (3-a): admin "Industry & templates" screen --------------
  templatesTitle: "القوالب القطاعية",
  templatesAppliedCard: "القالب المطبّق",
  templatesNoneApplied:
    "لا يوجد قالب قطاعي مطبّق — تعمل مساحة العمل بالإعدادات الأساسية للمنصة.",
  templatesAppliedNotInRegistry:
    "القالب المطبّق غير موجود في سجل القوالب النشطة — راجع إدارة المنصة.",
  templatesKey: "المعرّف",
  templatesName: "الاسم",
  templatesAppliedVersion: "الإصدار المطبّق",
  templatesHash: "بصمة ملف القالب",
  templatesStatus: "الحالة",
  templatesStatusActive: "نشط",
  templatesAppliedNote: "تاريخ التطبيق غير معروض — لا تكشفه الواجهة البرمجية حاليًا.",
  templatesDriftTitle: "تحديثات القوالب",
  templatesDriftPending: "تعذّر فحص تحديثات القالب حاليًا.",
  templatesDriftCurrent: "أنت على أحدث إصدار من القالب المطبّق.",
  templatesDriftBehind: "بيانات شاذة: إصدار السجل أقدم من الإصدار المطبّق — راجع إدارة المنصة.",
  templatesDriftAvailable: "تحديث متاح: الإصدار {registry} (المطبّق حاليًا: {applied}).",
  templatesDriftMajor: "تحديث رئيسي — راجع ملاحظات الترحيل قبل الترقية.",
  templatesDriftWhatNext: "راجع ما سيتغير قبل الترقية.",
  templatesDriftRecorded: "سُجّل عرض الترقية في مركز الإشعارات.",
  templatesDriftReview: "راجع التغييرات",
  templatesDriftNeverAuto: "لا يتم تطبيق تحديثات القوالب تلقائيًا أبدًا — الترقية قرارك.",
  templatesRegistryTitle: "القوالب المتاحة",
  templatesNoPermission:
    "عرض فقط — تطبيق القوالب وتبديلها يتطلب صلاحية «configuration.templates.apply».",
  templatesAppliedBadge: "المطبّق حاليًا",
  templatesApplyButton: "تطبيق",
  templatesPreviewSwitch: "معاينة التبديل",
  templatesPreviewExtend: "معاينة الإضافة",
  templatesApplyDone: "تم تطبيق قالب «{template}» (الإصدار {version}).",
  templatesApplyAlready: "القالب مطبّق بالفعل — لم يتم أي تغيير.",
  templatesBlockedGeneric:
    "العملية محجوبة: قدرات مطلوبة غير مفعّلة في خطتك الحالية — اختر خطة أعلى لإتمام التفعيل.",
  templatesSwitchDone: "تم التبديل إلى قالب «{template}».",
  templatesExtendDone: "تمت إضافة قالب «{template}» إلى مساحة عملك.",
  templatesAckRequiredNote:
    "يتضمن هذا التغيير ميزات إلزامية مرحلية — ستفعل لاحقًا مع المراحل القادمة، ويجب الإقرار بذلك قبل المتابعة.",
  templatesAckLabel: "أُقرّ بأن الميزات المرحلية ({phases}) ستفعل لاحقًا عند توفرها.",
  templatesDiffTitle: "ما الذي سيتغير؟",
  templatesDiffDescription: "معاينة {mode} — لا يتم أي تغيير حتى التأكيد.",
  templatesModeSwitch: "التبديل",
  templatesModeExtend: "الإضافة",
  templatesDiffFromTo: "من {from} إلى {to}",
  templatesDiffBlocked: "العملية محجوبة — المفاتيح الناقصة:",
  templatesDiffAddedCaps: "قدرات جديدة",
  templatesDiffAddedIncluded: "متاحة فورًا",
  templatesDiffAddedPhaseGated: "مرحلية — قادمة لاحقًا",
  templatesDiffAddedOptionalMissing: "اختيارية غير مفعّلة في خطتك (لن تظهر قوائمها)",
  templatesDiffEmpty: "لا توجد إضافات.",
  templatesDiffArchived: "قدرات مؤرشفة",
  templatesDiffArchivedNote: "تُحفظ للقراءة فقط — لا يُحذف أي بيانات عند التبديل.",
  templatesDiffRenamed: "تسميات ستتغير",
  templatesDiffSeries: "سلاسل ترقيم جديدة",
  templatesDiffKeptSeries: "سلاسل موجودة تبقى دون تغيير:",
  templatesDiffInventory: "تغييرات افتراضيات المخزون",
  templatesDiffInventoryNote: "تسري على الأصناف الجديدة فقط — لا تتغير بيانات الأصناف القائمة.",
  templatesDiffPolicies: "سياسات سير العمل",
  templatesDiffPolicyConflict: "تعارض مسجّل — تبقى القيمة الأساسية",
  templatesDiffPins: "التقارير المثبتة",
  templatesDiffPinsAdded: "ستُضاف:",
  templatesDiffPinsRemoved: "ستُرفع:",
  templatesDiffChecklist: "خطوات قائمة التهيئة",
  templatesSwitchButton: "تبديل القالب",
  templatesExtendButton: "إضافة القالب",
  templatesPoliciesTitle: "السياسات الفعّالة",
  templatesPoliciesNote: "القيم الفعّالة بعد دمج كل الطبقات — للقراءة فقط.",
  templatesPolicyKey: "المفتاح",
  templatesPolicyValue: "القيمة",
  templatesPolicySource: "المصدر",
  templatesPolicySourceTemplate: "قالب الصناعة",
  templatesPolicySourceTenant: "إعدادك",
  templatesPolicyOn: "مفعّلة",
  templatesPolicyOff: "معطّلة",
  templatesPolicyLegend:
    "«قالب الصناعة» = افتراضي من القالب المطبّق · «إعدادك» = قيمة صريحة من إعداداتك · «—» = لا تكشف الحمولة مصدر هذا المفتاح على حدة (قد يكون إعدادك الصريح أو افتراضي القالب أو الافتراضي العام).",

  // -- PHASE-017 (T6/T14): automotive + distribution navigation & crumbs ------
  navSales: "المبيعات",
  distributionNavSection: "التوزيع",
  jobCardsTitle: "بطاقات العمل",
  vehiclesTitle: "المركبات",
  commissionsTitle: "العمولات",
  distributionRoutesTitle: "خطوط السير والزيارات",
  distributionVanTitle: "مخزون السيارات",
  distributionSettlementsTitle: "تسويات المندوبين",
  distributionTiersTitle: "فئات العملاء",

  // -- PHASE-017-T6 automotive screens (job cards + vehicles) ------------------
  jobCardsEmpty: "لا توجد بطاقات عمل بعد.",
  jobCardsNew: "بطاقة عمل جديدة",
  jcFilterAll: "الكل",
  jcCardNo: "رقم البطاقة",
  jcCustomer: "العميل",
  jcVehicle: "المركبة",
  jcBranch: "الفرع",
  jcWarehouse: "المستودع",
  jcPartsIssueMode: "سياسة إصدار القطع",
  jcModeReserve: "حجز القطع (reserve)",
  jcModeIssueImmediate: "إصدار فوري (issue_immediate)",
  jcOdometer: "العداد (كم)",
  jcComplaints: "الشكاوى",
  jcDiagnosis: "التشخيص",
  jcNote: "ملاحظة",
  jcLaborHoursTotal: "إجمالي ساعات العمل",
  jcLineParts: "قطع",
  jcLineLabor: "خدمة",
  jcItem: "الصنف",
  jcQty: "الكمية",
  jcUnitPrice: "سعر الوحدة",
  jcHourlyRate: "أجر الساعة",
  jcEstimatedHours: "الساعات المقدرة",
  jcLoggedHours: "الساعات المسجلة",
  jcDiscount: "الخصم",
  jcTaxCode: "رمز الضريبة",
  jcAddLine: "إضافة سطر",
  jcRemoveLine: "إزالة السطر",
  jcStatusDraft: "مسودة",
  jcStatusInProgress: "قيد التنفيذ",
  jcStatusCompleted: "مكتملة",
  jcStatusInvoiced: "مفوترة",
  jcStatusCancelled: "ملغاة",
  jcActionQuotation: "توليد عرض سعر",
  jcActionApprove: "موافقة العميل",
  jcActionComplete: "إكمال الأعمال",
  jcActionInvoice: "إصدار الفاتورة",
  jcActionCancel: "إلغاء البطاقة",
  jcCancelReason: "سبب الإلغاء",
  jcLogHours: "تسجيل ساعات",
  jcSearchPlaceholder: "ابحث برقم البطاقة أو العميل…",
  jcClose: "إغلاق",
  jcCreated: "تاريخ الفتح",
  jcNoticeCreated: "تم فتح البطاقة {no}.",
  jcNoticeQuotation: "تم توليد عرض السعر {no}.",
  jcNoticeUpdated: "تم تحديث البطاقة.",
  jcNoticeHoursLogged: "تم تسجيل الساعات.",
  jcErrState: "لا يمكن تنفيذ هذا الإجراء في الحالة الحالية للبطاقة.",
  jcErrNotCancelable:
    "لا يمكن الإلغاء بعد إصدار قطع أو فاتورة — التصحيح يكون بإشعار دائن.",
  jcErrLineInvalid: "سطر غير صالح — تحقق من نوع الصنف والكمية والساعات.",
  jcErrPosting: "ترحيل بطاقات العمل غير مهيأ بعد؛ لا يمكن تنفيذ هذا الإجراء.",
  vehiclesEmpty: "لا توجد مركبات مسجلة بعد.",
  vehNew: "مركبة جديدة",
  vehPartner: "الشريك",
  vehNote: "ملاحظة",
  vehMake: "الماركة",
  vehModel: "الطراز",
  vehModelYear: "سنة الصنع",
  vehChassis: "رقم الهيكل (VIN)",
  vehPlate: "رقم اللوحة",
  vehColor: "اللون",
  vehEngineNo: "رقم المحرك",
  vehOdometer: "العداد (كم)",
  vehSearchPlaceholder: "ابحث باللوحة أو الهيكل أو الماركة…",
  vehStatusActive: "نشطة",
  vehStatusArchived: "مؤرشفة",
  vehArchive: "أرشفة",
  vehArchiveHint: "تبقى المركبة في السجل للتوثيق ولا تظهر في الاختيارات الجديدة.",
  vehHistory: "سجل الخدمة",
  vehHistoryKindJobCard: "بطاقة عمل",
  vehHistoryKindInvoice: "فاتورة",
  vehHistoryKindCreditNote: "إشعار دائن",
  vehHistoryEmpty: "لا يوجد سجل خدمة لهذه المركبة.",
  vehNoticeCreated: "تم تسجيل المركبة.",
  vehNoticeArchived: "تمت أرشفة المركبة.",
  vehErrChassisTaken: "رقم الهيكل مسجل مسبقاً في هذا النطاق.",
  vehErrArchived: "المركبة مؤرشفة — لا يمكن تعديلها.",
  vehErrChassisInvalid:
    "رقم هيكل غير صالح: ٦–١٧ خانة من الأحرف A–H وJ–N وP وR–Z والأرقام (بدون I/O/Q).",

  // -- PHASE-017-T14 distribution + commissions screens ------------------------
  // (9a-dist) routes & visits + van stock + rep settlements + tiers/FOC + commissions

  // routes & visits (T14 routes screen)
  distRoutesCreate: "إنشاء خط سير",
  distRoutesCode: "الرمز",
  distRoutesName: "الاسم",
  distRoutesRep: "مندوب المبيعات",
  distRoutesVan: "سيارة التوزيع",
  distRoutesDayPattern: "أيام السير",
  distRoutesDayPatternHint: "اختر يومًا واحدًا على الأقل لكل خط سير — تخطَّط الزيارات لأيام السير فقط.",
  distRoutesEmpty: "لا خطوط سير بعد — أنشئ أول خط سير.",
  distRoutesCreatedToast: "أُنشئ خط السير {code}.",
  distRoutesErrCodeTaken: "رمز خط السير مستخدم بالفعل في هذا النطاق.",
  distRoutesErrPlanning: "بيانات التخطيط غير سليمة — تحقق من التاريخ وأيام السير والعملاء.",
  distDayMon: "الاثنين",
  distDayTue: "الثلاثاء",
  distDayWed: "الأربعاء",
  distDayThu: "الخميس",
  distDayFri: "الجمعة",
  distDaySat: "السبت",
  distDaySun: "الأحد",
  distCompTitle: "تشكيلة العملاء",
  distCompHint: "الترتيب يحدد تسلسل الزيارات عند التخطيط؛ ثبّت العملاء الدائمين أعلى القائمة.",
  distCompDerivedHint: "التشكيلة الحالية مستنتجة من زيارات الخط المخططة (خطة السير)؛ الحفظ يستبدلها كاملة بالترتيب المعروض.",
  distCompCount: "{count} من العملاء",
  distCompOrder: "الترتيب",
  distCompPinned: "مثبّت",
  distCompAddCustomer: "إضافة عميل",
  distCompRemove: "إزالة",
  distCompSave: "حفظ التشكيلة",
  distCompEmpty: "لا عملاء على هذا الخط بعد — أضف عملاء من القائمة.",
  distCompSavedToast: "حُفظت تشكيلة العملاء ({count}).",
  distPlanTitle: "تخطيط الزيارات",
  distPlanDate: "تاريخ التخطيط",
  distPlanBtn: "خطّط زيارات هذا التاريخ",
  distPlanToast: "خُطّطت {planned} زيارة ({skipped} كانت مخططة مسبقًا).",
  distBoardTitle: "لوحة الزيارات",
  distBoardDate: "تاريخ الزيارة",
  distBoardAllStatuses: "كل الحالات",
  distVisitPlanned: "مخططة",
  distVisitCompleted: "مكتملة",
  distVisitSkipped: "متخطاة",
  distVisitMissed: "مفقودة",
  distVisitCheckIn: "تسجيل وصول",
  distVisitComplete: "إكمال",
  distVisitSkip: "تخطٍّ",
  distVisitCheckedIn: "سُجّل الوصول",
  distVisitCustomer: "العميل",
  distVisitRoute: "خط السير",
  distVisitNote: "ملاحظة",
  distVisitEmpty: "لا زيارات بهذه المرشّحات.",
  distCompleteTitle: "إكمال الزيارة",
  distCompleteInvoice: "فاتورة بيع (UUID)",
  distCompleteCreditNote: "إشعار دائن (UUID)",
  distCompleteReceipt: "سند قبض (UUID)",
  distCompleteHint: "اختياري — الصق معرّف مستند لربطه بالزيارة عند الإكمال، مع ملاحظة إن لزم.",
  distVisitCheckedInToast: "سُجّل وصول الزيارة.",
  distVisitCompletedToast: "أُكملت الزيارة.",
  distVisitSkippedToast: "تُخُطّيت الزيارة.",
  distErrVisitState: "حالة الزيارة لا تسمح بهذه العملية — فقط الزيارات المخططة تُدار.",
  distErrVisitDocument: "أحد المستندات المرتبطة غير موجود في هذا النطاق.",

  // van stock (T14 van screen)
  distVanRegister: "تسجيل سيارة",
  distVanCode: "الرمز",
  distVanName: "الاسم",
  distVanBranch: "الفرع",
  distVanRep: "المندوب المرتبط",
  distVanEmpty: "لا سيارات توزيع مسجلة — سجّل أول سيارة.",
  distVanRegisteredToast: "سُجّلت سيارة التوزيع {code} وربطت بالمندوب {rep}.",
  distVanBalancesTitle: "أرصدة السيارة",
  distVanPickVan: "اختر سيارة",
  distVanItem: "الصنف",
  distVanSku: "رمز الصنف",
  distVanQty: "الكمية",
  distVanValue: "القيمة",
  distVanTotals: "الإجمالي",
  distVanBalancesEmpty: "لا مخزون على هذه السيارة بعد — حمّلها من مستودع رئيسي.",
  distLoadOutTitle: "تحميل سيارة (إخراج مخزون)",
  distLoadOutFrom: "من مستودع",
  distLoadOutVan: "إلى سيارة",
  distLoadOutAddLine: "إضافة بند",
  distLoadOutBtn: "تحميل",
  distLoadOutToast: "حركة التحميل {no} قيد النقل — استلمها لتظهر في رصيد السيارة.",
  distUnloadTitle: "تفريغ سيارة",
  distUnloadVan: "من سيارة",
  distUnloadTo: "إلى مستودع",
  distUnloadBtn: "تفريغ",
  distUnloadToast: "حركة التفريغ {no} قيد النقل — تُستلم من الجهة الأخرى.",
  distTransfersTitle: "حركات قيد النقل إلى السيارات",
  distTransfersEmpty: "لا حركات قيد النقل إلى السيارات حاليًا.",
  distTransfersVanOnly: "تُعرض فقط الحركات المرسلة إلى سيارات توزيع (الاستلام يُنعش مرآة المخزون).",
  distTransfersReceiveToast: "استُلمت الحركة — انعكس الرصيد على السيارة.",
  distErrVanCodeTaken: "رمز المستودع مستخدم بالفعل في هذا النطاق.",
  distErrVanRepBinding: "ربط المندوب غير صالح — يلزم مندوب نشط غير مرتبط بسيارة أخرى (سيارة لكل مندوب).",
  distErrVanLoadOut: "عملية التحميل/التفريغ غير صالحة — تحقق من السيارة والمستودع والبنود.",
  distErrVanNotFound: "سيارة التوزيع غير موجودة (أو ليست من نوع VAN).",

  // rep settlements (T14 settlements screen)
  distSettlementsOpen: "فتح تسوية جديدة",
  distSettlementsRep: "المندوب",
  distSettlementsCashAccount: "حساب نقدية المندوب",
  distSettlementsVan: "سيارة التوزيع",
  distSettlementsDate: "تاريخ التسوية",
  distSettlementsOpening: "النقدية الافتتاحية",
  distSettlementsNo: "رقم التسوية",
  distSettlementsEmpty: "لا تسويات بعد — افتح تسوية اليوم لأحد المندوبين.",
  distSettlementsOpenedToast: "فُتحت تسوية المندوب {rep} ليوم {date} (رقم STL يُرقَّم عند الترحيل).",
  distSettlementAllStatuses: "كل الحالات",
  distSettlementDraft: "مسودة",
  distSettlementCounted: "مجرودة",
  distSettlementApproved: "معتمدة",
  distSettlementPosted: "مُرحّلة",
  distSettlementCancelled: "ملغاة",
  distSettlementDetail: "تفاصيل التسوية",
  distSettlementLines: "بنود توقع النقدية",
  distSettlementLineNo: "#",
  distSettlementComponent: "المكوّن",
  distSettlementAmount: "المبلغ",
  distSettlementDescription: "البيان",
  distSettlementCashSales: "المبيعات النقدية",
  distSettlementCollections: "التحصيلات",
  distSettlementRefunds: "المرتجعات النقدية",
  distSettlementExpenses: "مصروفات المندوب",
  distSettlementExpected: "النقدية المتوقعة",
  distSettlementCountedCash: "النقدية المجرودة",
  distSettlementVariance: "الفرق",
  distSettlementShortage: "عجز",
  distSettlementSurplus: "زيادة",
  distSettlementNone: "لا فرق",
  distSettlementVarianceReason: "سبب الفرق",
  distSettlementApprovalBadge: "يتطلب اعتمادًا",
  distSettlementCountAction: "جرد الدرج",
  distSettlementApproveAction: "اعتماد",
  distSettlementPostAction: "ترحيل",
  distSettlementCancelAction: "إلغاء التسوية",
  distSettlementCancelReason: "سبب الإلغاء",
  distSettlementDepositAccount: "حساب الإيداع",
  distSettlementDepositAmount: "مبلغ الإيداع",
  distSettlementDepositHint: "اختياري — إيداع جزء من الدرج في حساب آخر (بنك/صندوق) عند الترحيل، ولا يتجاوز المجرود.",
  distSettlementShift: "الوردية المرتبطة",
  distSettlementCountedToast: "جُردت التسوية — الفرق {variance} ({direction}).",
  distSettlementApprovedToast: "اعتُمدت التسوية.",
  distSettlementPostedToast: "رُحّلت التسوية {no} وقُيّدت قيود الفرق والإيداع.",
  distSettlementCancelledToast: "أُلغيت التسوية.",
  distComponentOpeningCash: "نقدية افتتاحية",
  distComponentCashSale: "بيع نقدي",
  distComponentCollection: "تحصيل",
  distComponentCashRefund: "رد نقدي",
  distComponentRepExpense: "مصروف مندوب",
  distComponentVariance: "فرق الجرد",
  distComponentBankDeposit: "إيداع بنكي",
  distErrSettlementPendingDocs: "ما زالت مستندات مسودة/معلّقة على يوم المندوب — رحّلها أو ألغِها قبل التسوية.",
  distErrSettlementDayLocked: "يوم المندوب مقيّد بتسوية قائمة بالفعل (أو التسوية مُرحّلة وغير قابلة للتعديل).",
  distErrSettlementApprovalRequired: "الفرق يتجاوز الحد المسموح (أو سياسة اعتماد مفعّلة) — يلزم اعتماد منفصل قبل الترحيل.",
  distErrSettlementVarianceReason: "الفرق غير الصفري يتطلب سببًا موثقًا.",
  distErrSettlementSelfApproval: "لا يمكن لمنشئ التسوية اعتمادها (المُنشئ ≠ المُعتمد).",
  distErrSettlementState: "حالة التسوية لا تسمح بهذه العملية — الجرد يسبق الترحيل.",
  distErrSettlementNotFound: "التسوية غير موجودة في هذا النطاق.",

  // customer tiers + free goods (T14 tiers screen)
  distTiersCreate: "إنشاء فئة",
  distTiersEdit: "تعديل الفئة",
  distTiersCode: "الرمز",
  distTiersName: "الاسم",
  distTiersPriceList: "قائمة الأسعار",
  distTiersDiscountCap: "سقف الخصم %",
  distTiersDiscountCapHint: "اختياري 0–100 — يقيّد أي خصم يُمنح لعملاء هذه الفئة.",
  distTiersVisitFrequency: "تكرار الزيارة (أيام)",
  distTiersVisitFrequencyHint: "اختياري 0–365 — كل كم يوم يُزار عملاء هذه الفئة.",
  distTiersEmpty: "لا فئات بعد — أنشئ أول فئة.",
  distTiersSavedToast: "حُفظت الفئة {code}.",
  distErrTierCodeTaken: "رمز الفئة مستخدم بالفعل في هذا النطاق.",
  distErrTierPriceList: "قائمة الأسعار غير صالحة — يجب أن تكون قائمة بيع (SALE) نشطة.",
  distErrTierInvalid: "بيانات الفئة غير سليمة (سقف الخصم 0–100، تكرار غير سالب).",
  distFocTitle: "قواعد الهدايا (FOC)",
  distFocCreate: "إنشاء قاعدة",
  distFocCode: "الرمز",
  distFocName: "الاسم",
  distFocBuy: "اشترِ صنفًا",
  distFocBuyQty: "كمية الشراء",
  distFocGet: "احصل على صنف",
  distFocGetQty: "كمية الهدايا",
  distFocPerMultiple: "لكل مضاعف",
  distFocMaxFree: "سقف الهدايا للأمر",
  distFocMaxFreeHint: "اختياري — 0 أو فراغ يعني بلا سقف.",
  distFocTier: "الفئة المستهدفة",
  distFocAnyTier: "كل الفئات",
  distFocReason: "رمز السبب",
  distFocReasonHint: "مطلوب — سبب منح الهدايا (BR-008)، حتى 30 حرفًا.",
  distFocValidFrom: "صالح من",
  distFocValidTo: "صالح إلى",
  distFocEmpty: "لا قواعد هدايا بعد — أنشئ أول قاعدة (اشترِ X واحصل على Y).",
  distFocSavedToast: "حُفظت قاعدة الهدايا {code}.",
  distFocErrInvalid: "بيانات القاعدة غير سليمة (كميات موجبة، نافذة صالحة، رمز سبب).",

  // commissions (T14 commissions screen)
  commissionsRunsTitle: "تشغيلات العمولة",
  commissionsNewRun: "تشغيلة جديدة",
  commissionsPeriodFrom: "من تاريخ",
  commissionsPeriodTo: "إلى تاريخ",
  commissionsBasis: "أساس الاحتساب",
  commissionsBasisInvoiced: "مفوتر",
  commissionsBasisCollected: "محصّل",
  commissionsTotalBase: "إجمالي الأساس",
  commissionsTotalCommission: "إجمالي العمولة",
  commissionsEmpty: "لا تشغيلات بعد — أنشئ تشغيلة لفترة محددة.",
  commissionsAllStatuses: "كل الحالات",
  commissionsStatusDraft: "مسودة",
  commissionsStatusPosted: "مُرحّلة",
  commissionsStatusCancelled: "ملغاة",
  commissionsRunCreatedToast: "أُنشئت التشغيلة وحُسبت بنودها — الترحيل هو نقطة الاستحقاق.",
  commissionsRunPostedToast: "رُحّلت التشغيلة — قُيّد مخصص العمولات (مصروف/مخصص).",
  commissionsRunCancelledToast: "أُلغيت التشغيلة.",
  commissionsDetail: "تفاصيل التشغيلة",
  commissionsLines: "بنود العمولة",
  commissionsRep: "المندوب",
  commissionsBase: "الأساس",
  commissionsRate: "المعدل %",
  commissionsAmount: "العمولة",
  commissionsPayout: "حالة الصرف",
  commissionsPayoutAccrued: "مستحقة",
  commissionsPayoutPaid: "مدفوعة",
  commissionsExcluded: "مستبعد — أساس قاعدة المندوب يخالف أساس التشغيلة",
  commissionsNoLines: "لا بنود محتسبة لهذه التشغيلة (لا نشاط أو قواعد بلا عمولة).",
  commissionsPostRun: "ترحيل التشغيلة",
  commissionsCancelRun: "إلغاء التشغيلة",
  commissionsCancelReason: "سبب الإلغاء",
  commissionsRulesTitle: "قواعد العمولة للمندوبين",
  commissionsRulesHint: "اختر مندوبًا لعرض قاعدته وتعديلها (طريقة/معدل/أساس).",
  commissionsRuleRep: "المندوب",
  commissionsRuleMethod: "الطريقة",
  commissionsMethodNone: "بلا عمولة",
  commissionsMethodPercentage: "نسبة",
  commissionsRuleRate: "المعدل %",
  commissionsRuleRateHint: "0–100 على الأساس المحتسب؛ تركه فارغًا مع قاعدة متدرجة يُبقي النطاقات كما هي.",
  commissionsRuleBasis: "أساس الاحتساب",
  commissionsRuleTiers: "النطاقات المتدرجة",
  commissionsRuleTiersHint: "للقراءة فقط في هذه الشاشة — إدخال معدل ثابت يستبدلها.",
  commissionsRuleSavedToast: "حُفظت قاعدة عمولة المندوب {rep}.",
  commErrRuleInvalid: "بيانات القاعدة غير سليمة (معدل 0–100، أو نطاقات متدرجة سليمة — لا الاثنان معًا).",
  commErrRunState: "حالة التشغيلة لا تسمح بهذه العملية (المُرحّلة غير قابلة للتعديل — الصحيح عكس قيد الاستحقاق).",

  // -- PHASE-016 T4/T10 — POS (counter, floor, reconciliation, terminals, offline) --

  posNavSection: "نقاط البيع",
  posNavCounter: "نقاط البيع",
  posNavFloor: "خريطة الطاولات",
  posNavReconciliation: "التسوية",
  posNavTerminals: "أجهزة نقاط البيع",

  posCounterTitle: "نقاط البيع — شاشة الكاشير",
  posCounterNoTerminals: "لا توجد أجهزة نقاط بيع مسجلة — سجّل جهازاً أولاً.",
  posCounterRegisterTerminal: "تسجيل جهاز",
  posCounterTerminalLabel: "الجهاز",
  posCounterShiftOpen: "وردية مفتوحة",
  posCounterShiftNone: "لا وردية مفتوحة",
  posCounterOpenShiftBtn: "فتح وردية",
  posCounterCloseShiftBtn: "إغلاق الوردية",
  posCounterZReportLink: "تقرير Z",
  posCounterScanLabel: "مسح الباركود / رمز الصنف",
  posCounterScanPlaceholder: "امسح أو اكتب الرمز ثم Enter",
  posCounterScanNotFound: "لا يوجد صنف بهذا الرمز.",
  posCounterScanPerf: "آخر بحث: {ms} م.ث",
  posCounterItemsTitle: "الأصناف",
  posCounterItemsEmpty: "لا أصناف قابلة للبيع.",
  posCounterSearchPlaceholder: "ابحث بالاسم أو الرمز…",
  posCounterCartTitle: "سلة البيع",
  posCounterCartEmpty: "السلة فارغة — أضف أصنافاً من الشبكة أو بالمسح.",
  posCounterQty: "الكمية",
  posCounterRemove: "إزالة",
  posCounterTotal: "الإجمالي",
  posCounterTaxNote: "الضريبة النهائية تُحتسب عند الترحيل.",
  posCounterPayBtn: "دفع",
  posCounterClearBtn: "تفريغ السلة",
  posCounterCustomer: "العميل",
  posCounterWalkIn: "عميل نقدي",
  posCounterPickCustomer: "اختيار عميل",
  posCounterCustomerSearch: "ابحث بالاسم أو الكود…",
  posCounterNewSale: "بيع جديد",
  posCounterSalePosted: "تم ترحيل الفاتورة {no}.",
  posCounterPreloadedCheck: "طلب الطاولة {no} محمّل — الدفع يغلق الطلب ويحرر الطاولة.",
  posCounterErrTerminalRequired: "اختر جهازاً أولاً.",
  posCounterErrCartEmpty: "أضف بنداً واحداً على الأقل.",
  posCounterErrTerminalInactive: "الجهاز متوقف — فعّله قبل البيع.",
  posCounterErrDiscountCeiling: "الخصم يتجاوز الحد المسموح — يلزم موافقة مشرف.",
  posCounterReturnBtn: "مرتجع",
  posCounterOfflineQueued: "خارج الاتصال — حُفظ البيع {no} محلياً بانتظار المزامنة.",

  posShiftOpenTitle: "فتح وردية على {terminal}",
  posShiftOpeningAmount: "الفتحة النقدية",
  posShiftDenominations: "فئات النقد (اختياري)",
  posShiftDenomination: "الفئة",
  posShiftCount: "العدد",
  posShiftCountedTotal: "إجمالي المعدود",
  posShiftOpenAction: "فتح الوردية",
  posShiftAlreadyOpen: "توجد وردية مفتوحة على صندوق هذا الجهاز.",
  posShiftOpenedToast: "فُتحت الوردية {no}.",
  posShiftCloseTitle: "إغلاق الوردية — عدّ عمياء",
  posShiftBlindNote: "عدّ عمياء: المتوقع لا يظهر قبل الإغلاق.",
  posShiftCloseAction: "إغلاق الوردية",
  posShiftClosedToast: "أُغلقت الوردية {no}.",
  posShiftSupervisorRequired: "الفارق يتجاوز السماحية — يلزم معرّف مشرف + الرمز السري + السبب.",
  posShiftErrOpenMismatch: "توجد وردية مفتوحة على هذا الصندوق — وردية واحدة لكل صندوق.",
  posShiftErrNotOnTerminal: "هذه الوردية ليست المفتوحة على هذا الجهاز.",

  posTenderTitle: "الدفع",
  posTenderMethod: "الطريقة",
  posTenderAmount: "المبلغ",
  posTenderCash: "نقداً",
  posTenderCard: "بطاقة",
  posTenderRemaining: "المتبقي",
  posTenderChangeDue: "المسترد للعميل",
  posTenderAddRow: "إضافة طريقة دفع",
  posTenderConfirm: "تأكيد الدفع",
  posTenderErrInvalid: "مبلغ الدفع غير صالح — يجب أن يكون رقماً موجباً.",
  posTenderErrOverflow: "مجموع الدفع يتجاوز الإجمالي بكثير — راجع البنود.",
  posTenderErrUnderpaid: "مجموع الدفع أقل من الإجمالي.",

  posReceiptTitle: "معاينة الإيصال",
  posReceiptPrint: "طباعة",
  posReceiptLoading: "جارٍ تحميل الإيصال…",
  posReceiptErrLoad: "تعذر تحميل الإيصال.",
  posReceiptOfflineNote: "إيصال محلي بانتظار المزامنة — الرقم الرسمي يظهر بعد قبول الخادم.",

  posReturnTitle: "مرتجع بيع",
  posReturnInvoiceLabel: "الفاتورة الأصلية (المعرّف أو الرقم)",
  posReturnLoad: "تحميل الفاتورة",
  posReturnLines: "بنود المرتجع",
  posReturnReason: "سبب الإرجاع",
  posReturnNote: "ملاحظة",
  posReturnSubmit: "تسجيل المرتجع",
  posReturnPosted: "سُجّل الإشعار الدائن {no} ورُحّل.",
  posReturnErrNoLines: "اختر بنداً واحداً على الأقل بكمية موجبة.",
  posReturnErrInvoice: "تعذر تحميل الفاتورة الأصلية.",

  posFloorTitle: "خريطة الطاولات — خدمة الطاولات",
  posFloorBranch: "الفرع",
  posFloorZone: "المنطقة",
  posFloorSeats: "المقاعد",
  posFloorSortKey: "الترتيب",
  posFloorFree: "شاغرة",
  posFloorOccupied: "مشغولة",
  posFloorTableLabel: "رمز الطاولة",
  posFloorOpenCheck: "فتح طلب",
  posFloorOrderType: "نوع الطلب",
  posFloorGuests: "عدد الضيوف",
  posFloorAddTable: "إضافة طاولة",
  posFloorTableAdded: "أُضيفت الطاولة.",
  posFloorEmpty: "لا طاولات في هذا الفرع بعد.",
  posFloorOpenChecks: "الطلبات المفتوحة",
  posFloorCheckNo: "رقم الطلب",
  posFloorLines: "البنود",
  posFloorAddItem: "إضافة صنف",
  posFloorSaveLines: "حفظ البنود",
  posFloorLinesSaved: "حُفظت بنود الطلب.",
  posFloorKitchenSend: "إرسال للمطبخ",
  posFloorKitchenSent: "أُرسلت تذكرة المطبخ {no}.",
  posFloorTickets: "تذاكر المطبخ",
  posFloorTransfer: "نقل لطاولة",
  posFloorTransferTo: "إلى طاولة",
  posFloorTransferred: "نُقل الطلب إلى الطاولة الجديدة.",
  posFloorSplit: "تقسيم الطلب",
  posFloorSplitHint: "اختر البنود التي ستنتقل إلى طلب جديد.",
  posFloorSplitDone: "انتقلت {n} بنود إلى طلب جديد.",
  posFloorGuestCheck: "حساب الضيف",
  posFloorPay: "دفع",
  posFloorCancelCheck: "إلغاء الطلب",
  posFloorCancelReason: "سبب الإلغاء",
  posFloorCheckCancelled: "أُلغي الطلب وحُررت الطاولة.",
  posFloorSent: "أُرسل للمطبخ",
  posFloorUnsent: "لم يُرسل",
  posFloorOrderDineIn: "في المكان",
  posFloorOrderTakeaway: "سفري",
  posFloorOrderDelivery: "توصيل",
  posFloorOrderCounter: "كاشير",
  posFloorCheckPaid: "مدفوع",
  posFloorErrCheckNotOpen: "الطلب ليس مفتوحاً — لا يمكن تعديله.",
  posFloorErrOpenTables: "لا تزال هناك طلبات مفتوحة — سوّها أو ألغها قبل إغلاق اليوم.",

  posReconciliationTitle: "التسوية — تقرير Z",
  posReconciliationDate: "التاريخ",
  posReconciliationBranch: "الفرع",
  posReconciliationLoad: "عرض التقرير",
  posReconciliationZNumber: "رقم Z",
  posReconciliationTotals: "الإجماليات",
  posReconciliationInvoiceCount: "عدد الفواتير",
  posReconciliationByOrderType: "حسب نوع الطلب",
  posReconciliationByTender: "حسب طريقة الدفع",
  posReconciliationByTerminal: "حسب الجهاز",
  posReconciliationByHour: "حسب الساعة",
  posReconciliationOfflinePairs: "مطابقة مبيعات عدم الاتصال (OFF- ⇄ الرسمي)",
  posReconciliationOfflineNo: "رقم OFF-",
  posReconciliationOfficialNo: "الرقم الرسمي",
  posReconciliationPrint: "طباعة تقرير Z",
  posReconciliationEmpty: "لا نتائج لهذا اليوم.",
  posReconciliationOpenChecks: "طلبات مفتوحة ({n})",
  posReconciliationRejections: "مبيعات مرفوضة من طابور المزامنة",
  posReconciliationColType: "النوع",
  posReconciliationColCount: "العدد",
  posReconciliationColTax: "الضريبة",

  posTerminalsTitle: "أجهزة نقاط البيع",
  posTerminalsCode: "الكود",
  posTerminalsName: "الاسم",
  posTerminalsBranch: "الفرع",
  posTerminalsTill: "الصندوق النقدي",
  posTerminalsWarehouse: "المستودع",
  posTerminalsReceiptSize: "مقاس الإيصال",
  posTerminalsStatus: "الحالة",
  posTerminalsDevice: "الجهاز المرتبط",
  posTerminalsLastSeen: "آخر ظهور",
  posTerminalsActive: "نشط",
  posTerminalsInactive: "متوقف",
  posTerminalsRegister: "تسجيل جهاز",
  posTerminalsRegisterAction: "تسجيل",
  posTerminalsRegistered: "سُجّل الجهاز {code}.",
  posTerminalsActivate: "تفعيل",
  posTerminalsDeactivate: "إيقاف",
  posTerminalsActivated: "فُعّل الجهاز.",
  posTerminalsDeactivated: "أُوقف الجهاز.",
  posTerminalsEnrollDevice: "ربط جهاز",
  posTerminalsDeviceName: "اسم الجهاز",
  posTerminalsDeviceKey: "مفتاح الجهاز",
  posTerminalsDeviceKeyNote: "يُولَّد محلياً ويظهر مرة واحدة — انسخه الآن.",
  posTerminalsEnrollAction: "ربط",
  posTerminalsEnrolled: "رُبط الجهاز بنجاح.",
  posTerminalsRevoke: "إلغاء ربط الجهاز",
  posTerminalsRevoked: "أُلغي ربط الجهاز.",
  posTerminalsErrCodePattern: "الكود: 2–30 حرفاً/رقماً (يسمح بـ . _ -).",
  posTerminalsErrCodeTaken: "هذا الكود مستخدم لجهاز آخر.",
  posTerminalsEmpty: "لا أجهزة مسجلة.",

  posOfflineBanner: "أنت خارج الاتصال — البيع يُحفظ محلياً برقم OFF- ويُزامن عند العودة.",
  posOfflineQueue: "طابور المزامنة ({n})",
  posOfflinePendingSync: "بانتظار المزامنة",
  posOfflineSynced: "مُزامن",
  posOfflineRejected: "مرفوض",
  posOfflineKept: "محفوظ محلياً",
  posOfflineRetry: "إعادة الإرسال",
  posOfflineKeep: "الاحتفاظ",
  posOfflineRemove: "حذف من الطابور",
  posOfflineSyncNow: "مزامنة الآن",
  posOfflineSyncedToast: "زُامن {n} بيعاً بنجاح.",
  posOfflineRejectionReason: "سبب الرفض",
  posOfflineEditResend: "تعديل وإعادة الإرسال",
  posOfflineAcceptPrice: "قبول سعر الخادم",
  posOfflineCancelWithReason: "إلغاء مع السبب",
  posOfflineCancelledLocal: "أُلغي محلياً — بقي السجل محفوظاً.",
  posOfflineReasonPeriodLocked: "الفترة المحاسبية مقفلة.",
  posOfflineReasonPriceChanged: "تغيّر سعر الصنف على الخادم.",
  posOfflineReasonInsufficientStock: "الكمية غير كافية في المخزون.",
  posOfflineReasonCreditLimit: "تجاوز الحد الائتماني للعميل.",
  posOfflineReasonValidation: "البيانات لم تجتز التحقق.",
  posOfflineLocalReceiptTitle: "إيصال محلي",

  // -- PHASE-018 (T41): manufacturing navigation & screens ---------------------
  // (boms + production orders + QC inspections + batch genealogy; the
  // food_manufacturing template's production/traceability surfaces)

  manufacturingNavSection: "الإنتاج والتصنيع",
  mfgBomsTitle: "قوائم المواد",
  mfgOrdersTitle: "أوامر الإنتاج",
  mfgQcTitle: "فحوص الجودة",
  mfgGenealogyTitle: "تتبّع الدفعات",

  // BOM screen (the version registry + the lines editor + explosion preview)
  mfgBomsNew: "إصدار جديد",
  mfgBomsEmpty: "لا توجد قوائم مواد بعد.",
  mfgBomFilterItem: "تصفية حسب الصنف",
  mfgBomsAllStatuses: "كل الحالات",
  mfgBomStatusDraft: "مسودة",
  mfgBomStatusActive: "نشطة",
  mfgBomStatusArchived: "مؤرشفة",
  mfgBomItem: "الصنف المنتج",
  mfgBomVersion: "الإصدار",
  mfgBomYield: "نسبة الإنتاج (%)",
  mfgBomYieldHint: "أكبر من 0 وأقصاها 100 — تُقسم الكميات عليها عند تفجير القائمة.",
  mfgBomEffectiveFrom: "سارٍ من",
  mfgBomNote: "ملاحظة",
  mfgBomOutputUom: "وحدة القياس للإخراج",
  mfgBomComponent: "المكوّن",
  mfgBomQtyPerOutput: "الكمية لكل وحدة إخراج",
  mfgBomScrapPct: "هدر المكوّن (%)",
  mfgBomLines: "بنود المكوّنات",
  mfgBomLineNo: "#",
  mfgBomAddLine: "إضافة مكوّن",
  mfgBomRemoveLine: "إزالة",
  mfgBomCreateTitle: "إصدار قائمة مواد جديد",
  mfgBomEditTitle: "تعديل قائمة المواد (مسودة)",
  mfgBomDraftOnlyHint: "التعديل على الإصدارات المسودة فقط؛ بعد التفعيل أنشئ إصدارًا جديدًا.",
  mfgBomActivate: "تفعيل",
  mfgBomActivateTitle: "تفعيل الإصدار",
  mfgBomArchive: "أرشفة",
  mfgBomArchiveHint: "يتوقف هذا الإصدار عن كونه القائمة المعتمدة لأوامر إنتاج الصنف.",
  mfgBomCreatedToast: "أُنشئ الإصدار {version} — عدّل البنود ثم فعّله.",
  mfgBomSavedToast: "حُفظ تعديل الإصدار {version}.",
  mfgBomActivatedToast: "فُعّل الإصدار {version} (أُرشِف النشط السابق إن وُجد).",
  mfgBomArchivedToast: "أُرشِف الإصدار {version}.",
  mfgBomWorkspace: "مساحة عمل الإصدار",
  mfgExplodeTitle: "معاينة تفجير القائمة",
  mfgExplodeQty: "كمية الإخراج المطلوبة",
  mfgExplodeBom: "الإصدار (اختياري)",
  mfgExplodeBomAuto: "الإصدار النشط للصنف",
  mfgExplodeRun: "تفجير",
  mfgExplodeLevels: "المستويات",
  mfgExplodeColVia: "عبر نصف مصنّع",
  mfgExplodeTotals: "الإجماليات لكل صنف",
  mfgExplodeEmpty: "لا توجد نتائج — تأكد من وجود إصدار قابل للتفجير للصنف.",
  mfgExplodeHint: "المستوى 1 بنود مباشرة؛ المستويات الأعمق تُشتق من قوائم المكوّنات نصف المصنّعة.",
  mfgColLevel: "المستوى",

  // Production-order screen (list + create + the lifecycle workspace)
  mfgOrdersNew: "أمر إنتاج جديد",
  mfgOrdersEmpty: "لا توجد أوامر إنتاج بعد.",
  mfgOrdersAllStatuses: "كل الحالات",
  mfgOrderStatusDraft: "مسودة",
  mfgOrderStatusReleased: "مُطلقة",
  mfgOrderStatusInProgress: "قيد التنفيذ",
  mfgOrderStatusCompleted: "مكتملة",
  mfgOrderStatusCancelled: "ملغاة",
  mfgOrderNo: "رقم الأمر",
  mfgOrderPlannedQty: "الكمية المخططة",
  mfgOrderActualQty: "الكمية الفعلية",
  mfgOrderFgValue: "قيمة الإنتاج التام",
  mfgOrderCompletedAt: "تاريخ الإكمال",
  mfgOrderBranch: "الفرع",
  mfgOrderBom: "إصدار القائمة (اختياري)",
  mfgOrderBomActive: "الإصدار النشط عند الإطلاق",
  mfgOrderPlannedDate: "التاريخ المخطط",
  mfgOrderMaterialsWarehouse: "مستودع المواد",
  mfgOrderFgWarehouse: "مستودع الإنتاج التام",
  mfgOrderLaborRate: "أجر العمالة لكل وحدة",
  mfgOrderOverheadRate: "المصاريف غير المباشرة لكل وحدة",
  mfgOrderRatesHint: "اختياري — يُستوعب في قيد الإكمال عند الإطلاق عندما يكون أكبر من صفر.",
  mfgOrderCreatedToast: "أُنشئ أمر الإنتاج (مسودة) — أطلقه لحجز رقم PRD وتجميد بنود الخطة.",
  mfgOrderDetail: "تفاصيل أمر الإنتاج",
  mfgOrderBatch: "الدفعة المنتجة",
  mfgOrderExpiry: "تاريخ الانتهاء",
  mfgOrderWipCredit: "دائن تحت التشغيل",
  mfgOrderLabor: "العمالة المستوعبة",
  mfgOrderOverhead: "المصاريف المستوعبة",
  mfgOrderNoEditHint: "لا يوجد تعديل مباشر من الشاشة — أنشئ أمرًا بديلًا أو صحّح عبر استهلاكات معدّلة.",
  mfgOrderPlanLines: "بنود الخطة (لقطة الإطلاق)",
  mfgOrderOverPlan: "تجاوز الخطة",
  mfgOrderRelease: "إطلاق",
  mfgOrderStart: "بدء التنفيذ",
  mfgOrderConsume: "استهلاك مواد",
  mfgOrderScrap: "تالف",
  mfgOrderComplete: "إكمال",
  mfgOrderCancel: "إلغاء الأمر",
  mfgOrderCancelTitle: "إلغاء أمر الإنتاج",
  mfgOrderCancelReason: "سبب الإلغاء",
  mfgOrderReleasedToast: "أُطلق الأمر {no} وجُمّدت بنود الخطة.",
  mfgOrderStartedToast: "بدأ تنفيذ الأمر {no}.",
  mfgOrderCancelledToast: "أُلغي الأمر.",
  mfgConsumeQty: "الكمية المستهلكة",
  mfgConsumeBatch: "الدفعة (اختياري)",
  mfgConsumeBatchAuto: "تلقائي (الأقرب انتهاءً)",
  mfgConsumeAt: "تاريخ الاستهلاك",
  mfgConsumeAddLine: "إضافة بند",
  mfgConsumeToast: "سُجّل الاستهلاك — قيد يومية {journal}.",
  mfgScrapTitle: "تسجيل تالف تحت التشغيل",
  mfgScrapQty: "الكمية التالفة",
  mfgScrapReason: "رمز السبب",
  mfgScrapValue: "قيمة التالف",
  mfgScrapAt: "تاريخ الإتلاف",
  mfgScrapToast: "سُجّل التالف بقيمة {value} — قيد يومية {journal}.",
  mfgCompleteTitle: "إكمال أمر الإنتاج",
  mfgCompleteActualQty: "الكمية المنتجة فعلًا",
  mfgCompleteBatchNo: "رقم الدفعة (اختياري)",
  mfgCompleteToast: "اكتمل الأمر — قيمة الإنتاج {value}، والدفعة {batch}.",
  mfgConsumptions: "الاستهلاكات",
  mfgConsumptionBatch: "الدفعة",
  mfgConsumptionUnitCost: "تكلفة الوحدة",
  mfgConsumptionValue: "القيمة",
  mfgConsumptionJournal: "قيد اليومية",
  mfgScraps: "التالف المسجّل",

  // QC screen (the inspection log + the entry dialog)
  mfgQcNew: "تسجيل فحص",
  mfgQcEmpty: "لا توجد فحوص مسجّلة بعد.",
  mfgQcAllTargets: "كل الأهداف",
  mfgQcResultPass: "ناجح",
  mfgQcResultFail: "راسب",
  mfgQcDispAccept: "قبول",
  mfgQcDispScrap: "إتلاف",
  mfgQcDispRework: "إعادة تشغيل",
  mfgQcDispReturn: "إرجاع للمورّد",
  mfgQcDispNone: "بدون قرار",
  mfgQcTargetProductionOrder: "أمر إنتاج",
  mfgQcTargetGoodsReceipt: "استلام مشتريات",
  mfgQcColInspectedAt: "تاريخ الفحص",
  mfgQcColTarget: "الهدف",
  mfgQcColGrn: "استلام المشتريات (معرّف)",
  mfgQcColBatch: "دفعة الإنتاج التام",
  mfgQcColSampled: "العيّنة",
  mfgQcCreateTitle: "تسجيل فحص جودة",
  mfgQcTargetType: "نوع الهدف",
  mfgQcOrder: "أمر الإنتاج (مكتمل)",
  mfgQcGrnId: "معرّف استلام المشتريات (UUID)",
  mfgQcGrnHint: "لا تتوفر قائمة استلامات في الواجهة — الصق المعرّف من شاشة المشتريات.",
  mfgQcResult: "النتيجة",
  mfgQcSampled: "فحص بالعيّنة",
  mfgQcSampleSize: "حجم العيّنة",
  mfgQcDisposition: "القرار",
  mfgQcDispositionHint: "الراسب يتطلب قرارًا؛ الناجح يقبل «بدون قرار» أو «قبول» فقط؛ والإرجاع للمورّد لأهداف استلام المشتريات فقط.",
  mfgQcCreatedToast: "سُجّل الفحص ({result}).",
  mfgQcReleasedToast: "أُفرج عن الدفعة المحجوزة للفحص (أصبحت نشطة).",
  mfgQcScrapToast: "سُجّل إتلاف الفحص: كمية {qty} بقيمة {value} — قيد يومية {journal}.",

  // Genealogy screen (the read-only recall search)
  mfgGenealogyItem: "الصنف",
  mfgGenealogyBatchId: "أو الصق معرّف دفعة (UUID)",
  mfgGenealogyBatchHint: "اختر صنفًا ثم دفعة، أو الصق المعرّف مباشرة — الشاشة للقراءة فقط ولا ترحّل شيئًا.",
  mfgGenealogyUpstream: "المصادر (صعودًا)",
  mfgGenealogyDownstream: "الوجهات (نزولًا)",
  mfgGenealogySummary: "ملخّص الدفعة",
  mfgGenealogyBatchCard: "بطاقة الدفعة",
  mfgGenealogyOnHand: "الرصيد الحالي",
  mfgGenealogyProducingOrder: "أمر الإنتاج المُنشئ",
  mfgGenealogyConsumedBy: "الأوامر التي استهلكتها",
  mfgGenealogySalesCount: "عدد حركات البيع",
  mfgGenealogyInspectionsCount: "عدد الفحوص",
  mfgBatchStatusActive: "نشطة",
  mfgBatchStatusQuarantined: "محجوزة للفحص",
  mfgBatchStatusWrittenOff: "مشطوبة",
  mfgGenealogyMaterials: "سلسلة المواد (صعودًا)",
  mfgGenealogyColConsumedBy: "استُهلكت بواسطة",
  mfgGenealogyColProducedBy: "أُنتجت بواسطة",
  mfgGenealogyProductions: "الإنتاج النازل",
  mfgGenealogyColFromBatch: "من دفعة",
  mfgGenealogyColOrder: "الأمر",
  mfgGenealogySales: "المبيعات النازلة",
  mfgGenealogyColDocType: "نوع المستند",
  mfgGenealogyColDocId: "المستند",
  mfgGenealogyColDocDate: "تاريخ المستند",
  mfgGenealogyIdsHint: "تعرض هذه الشاشة معرّفات المستندات فقط — تقرير شجرة الدفعات يضيف أرقامها.",
  mfgDocSalesInvoice: "فاتورة بيع",
  mfgDocDeliveryNote: "إشعار تسليم",
  mfgGenealogyKindMaterial: "مادة",
  mfgGenealogyKindProduced: "منتَج",
  mfgGenealogyKindSold: "مبيع",

  // Manufacturing typed errors (manufacturing-errors.ts codes → mfgErr*)
  mfgErrBomNotFound: "قائمة المواد غير موجودة في هذه المنشأة.",
  mfgErrBomVersionConflict: "رقم الإصدار مستخدم مسبقًا لهذا الصنف — اختر إصدارًا جديدًا.",
  mfgErrBomNotDraft: "الإصدار ليس مسودة — التعديل والتفعيل للإصدارات المسودة فقط.",
  mfgErrBomNotActive: "الإصدار ليس نشطًا — الأرشفة للإصدارات النشطة فقط.",
  mfgErrBomActiveExists: "للصنف إصدار نشط آخر — أرشِفه أولًا (إصدار نشط واحد لكل صنف).",
  mfgErrBomLineInvalid: "بند مكوّن غير صالح — تحقق من الصنف والكمية (أكبر من صفر) وعدم تكرار المكوّن.",
  mfgErrBomCycle: "سلسلة القائمة تعود إلى صنف سبق عرضه — القوائم الدائرية مرفوضة.",
  mfgErrBomTooDeep: "تفجير القائمة يتجاوز حد الـ 16 مستوى.",
  mfgErrBomItemNotStock: "يجب أن يكون الصنف مخزنيًا — الخدمات لا تدخل قوائم المواد.",
  mfgErrBomSelfReference: "لا يمكن أن يكون الصنف مكوّنًا في قائمته الخاصة.",
  mfgErrBomYieldInvalid: "نسبة الإنتاج يجب أن تكون أكبر من 0 وأقصاها 100 (بحد أربع منازل عشرية).",
  mfgErrBomUomMismatch: "وحدة القياس للإخراج يجب أن تطابق وحدة الصنف الأساسية.",
  mfgErrBomRequired: "لا يوجد إصدار نشط لقائمة مواد الصنف — أنشئ إصدارًا وفعّله أو اختر إصدارًا صريحًا.",
  mfgErrOrderNotFound: "أمر الإنتاج غير موجود في هذه المنشأة.",
  mfgErrOrderState: "حالة الأمر لا تسمح بهذه العملية (المكتمل والملغى نهائيان).",
  mfgErrOrderInputInvalid: "بيانات الأمر غير صالحة — تحقق من الكميات والتواريخ والمستودعات.",
  mfgErrOrderItemNotStock: "يجب أن يكون الصنف المنتج مخزنيًا — الخدمات لا تُصنّع.",
  mfgErrConsumptionNotPlanned: "الصنف ليس من مكوّنات الخطة المجمّدة — التصحيح يكون باستهلاك معدّل للمكوّنات المخططة.",
  mfgErrScrapReasonRequired: "رمز سبب الإتلاف مطلوب بموجب سياسة المنشأة (1–40 حرفًا).",
  mfgErrScrapExceedsWip: "قيمة التالف تتجاوز رصيد تحت التشغيل الحالي للأمر.",
  mfgErrCompleteWithoutConsumption: "لا يمكن الإكمال قبل استهلاك المواد — سجّل استهلاكًا أولًا.",
  mfgErrCostRounding: "تكلفة الوحدة لا تمثل قيمة الإنتاج بدقة أربع منازل — راجع الكمية الفعلية.",
  mfgErrFgShelfLifeRequired: "الصنف يتتبع الانتهاء وسياسة الاشتقاق مفعّلة لكن لا توجد أيام صلاحية على الصنف.",
  mfgErrOrderNotCancelable: "الأمر بدأ الاستهلاك — التصحيح باستهلاكات معدّلة لا بالإلغاء.",
  mfgErrInspectionNotFound: "الفحص غير موجود في هذه المنشأة.",
  mfgErrInspectionTargetNotFound: "استلام المشتريات غير موجود في هذه المنشأة.",
  mfgErrInspectionTargetInvalid: "هدف الفحص غير صالح — أمر الإنتاج يجب أن يكون مكتملًا، والاستلام يحتاج معرّفًا.",
  mfgErrInspectionInputInvalid: "بيانات الفحص غير صالحة — تحقق من العيّنة وحجمها والتاريخ.",
  mfgErrDispositionRequired: "الفحص الراسب يتطلب قرارًا (قبول أو إتلاف أو إعادة تشغيل أو إرجاع للمورّد).",
  mfgErrDispositionInvalid: "القرار لا يناسب النتيجة — الناجح يقبل «بدون قرار» أو «قبول» فقط، والإرجاع للمورّد لأهداف الاستلام فقط.",
  mfgErrQcScrapBatchNotQuarantined: "لا توجد دفعة إنتاج تام محجوزة للفحص على الأمر — الإتلاف يتطلب دفعة محجوزة.",
  mfgErrQcScrapEmptyBatch: "الدفعة المحجوزة فارغة — لا رصيد متبقٍ لإتلافه.",
  mfgErrGenealogyBatchNotFound: "الدفعة غير موجودة في هذه المنشأة.",

  // -- PHASE-019 (T50): crm navigation & screens ---------------------
  // (leads pipeline + tasks/activities + service contracts + recurring
  // billing + time entries + service orders + the projects dimension +
  // the GL project filter + the dashboard CRM card)

  crmNavSection: "إدارة العملاء",
  crmPipelineTitle: "قمع العملاء المحتملين",
  crmTasksTitle: "مهام المتابعة والأنشطة",
  crmContractsTitle: "عقود الخدمات",
  crmBillingTitle: "الفوترة الدورية",
  crmTimeTitle: "سجل الوقت",
  crmServiceOrdersTitle: "أوامر الخدمة",
  accountingProjectsTitle: "المشاريع",

  // GL project filter (the T44 projectId query param)
  accountingGlProjectFilter: "مشروع",
  accountingGlAllProjects: "كل المشاريع",

  // Lead pipeline screen (the board + conversion wizard + lose dialog)
  crmLeadsNew: "عميل محتمل جديد",
  crmLeadsEmpty: "لا يوجد عملاء محتملون بعد.",
  crmLeadsAllStatuses: "كل الحالات",
  crmLeadStatusNew: "جديد",
  crmLeadStatusQualified: "مؤهَّل",
  crmLeadStatusConverted: "محوَّل",
  crmLeadStatusLost: "مفقود",
  crmLeadColName: "الاسم",
  crmLeadColCompany: "الجهة",
  crmLeadColContact: "التواصل",
  crmLeadColSource: "المصدر",
  crmLeadColOwner: "المسؤول",
  crmLeadColPartner: "الشريك",
  crmLeadColCreated: "أُنشئ في",
  crmLeadColLostReason: "سبب الفقد",
  crmLeadSourceWalkIn: "زيارة مباشرة",
  crmLeadSourceReferral: "ترشيح",
  crmLeadSourceWebsite: "الموقع الإلكتروني",
  crmLeadSourceCampaign: "حملة تسويقية",
  crmLeadSourceCall: "مكالمة",
  crmLeadSourceOther: "أخرى",
  crmLeadCreateTitle: "تسجيل عميل محتمل",
  crmLeadEditTitle: "تعديل العميل المحتمل",
  crmLeadName: "الاسم",
  crmLeadNameAr: "الاسم بالعربية",
  crmLeadPhone: "الهاتف",
  crmLeadEmail: "البريد الإلكتروني",
  crmLeadCompany: "الجهة / الشركة",
  crmLeadSource: "المصدر",
  crmLeadOwner: "مندوب المبيعات المسؤول",
  crmLeadNote: "ملاحظة",
  crmLeadConvert: "تحويل",
  crmLeadConvertTitle: "تحويل العميل المحتمل إلى شريك",
  crmLeadConvertMode: "طريقة التحويل",
  crmLeadConvertNewPartner: "إنشاء شريك جديد",
  crmLeadConvertMerge: "ربط بشريك قائم",
  crmLeadConvertPartner: "الشريك الهدف",
  crmLeadConvertHint: "التحويل نهائي — يرتبط العميل المحتمل بالشريك للأبد ولا يقبل أي تعديل بعده.",
  crmLeadLose: "تسجيل فقد",
  crmLeadLoseTitle: "تسجيل فقد العميل المحتمل",
  crmLeadLoseReason: "سبب الفقد (1–200 حرفًا)",
  crmLeadCreatedToast: "سُجّل العميل المحتمل.",
  crmLeadSavedToast: "حُفظت تعديلات العميل المحتمل.",
  crmLeadConvertedToast: "حوّل العميل المحتمل — الشريك {partner}.",
  crmLeadLostToast: "سُجّل فقد العميل المحتمل.",

  // Tasks + activities screen (future work + the logged-past timeline)
  crmTasksNew: "مهمة جديدة",
  crmTasksEmpty: "لا توجد مهام بعد.",
  crmTasksAllStatuses: "كل الحالات",
  crmTaskStatusOpen: "مفتوحة",
  crmTaskStatusDone: "منجزة",
  crmTaskStatusCancelled: "ملغاة",
  crmTaskColTitle: "المهمة",
  crmTaskColDue: "الاستحقاق",
  crmTaskColRemind: "التذكير",
  crmTaskColAssignee: "المكلَّف",
  crmTaskColRelated: "مرتبطة بـ",
  crmTaskCreateTitle: "مهمة متابعة جديدة",
  crmTaskEditTitle: "تعديل المهمة",
  crmTaskTitleLabel: "عنوان المهمة",
  crmTaskAssignee: "المكلَّف",
  crmTaskDueDate: "تاريخ الاستحقاق",
  crmTaskRemindAt: "تاريخ التذكير",
  crmTaskRemindTime: "وقت التذكير",
  crmTaskNote: "ملاحظة",
  crmTaskRelatedType: "نوع الارتباط",
  crmTaskRelatedLead: "عميل محتمل",
  crmTaskRelatedPartner: "شريك",
  crmTaskRelatedContract: "عقد خدمات",
  crmTaskRelatedServiceOrder: "أمر خدمة",
  crmTaskRelatedTarget: "السجل المرتبط",
  crmTaskCreatedToast: "أُنشئت المهمة.",
  crmTaskSavedToast: "حُفظت تعديلات المهمة.",
  crmTaskComplete: "إنجاز",
  crmTaskCompletedToast: "أُنجزت المهمة.",
  crmTaskCancelledToast: "أُلغيت المهمة.",
  crmActivitiesTitle: "سجل الأنشطة",
  crmActivitiesEmpty: "لا توجد أنشطة مسجّلة لهذا الارتباط.",
  crmActivitiesHint: "اختر مهمة لعرض أنشطة سجلها المرتبط — الأنشطة تُجلب عند التحديد.",
  crmActivityColOccurredAt: "التاريخ",
  crmActivityColKind: "النوع",
  crmActivityColSummary: "الملخص",
  crmActivityColDuration: "المدة (دقيقة)",
  crmActivityKindCall: "مكالمة",
  crmActivityKindMeeting: "اجتماع",
  crmActivityKindEmail: "بريد إلكتروني",
  crmActivityKindNote: "ملاحظة",
  crmActivityLogTitle: "تسجيل نشاط",
  crmActivityKindLabel: "نوع النشاط",
  crmActivityOccurredAt: "تاريخ النشاط",
  crmActivityOccurredTime: "وقت النشاط",
  crmActivitySummary: "الملخص",
  crmActivityDuration: "المدة بالدقائق (اختياري)",
  crmActivityLoggedToast: "سُجّل النشاط.",

  // Service contracts screen (list + create/edit + schedule + preview + advances)
  crmContractsNew: "عقد جديد",
  crmContractsEmpty: "لا توجد عقود بعد.",
  crmContractsAllStatuses: "كل الحالات",
  crmContractStatusDraft: "مسودة",
  crmContractStatusActive: "نشط",
  crmContractStatusCancelled: "ملغى",
  crmContractStatusRenewed: "مُجدَّد",
  crmContractExpiredChip: "منتهي",
  crmContractColNo: "رقم العقد",
  crmContractColPartner: "الشريك",
  crmContractColTitle: "العنوان",
  crmContractColFeeModel: "نموذج الأتعاب",
  crmContractColTerm: "المدة",
  crmContractColMonthly: "المبلغ الشهري",
  crmFeeModelRetainer: "أتعاب شهرية",
  crmFeeModelMilestones: "دفعات مراحل",
  crmFeeModelHourly: "بالساعة",
  crmContractCreateTitle: "عقد خدمات جديد",
  crmContractPartner: "الشريك (عميل)",
  crmContractProject: "المشروع (اختياري)",
  crmContractTitleLabel: "عنوان العقد",
  crmContractTitleAr: "العنوان بالعربية",
  crmContractScope: "نطاق العمل",
  crmContractFeeModel: "نموذج الأتعاب",
  crmContractStartDate: "تاريخ البداية",
  crmContractEndDate: "تاريخ النهاية",
  crmContractMonthlyAmount: "المبلغ الشهري (للأتعاب الشهرية)",
  crmContractFeeItem: "بند الخدمة الافتراضي",
  crmContractFeeItemHint: "يُثبَّت في بنود جدول الفوترة عند الإنشاء (بند من نوع خدمة).",
  crmContractNote: "ملاحظة",
  crmContractMilestones: "دفعات المراحل",
  crmContractMilestoneLabel: "اسم المرحلة",
  crmContractMilestoneDue: "تاريخ الاستحقاق",
  crmContractMilestoneAmount: "المبلغ",
  crmContractAddMilestone: "إضافة مرحلة",
  crmContractRemoveMilestone: "حذف المرحلة",
  crmContractEditTitle: "تعديل العقد (مسودة)",
  crmContractWorkspace: "مساحة عمل العقد",
  crmContractActivatedAt: "تاريخ التفعيل",
  crmContractRenewedTo: "العقد البديل",
  crmContractCancelReasonLabel: "سبب الإلغاء",
  crmContractActivate: "تفعيل",
  crmContractActivateHint: "التفعيل يحجز رقم العقد (CT-) ويثبّت جدول الفوترة النهائي — لا يقبل العقد النشط التعديل بعدها.",
  crmContractCancelAction: "إلغاء العقد",
  crmContractCancelTitle: "إلغاء عقد الخدمات",
  crmContractRenew: "تجديد",
  crmContractRenewTitle: "تجديد العقد",
  crmContractRenewStart: "بداية المدة الجديدة (اختياري)",
  crmContractRenewEnd: "نهاية المدة الجديدة (اختياري)",
  crmContractRenewHint: "ينشئ التجديد عقد مسودة جديدًا بنسخة من بنود العقد الحالي ويربطه بهذا العقد.",
  crmContractCreatedToast: "أُنشئ العقد (مسودة) — ثبّت الجدول عند التفعيل.",
  crmContractSavedToast: "حُفظت تعديلات العقد.",
  crmContractActivatedToast: "فُعّل العقد — الرقم {no}.",
  crmContractCancelledToast: "أُلغي العقد.",
  crmContractRenewedToast: "أُنشئ عقد التجديد — الرقم {no}.",
  crmScheduleTitle: "جدول الفوترة",
  crmScheduleEmpty: "لا توجد بنود في الجدول.",
  crmScheduleColEntryType: "النوع",
  crmScheduleColPeriod: "الفترة",
  crmScheduleColWindow: "النافذة",
  crmScheduleColBillDate: "تاريخ الفوترة",
  crmScheduleColAmount: "المبلغ",
  crmScheduleColMilestone: "المرحلة",
  crmScheduleEntryRetainer: "أتعاب شهرية",
  crmScheduleEntryMilestone: "دفعة مرحلة",
  crmScheduleEntryHourly: "فترة ساعات",
  crmScheduleStatusPlanned: "مخططة",
  crmScheduleStatusInvoiced: "مفوترة",
  crmScheduleStatusSkipped: "متخطاة",
  crmPreviewTitle: "معاينة الفوترة",
  crmPreviewAsOf: "حتى تاريخ",
  crmPreviewRun: "عرض المعاينة",
  crmPreviewEmpty: "لا توجد بنود مستحقة حتى التاريخ المحدد.",
  crmPreviewLockedChip: "فترة مقفلة",
  crmPreviewNarrativeChip: "بلا وصف",
  crmPreviewPullable: "بنود وقت قابلة للفوترة",
  crmPreviewNeedsNarrative: "بنود تحتاج وصفًا قبل الفوترة",
  crmAdvancesTitle: "الدفعات المقدمة",
  crmAdvancesEmpty: "لا توجد دفعات مقدمة مرتبطة بهذا العقد.",
  crmAdvancesTag: "ربط دفعة مقدمة",
  crmAdvancesTagTitle: "ربط دفعة مقدمة بالعقد",
  crmAdvanceReceipt: "سند القبض",
  crmAdvanceNote: "ملاحظة",
  crmAdvancePolicyHint: "يُربط من رصيد السند غير المخصص؛ وسياسة المنشأة تحدد ترحيل قيد الإرجاء تلقائيًا.",
  crmAdvanceColReceipt: "سند القبض",
  crmAdvanceColAmount: "المبلغ",
  crmAdvanceColStatus: "الحالة",
  crmAdvanceColJournals: "القيود",
  crmAdvanceStatusHeld: "معلقة",
  crmAdvanceStatusReleased: "مُفرج عنها",
  crmAdvanceTaggedToast: "رُبطت الدفعة المقدمة بالعقد.",

  // Recurring billing screen (runs history + manual run + drafts review)
  crmBillingRunsTitle: "سجل تشغيلات الفوترة",
  crmBillingRunsEmpty: "لم تُشغَّل الفوترة الدورية بعد.",
  crmBillingColAt: "الوقت",
  crmBillingColActor: "المشغِّل",
  crmBillingColAsOf: "حتى تاريخ",
  crmBillingColScanned: "عقود مفحوصة",
  crmBillingColDrafts: "مسودات",
  crmBillingColLocked: "مقفلة",
  crmBillingColDuplicates: "مكررة",
  crmBillingColNarrative: "بلا وصف",
  crmBillingRunAction: "تشغيل الفوترة",
  crmBillingRunTitle: "تشغيل فوترة دورية",
  crmBillingRunAsOf: "حتى تاريخ",
  crmBillingPreviewAll: "معاينة جافة (كل العقود النشطة)",
  crmBillingPreviewTitle: "المعاينة الجافة",
  crmBillingPreviewEmpty: "لا توجد بنود مستحقة حتى التاريخ المحدد.",
  crmBillingPreviewContract: "العقد",
  crmBillingRunToast: "اكتمل التشغيل — {drafts} مسودة فاتورة، و{scanned} عقد مفحوص.",
  crmBillingDraftsTitle: "فواتير العقود (المسودات والتاريخ)",
  crmBillingDraftsEmpty: "لا توجد فواتير مولدة من العقود بعد.",
  crmBillingDraftsColContract: "العقد",
  crmBillingDraftsColInvoice: "الفاتورة",
  crmBillingDraftsColPeriod: "الفترة",
  crmBillingDraftsColMilestone: "المرحلة",
  crmBillingDraftsColCreatedAt: "أُنشئت في",
  crmBillingDraftsLink: "فتح شاشة فواتير البيع",

  // Time entries screen (timeslips + weekly review)
  crmTimeNew: "تسجيل وقت",
  crmTimeEmpty: "لا توجد قيود وقت بعد.",
  crmTimeColDate: "التاريخ",
  crmTimeColProject: "المشروع",
  crmTimeColFeeItem: "بند الخدمة",
  crmTimeColHours: "الساعات",
  crmTimeColRate: "السعر/ساعة",
  crmTimeColNarrative: "الوصف",
  crmTimeColBillable: "قابلة للفوترة",
  crmTimeColEarner: "مقدم الخدمة",
  crmTimeCreateTitle: "تسجيل وقت",
  crmTimeEditTitle: "تعديل قيد الوقت",
  crmTimeEntryDate: "تاريخ القيد",
  crmTimeHours: "الساعات",
  crmTimeFeeItem: "بند الخدمة",
  crmTimeProject: "المشروع",
  crmTimeCaseHint: "سياسة المنشأة تتطلب مشروعًا (قضية) على كل قيد وقت.",
  crmTimeContract: "العقد (اختياري — يحدد السعر من قائمة الأسعار)",
  crmTimeFeeEarner: "مقدم الخدمة",
  crmTimeRate: "السعر/ساعة (يدوي — اختياري)",
  crmTimeRateHint: "يُثبَّت السعر لحظة التسجيل ولا يُعاد حسابه لاحقًا؛ اتركه فارغًا ليُقرأ من قائمة أسعار شريك العقد.",
  crmTimeNarrative: "الوصف (مطلوب للفوترة بالساعة)",
  crmTimeBillable: "قابلة للفوترة",
  crmTimeYes: "نعم",
  crmTimeNo: "لا",
  crmTimeCreatedToast: "سُجّل الوقت.",
  crmTimeSavedToast: "حُفظ قيد الوقت.",
  crmTimeVoid: "إبطال",
  crmTimeVoidedToast: "أُبطل قيد الوقت.",
  crmTimeStatusDraft: "مسودة",
  crmTimeStatusApproved: "معتمد",
  crmTimeStatusBilled: "مفوتر",
  crmTimeStatusVoid: "مبطل",
  crmTimeReviewTitle: "اعتماد كشف الأسبوع",
  crmTimeReviewWeek: "بداية الأسبوع (الاثنين)",
  crmTimeReviewHint: "يعتمد كل قيود الوقت المسودة في الأسبوع المحدد (الاثنين → الأحد).",
  crmTimeReviewToast: "اعتُمد {count} قيد وقت للأسبوع {week}.",

  // Service orders screen (the job-card workspace pattern)
  crmServiceOrdersNew: "أمر خدمة جديد",
  crmServiceOrdersEmpty: "لا توجد أوامر خدمة بعد.",
  crmServiceOrdersAllStatuses: "كل الحالات",
  crmServiceOrderStatusDraft: "مسودة",
  crmServiceOrderStatusInProgress: "قيد التنفيذ",
  crmServiceOrderStatusCompleted: "مكتمل",
  crmServiceOrderStatusInvoiced: "مفوتر",
  crmServiceOrderStatusCancelled: "ملغى",
  crmServiceOrderColNo: "رقم الأمر",
  crmServiceOrderColPartner: "الشريك",
  crmServiceOrderColContract: "العقد",
  crmServiceOrderCreateTitle: "أمر خدمة جديد",
  crmServiceOrderPartner: "الشريك (عميل)",
  crmServiceOrderContract: "العقد (اختياري)",
  crmServiceOrderContractHint: "الربط بالعقد للربط الإجرائي فقط ولا يغيّر أي قيد محاسبي.",
  crmServiceOrderLines: "بنود الأمر",
  crmServiceOrderLineType: "النوع",
  crmServiceOrderLineService: "خدمة",
  crmServiceOrderLineParts: "قطع",
  crmServiceOrderItem: "الصنف",
  crmServiceOrderDescription: "الوصف",
  crmServiceOrderHours: "الساعات المقدرة",
  crmServiceOrderQty: "الكمية",
  crmServiceOrderUnitPrice: "سعر الوحدة",
  crmServiceOrderAddLine: "إضافة بند",
  crmServiceOrderRemoveLine: "حذف البند",
  crmServiceOrderWorkspace: "مساحة عمل أمر الخدمة",
  crmServiceOrderEditTitle: "تعديل أمر الخدمة (مسودة)",
  crmServiceOrderApprove: "اعتماد",
  crmServiceOrderApproveTitle: "اعتماد أمر الخدمة",
  crmServiceOrderIssueMode: "سياسة صرف القطع",
  crmServiceOrderIssueImmediate: "صرف فوري (قيد تكلفة عند الاعتماد)",
  crmServiceOrderIssueReserve: "حجز (يُستهلك عند الفوترة)",
  crmServiceOrderLogHours: "تسجيل ساعات",
  crmServiceOrderLogHoursTitle: "تسجيل ساعات على بند خدمة",
  crmServiceOrderLine: "البند",
  crmServiceOrderComplete: "إكمال",
  crmServiceOrderInvoiceAction: "فوترة",
  crmServiceOrderCancelAction: "إلغاء الأمر",
  crmServiceOrderCancelTitle: "إلغاء أمر الخدمة",
  crmServiceOrderCancelReason: "سبب الإلغاء",
  crmServiceOrderCreatedToast: "أُنشئ أمر الخدمة — الرقم {no}.",
  crmServiceOrderSavedToast: "حُفظت تعديلات أمر الخدمة.",
  crmServiceOrderApprovedToast: "اعتُمد أمر الخدمة.",
  crmServiceOrderHoursToast: "سُجلت الساعات على البند.",
  crmServiceOrderCompletedToast: "اكتمل أمر الخدمة.",
  crmServiceOrderInvoicedToast: "فُوتر أمر الخدمة — الفاتورة {invoice}.",
  crmServiceOrderCancelledToast: "أُلغي أمر الخدمة.",
  crmServiceOrderColLineNo: "#",
  crmServiceOrderColLineType: "النوع",
  crmServiceOrderColItem: "الصنف",
  crmServiceOrderColHours: "الساعات",
  crmServiceOrderColQty: "الكمية",
  crmServiceOrderColPrice: "السعر",
  crmServiceOrderColLogged: "المسجلة",
  crmServiceOrderColStatus: "الحالة",
  crmServiceOrderLineStatusPending: "منتظر",
  crmServiceOrderLineStatusReserved: "محجوز",
  crmServiceOrderLineStatusIssued: "مصروف",
  crmServiceOrderLineStatusInvoiced: "مفوتر",
  crmServiceOrderLineStatusVoid: "ملغى",
  crmServiceOrderIssueValue: "قيمة الصرف",

  // Projects screen (accounting.projects — the cost-center mirror)
  accountingProjectsNew: "مشروع جديد",
  accountingProjectsEmpty: "لا توجد مشاريع بعد.",
  accountingProjectColParent: "المشروع الأب",
  accountingProjectCreateTitle: "مشروع جديد",
  accountingProjectCode: "رمز المشروع",
  accountingProjectCodeHint: "حروف وأرقام وشرطات فقط، 1–20 حرفًا (مثال: CASE-01).",
  accountingProjectNameAr: "الاسم بالعربية",
  accountingProjectParent: "المشروع الأب (اختياري)",
  accountingProjectStatusOpen: "مفتوح",
  accountingProjectStatusClosed: "مغلق",
  accountingProjectEditTitle: "تعديل المشروع",
  accountingProjectClose: "إغلاق",
  accountingProjectReopen: "إعادة فتح",
  accountingProjectCloseTitle: "إغلاق المشروع",
  accountingProjectCloseHint: "المشروع المغلق يرفض قيود اليومية الجديدة وتبقى قيوده المسجلة كما هي.",
  accountingProjectCreatedToast: "أُنشئ المشروع.",
  accountingProjectSavedToast: "حُفظت تعديلات المشروع.",
  accountingProjectStatusToast: "حُدّثت حالة المشروع.",
  accountingProjectErrCodeTaken: "رمز المشروع مستخدم مسبقًا في هذه المنشأة.",

  // Dashboard CRM card (the permission-gated summary section)
  dashboardCrmTitle: "لمحة إدارة العملاء",
  dashboardCrmPipeline: "القمع: {newCount} جديد · {qualifiedCount} مؤهَّل",
  dashboardCrmFollowUps: "متابعات اليوم: {dueToday} · متأخرة: {overdue}",
  dashboardCrmExpiring: "عقود تنتهي خلال 30 يومًا: {count}",
  dashboardCrmUpcoming: "بنود فوترة خلال 7 أيام: {count}",
  dashboardCrmOpen: "فتح قمع العملاء",

  // CRM typed errors (crm-errors.ts codes → crmErr*)
  crmErrLeadNotFound: "العميل المحتمل غير موجود في هذه المنشأة.",
  crmErrLeadInputInvalid: "بيانات العميل المحتمل غير صالحة — راجع الحقول.",
  crmErrLeadConverted: "العميل المحتمل محوَّل أو مغلق — لا يقبل هذه العملية.",
  crmErrLeadLostReason: "تسجيل الفقد يتطلب سببًا (1–200 حرفًا).",
  crmErrLeadMergeTarget: "هدف الربط غير صالح — يجب أن يكون شريكًا عميلًا قائمًا في هذه المنشأة.",
  crmErrTaskNotFound: "المهمة غير موجودة في هذه المنشأة.",
  crmErrTaskState: "حالة المهمة لا تسمح بهذه العملية.",
  crmErrTaskInput: "بيانات المهمة غير صالحة — تحقق من العنوان والارتباط والتواريخ.",
  crmErrActivityInput: "بيانات النشاط غير صالحة — تحقق من النوع والملخص والتاريخ.",
  crmErrContractNotFound: "عقد الخدمات غير موجود في هذه المنشأة.",
  crmErrContractState: "حالة العقد لا تسمح بهذه العملية (المسودة فقط تقبل التعديل والتفعيل).",
  crmErrContractInput: "بيانات العقد غير صالحة — تحقق من الشريك والمدة ونموذج الأتعاب وبنود الخدمة.",
  crmErrContractTerm: "مدة العقد غير صالحة — النهاية يجب أن تكون في البداية أو بعدها.",
  crmErrScheduleNotFound: "بند الجدول غير موجود في هذه المنشأة.",
  crmErrAdvanceState: "سند القبض لا يصلح لهذه الدفعة — تحقق من حالته وشريكه وعملته وعدم تكرار الربط.",
  crmErrAdvanceInsufficient: "رصيد السند غير المخصص لا يكفي لقيمة الدفعة المطلوبة.",
  crmErrTimeNotFound: "قيد الوقت غير موجود في هذه المنشأة.",
  crmErrTimeState: "حالة قيد الوقت لا تسمح بهذه العملية.",
  crmErrTimeInput: "بيانات قيد الوقت غير صالحة — تحقق من الساعات وبند الخدمة والسعر.",
  crmErrTimeCaseRequired: "سياسة المنشأة تتطلب مشروعًا (قضية) على كل قيد وقت.",
  crmErrTimesheetEmpty: "لا توجد قيود وقت مسودة في هذا الأسبوع لاعتمادها.",
  crmErrServiceOrderNotFound: "أمر الخدمة غير موجود في هذه المنشأة.",
  crmErrServiceOrderState: "حالة أمر الخدمة لا تسمح بهذه العملية (المفوتر لا يُلغى — التصحيح بإشعار دائن).",
  crmErrServiceOrderInput: "بيانات أمر الخدمة غير صالحة — تحقق من الشريك والعقد والبنود.",
  crmErrServiceOrderLine: "بند غير صالح — بنود الخدمة تحتاج صنف خدمة بساعات، وبنود القطع تحتاج صنفًا مخزنيًا بكمية.",
  crmErrServiceOrderPosting: "إعدادات الترحيل لأوامر الخدمة غير مكتملة — تواصل مع المسؤول.",

  // -- PHASE-020 (T14): sync admin screens — Arabic --------------------
  syncDevicesTitle: "إدارة الأجهزة",
  syncHealthTitle: "صحة المزامنة",
  syncReconciliationTitle: "تسوية الأجهزة الملغاة",
  syncDevicesSubtitle:
    "سجل الأجهزة المسجّلة (النوع، المنصة، إصدار العقد، حالة الإثبات، مؤشرات الثقة، آخر سحب/دفع، انتهاء البيانات) مع إجراءات الإلغاء ووسم الثقة وتحديد انتهاء البيانات.",
  syncHealthSubtitle:
    "لوحة صحة المزامنة: نجاح الدفع وزمن المعالجة، تأخر المؤشرات لكل كيان، التعارضات والرفوضات، مقياس تأخر الصادر، والتنبيهات المشتقة.",
  syncReconciliationSubtitle:
    "طابور الأجهزة الملغاة ذات الحالة غير المحسومة: أوامر معلّقة ومسودات مملوكة للجهاز — انقل ملكية المسودات لجهاز آخر لإغلاق الطابور.",

  // Device registry screen (/platform/devices)
  syncDevicesEmpty: "لا توجد أجهزة مسجّلة في هذه المنشأة.",
  syncDevicesColName: "الجهاز",
  syncDevicesColClass: "النوع",
  syncDevicesColPlatform: "المنصة",
  syncDevicesColContract: "إصدار العقد",
  syncDevicesColAttestation: "الإثبات",
  syncDevicesColTrustFlags: "مؤشرات الثقة",
  syncDevicesColLastPull: "آخر سحب",
  syncDevicesColLastPush: "آخر دفع",
  syncDevicesColStatus: "الحالة",
  syncDevicesColDataExpiry: "انتهاء البيانات",
  syncDevicesColPending: "أوامر معلّقة",
  syncDevicesFilterClass: "نوع الجهاز",
  syncDevicesFilterClassAll: "كل الأنواع",
  syncDevicesFilterStatus: "الحالة",
  syncDevicesFilterStatusAll: "كل الحالات",
  syncDevicesFilterStatusActive: "نشط",
  syncDevicesFilterStatusRevoked: "ملغى",
  syncDevicesFilterApply: "تطبيق",
  syncDevicesClassPosTerminal: "نقطة بيع",
  syncDevicesClassTauriDesktop: "حاسوب مكتبي",
  syncDevicesClassAndroidField: "جهاز ميداني",
  syncDevicesClassAndroidPersonal: "جهاز شخصي",
  syncDevicesAttested: "مُثبت",
  syncDevicesAttestationPending: "بانتظار الإثبات",
  syncDevicesStatusActive: "نشط",
  syncDevicesStatusRevoked: "ملغى",
  syncDevicesTrustFlagsNone: "بدون",
  syncDevicesActionRevoke: "إلغاء الجهاز",
  syncDevicesActionFlag: "وسم ثقة",
  syncDevicesActionExpiry: "تحديد انتهاء البيانات",
  syncDevicesActionDetail: "حالة المزامنة",
  syncDevicesRevokeTitle: "إلغاء الجهاز",
  syncDevicesRevokeReason: "السبب (اختياري)",
  syncDevicesRevokeReasonPlaceholder: "فقدان الجهاز…",
  syncDevicesRevokeConfirm:
    "الإلغاء يوقف كل بيانات الاعتماد فورًا ولا يمكن التراجع عنه. هل تريد المتابعة؟",
  syncDevicesRevokeAction: "إلغاء نهائي",
  syncDevicesRevokedToast: "تم إلغاء الجهاز.",
  syncDevicesFlagTitle: "وسم مؤشر ثقة",
  syncDevicesFlagKey: "المفتاح",
  syncDevicesFlagValue: "القيمة",
  syncDevicesFlagHint: "يُدمج مع المؤشرات الحالية (لا يستبدلها) — مثال: مفتاح jailbroken وقيمة suspected.",
  syncDevicesFlagAction: "وسم",
  syncDevicesFlaggedToast: "تم دمج مؤشر الثقة.",
  syncDevicesExpiryTitle: "تحديد انتهاء بيانات الجهاز",
  syncDevicesExpiryAt: "تنتهي البيانات في",
  syncDevicesExpiryClear: "إلغاء التحديد",
  syncDevicesExpiryAction: "حفظ",
  syncDevicesExpirySetToast: "تم تحديد انتهاء بيانات الجهاز.",
  syncDevicesExpiryClearedToast: "تم إلغاء انتهاء بيانات الجهاز.",
  syncDevicesDetailTitle: "حالة مزامنة الجهاز",
  syncDevicesDetailCursors: "المؤشرات لكل كيان",
  syncDevicesDetailEntity: "الكيان",
  syncDevicesDetailLastSeq: "آخر تسلسل",
  syncDevicesDetailAckedAt: "تاريخ الإقرار",
  syncDevicesDetailNoCursors: "لا توجد مؤشرات لهذا الجهاز بعد.",
  syncDevicesDetailLoadError: "تعذّر تحميل حالة المزامنة.",
  syncDevicesPendingCommands: "أوامر معلّقة: {count}",

  // Sync health dashboard (/platform/sync-health)
  syncHealthPushTitle: "إحصاءات الدفع (آخر 7 أيام)",
  syncHealthPushTotal: "الإجمالي",
  syncHealthPushAccepted: "مقبولة",
  syncHealthPushRejected: "مرفوضة",
  syncHealthPushDeferred: "مؤجّلة",
  syncHealthPushSuccessRate: "نسبة النجاح",
  syncHealthPushP95: "زمن المعالجة p95",
  syncHealthPushP95None: "لا عينات",
  syncHealthPullLagTitle: "تأخر مؤشرات السحب لكل كيان",
  syncHealthPullLagEntity: "الكيان",
  syncHealthPullLagMaxLag: "أقصى تأخر",
  syncHealthPullLagDevices: "الأجهزة",
  syncHealthPullLagEmpty: "لا توجد مؤشرات مُقرّة بعد.",
  syncHealthPullLagNeverAck: "لم يُقرّ بعد",
  syncHealthConflictsTitle: "التعارضات حسب نوع الأمر",
  syncHealthRejectionsTitle: "الرفوضات حسب السبب",
  syncHealthBreakdownCount: "العدد",
  syncHealthBreakdownEmpty: "لا رفوضات خلال النافذة.",
  syncHealthOutboxTitle: "مقياس تأخر الصادر (حسب آخر دفع)",
  syncHealthOutboxNever: "لم يدفع أبدًا",
  syncHealthOutboxLt1h: "أقل من ساعة",
  syncHealthOutboxLt6h: "أقل من 6 ساعات",
  syncHealthOutboxLt24h: "أقل من 24 ساعة",
  syncHealthOutboxLt7d: "أقل من 7 أيام",
  syncHealthOutboxGt7d: "أكثر من 7 أيام",
  syncHealthOutboxDevices: "جهازًا",
  syncHealthRevokedTitle: "الأجهزة الملغاة ذات عمليات معلّقة",
  syncHealthRevokedDevices: "أجهزة",
  syncHealthRevokedPending: "أوامر معلّقة",
  syncHealthRevokedDrafts: "مسودات مملوكة",
  syncHealthTombstones: "سجلات الحذف (GC)",
  syncHealthAlertsTitle: "التنبيهات",
  syncHealthAlertsEmpty: "لا تنبيهات — كل المؤشرات ضمن الحدود.",
  syncHealthAlertSyncCursorStall:
    "كيان «{entity}» لم يُقرّ مؤشر سحب منذ {days} يومًا ({devices} جهازًا متأثرًا).",
  syncHealthAlertSyncPushFailSpike:
    "نسبة نجاح الدفع {rate}% خلال آخر 7 أيام ({total} أمرًا، {rejected} مرفوضًا) — أدنى من حد 90%.",
  syncHealthGeneratedAt: "تم إنشاء التقرير:",
  syncHealthLagDays: "يومًا",
  syncHealthLagHours: "ساعات",
  syncHealthLagMinutes: "دقائق",

  // Revoked-device reconciliation queue (/platform/sync-reconciliation)
  syncReconciliationEmpty: "الطابور فارغ — لا أجهزة ملغاة ذات حالة معلّقة.",
  syncReconciliationColDevice: "المعرّف",
  syncReconciliationColName: "الجهاز",
  syncReconciliationColRevokedAt: "تاريخ الإلغاء",
  syncReconciliationColPending: "أوامر معلّقة",
  syncReconciliationColDrafts: "مسودات مملوكة",
  syncReconciliationColOldest: "أقدم معلّق",
  syncReconciliationReassign: "نقل ملكية المسودات",
  syncReconciliationReassignTitle: "نقل ملكية المسودات",
  syncReconciliationReassignFrom: "من الجهاز (ملغى)",
  syncReconciliationReassignTo: "إلى الجهاز",
  syncReconciliationReassignToPlaceholder: "اختر جهازًا نشطًا…",
  syncReconciliationReassignNoTargets:
    "تعذّر جلب قائمة الأجهزة النشطة — أدخل معرّف الجهاز الهدف يدويًا.",
  syncReconciliationReassignAction: "نقل الملكية",
  syncReconciliationReassignedToast: "تم نقل ملكية {count} مسودة.",

  // -- PHASE-021 (T2-b): قوائم وحدة العمل دون اتصال ------------------------------
  // (DR-P21-06 / MASTER-PLAN §6 — الحالات الصادقة، جدول إجراءات الرفض
  // CONFLICT_RESOLUTION §3، المسودات التسع، القراءات المخبأة، إعادة الطباعة،
  // شاشة الفتح D-04، ومداخل التنقل/لوحة المعلومات)

  // حالة الوحدة والغلاف
  offlineNavSection: "العمل دون اتصال",
  offlineConsoleTitle: "وحدة العمل دون اتصال",
  offlineConsoleIntro:
    "المسودات والقراءات المخبأة وقائمة المزامنة — تعمل دون اتصال داخل تطبيق سطح المكتب، وتُبتَث الخيارات النهائية عند المزامنة.",
  offlinePhaseBrowser: "وضع المتصفح — عبر الإنترنت فقط",
  offlinePhaseIdle: "خامل",
  offlinePhaseSyncing: "جارٍ المزامنة…",
  offlinePhaseReadOnly: "قراءة فقط",
  offlinePhaseRevoked: "الجهاز ملغى",
  offlinePhaseCorrupt: "المخزن المحلي معطّل",
  offlineQueueLabel: "قائمة الانتظار",
  offlineAsOfLabel: "آخر مزامنة {time}",
  offlineAsOfNever: "لم تتم مزامنة بعد",
  offlineOnlineLabel: "متصل",
  offlineOfflineLabel: "غير متصل",
  offlineSyncNow: "مزامنة الآن",
  offlinePushNow: "إرسال الآن",
  offlineSyncUnavailable: "غير متاح في هذا الإصدار من الغلاف — حدّث التطبيق",
  offlineUpdatePrompt: "حدّث التطبيق لاستئناف المزامنة.",
  offlineUpdateAction: "حدّث التطبيق الآن",
  offlineBannerReadOnly:
    "الوضع قراءة فقط — إصدار عقد المزامنة على الخادم أحدث مما يفهمه هذا التطبيق. القراءات متاحة، والكتابة المحلية موقوفة حتى التحديث (C-08).",
  offlineBannerRevoked:
    "تم إلغاء هذا الجهاز — لا يمكن إرسال أي أوامر، وبيانات المستأجر المحلية أُفرغت. أعِد التسجيل بمساعدة المسؤول.",
  offlineBannerCorrupt:
    "المخزن المحلي معطّل (فشل فحص السلامة) — الكتابة موقوفة حتى تشغيل مسار الإصلاح الموثّق.",
  offlineReadOnlyGate: "رُفض التخزين المحلي — الغلاف في وضع قراءة فقط أو معطّل.",

  // أسباب «عبر الإنترنت فقط» (بوابات القدرات — لا محاكاة أبدًا)
  offlineOnlineOnlyTitle: "عبر الإنترنت فقط",
  offlineReasonBrowser:
    "تتطلب هذه الوظيفة تطبيق سطح المكتب — المتصفح لا يخزّن قائمة محلية ولا يزيّف عملًا دون اتصال.",
  offlineReasonNoStore: "الغلاف حاضر لكن مخزن SQLite غير متاح في هذا الإصدار.",
  offlineReasonNoSync: "محرك المزامنة غير متاح في هذا الإصدار من الغلاف (يُطلب التحديث).",
  offlineReasonNoPrint: "الطباعة غير متاحة في هذا الإصدار من الغلاف.",

  // الحالات الصادقة (draft_docs + قائمة الإرسال)
  offlineStateDraftLocal: "مسودة محلية",
  offlineStatePendingMerge: "بانتظار الدمج",
  offlineStateSyncFailed: "فشلت المزامنة",
  offlineStateMerged: "تمت المزامنة",
  offlineStateCancelledLocal: "أُلغيت محليًا",
  offlineStatusQueued: "في الانتظار",
  offlineStatusInFlight: "قيد الإرسال",
  offlineStatusAcked: "مقبول",
  offlineStatusRejected: "مرفوض",
  offlineStatusCancelled: "ملغى",

  // عرض قائمة الإرسال والرفض
  offlineOutboxTitle: "قائمة الإرسال والرفض",
  offlineOutboxIntro:
    "كل أمر محلي بحالته الصادقة — الأرقام الرسمية تظهر عند القبول فقط، وحمولات الرفض تُعرض كما وصلت من الخادم.",
  offlineOutboxEmpty: "القائمة فارغة — لا أوامر معلّقة.",
  offlineOutboxColCommand: "الأمر",
  offlineOutboxColStatus: "الحالة",
  offlineOutboxColCreated: "تاريخ الإنشاء",
  offlineOutboxOfficialNo: "الرقم الرسمي: {no}",
  offlineOutboxServerResponse: "استجابة الخادم",
  offlineOutboxNoDraft: "لا توجد مسودة محلية مرتبطة بهذا الأمر — لا يمكن فتحه للتعديل هنا.",

  // أسباب الرفض + دلالاتها (CONFLICT_RESOLUTION §3 — الجدول كاملًا)
  offlineRejPeriodLocked: "فترة مقفلة",
  offlineRejPriceChanged: "تغيّر السعر",
  offlineRejInsufficientStock: "مخزون غير كافٍ",
  offlineRejCreditLimitExceeded: "تجاوز حدّ الائتمان",
  offlineRejStaleVersion: "نسخة قديمة",
  offlineRejItemInactive: "صنف غير نشط",
  offlineRejPartnerInactive: "شريك غير نشط",
  offlineRejValidationError: "خطأ تحقق",
  offlineRejDeviceRevoked: "إلغاء الجهاز",
  offlineRejTenantSuspended: "إيقاف المستأجر",
  offlineRejMeaningPeriodLocked: "تاريخ المستند يقع في فترة محاسبية مقفلة عند المزامنة.",
  offlineRejMeaningPriceChanged: "سعر السطر يختلف عن السعر الحالي على الخادم بعد حدّ التسامح.",
  offlineRejMeaningInsufficientStock: "الكمية المتاحة أقل من المطلوبة عند التنفيذ.",
  offlineRejMeaningCreditLimitExceeded: "حدّ ائتمان الشريك متجاوزٌ شاملًا هذا المستند.",
  offlineRejMeaningStaleVersion: "النسخة على الخادم تجاوزت baseVersion — راجع الفرق ثم سوّ الخيار يدويًا.",
  offlineRejMeaningItemInactive: "أُوقف الصنف المرجعي أثناء العمل دون اتصال.",
  offlineRejMeaningPartnerInactive: "أُوقف الشريك المرجعي أثناء العمل دون اتصال.",
  offlineRejMeaningValidationError: "خلل بنيوي في الحمولة (سطر ناقص أو صيغة مبلغ غير صالحة).",
  offlineRejMeaningDeviceRevoked: "فقد الجهاز حقوق المزامنة — حالة إدارية، لا إعادة إرسال.",
  offlineRejMeaningTenantSuspended: "أُوقف حساب المستأجر — حالة إدارية، لا إعادة إرسال.",
  offlineRejAdminNote: "حالة إدارية — لا إعادة إرسال؛ راجع المسؤول.",

  // إجراءات الرفض (كل اختيار يُسجَّل في local_events للمراجعة)
  offlineActionEditResend: "تعديل وإعادة الإرسال",
  offlineActionAcceptServerPrice: "اعتماد سعر الخادم",
  offlineActionCancel: "إلغاء",
  offlineActionAcceptPartial: "قبول التنفيذ الجزئي",
  offlineActionRequestApproval: "طلب موافقة عبر الإنترنت",
  offlineActionReviewMerge: "مراجعة والدمج",
  offlineActionDiscard: "تجاهل التعديل المحلي",
  offlineActionSubstitute: "استبدال وإعادة الإرسال",
  offlineChoiceRecorded: "سُجّل اختيارك — يُدقَّق مع أول اتصال مزامنة.",
  offlineEffectAcceptPrice: "ستُعاد الإرسالة بسعر الخادم {price}.",
  offlineEffectAcceptPartial: "ستُعاد الإرسالة بكمية {qty}.",
  offlineEffectApproval: "اجمع دفعة مقدمة عبر سند قبض في التطبيق المتصل، ثم عدّل المستند وأعد إرساله.",
  offlineEffectDiscard: "تجاهُل التعديل المحلي (مسجَّل للمراجعة).",
  offlineActionUnavailable: "استجابة الخادم لا تحمل التفاصيل اللازمة — الإجراء غير متاح.",
  offlineDiffServerRow: "الصف الحالي على الخادم",
  offlineDiffLocalRow: "تعديلك المحلي",

  // تبويبات المسودات التسع
  offlineTabInvoice: "مسودة فاتورة بيع",
  offlineTabQuotation: "مسودة عرض سعر",
  offlineTabDelivery: "إشعار تسليم",
  offlineTabStockCount: "جرد — إدخال الكميات",
  offlineTabPartnerContact: "جهات اتصال شريك",
  offlineTabPartnerCreate: "إنشاء شريك",
  offlineTabExpense: "قيد مصروف",
  offlineTabCashTransfer: "تحويل نقدي / إسقاط درج",
  offlineTabStockTransfer: "مسودة تحويل مخزون",
  offlineNoteDraft: "مسودة دون اتصال — تُنشأ محليًا، والإرسال والاعتماد عبر الإنترنت لاحقًا.",
  offlineNoteMerge: "دمج على مستوى الحقول (غير المقيدة فقط) — يُدوَّن سجل مراجعة لكل حقل.",
  offlineNoteCount: "الكميات المجرودة وقائع — الفروق وترحيلها تُحسب على الخادم وحده.",

  // حقول النماذج
  offlineFieldCustomer: "العميل",
  offlineFieldItem: "الصنف",
  offlineFieldQty: "الكمية",
  offlineFieldUnitPrice: "سعر الوحدة",
  offlineFieldServerPriceHint: "اتركه فارغًا ليحسم الخادم السعر عند الإرسال",
  offlineFieldDiscount: "الخصم",
  offlineFieldTaxCode: "الرمز الضريبي",
  offlineFieldNote: "ملاحظة (إنجليزي)",
  offlineFieldNoteAr: "ملاحظة (عربي)",
  offlineFieldDescription: "الوصف (إنجليزي)",
  offlineFieldDescriptionAr: "الوصف (عربي)",
  offlineFieldAmount: "المبلغ",
  offlineFieldFee: "العمولة",
  offlineFieldCurrency: "رمز العملة (3 أحرف)",
  offlineFieldExchangeRate: "سعر الصرف",
  offlineFieldReference: "المرجع",
  offlineFieldDate: "التاريخ",
  offlineFieldValidUntil: "صالح حتى",
  offlineFieldValueDate: "تاريخ القيمة",
  offlineFieldWarehouseId: "معرّف المستودع (UUID)",
  offlineFieldFromWarehouse: "من مستودع (UUID)",
  offlineFieldToWarehouse: "إلى مستودع (UUID)",
  offlineFieldFromAccount: "من حساب (UUID)",
  offlineFieldToAccount: "إلى حساب (UUID)",
  offlineFieldCategoryId: "معرّف فئة المصروف (UUID)",
  offlineFieldCashAccountId: "الدفع من حساب (UUID)",
  offlineFieldCountSession: "جلسة الجرد",
  offlineFieldOrderId: "أمر بيع مرتبط (UUID)",
  offlineFieldPartnerId: "الشريك",
  offlineFieldKind: "النوع",
  offlineFieldCode: "الرمز",
  offlineFieldName: "الاسم (إنجليزي)",
  offlineFieldNameAr: "الاسم (عربي)",
  offlineFieldTaxNumber: "الرقم الضريبي",
  offlineFieldCreditLimit: "حدّ الائتمان",
  offlineFieldCreditTermsId: "شروط الائتمان (UUID)",
  offlineFieldPriceListId: "قائمة الأسعار (UUID)",
  offlineFieldPhone: "الهاتف",
  offlineFieldPhone2: "هاتف ثانٍ",
  offlineFieldEmail: "البريد الإلكتروني",
  offlineFieldAddress1: "العنوان — سطر 1",
  offlineFieldAddress2: "العنوان — سطر 2",
  offlineFieldCity: "المدينة",
  offlineFieldContactPerson: "جهة الاتصال",
  offlineFieldPayee: "المستفيد",
  offlineFieldBatchRef: "مرجع الدفعة (UUID)",
  offlineFieldBatchId: "الدفعة (UUID)",
  offlineFieldSerialIds: "المسلسلات (UUID)",
  offlineFieldSerialIdsHint: "UUIDs مفصولة بفواصل",
  offlineFieldOptional: "اختياري",
  offlineFieldNoCatalog: "لا يخزَّن هذا الدليل محليًا بعد — أدخل المعرّف (UUID) مباشرة.",
  offlineLinesTitle: "السطور",
  offlineLinesAdd: "إضافة سطر",
  offlineLinesRemove: "حذف السطر",

  // أخطاء التحقق
  offlineErrRequired: "هذا الحقل مطلوب.",
  offlineErrUuid: "أدخل معرّفًا صالحًا (UUID).",
  offlineErrMoney: "أدخل رقمًا عشريًا صالحًا بحد أقصى 4 منازل.",
  offlineErrQty: "أدخل كمية عشرية صالحة بحد أقصى 6 منازل.",
  offlineErrUnitPrice: "أدخل سعرًا غير سالب بحد أقصى 6 منازل.",
  offlineErrCountedQty: "أدخل كمية معدودة غير سالبة بحد أقصى 6 منازل (الصفر جائز).",
  offlineErrDate: "أدخل تاريخًا بصيغة YYYY-MM-DD.",
  offlineErrFx: "أدخل سعر صرف صالحًا بحد أقصى 8 منازل.",
  offlineErrCurrency: "ثلاثة أحرف إنجليزية (مثل SAR).",
  offlineErrKind: "اختر نوعًا من القائمة.",
  offlineErrMinLen: "القيمة أقصر من الحد الأدنى.",
  offlineErrMaxLen: "القيمة أطول من الحد الأقصى.",
  offlineErrLinesMin: "أضف سطرًا واحدًا على الأقل.",
  offlineErrLinesMax: "تجاوزت الحد الأقصى لعدد السطور.",
  offlineErrSameWarehouse: "يجب أن يختلف المستودعان.",
  offlineErrSameAccount: "يجب أن يختلف الحسابان.",
  offlineErrAmountPositive: "المبلغ يجب أن يكون أكبر من صفر.",
  offlineErrFeeRange: "العمولة بين صفر (شاملًا) والمبلغ (غير شامل).",
  offlineErrContactOneField: "أدخل حقل اتصال واحدًا على الأقل.",

  // الإرسال والتغذية الراجعة
  offlineSubmitQueue: "حفظ المسودة محليًا",
  offlineSubmitting: "جارٍ الحفظ…",
  offlineQueuedToast: "حُفظت المسودة محليًا وستُرسل مع أول دفعة مزامنة.",

  // القراءات المخبأة وإعادة الطباعة
  offlineReadsTitle: "القراءات المخبأة",
  offlineReadsIntro: "قراءة من المخزن المحلي بعلامة «آخر مزامنة» — البيانات القديمة تُعلَّم ولا تُخمَّن.",
  offlineReadsSearchItems: "ابحث في الأصناف",
  offlineReadsSearchPartners: "ابحث في الشركاء",
  offlineReadsItemsEmpty: "لا نتائج.",
  offlineReadsPartnersEmpty: "لا نتائج.",
  offlineReadsInvoicesTitle: "فواتير البيع",
  offlineReadsInvoicesEmpty: "لا فواتير في المخبأ.",
  offlineReadsColDocNo: "رقم المستند",
  offlineReadsColStatus: "الحالة",
  offlineReadsColDate: "التاريخ",
  offlineReadsColTotal: "الإجمالي",
  offlineReadsColActions: "إجراءات",
  offlineReadsReprint: "إعادة طباعة",
  offlineReadsReprintNotPosted: "غير مرحّلة — تُعاد طباعة المستندات المرحّلة فقط.",
  offlineReadsReprintSent: "أُرسلت إعادة الطباعة إلى الطابعة.",

  // شاشة الفتح (D-04)
  unlockTitle: "فتح التطبيق",
  unlockIntro: "يُفتح التطبيق على لقطة الأذونات المخبأة — يبقى الخادم المرجع النهائي في كل عملية.",
  unlockModeFull: "وصول كامل وفق لقطة الأذونات المخبأة",
  unlockModeReadOnly: "قراءة فقط — الاتصال بالإنترنت مطلوب",
  unlockReasonExpired: "تجاوزت اللقطة مهلة الأيام السبعة (D-04).",
  unlockReasonNone: "لا لقطة مخبأة — لم يسحب هذا الجهاز أذوناتًا بعد.",
  unlockSnapshotAt: "اللقطة من {date}",
  unlockPermissionsHeading: "مفاتيح الأذونات المخبأة",
  unlockGoOffline: "افتح وحدة العمل دون اتصال",
  unlockBrowserNote: "في المتصفح لا يوجد مخزن محلي — الوصول قراءة فقط ويتطلب الاتصال.",
  unlockRuleNote: "خلال سبعة أيام من آخر مزامنة أذونات يمنح الفتح الوصول الكامل وفق المفاتيح المخبأة؛ وبعدها يتحول التطبيق إلى قراءة فقط حتى يعود الاتصال.",

  // بطاقة لوحة المعلومات
  dashboardOfflineNote: "مسودات وقراءات وقائمة مزامنة تعمل دون اتصال داخل تطبيق سطح المكتب.",

  // صفحة سياسة الإفصاح الأمني (المرحلة 024 — T14)
  disclosureTitle: "سياسة الإفصاح عن الثغرات الأمنية",
  disclosureIntro:
    "كيف تبلّغنا عن الثغرات الأمنية، وما نلتزم به مقابل ذلك، والقواعد التي تحافظ على حسن نية البحث.",
  disclosureContactHeading: "الإبلاغ عن ثغرة",
  disclosureContactBody:
    "أرسل لنا بريدًا يصف المشكلة وخطوات إعادة إنتاجها وأي مثال توضيحي، ويُفضّل تشفير التفاصيل الحساسة إن أمكن، مع ذكر وسيلة تواصل للوصول إليك.",
  disclosureContactAddress: "security@erp.example",
  disclosureContactPlaceholderNote:
    "العنوان أعلاه قيمة موثّقة مؤقتة في وثائق هذا النشر؛ ويُضبَط العنوان الفعلي عند وقت النشر.",
  disclosureCommitmentHeading: "التزامنا",
  disclosureCommitmentAck: "نُقرّ باستلام البلاغات خلال ٤٨ ساعة.",
  disclosureCommitmentUpdates:
    "نُبقي المُبلّغين على اطّلاع على الفحص والتقدّم وجدول الإصلاح حتى تُحلّ المشكلة.",
  disclosureCommitmentCoordinated:
    "نتبع الإفصاح المنسّق: لا تُنشر التفاصيل إلا بعد توفر الإصلاح وبالاتفاق مع المُبلّغ.",
  disclosureSafeHarborHeading: "الملاذ الآمن",
  disclosureSafeHarborBody:
    "لن نتخذ إجراءات قانونية ضد الباحثين الذين يعملون بحسن نية، ويحترمون الإرشادات أدناه، ويتجنبون الإضرار بخدمتنا أو ببيانات مستأجرينا.",
  disclosureGuidelinesHeading: "ما نطلبه منك",
  disclosureGuidelineTesting:
    "تجنّب بيانات المستأجرين في بيئة الإنتاج: اختبر فقط بحساباتك ومستأجريك، ولا تصل إلى بيانات مستأجرين آخرين ولا تعدّلها ولا تسربها.",
  disclosureGuidelineNoDegrade:
    "لا تحاول هجمات الحرمان من الخدمة أو الرسائل المزعجة أو الهندسة الاجتماعية، ولا تستخدم أدوات فحص تُحدث حملًا ثقيلًا.",
  disclosureGuidelineReport:
    "أبلغ فور اكتشاف المشكلة، وامنحنا وقتًا معقولًا للإصلاح قبل أي إفصاح عام.",
  disclosureScopeHeading: "النطاق",
  disclosureScopeBody:
    "داخل النطاق: تطبيق الويب وواجهاته البرمجية، وتطبيقات سطح المكتب وأندرويد، ونقاط نهاية المزامنة، وسطح بيئة الفوترة الإلكترونية التجريبية. أمّا بلاغات التوافر والرسائل المزعجة والتخمينات خارج هذه الأسطح فخارج النطاق.",
  disclosureTriageHeading: "كيف تُعالج البلاغات",
  disclosureTriageBody:
    "تُوجّه البلاغات إلى مسار الفحص لدى فريق الاستجابة المناوب وتُصنّف وفق سلّم خطورة الحوادث (SEV-1 حتى SEV-4)؛ وتتبع الثغرات المؤكدة جداول إصلاح مرتبطة بالخطورة، ويُعاد اختبار كل بلاغ مؤكد قبل إغلاقه.",
  disclosureBountyNote:
    "برنامج المكافآت المدفوعة قرار منفصل بعد الإطلاق العام؛ وهذه الصفحة هي سياسة الإفصاح نفسها.",
  loginSecurityLink: "سياسة الإفصاح الأمني",

  // -- PHASE-025 (T9d): SLO dashboard — Arabic -------------------------
  sloTitle: "مؤشرات مستوى الخدمة",
  sloSubtitle:
    "لوحة مؤشرات مستوى الخدمة وميزانيات الأخطاء: المؤشرات الستة المعتمدة (التوفر، زمن الاستجابة، نجاح الترحيل، النسخ الاحتياطي وفحص الاستعادة، دفع المزامنة، توليد التقارير) مع معدلات استهلاك الميزانية وتنبيهات الحريق.",
  sloStateOk: "سليم",
  sloStateBurning2x: "حرق ٢×",
  sloStateBurning4x: "حرق ٤×",
  sloStateNoData: "لا بيانات",
  sloNoDataNote: "لا توجد عينات في نافذة القياس الحالية.",
  sloBudgetLabel: "المتبقي من ميزانية الأخطاء",
  sloBudgetExhausted: "استُهلكت الميزانية كاملة",
  sloBurnLabel: "معدل الحرق",
  sloCardApiAvailability: "توفر الواجهة البرمجية",
  sloCardApiLatency: "زمن الاستجابة (p95)",
  sloCardPosting: "نجاح الترحيل المحاسبي",
  sloCardBackup: "النسخ الاحتياطي وفحص الاستعادة",
  sloCardSync: "نجاح دفع المزامنة",
  sloCardReport: "مدة توليد التقارير",
  sloSummaryTitle: "ملخص العدّادات",
  sloAvailabilityRequests: "الطلبات (النافذة الحالية)",
  sloAvailabilityErrors: "أخطاء 5xx",
  sloPostingAttempts: "محاولات الترحيل",
  sloPostingInvariantFailures: "إخفاقات الثوابت",
  sloSyncDeferred: "أوامر مؤجلة",
  sloLatencyColGroup: "المجموعة",
  sloLatencyColP50: "p50",
  sloLatencyColP95: "p95",
  sloLatencyColP99: "p99",
  sloLatencyColBudget: "الميزانية",
  sloLatencyColOverBudget: "فوق الميزانية",
  sloRouteGroupIdentity: "الهوية والمستأجرون",
  sloRouteGroupAccounting: "المحاسبة",
  sloRouteGroupSales: "المبيعات",
  sloRouteGroupPurchasing: "المشتريات",
  sloRouteGroupTreasury: "الخزينة والضرائب",
  sloRouteGroupInventory: "المخزون والتصنيع",
  sloRouteGroupSync: "المزامنة",
  sloRouteGroupPlatform: "المنصة والتقارير",
  sloReportColClass: "الفئة",
  sloReportColRenders: "التوليدات",
  sloReportColBudget: "الميزانية",
  sloReportColOverBudget: "فوق الميزانية",
  sloReportClassInline: "تفاعلي",
  sloReportClassJob: "مهام خلفية",
  sloReportTemplatesTitle: "أبطأ القوالب (p95)",
  sloBackupNoteTitle: "ملاحظة النسخ الاحتياطي وفحص الاستعادة",
  sloBackupExternalCadence:
    "لا توجد بيانات في هذه النافذة: فحص الاستعادة الليلي والتمارين تعمل خارج عملية الواجهة — تُغذّى هذه البطاقة عبر مقبس التسجيل عند اكتمال خط المقاييس، ولا تُعرض حالة خضراء بلا بيانات.",
  sloBackupNoFailuresNote:
    "جميع عمليات فحص الاستعادة المسجلة في هذه النافذة ناجحة؛ أي إخفاق واحد يستنزف الميزانية فورًا (الهدف ١٠٠٪).",
  sloBurnAlertsTitle: "تنبيهات حرق الميزانية",
  sloBurnAlertsEmpty: "لا تنبيهات حرق نشطة في هذه النافذة.",
  sloAlertSev1: "خطورة ١",
  sloAlertSev2: "خطورة ٢",
  sloAlertSloBurn:
    "استهلاك ميزانية الأخطاء بمعدل {burn}× في «{slo}» — راجع دليل المعالجة (MONITORING §5 + TROUBLESHOOTING §api).",
  sloAlertPostingInvariant:
    "رفض محرك الترحيل قيدًا غير متوازن {count} مرة — تسامح صفري (RISK-009)، حقّق فورًا وفق دليل المعالجة (TROUBLESHOOTING §api).",
  sloDataSourceTitle: "مصدر البيانات",
  sloDataSourceNote:
    "تُحسب هذه اللوحة من سجل المقاييس داخل العملية نفسها (نمط SF-024-021): عدّادات تراكمية وعيّنات زمن الاستجابة بأسماء موحّدة erp_، يلتقطها مصدّر OpenTelemetry عند تفعيله دون تغيير الأسماء.",
  sloWindowNote:
    "نافذة القياس هي عمر العملية الحالي (تُصفَّر العدّادات عند إعادة التشغيل)؛ نافذة الثلاثين يومًا لميزانية الأخطاء مسؤولية خط المقاييس، ولا تُفبرك هنا. حالة «لا بيانات» صريحة ولا تُعد نجاحًا.",
  sloGeneratedAt: "آخر تقييم:",

  // -- PHASE-026 (T13-UI): fixed assets & depreciation (AR) --------------------
  commonEdit: "تعديل",
  navAccounting: "المحاسبة",
  navFixedAssets: "الأصول الثابتة",

  faStatusActive: "نشط",
  faStatusFullyDepreciated: "مستهلك بالكامل",
  faStatusDisposed: "مستبعد",
  faStatusWrittenOff: "مشطوب",
  faMethodSl: "قسط ثابت",
  faMethodDb: "قسط متناقص",
  faMethodUop: "وحدات الإنتاج",

  faTitle: "الأصول الثابتة",
  faAssetsEmpty: "لا توجد أصول بعد.",
  faAssetsNewButton: "أصل جديد",
  faSearchPlaceholder: "ابحث برمز الأصل أو اسمه…",
  faAllStatuses: "كل الحالات",
  faFilterCategory: "الفئة",
  faFilterBranch: "الفرع",
  faFilterCustodian: "أمين العهدة",
  faColCode: "الرمز",
  faColAcquisitionDate: "تاريخ الاقتناء",
  faColCost: "التكلفة",
  faColAccumulated: "المجمع",
  faColNbv: "القيمة الدفترية",
  faColBranch: "الفرع",
  faColCustodian: "أمين العهدة",

  faFormTitleCreate: "أصل ثابت جديد",
  faFormTitleEdit: "تعديل الأصل",
  faFormCode: "الرمز",
  faFormCodeHint: "يُولَّد تلقائيًا عند تركه فارغًا",
  faFormName: "الاسم (إنجليزي)",
  faFormNameAr: "الاسم (عربي)",
  faFormCategory: "الفئة",
  faFormCategoryHint: "تظهر الفئات النشطة؛ يتحقق الخادم من اكتمال أغراض الفئة قبل الاستخدام",
  faFormAcquisitionDate: "تاريخ الاقتناء",
  faFormCost: "التكلفة",
  faFormSalvage: "القيمة التخليدية",
  faFormSalvageHint: "يجب أن تكون أقل من التكلفة أو تساويها",
  faFormLife: "العمر الإنتاجي (شهر)",
  faFormMethod: "طريقة الإهلاك",
  faFormBranch: "الفرع",
  faFormCustodian: "أمين العهدة",
  faFormNote: "ملاحظة (إنجليزي)",
  faFormNoteAr: "ملاحظة (عربي)",
  faFormUnitsTotal: "إجمالي الوحدات التقديرية",
  faFormUnitsHint: "مطلوب لطريقة وحدات الإنتاج",
  faFormOpeningAccumulated: "المجمع الافتتاحي حتى التاريخ",
  faFormOpeningHint: "للأصول القائمة عند التطبيق — يستأنف الإهلاك من القيمة الدفترية الحقيقية",
  faFormCreatedToast: "تم إنشاء الأصل.",
  faFormSavedToast: "تم حفظ الأصل.",
  faFormImmutableHint:
    "حقول الأساس غير قابلة للتعديل بعد الإنشاء (التكلفة/التخليدية/العمر/الطريقة/الفئة/تاريخ الاقتناء) — التصحيح بالعكس عبر محرك القيود",

  faOverviewTitle: "بيانات الأصل",
  faFinancialTitle: "الوضع المالي",
  faAccumulatedCard: "مجمع الإهلاك",
  faNbvCard: "القيمة الدفترية",
  faSourceLabel: "المصدر",
  faSourceNone: "غير مرسملة — لا يوجد قيد رسملة بعد",
  faHistoryTitle: "سجل الإهلاك",
  faHistoryColDate: "التاريخ",
  faHistoryColAmount: "إهلاك الفترة",
  faHistoryColAccumAfter: "المجمع بعدها",
  faHistoryColUnits: "وحدات الفترة",
  faHistoryEmpty: "لا يوجد إهلاك بعد.",
  faReversedBadge: "معكوس",
  faLifecycleTitle: "دورة الحياة",
  faJournalEntry: "قيد اليومية",

  faCapitalizeTitle: "رسملة الأصل (G-21)",
  faCapitalizeHint: "ينشئ قيد الرسملة عبر محرك القيود — لا يكتب الأصول في دفتر الأستاذ مباشرة أبدًا",
  faCapitalizeFunding: "مصدر التمويل",
  faFundingCredit: "آجل (حساب الدائنين)",
  faFundingCash: "نقدي",
  faFundingOpening: "رصيد افتتاحي",
  faCapitalizePartner: "المورد",
  faCapitalizeOpeningNote: "سيُقيَّد المجمع الافتتاحي المسجل على الأصل في نفس القيد",
  faCapitalizeButton: "رسملة",
  faCapitalizePostedToast: "تمت الرسملة — قيد اليومية {entry}",

  faRevaluateTitle: "إعادة تقييم الأصل",
  faRevNewGross: "القيمة الإجمالية الجديدة",
  faRevNewAccum: "المجمع الجديد",
  faRevDeltaPreview: "فرق القيمة الدفترية (يُرحَّل إلى احتياطي إعادة التقييم)",
  faRevReason: "السبب",
  faRevCreateButton: "إنشاء مسودة",
  faRevPostButton: "ترحيل",
  faRevCreatedToast: "تم إنشاء مسودة إعادة التقييم.",
  faRevPostedToast: "تم ترحيل إعادة التقييم إلى احتياطي إعادة التقييم.",

  faCategoriesTitle: "فئات الأصول",
  faCategoriesEmpty: "لا فئات بعد — أنشئ فئة أولًا.",
  faCatNewButton: "فئة جديدة",
  faCatColLife: "العمر الافتراضي (شهر)",
  faCatColMethod: "الطريقة الافتراضية",
  faCatColActive: "نشطة",
  faCatInUseBadge: "قيد الاستخدام",
  faCatCode: "رمز الفئة",
  faCatCodeHint: "مفتاح طبيعي خاص بالمستأجر",
  faCatName: "الاسم (إنجليزي)",
  faCatNameAr: "الاسم (عربي)",
  faCatLife: "العمر الافتراضي (شهر)",
  faCatMethod: "الطريقة الافتراضية",
  faCatPurposesTitle: "ربط الأغراض (متقدم)",
  faCatPurposesHint:
    "القيم الافتراضية معروضة أدناه؛ يتحقق الخادم من تعيينها إلى حسابات نشطة قبل أي استخدام (BR-041)",
  faCatPurposeAsset: "غرض الأصل",
  faCatPurposeAccum: "غرض مجمع الإهلاك",
  faCatPurposeExpense: "غرض مصروف الإهلاك",
  faCatActive: "نشطة",
  faCatEditTitle: "تعديل الفئة",
  faCatCreatedToast: "تم إنشاء الفئة.",
  faCatSavedToast: "تم حفظ الفئة.",

  faDepTitle: "تشغيلات الإهلاك",
  faDepEmpty: "لا توجد تشغيلات بعد.",
  faDepPeriodLabel: "الفترة المالية",
  faDepPeriodYear: "السنة المالية",
  faDepPeriodPeriod: "الفترة",
  faDepAssembleButton: "تجميع التشغيل",
  faDepAssembleHint: "تشغيل واحد لكل فترة مالية — يعاد استخدام المسودة القائمة إن وُجدت",
  faDepAssembledToast: "تم تجميع التشغيل.",
  faDepApplyUsage: "تحديث الاستخدام وإعادة التجميع",
  faDepApplyUsageHint: "تُعاد كتابة سطور المسودة بقيم الوحدات المحدثة",
  faDepPostButton: "ترحيل التشغيل",
  faDepPostConfirmTitle: "تأكيد ترحيل التشغيل",
  faDepPostConfirmBody:
    "سيُنشأ قيد يومية واحد بمبلغ {amount} (G-22) ولا يمكن التراجع إلا بعكس عبر محرك القيود. المتابعة؟",
  faDepPostedToast: "تم ترحيل التشغيل — قيد اليومية {entry}",
  faDepReverseTitle: "عكس التشغيل",
  faDepReverseReason: "سبب العكس",
  faDepReverseButton: "عكس",
  faDepReversedToast: "تم عكس التشغيل — تبقى السطور للمراجعة.",
  faDepColPeriod: "الفترة",
  faDepColAssets: "الأصول",
  faDepColTotal: "الإجمالي",
  faDepColPostedAt: "وقت الترحيل",
  faDepWorkspaceTitle: "مساحة تشغيل الإهلاك",
  faDepColMethod: "الطريقة",
  faDepColUnits: "وحدات الفترة",
  faDepColPeriodAmount: "إهلاك الفترة",
  faDepColAccumAfter: "المجمع بعدها",
  faDepColNbvAfter: "القيمة الدفترية بعدها",
  faDepNoLines: "لا سطور في المسودة — قم بالتجميع أولًا.",
  faDepUopHint: "الاستخدام يدوي لكل سطر لطريقة وحدات الإنتاج (لا قياس آلي)",
  faDepPreviewNote:
    "المعاينة حساب محلي دقيق (لا فواصل عائمة)؛ إعادة التجميع الخادمية هي المرجع عند الترحيل",

  faDisposalsTitle: "استبعاد الأصول",
  faDisposalsEmpty: "لا توجد عمليات استبعاد بعد.",
  faDispNewButton: "استبعاد جديد",
  faDispColNo: "الرقم",
  faDispColAsset: "الأصل",
  faDispColKind: "النوع",
  faDispColDate: "التاريخ",
  faDispColProceeds: "المتحصلات",
  faDispColNbv: "القيمة الدفترية",
  faDispColGainLoss: "الربح/(الخسارة)",
  faDispKindSale: "بيع",
  faDispKindScrap: "كشط",
  faDispWizardTitle: "معالج الاستبعاد",
  faDispStep1: "اختيار الأصل",
  faDispStep2: "بيانات الاستبعاد",
  faDispStep3: "المراجعة والإرسال",
  faDispNext: "متابعة",
  faDispBack: "رجوع",
  faDispCreatedToast: "تم إنشاء مسودة الاستبعاد — تنتظر اعتماد مستخدم ثانٍ.",
  faDispAssetLabel: "الأصل",
  faDispAssetHint: "الأصول النشطة أو المستهلكة بالكامل فقط",
  faDispKindLabel: "نوع الاستبعاد",
  faDispDateLabel: "تاريخ الاستبعاد",
  faDispProceedsLabel: "المتحصلات",
  faDispProceedsHint: "للكشط: يجب إثبات الصفر صراحةً",
  faDispScrapZeroLabel: "أُقر أن المتحصلات صفر (كشط)",
  faDispReviewTitle: "المراجعة المحسوبة",
  faDispReviewCost: "التكلفة",
  faDispReviewAccum: "المجمع",
  faDispReviewNbv: "القيمة الدفترية",
  faDispReviewGainLoss: "الربح/(الخسارة)",
  faDispSubmitButton: "إنشاء المسودة",
  faDispApproveHint:
    "فصل المهام: اعتماد مستخدم ثانٍ إلزامي — منشئ المسودة لا يستطيع الاعتماد أو الترحيل",
  faDispApproveButton: "اعتماد (مستخدم ثانٍ)",
  faDispApprovedToast: "تم اعتماد الاستبعاد.",
  faDispPostButton: "ترحيل وعرض السند",
  faDispPostedToast: "تم ترحيل الاستبعاد {no} — قيد اليومية {entry}",
  faDispVoucherTitle: "سند الاستبعاد (A4)",
  faDispPrintButton: "طباعة",
  faDispVoucherTotalsProceeds: "المتحصلات",
  faDispVoucherTotalsAccum: "مجمع الإهلاك",
  faDispVoucherTotalsCost: "تكلفة الأصل",
  faDispVoucherTotalsGainLoss: "الربح/(الخسارة)",

  faReportsTitle: "تقارير الأصول",
  faReportsHint: "سجل الأصول (بحدّ تاريخ)، جدول الإهلاك، وحركات الأصول — مع روابط المطابقة",
  faReportsEmpty: "لا تقارير أصول متاحة بعد.",

  faErrCategoryCodeTaken: "رمز الفئة مستخدم مسبقًا.",
  faErrAssetCodeTaken: "رمز الأصل مستخدم مسبقًا.",
  faErrAssetImmutable: "حقول الأساس غير قابلة للتعديل على أصل قائم.",
  faErrPurposesNotMapped: "أغراض الفئة غير معينة إلى حسابات نشطة (BR-041).",
  faErrInvalidAmount: "قيمة غير صالحة — راجع التكلفة والقيمة التخليدية والعمر.",
  faErrUopUnitsRequired: "إجمالي الوحدات التقديرية مطلوب لطريقة وحدات الإنتاج.",
  faErrImmutableDocument: "المستند مُرحَّل ولا يمكن تعديله — التصحيح بالعكس فقط.",
  faErrRunNotDraft: "التشغيل ليس مسودة — لا يمكن تعديله.",
  faErrRunDuplicate: "يوجد تشغيل واحد فقط لكل فترة مالية.",
  faErrPeriodLocked: "الفترة المالية مقفلة (INV-011).",
  faErrNbvFloor: "القيمة الدفترية ستهبط دون الحد الأدنى (القيمة التخليدية).",
  faErrDisposalState: "حالة الاستبعاد لا تسمح بهذه العملية.",
  faErrDisposalSod: "فصل المهام: المنشئ لا يستطيع الاعتماد أو الترحيل.",
  faErrDisposalProceeds: "قيمة المتحصلات غير صالحة.",
  faErrRevalState: "حالة إعادة التقييم لا تسمح بهذه العملية.",
  faErrCapitalizeState: "الأصل مرسمل مسبقًا أو حالته لا تسمح بالرسملة.",
  faErrAssetDisposedReuse: "الاستبعاد مرة واحدة فقط ومن حالة نشط/مستهلك بالكامل (INV-023).",

  // -- PHASE-027 (wave F): cheques & notes + installment plans ----------------
  navChequesNotes: "الشيكات والأوراق التجارية",
  navPdcCalendar: "تقويم الاستحقاق",
  navInstallmentPlans: "خطة الأقساط",

  notesKindCheque: "شيك",
  notesKindPromissoryNote: "سند لأمر",
  notesDirectionReceived: "مستلمة",
  notesDirectionIssued: "مصدَّرة",
  notesStatusInCustody: "في الحيازة",
  notesStatusEndorsedOut: "مظهَّرة للغير",
  notesStatusDeposited: "مودعة لدى البنك",
  notesStatusCollected: "محصَّلة",
  notesStatusDishonored: "مرفوضة الدفع",
  notesStatusDiscounted: "مخصومة",
  notesStatusReturned: "معادة",

  notesTitle: "الشيكات والأوراق التجارية",
  notesNewTitle: "تسجيل ورقة تجارية",
  notesCalendarTitle: "تقويم الاستحقاق",
  notesReportsTitle: "تقارير الأوراق التجارية",
  notesReportsHint: "تقارير سجل الأوراق التجارية وحيازتها (نطاق notes.*).",
  notesReportsEmpty: "لم تُسجَّل عقود تقارير لهذه الوحدة بعد — لن تُعرض قوائم مفبركة.",
  notesEmpty: "لا أوراق تجارية مطابقة.",
  notesNewButton: "تسجيل ورقة",
  notesSearchPlaceholder: "ابحث برقم الورقة أو البنك…",
  notesAllStatuses: "كل الحالات",
  notesFilterKind: "النوع",
  notesFilterDirection: "الاتجاه",
  notesFilterPartner: "الشريك",
  notesFilterMaturityRange: "نطاق تاريخ الاستحقاق",

  notesFormDirection: "الاتجاه",
  notesFormDirectionHint:
    "مستلمة = قبول شيك/سند من عميل مقابل فاتورة بيع (G-24). مصدَّرة = إصدار شيك/سند لمورد مقابل فاتورة شراء (G-27).",
  notesFormPartner: "الشريك",
  notesFormNumber: "رقم الورقة",
  notesFormNumberHint: "رقم الشيك أو السند كما هو مطبوع (اختياري).",
  notesFormBank: "البنك المصدر",
  notesFormBankHint: "البنك المسحوب عليه (اختياري).",
  notesFormAmount: "المبلغ",
  notesFormCurrency: "العملة",
  notesFormRate: "سعر الصرف",
  notesFormRateHint: "مطلوب للعملات الأجنبية — يجب أن يطابق سعر البند الأصلي (INV-008).",
  notesFormIssueDate: "تاريخ الإصدار",
  notesFormMaturityDate: "تاريخ الاستحقاق",
  notesFormSourceInvoice: "المستند المصدر",
  notesFormSourceInvoiceHint:
    "فواتير مرحَّلة فقط: بيع آجل بفاتورة (للمستلمة) أو فاتورة مورد مرحَّلة (للمصدَّرة). الترك بدون مصدر يقيَّد على الحساب.",
  notesFormSourceNone: "بدون مستند مصدر (على الحساب)",
  notesFormNote: "ملاحظة (EN)",
  notesFormNoteAr: "ملاحظة (AR)",
  notesFormSubmit: "تسجيل الورقة",
  notesFormInvalid: "بيانات غير صالحة — أكمل الحقول المطلوبة.",
  notesFormCreatedToast: "تم تسجيل الورقة {number} — في الحيازة.",

  notesOverviewTitle: "بيانات الورقة",
  notesCustodyTitle: "سجل الحيازة",
  notesCustodyEmpty: "لا أحداث حيازة مسجلة بعد.",
  notesJournalEntry: "القيد المحاسبي",
  notesCashAccountLabel: "الحساب النقدي",
  notesSourceLabel: "المستند المصدر",
  notesTerminalHint: "هذه الحالة نهائية — لا مزيد من أحداث الحيازة (INV-024).",
  notesActionsTitle: "إجراءات الحيازة",

  notesEventReceive: "استلام ورقة تجارية",
  notesEventIssue: "إصدار ورقة تجارية",
  notesEventEndorse: "تظهير للغير",
  notesEventDeposit: "إيداع لدى البنك",
  notesEventCollect: "تحصيل عند الاستحقاق",
  notesEventDishonor: "رفض الدفع",
  notesEventDiscount: "خصم لدى البنك",
  notesEventReturn: "إرجاع للشريك",
  notesEventReclassify: "إعادة تصنيف (تصحيح بيانات)",

  notesActionEndorse: "تظهير",
  notesActionDeposit: "إيداع",
  notesActionCollect: "تحصيل",
  notesActionDishonor: "رفض دفع",
  notesActionDiscount: "خصم",
  notesActionReturn: "إرجاع",
  notesActionEndorsee: "المستفيد (المظهَّر له)",
  notesActionDate: "تاريخ الحدث",
  notesActionReason: "سبب الرفض",
  notesActionReasonHint: "السبب إلزامي (BR-046).",
  notesActionBankFee: "رسوم بنكية",
  notesActionFee: "رسوم الخصم",
  notesActionAccount: "الحساب النقدي",
  notesActionRate: "سعر الصرف",
  notesEndorseToast: "تم التظهير — الورقة لدى الغير (بدون قيد).",
  notesDepositToast: "تم الإيداع — خُزّن الحساب النقدي (بدون قيد).",
  notesCollectToast: "تم التحصيل — القيد {entry}.",
  notesDishonorToast: "سُجل الرفض — القيد {entry}.",
  notesDiscountToast: "تم الخصم — المتحصلات {proceeds} عبر القيد {entry}.",
  notesReturnToast: "تم الإرجاع — القيد {entry}.",

  pdcAsOfLabel: "كما في",
  pdcComputedAtLabel: "آخر احتساب",
  pdcStaleWarning: "قد تكون البيانات قديمة",
  pdcStaleHint: "التقويم يُحدَّث يوميًا؛ تجاوز عمره {hours} ساعة.",
  pdcBucketOverdue: "متأخر الاستحقاق",
  pdcBucketThisWeek: "هذا الأسبوع",
  pdcBucket30: "7–30 يومًا",
  pdcBucket60: "30–60 يومًا",
  pdcBucket90: "60–90 يومًا",
  pdcBucketBeyond: "أبعد من 90 يومًا",
  pdcCountLabel: "العدد",
  pdcAmountBaseLabel: "القيمة بالعملة الأساسية",
  pdcReceivedSide: "أوراق مستلمة",
  pdcIssuedSide: "أوراق مصدَّرة",
  pdcByPartnerTitle: "حسب الشريك",
  pdcByBankTitle: "حسب البنك المصدر",
  pdcNotesTitle: "الأوراق الحية",
  pdcBankUnspecified: "غير محدد",
  pdcDrillLink: "عرض في السجل",
  pdcEmpty: "لا أوراق حية (حيازة غير محسومة).",

  notesErrSourceInvalid: "المستند المصدر غير صالح — يجب أن يكون فاتورة مرحَّلة قابلة للتسوية لنفس الشريك وبنفس العملة.",
  notesErrAlreadyPosted: "الورقة محسومة مسبقًا بهذا الحدث — لا تكرار لنفس الحدث المالي (INV-013).",
  notesErrCustodyTransition: "هذا الانتقال غير قانوني من الحالة الحالية (آلة الحيازة BR-047).",
  notesErrDishonorReason: "سبب رفض الدفع إلزامي (BR-046).",
  notesErrRateMismatch: "سعر الصرف يجب أن يطابق السعر الأصلي المخزن للبند (INV-008).",
  notesErrCurrencyMismatch: "عملة الورقة يجب أن تطابق عملة المستند المصدر.",
  notesErrAccountRequired: "هذا الإجراء يتطلب حسابًا نقديًا (مرر الحساب أو أودع الورقة أولًا).",
  notesErrFeeInvalid: "الرسوم غير صالحة — يجب أن تكون بين صفر ومبلغ الورقة.",
  notesErrDiscountCurrency: "خصم الأوراق بغير العملة الأساسية غير مدعوم في هذه المرحلة — حصّل عند الاستحقاق أو أرجِع.",
  notesErrFieldsImmutable: "الحقول الجوهرية غير قابلة للتعديل بعد الإنشاء — إعادة التصنيف للبيانات الوصفية فقط.",
  notesErrAccountCurrency: "عملة الحساب النقدي يجب أن تطابق عملة الورقة.",

  instTitle: "خطط الأقساط",
  instNewTitle: "معالج خطة أقساط",
  instReportsTitle: "تقارير الأقساط",
  instReportsHint: "تقارير الخطط والجدولة والتحصيل (نطاق installments.*).",
  instReportsEmpty: "لم تُسجَّل عقود تقارير لهذه الوحدة بعد — لن تُعرض قوائم مفبركة.",
  instEmpty: "لا خطط أقساط مطابقة.",
  instNewButton: "خطة جديدة",
  instSearchPlaceholder: "ابحث برقم المستند…",
  instAllStatuses: "كل الحالات",
  instStatusDraft: "مسودة",
  instStatusActive: "نشطة",
  instStatusClosed: "مغلقة",
  instStatusDefaulted: "متعثرة",
  instFilterPartner: "الشريك",
  instFilterStatus: "الحالة",
  instFilterSource: "نوع المصدر",
  instSourceSalesInvoice: "فاتورة بيع",
  instSourceServiceContract: "عقد خدمات",
  instColSource: "المصدر",
  instColTotal: "الإجمالي",
  instColSeq: "#",
  instColAmount: "المبلغ",
  instColReceipts: "سندات القبض",
  instColCollected: "المحصَّل",
  instColLateFee: "رسوم التأخير",

  instFreqWeekly: "أسبوعيًا",
  instFreqBiweekly: "كل أسبوعين",
  instFreqMonthly: "شهريًا",
  instFreqQuarterly: "ربع سنويًا",

  instDetailOverview: "بيانات الخطة",
  instDetailSchedule: "جدول الأقساط",
  instDetailScheduleEmpty: "لا أقساط مسجلة لهذه الخطة.",
  instDetailPolicy: "سياسة رسوم التأخير",
  instLineStatusPending: "منتظر",
  instLineStatusDue: "مستحق",
  instLineStatusPaid: "مسدد",
  instLineStatusOverdue: "متأخر",
  instLineStatusWaived: "معفى",
  instWaiveAction: "إعفاء القسط",
  instWaiveReason: "سبب الإعفاء",
  instWaiveToast: "أُعفي القسط {seq} — السبب مسجل.",
  instChargeLateFeeAction: "احتساب رسوم تأخير",
  instChargeLateFeeToast: "احتُسبت رسوم تأخير {fee} — القيد {entry}.",

  instWizStepSource: "المستند المصدر",
  instWizStepSchedule: "معاملات الجدولة",
  instWizStepPolicy: "سياسة رسوم التأخير",
  instWizStepOf: "الخطوة {current} من {total}",
  instWizBack: "السابق",
  instWizNext: "التالي",
  instWizSourceType: "نوع المصدر",
  instWizSourceInvoice: "فاتورة بيع مرحَّلة",
  instWizSourceContract: "عقد خدمات نشط",
  instWizSourceTotal: "إجمالي المستند المصدر",
  instWizEstimateChip: "تقديري — للمعاينة فقط",
  instWizDownPayment: "الدفعة المقدمة",
  instWizCount: "عدد الأقساط",
  instWizStartDate: "تاريخ أول قسط",
  instWizFrequency: "التكرار",
  instWizPreviewTitle: "معاينة الجدول (مباشرة)",
  instWizPreviewInvalid: "الجدولة غير صالحة — عدّل الدفعة المقدمة أو عدد الأقساط.",
  instWizPolicyTitle: "سياسة رسوم التأخير (BR-049)",
  instWizPolicyHint: "القيم أدناه مبدئية (PLACEHOLDER) بانتظار قرار السياسة النهائي.",
  instWizPolicyRate: "النسبة (لكل قسط متأخر)",
  instWizPolicyCap: "الحد الأقصى للرسوم",
  instWizPolicyGrace: "أيام السماح",
  instWizPolicyAuto: "احتساب تلقائي للرسوم",
  instWizPolicyDefaulted: "التعثر بعد (أقساط غير مسددة)",
  instWizPlaceholderChip: "PLACEHOLDER (OQ-002)",
  instWizCreate: "إنشاء الخطة (مسودة)",
  instWizActivate: "تنشيط الخطة",
  instWizActivateHint: "التنشيط يتحقق أن إجمالي الخطة يساوي إجمالي المستند المصدر بالضبط (BR-048)، وبعده يصبح الجدول غير قابل للتعديل.",
  instWizCreatedToast: "أُنشئت الخطة كمسودة — راجع الجدول ثم نشِّطها.",
  instWizActivatedToast: "نُشِّطت الخطة — الجدول نهائي (BR-048).",
  instWizBrTotal: "إجمالي الخطة (BR-048)",

  instErrSourceInvalid: "المستند المصدر غير قابل للتقسيط — فاتورة بيع مرحَّلة (آجلة) أو عقد خدمات نشط بالعملة الأساسية فقط.",
  instErrScheduleImmutable: "الخطة منشَّطة — الجدول غير قابل للتعديل (BR-048)؛ التصحيح بالإعفاء أو الإغلاق الموثق.",
  instErrSourceTaken: "توجد خطة قائمة لهذا المستند مسبقًا — خطة واحدة لكل مستند.",
  instErrTotalMismatch: "إجمالي الخطة لا يساوي إجمالي المستند المصدر (BR-048) — أعد بناء المسودة.",
  instErrScheduleInvalid: "الجدولة المحسوبة غير صالحة — عدّل الدفعة المقدمة أو عدد الأقساط.",
  instErrSourceCurrency: "الخطط على مستندات بغير العملة الأساسية غير مدعومة في هذه المرحلة.",
  instErrPolicyInvalid: "سياسة رسوم التأخير غير صالحة — راجع النسبة والحد وأيام السماح.",
  instErrLateFeeNotChargeable: "رسوم التأخير تُحتسب فقط على أقساط متأخرة غير محتسبة مسبقًا (G-28).",
  instErrWaiveReason: "سبب الإعفاء إلزامي (BR-049).",

  // -- PHASE-028 (budgeting): the period-column planning grid ----------------
  navBudgets: "الموازنات",

  budgetsTitle: "الموازنات",
  budgetsNewTitle: "موازنة جديدة",
  budgetsImportTitle: "استيراد شبكة موازنة",
  budgetsImportLink: "استيراد شبكة",
  budgetReportsTitle: "تقارير الموازنات",
  budgetReportsHint: "تقارير الموازنة مقابل الفعلي وتحليل الانحرافات (نطاق budgeting.*).",
  budgetReportsEmpty: "لم تُسجَّل عقود تقارير لهذه الوحدة بعد — لن تُعرض قوائم مفبركة.",
  budgetsEmpty: "لا موازنات مطابقة.",
  budgetsNewButton: "موازنة جديدة",
  budgetsSearchPlaceholder: "ابحث بالرمز أو الاسم…",
  budgetsAllStatuses: "كل الحالات",
  budgetsFilterStatus: "الحالة",
  budgetsFilterScope: "النطاق",
  budgetsFilterYear: "السنة المالية",

  budgetStatusDraft: "مسودة",
  budgetStatusPendingApproval: "بانتظار الاعتماد",
  budgetStatusActive: "نشطة",
  budgetStatusRevised: "معدَّلة (سبقتها نسخة أحدث)",
  budgetStatusClosed: "مغلقة",
  budgetScopeAccounts: "الحسابات",
  budgetScopeCostCenters: "مراكز التكلفة",
  budgetScopeProjects: "المشاريع",
  budgetScopeBranches: "الفروع",

  budgetColCode: "الرمز",
  budgetColName: "الاسم",
  budgetColScope: "النطاق",
  budgetColStatus: "الحالة",
  budgetColYear: "السنة المالية",
  budgetColRevision: "المراجعة",
  budgetColLines: "البنود",
  budgetColTotal: "الإجمالي السنوي",

  budgetFormName: "الاسم (EN)",
  budgetFormNameAr: "الاسم (AR)",
  budgetFormFiscalYear: "السنة المالية",
  budgetFormScope: "النطاق",
  budgetFormScopeHint:
    "النطاق مرشِّح لا مسار: تحدد المحركات الأربع نفسها؛ النطاق يحدد البُعد الاختياري الذي تُجمَّع حسبه بنود الشبكة.",
  budgetFormNote: "ملاحظة (EN)",
  budgetFormNoteAr: "ملاحظة (AR)",
  budgetFormSubmit: "إنشاء الموازنة (مسودة)",
  budgetFormInvalid: "بيانات غير صالحة — أكمل الحقول المطلوبة.",
  budgetFormCreatedToast: "أُنشئت الموازنة {code} كمسودة — أدخل بنود الشبكة ثم أرسلها.",

  budgetGridTitle: "شبكة الموازنة",
  budgetGridDimension: "البُعد",
  budgetGridRowTotal: "الإجمالي السنوي",
  budgetGridPeriodTotals: "إجماليات الفترات",
  budgetGridYearTotal: "الإجمالي السنوي",
  budgetGridAccount: "الحساب",
  budgetGridAddLine: "إضافة بند",
  budgetGridRemoveLine: "إزالة البند",
  budgetGridSave: "حفظ الشبكة",
  budgetGridSavedToast: "حُفظت الشبكة — {lines} بندًا، الإجمالي السنوي {total}.",
  budgetGridReadOnly: "الشبكة للقراءة فقط — التعديل في حالة المسودة حصرًا (BR-050).",
  budgetGridEmpty: "لا بنود موازنة بعد — أضف بندًا أو استورد شبكة.",
  budgetLiveTotals: "الإجماليات المباشرة",

  budgetSubmit: "إرسال للاعتماد",
  budgetApprove: "اعتماد",
  budgetActivate: "تنشيط",
  budgetSupersede: "إنشاء نسخة معدَّلة",
  budgetClose: "إغلاق",
  budgetSubmitToast: "أُرسلت الموازنة للاعتماد (BR-050).",
  budgetApproveToast: "وُضع ختم الاعتماد — يمكن التنشيط الآن.",
  budgetActivateToast: "نُشِّطت الموازنة — النسخة السابقة (إن وجدت) أصبحت معدَّلة.",
  budgetSupersedeToast: "أُنشئت نسخة مسودة جديدة تنسخ بنود هذه الموازنة (BR-050).",
  budgetCloseToast: "أُغلقت الموازنة — تبقى مقروءة للأبد.",
  budgetSupersedeHint:
    "الإنشاء المعدَّل ينسخ البنود إلى مسودة جديدة مرتبطة بسلسلة هذه النسخة؛ التعديل المباشر بعد المسودة ممنوع (BR-050).",

  budgetConsumption: "الاستهلاك مقابل الفعلي",
  budgetActual: "الفعلي",
  budgetVariance: "الانحراف",
  budgetOverBudget: "تجاوز الموازنة",
  budgetAtOverBudget: "تجاوزت الفترة الموازنة المخصصة",
  budgetAdvisoryNote: "الرقابة استشارية — لن يُمنع أي ترحيل",
  budgetStaleWarning: "قد تكون البيانات قديمة",
  budgetComputedAt: "آخر احتساب",
  budgetConsumptionEmpty: "لا استهلاك مسجل بعد على بنود هذه الموازنة.",

  budgetImportChooseFile: "اختيار ملف الشبكة (XLSX)",
  budgetImportFileRequired: "اختر ملف XLSX أولًا.",
  budgetImportFileTooLarge: "حجم الملف يتجاوز الحد المسموح (15 ميغابايت).",
  budgetImportBudgetRequired: "اختر موازنة مسودة أولًا.",
  budgetImportNoDrafts: "لا موازنات مسودة متاحة — أنشئ موازنة أولًا (الاستيراد يستبدل شبكة المسودة بالكامل).",
  budgetImportStepSetup: "اختيار الموازنة والملف",
  budgetImportStepReview: "تقرير الفحص المسبق",
  budgetImportDryRun: "فحص مسبق (بدون كتابة)",
  budgetImportDryRunTitle: "تقرير الفحص المسبق (Dry-run)",
  budgetImportRowCount: "عدد الصفوف",
  budgetImportValidRows: "الصفوف الصالحة",
  budgetImportTotalsPreview: "إجمالي المعاينة",
  budgetImportErrors: "أخطاء الصفوف",
  budgetImportClean: "كل الصفوف صالحة — يمكن تنفيذ الاستيراد.",
  budgetImportCommit: "تنفيذ الاستيراد (استبدال الشبكة)",
  budgetImportCommitToast: "نُفِّذ الاستيراد — {lines} بندًا، الإجمالي السنوي {total}.",
  budgetImportRowCap: "سقف الاستيراد 5,000 صف بيانات — قسِّم الملف حسب البُعد.",
  budgetExportLabel: "تصدير الشبكة",
  budgetExportAr: "تصدير (عربي)",
  budgetExportEn: "تصدير (إنجليزي)",

  budgetReportVsActual: "الموازنة مقابل الفعلي",
  budgetReportVarianceAnalysis: "تحليل الانحرافات",

  budgetChainHistory: "سلسلة النسخ",
  budgetChainEmpty: "لا سلسلة تعديل — هذه النسخة الأصلية.",
  budgetSupersedes: "تسبق",
  budgetSupersededBy: "مسبوقة بـ",
  budgetCreatedAt: "تاريخ الإنشاء",

  budgetErrImmutable: "الموازنة ليست مسودة — تعديل البنود متاح للمسودات حصرًا؛ عدّل عبر نسخة معدَّلة (BR-050).",
  budgetErrState: "هذا الانتقال غير قانوني من الحالة الحالية (آلة BR-050).",
  budgetErrSelfApproval: "فصل المهام: منشئ الموازنة لا يعتمدها — يتطلب الختم معتمدًا مختلفًا (BR-034).",
  budgetErrActiveExists: "توجد موازنة نشطة مسبقًا لنفس السنة والنطاق — أنشئ نسخة معدَّلة منها، لا تنشِّط موازنة موازية (BR-050).",
  budgetErrPeriodMismatch: "الفترة لا تنتمي إلى السنة المالية لهذه الموازنة.",
  budgetErrExceeded: "تجاوز الموازنة على فترات المستند — سياسة المنشأة ENFORCE_DRAFT (BR-051): عدّل الموازنة أو قلِّل المستند.",
  budgetErrNotApproved: "لا ختم اعتماد — اعتمد الموازنة (بمعتمد مختلف) قبل التنشيط.",
  budgetErrScopeDimension: "أبعاد البنود لا تطابق نطاق الموازنة — بُعد واحد بالضبط لكل نطاق، وبلا أبعاد لنطاق الحسابات.",
  budgetErrDuplicateLine: "بند مكرر لنفس (الفترة × مفتاح البُعد) — صف واحد لكل فترة ومفتاح.",
  budgetErrLineLimit: "الشبكة تتجاوز حد 20,000 بند — قسِّم الاستيراد حسب البُعد.",
  budgetErrImportFormat: "الملف ليس شبكة موازنة — راجع أعمدة التعريف الثلاثة وأعمدة الفترات (تُقبل ترويسات عربية أو إنجليزية).",
  budgetErrImportRowLimit: "الاستيراد يتجاوز سقف 5,000 صف بيانات — قسِّم الملف.",
  budgetErrImportRow: "الملف يحمل صفوفًا غير صالحة — صحّحها وأعد الفحص المسبق.",
  // -- PHASE-029 (payroll): salaries, loans & end-of-service ---------
  navHr: "الموظفون والرواتب",
  navPayrollEmployees: "الموظفون",
  navPayrollStructures: "هياكل الرواتب",
  navPayrollRuns: "مسيرات الرواتب",
  navPayrollLoans: "سلف الموظفين",
  payTitle: "الرواتب",
  payEmployeesTitle: "الموظفون",
  payEmployeesNew: "موظف جديد",
  payEmployeesSearch: "ابحث بالرمز أو الاسم…",
  payEmployeesEmpty: "لا موظفين بعد — أضف أول موظف.",
  payEmployeeCode: "الرمز",
  payEmployeeName: "الاسم",
  payEmployeeHireDate: "تاريخ التعيين",
  payEmployeeContract: "نوع العقد",
  payEmployeeBasicSalary: "الراتب الأساسي",
  payEmployeeStructure: "هيكل الرواتب",
  payEmployeeBranch: "الفرع",
  payEmployeeCostCenter: "مركز التكلفة",
  payEmployeeProject: "المشروع",
  payEmployeeNationalId: "الهوية الوطنية (مقنّعة)",
  payEmployeeBank: "البنك (مقنّع)",
  payEmployeeStatus: "الحالة",
  payEmployeeEosBalance: "رصيد مخصص نهاية الخدمة",
  payStatusActive: "نشط",
  payStatusSuspended: "موقوف",
  payStatusTerminated: "منتهي الخدمة",
  payContractFullTime: "دوام كامل",
  payContractPartTime: "دوام جزئي",
  payContractContractor: "متعاقد",
  payEmployeeCreateTitle: "موظف جديد",
  payEmployeeEditTitle: "بيانات الموظف",
  payEmployeeTerminate: "إنهاء الخدمة",
  payEmployeeTerminateDate: "تاريخ الإنهاء",
  payEmployeeTerminateReason: "سبب الإنهاء",
  payEmployeeSuspend: "إيقاف",
  payEmployeeReactivate: "إعادة تنشيط",
  payEmployeeSave: "حفظ",
  payEmployeeCreatedToast: "أُنشئ الموظف {code}.",
  payEmployeeUpdatedToast: "حُفظت بيانات الموظف {code}.",
  payEmployeeTerminatedToast: "أُنهيت خدمة {code} بتاريخ {date} — تسوية نهاية الخدمة خطوة منفصلة.",
  payPiiNote: "بيانات الموظف من فئة C-PII: الهوية والحقول البنكية مقنّعة بالبنية، وكل قراءة مسجلة في سجل التدقيق.",
  payEmployeeTerminatedNote: "الصف المنتهي مجمد — ملاحظات فقط (سجل نهاية الخدمة يبقى).",
  payStructuresTitle: "هياكل الرواتب",
  payStructureNew: "هيكل جديد",
  payStructureCode: "الرمز",
  payStructureName: "الاسم",
  payStructureCurrency: "العملة",
  payStructureStatus: "الحالة",
  payStructureComponents: "المكونات",
  payComponentKey: "المفتاح",
  payComponentKind: "النوع",
  payComponentCalc: "طريقة الحساب",
  payComponentAmount: "المبلغ",
  payComponentRate: "النسبة %",
  payComponentAccount: "الحساب",
  payComponentEosBase: "أساس مخصص نهاية الخدمة",
  payKindAllowance: "بدل",
  payKindDeduction: "استقطاع",
  payKindEmployer: "مساهمة صاحب العمل",
  payCalcFixed: "مبلغ ثابت",
  payCalcPercentBasic: "نسبة من الأساسي",
  payCalcPercentGross: "نسبة من الإجمالي",
  payStructureAddComponent: "أضف مكوّناً",
  payStructureRemoveComponent: "أزل المكوّن",
  payStructureSave: "حفظ المكونات",
  payStructureArchived: "مؤرشف",
  payStructureVersion: "أنشئ نسخة جديدة",
  payStructureVersionedToast: "أُنشئت النسخة {code} وأُرشف السابق (BR-052).",
  payStructureSavedToast: "حُفظت مكونات الهيكل.",
  payStructureInUseNote: "الهياكل المستخدمة في مسيرات مرحّلة تُنسخ ولا تُعدّل — أنشئ نسخة جديدة (BR-052).",
  payRunsTitle: "مسيرات الرواتب",
  payRunNew: "مسير جديد",
  payRunPeriod: "الفترة المالية",
  payRunStatus: "الحالة",
  payRunGross: "الإجمالي",
  payRunDeductions: "الاستقطاعات",
  payRunNet: "الصافي",
  payRunEmployer: "مساهمات صاحب العمل",
  payRunEos: "مخصص نهاية الخدمة",
  payRunPaid: "المدفوع",
  payRunNumber: "رقم المسير",
  payRunLines: "سطور المسير",
  payRunCalculate: "احسب",
  payRunSubmit: "أرسل للاعتماد",
  payRunApprove: "اعتمد",
  payRunPost: "رحّل (G-29)",
  payRunPayout: "اصرف (G-30)",
  payRunReverse: "اعكس",
  payRunPayslips: "قسائم الرواتب",
  payRunDraft: "مسودة",
  payRunPending: "بانتظار الاعتماد",
  payRunPosted: "مرحّل",
  payRunCalculatedToast: "حُسب المسير: {count} سطراً (إجمالي {gross} / صافي {net}).",
  payRunSubmittedToast: "أُرسل المسير للاعتماد.",
  payRunApprovedToast: "اعُتمد المسير — الترحيل متاح الآن.",
  payRunPostedToast: "رُحّل المسير {runNo} — القيد {entryNo} (G-29).",
  payRunPayoutToast: "صُرف {amount} عبر الحساب البنكي (G-30) — المتبقي {outstanding}.",
  payRunEmptyLines: "لا سطور محسوبة — احسب المسير أولاً.",
  payRunLoanClampWarning: "تخفيض استقطاع السلف إلى الحد ({clampedTo} من {scheduled}) — BR-054.",
  payRunSkippedWarning: "موظفون متجاوزون: {list}.",
  payRunOutstanding: "المتبقي",
  payLoansTitle: "سلف الموظفين",
  payLoanNew: "سلفة جديدة",
  payLoanCode: "الرمز",
  payLoanEmployee: "الموظف",
  payLoanAmount: "المبلغ",
  payLoanInstallments: "عدد الأقساط",
  payLoanStartPeriod: "فترة البدء",
  payLoanCashAccount: "حساب الصرف",
  payLoanSchedule: "الجدول",
  payLoanLineAmount: "مبلغ القسط",
  payLoanLineStatus: "الحالة",
  payLoanPending: "معلق",
  payLoanDeducted: "مستقطع",
  payLoanWaived: "معفى",
  payLoanWaive: "أعفِ القسط",
  payLoanWaiveReason: "سبب الإعفاء",
  payLoanWriteOff: "شطب السلفة",
  payLoanWriteOffReason: "سبب الشطب",
  payLoanActive: "نشطة",
  payLoanClosed: "مسددة",
  payLoanWriteOffStatus: "مشطوبة",
  payLoanDisbursedToast: "صُرفت السلفة {code} — {amount} عبر الحساب المحدد.",
  payLoanWaivedToast: "أُعفي القسط ({reason}).",
  payLoanWrittenOffToast: "شُطبت السلفة {code} ({reason}).",
  payEosTitle: "مخصص نهاية الخدمة",
  payEosAccrued: "المستحق",
  payEosSettled: "المسدّد نقداً",
  payEosBalance: "الرصيد",
  payEosSettle: "سوِّ نهاية الخدمة (G-31)",
  payEosSettleAmount: "المبلغ المسدد نقداً",
  payEosPolicy: "سياسة المخصص: مفعّلة بأساس {days} يوماً لكل سنة خدمة (قيمة المستأجر — لا نسب نظامية).",
  payEosDisabled: "المخصص معطّل (الافتراضي) — سياسة المستأجر تفعّله بقيمة صريحة.",
  payEosSettledToast: "سُوّي المخصص: نقداً {settled} والفروق المحررة {residual} (G-31).",
  payReportsTitle: "تقارير الرواتب",
  payReportsEmpty: "لا عقود تقارير رواتب في السجل.",
  payErrNotFound: "السجل غير موجود (أو تابع لمستأجر آخر).",
  payErrStateInvalid: "حالة السجل لا تسمح بهذه الخطوة.",
  payErrSelfApproval: "فصل المهام: منشئ المسير لا يعتمده — يتطلب معتمداً مختلفاً.",
  payErrImmutable: "المستند مرحّل وغير قابل للتعديل — العكس هو طريق التصحيح الوحيد.",
  payErrRunPeriodExists: "توجد مسيرات حية لهذه الفترة بالفعل — مسير واحد لكل فترة.",
  payErrStructureInUse: "الهيكل مستخدم في مسير مرحّل — أنشئ نسخة جديدة (BR-052).",
  payErrStructureNotActive: "الهيكل مؤرشف — المسيرات تتطلب هيكلاً نشطاً (BR-052).",
  payErrStructureCurrency: "عملة الهيكل تخالف العملة الأساسية للمستأجر.",
  payErrEmployeeStructureMissing: "الموظف بلا هيكل رواتب نشط — عيّن هيكلاً قبل الحساب.",
  payErrLoanCap: "استقطاع السلفة فوق الحد المسموح من الصافي (BR-054).",
  payErrLoanUnmapped: "حساب سلف الموظفين غير معيّن — اضبط payroll.loans.control_account_id.",
  payErrEosBasis: "المخصص مفعّل بلا أساس صريح — BR-055 يرفض الصمت.",
  payErrEosExceeds: "مبلغ التسوية يفوق رصيد المخصص للموظف.",
  payErrPayoutExceeds: "المبلغ يفوق المتبقي من صافي المسير.",
  payErrEmployeeState: "حالة الموظف لا تسمح بهذه الخطوة.",
  payErrCodeConflict: "الرمز مستخدم بالفعل في هذا المستأجر.",
  payErrEngineOnly: "حسابات الرواتب تُرحّل عبر المسيرات فقط — القيود اليدوية مرفوضة (BR-053).",
  payErrPurposeNotMapped: "غرض محاسبي غير معيّن — عيّن الحساب قبل الترحيل.",
  payErrPeriodLocked: "الفترة المالية مقفلة — الترحيل مرفوض.",

  // -- PHASE-034 (T11): multi-entity consolidation (القوائم الموحدة) --------

  navConsolidated: "القوائم الموحدة",
  consolidationGroupsNav: "مجموعات التوحيد",
  consolidationEliminationsNav: "التسويات",
  consolidationRunsNav: "دورات التوحيد",

  consolidationTitle: "القوائم الموحدة",
  consolidationHubHint:
    "مساحة عمل التوحيد متعدد الكيانات: مجموعات التوحيد وأعضاؤها، والتسويات بين الشركات، ودورات التوحيد مع لقطات القوائم الموحدة.",
  consolidationDisclaimer: "قوائم المجموعة — لا تحل محل الدفاتر النظامية للأعضاء.",
  consolidationColGroup: "المجموعة",
  consolidationFiscalPeriod: "الفترة المالية",
  consolidationColCreated: "أُنشئت",
  consolidationStatusActive: "نشطة",
  consolidationStatusArchived: "مؤرشفة",
  consolidationFxMethodClosingRate: "سعر الإغلاق",
  consolidationFxMethodTemporary: "المعدل المؤقت",
  consolidationNoteEn: "ملاحظة (إنجليزي)",
  consolidationNoteAr: "ملاحظة (عربي)",
  consolidationRunStatusQueued: "في الانتظار",
  consolidationRunStatusRunning: "قيد التنفيذ",
  consolidationRunStatusCompleted: "مكتملة",
  consolidationRunStatusFailed: "فاشلة",

  consolidationEmptyGroups: "لا توجد مجموعات توحيد بعد — أنشئ المجموعة الأولى.",
  consolidationNewGroupButton: "مجموعة جديدة",
  consolidationCreateGroupTitle: "إنشاء مجموعة توحيد",
  consolidationGroupName: "الاسم (إنجليزي)",
  consolidationGroupNameAr: "الاسم (عربي)",
  consolidationGroupBaseCurrency: "العملة الأساسية للمجموعة",
  consolidationGroupFxMethod: "طريقة ترجمة العملات",
  consolidationGroupCreateToast: "أُنشئت المجموعة — أضف الأعضاء ثم ألِّف التسويات.",
  consolidationGroupMembersLabel: "الأعضاء",
  consolidationRecentRunsCard: "أحدث دورات التوحيد",
  consolidationViewRuns: "كل الدورات",
  consolidationViewEliminations: "سجل التسويات",
  consolidationNewElimination: "تسوية جديدة",
  consolidationNewRun: "دورة توحيد جديدة",
  consolidationRunsEmpty: "لا توجد دورات توحيد بعد.",

  consolidationGroupSettingsCard: "إعدادات المجموعة",
  consolidationGroupArchivedWarning: "هذه المجموعة مؤرشفة — أعِد تنشيطها قبل أي تعديل جديد.",
  consolidationArchiveGroupAction: "أرشفة المجموعة",
  consolidationReactivateGroupAction: "إعادة تنشيط المجموعة",
  consolidationGroupStatusToast: "حُدِّثت حالة المجموعة.",
  consolidationMembersCard: "أعضاء المجموعة",
  consolidationAddMemberTitle: "إضافة عضو",
  consolidationMemberTenantId: "معرّف مستأجر العضو (UUID)",
  consolidationMemberTenantIdHint: "أدخل معرّف المستأجر العضو كما هو — إدخال يدوي في هذه المرحلة.",
  consolidationMemberOwnershipPercent: "نسبة الملكية (٪)",
  consolidationMemberIncludeFrom: "الإدراج من تاريخ",
  consolidationAddMemberButton: "إضافة العضو",
  consolidationMemberAddedToast: "أُضيف العضو إلى المجموعة.",
  consolidationMemberStatusRemoved: "مُزال",
  consolidationUpdateMemberTitle: "تحديث العضو",
  consolidationMemberUpdateAction: "تحديث",
  consolidationMemberRemoveAction: "إزالة العضو",
  consolidationMemberUpdatedToast: "حُدِّثت بيانات العضو.",
  consolidationGroupEliminationsCard: "تسويات المجموعة",
  consolidationGroupRunsCard: "دورات المجموعة",

  eliminationsTitle: "سجل التسويات",
  eliminationsEmpty: "لا توجد تسويات بعد — أنشئ أول تسوية.",
  eliminationsFilterKind: "النوع",
  eliminationsKindIntercompany: "بين الشركات",
  eliminationsKindInvestmentEquity: "الاستثمار وحقوق الملكية",
  eliminationsColNo: "رقم التسوية",
  eliminationsColDescription: "الوصف",
  eliminationsColLines: "البنود",
  eliminationsColJournals: "قيود اليومية",
  eliminationsColReversalOf: "عكسٌ لتسوية",
  eliminationsApprovedBadge: "معتمدة",
  eliminationsReverseAction: "عكس",
  eliminationsApproveToast: "اعتُمدت التسوية — يمكن ترحيلها الآن.",
  eliminationsPostToast: "رُحِّلت التسوية {no} — أُنشئ القيد {entry}.",
  eliminationsReverseToast: "أُنشئت مسودة العكس — اعتَمدها ورحِّلها كأي تسوية.",
  eliminationsSodHint: "فصل المهام: على مستخدم آخر (غير منشئ المسودة) اعتمادها قبل الترحيل.",
  eliminationsPostConfirmTitle: "تأكيد الترحيل",
  eliminationsPostConfirmBody: "سيُرحَّل قيد التسوية إلى دفاتر التوحيد للشركة الأم بإجمالي {amount}.",
  eliminationsReverseConfirmTitle: "عكس التسوية المرحَّلة",
  eliminationsLinesTitle: "بنود التسوية",
  eliminationsLinePurpose: "الغرض",
  eliminationsLineDirection: "الجهة",
  eliminationsLineMember: "العضو",
  eliminationsLineMemoEn: "بيان (إنجليزي)",
  eliminationsLineMemoAr: "بيان (عربي)",
  eliminationsPurposeArControl: "أرصدة العملاء (AR_CONTROL)",
  eliminationsPurposeApControl: "أرصدة الموردين (AP_CONTROL)",
  eliminationsPurposeConsolidationAdjustment: "تسوية التوحيد (CONSOLIDATION_ADJUSTMENT)",
  eliminationsAddLine: "إضافة بند",
  eliminationsRemoveLine: "حذف البند",

  eliminationFormKind: "نوع التسوية",
  eliminationFormMemberA: "العضو (أ)",
  eliminationFormMemberB: "العضو (ب)",
  eliminationFormMemberHint: "معرّف مستأجر (UUID) لعضو نشط في المجموعة المختارة.",
  eliminationSuggestionsCard: "مقترحات بين الشركات (للعضو أ)",
  eliminationSuggestionsButton: "جلب المقترحات",
  eliminationSuggestionsAsOf: "كما في تاريخ",
  eliminationSuggestionsEmpty: "لا مقترحات لهذا العضو في هذا التاريخ.",
  eliminationSuggestionColPartner: "الشريك",
  eliminationSuggestionColAr: "رصيد العملاء",
  eliminationSuggestionColAp: "رصيد الموردين",
  eliminationPreviewTitle: "معاينة التوازن المباشرة",
  eliminationSubmitButton: "إنشاء المسودة",
  eliminationCreatedToast: "أُنشئت مسودة التسوية — اعتَمدها ثم رحِّلها.",
  eliminationCreatedCard: "المسودة المُنشأة",

  consolidationRunCreateHint: "دورة واحدة لكل (مجموعة، فترة) — تُنشأ في الانتظار ثم تُنفَّذ.",
  consolidationRunCreateButton: "إنشاء الدورة",
  consolidationRunCreatedToast: "أُنشئت الدورة في الانتظار — نفِّذها الآن.",
  consolidationRunExecuteAction: "تنفيذ",
  consolidationRunExecutedToast: "نُفِّذت الدورة — الحالة: {status}.",
  consolidationRunErrorCodeCol: "رمز الخطأ",
  consolidationRunSnapshotCard: "لقطة الدورة",
  consolidationSnapshotPending: "اللقطة متاحة بعد اكتمال الدورة فقط — نفّذ الدورة أولًا.",
  consolidationSnapshotMembersCard: "الأعضاء والأسعار المطبقة",
  consolidationSnapshotColType: "نوع الحساب",
  consolidationSnapshotColNet: "الصافي",
  consolidationSnapshotColRates: "الأسعار المطبقة",
  consolidationSnapshotConsolidatedCard: "البنود الموحدة",
  consolidationSnapshotEliminationsCard: "آثار التسويات",
  consolidationInv026Pass: "INV-026: سليمة",
  consolidationInv026Fail: "INV-026: انحراف",
  consolidationInv026Compared: "المقارنة: {left} مقابل {right}",

  // -- WEB-036 (PHASE-036): custom fields extensibility core ---------------------
  customFieldsTitle: "الحقول المخصصة",
  customFieldsSubtitle:
    "وسّع نماذج كياناتك بحقول خاصة بالمنشأة — التعريفات وقوائم القيم ومصمم النماذج",
  customFieldsDefinitionsTab: "التعريفات",
  customFieldsPicklistsTab: "قوائم القيم",
  customFieldsLayoutsTab: "مصمم النماذج",
  customFieldsEntityFilter: "تصفية حسب الكيان",
  customFieldsAllEntities: "كل الكيانات",
  customFieldsColEntity: "الكيان",
  customFieldsColKey: "المفتاح",
  customFieldsColLabel: "التسمية",
  customFieldsColDataType: "نوع البيانات",
  customFieldsColRequired: "إلزامي",
  customFieldsColOptions: "الخيارات",
  customFieldsColVersion: "الإصدار",
  customFieldsColOrder: "الترتيب",
  customFieldsDefinitionsNote:
    "تظهر الحقول النشطة تلقائيًا في نماذج الكيان وقوائمه، وتُطبَّق قواعد التحقق عند الحفظ.",
  customFieldsEmpty: "لا توجد حقول مخصصة بعد — أنشئ أول حقل.",
  customFieldsAddField: "إضافة حقل",
  customFieldsCreateTitle: "إنشاء حقل مخصص",
  customFieldsEditTitle: "تعديل الحقل المخصص",
  customFieldsEntityLabel: "الكيان",
  customFieldsEntityPlaceholder: "اختر كيانًا",
  customFieldsKeyLabel: "المفتاح",
  customFieldsKeyHint: "أحرف صغيرة بشرطات سفلية (snake_case) مثل preferred_branch",
  customFieldsLabelEn: "التسمية (إنجليزي)",
  customFieldsLabelAr: "التسمية (عربي)",
  customFieldsDataTypeLabel: "نوع البيانات",
  customFieldsTypeText: "نص",
  customFieldsTypeNumber: "رقم",
  customFieldsTypeDate: "تاريخ",
  customFieldsTypeBoolean: "نعم/لا",
  customFieldsTypeSelect: "اختيار واحد",
  customFieldsTypeMultiselect: "اختيار متعدد",
  customFieldsTypeReference: "مرجع لسجل",
  customFieldsPicklistLabel: "قائمة القيم",
  customFieldsPicklistPlaceholder: "اختر قائمة قيم",
  customFieldsReferenceEntityLabel: "الكيان المرجعي",
  customFieldsPrecisionLabel: "عدد الخانات العشرية",
  customFieldsPrecisionHint: "من 0 إلى 6 خانات عشرية (الافتراضي 2)",
  customFieldsRequiredLabel: "حقل إلزامي",
  customFieldsValidationTitle: "قواعد التحقق",
  customFieldsValidationTextOnly: "تعبير النمط والحدود الطولية تنطبق على الحقول النصية فقط.",
  customFieldsValidationNumberOnly: "الحدود العددية تنطبق على الحقول الرقمية فقط.",
  customFieldsRegexLabel: "تعبير نمطي (Regex)",
  customFieldsMinLengthLabel: "أقل طول",
  customFieldsMaxLengthLabel: "أقصى طول",
  customFieldsMinValueLabel: "أقل قيمة",
  customFieldsMaxValueLabel: "أقصى قيمة",
  customFieldsImmutableNote:
    "الكيان والمفتاح ونوع البيانات ثابتة بعد الإنشاء — أرشف الحقل وأنشئ بديلًا عند الحاجة.",
  customFieldsCreatedToast: "أُنشئ الحقل المخصص.",
  customFieldsSavedToast: "حُفظ الحقل المخصص.",
  customFieldsArchivedToast: "أُرشف الحقل المخصص — القيم التاريخية تبقى ظاهرة.",
  customFieldsRestoredToast: "استُعيد الحقل المخصص.",
  customFieldsArchiveAction: "أرشفة",
  customFieldsRestoreAction: "استعادة",
  customFieldsArchiveConfirm:
    "سيختفي الحقل المؤرشف من النماذج الجديدة مع بقاء القيم التاريخية. هل تريد المتابعة؟",
  customFieldsPicklistsNote:
    "قوائم القيم المشتركة تُستخدم في حقول الاختيار — الخيارات المؤرشفة تُرفض في القيم الجديدة وتبقى في السجل.",
  customFieldsPicklistsEmpty: "لا توجد قوائم قيم بعد.",
  customFieldsPicklistCreateTitle: "إنشاء قائمة قيم",
  customFieldsPicklistNameEn: "الاسم (إنجليزي)",
  customFieldsPicklistNameAr: "الاسم (عربي)",
  customFieldsPicklistKeyHint: "مفتاح فريد بأحرف صغيرة وشرطات سفلية (snake_case)",
  customFieldsPicklistCreatedToast: "أُنشئت قائمة القيم.",
  customFieldsPicklistSavedToast: "حُفظت قائمة القيم.",
  customFieldsPicklistArchivedToast: "أُرشفت قائمة القيم.",
  customFieldsPicklistRestoredToast: "استُعيدت قائمة القيم.",
  customFieldsManageOptions: "إدارة الخيارات",
  customFieldsOptionsTitle: "الخيارات",
  customFieldsPicklistOptionsForTitle: "خيارات: {name}",
  customFieldsOptionsEmpty: "لا خيارات في هذه القائمة بعد.",
  customFieldsOptionLabelEn: "الخيار (إنجليزي)",
  customFieldsOptionLabelAr: "الخيار (عربي)",
  customFieldsOptionAdd: "إضافة خيار",
  customFieldsOptionAddedToast: "أُضيف الخيار.",
  customFieldsOptionSavedToast: "حُفظ الخيار.",
  customFieldsOptionArchivedToast: "أُرشف الخيار.",
  customFieldsOptionRestoredToast: "استُعيد الخيار.",
  customFieldsOptionMoveUp: "تحريك لأعلى",
  customFieldsOptionMoveDown: "تحريك لأسفل",
  customFieldsOptionsReorderedToast: "حُدِّث ترتيب الخيارات.",
  customFieldsOptionEdit: "تعديل الخيار",
  customFieldsLayoutsNote:
    "صمّم ترتيب الأقسام والحقول لكل كيان؛ يتجاوز تخطيط الدور التخطيط الافتراضي لأصحاب ذلك الدور فقط.",
  customFieldsLayoutsEmpty: "لا يوجد تخطيط محفوظ لهذا الكيان بعد — يُعرض النموذج الأصلي بترتيبه المعتاد.",
  customFieldsLayoutEntityLabel: "الكيان",
  customFieldsLayoutDefaultLabel: "التخطيط الافتراضي",
  customFieldsLayoutDefaultBadge: "افتراضي",
  customFieldsLayoutRoleLabel: "الدور",
  customFieldsLayoutNewOverride: "تجاوز جديد لدور",
  customFieldsLayoutOverrideBadge: "تجاوز",
  customFieldsLayoutOverridesList: "التجاوزات المحفوظة",
  customFieldsLayoutEditingDefault: "تحرير التخطيط الافتراضي",
  customFieldsLayoutEditingOverride: "تحرير تجاوز الدور",
  customFieldsLayoutNameLabel: "اسم التخطيط",
  customFieldsLayoutNoLayout: "لا يوجد تخطيط",
  customFieldsLayoutDefaultNote: "ينطبق التخطيط الافتراضي على كل الأدوار التي ليس لها تجاوز خاص.",
  customFieldsLayoutOverrideNote: "ينطبق هذا التجاوز على أصحاب هذا الدور فقط.",
  customFieldsLayoutSectionsTitle: "الأقسام",
  customFieldsLayoutAddSection: "إضافة قسم",
  customFieldsLayoutSectionNew: "قسم جديد",
  customFieldsLayoutSectionLabelEn: "عنوان القسم (إنجليزي)",
  customFieldsLayoutSectionLabelAr: "عنوان القسم (عربي)",
  customFieldsLayoutSectionUp: "تحريك القسم لأعلى",
  customFieldsLayoutSectionDown: "تحريك القسم لأسفل",
  customFieldsLayoutRemoveSection: "حذف القسم",
  customFieldsLayoutCollapsedLabel: "مطوي افتراضيًا",
  customFieldsLayoutColumnsLabel: "عدد الأعمدة",
  customFieldsLayoutFieldsTitle: "الحقول",
  customFieldsLayoutAddField: "إضافة حقل إلى القسم",
  customFieldsLayoutFieldPlaceholder: "اختر حقلًا",
  customFieldsNativeFieldsGroup: "الحقول الأصلية",
  customFieldsCustomFieldsGroup: "الحقول المخصصة",
  customFieldsLayoutFieldNative: "أصلي",
  customFieldsLayoutFieldCustom: "مخصص",
  customFieldsLayoutMandatoryBadge: "إلزامي",
  customFieldsLayoutLockHint: "الحقول الأصلية الإلزامية محمية (BR-059) — لا يمكن حذفها أو تغيير ترتيبها.",
  customFieldsLayoutFieldUp: "تحريك الحقل لأعلى",
  customFieldsLayoutFieldDown: "تحريك الحقل لأسفل",
  customFieldsLayoutRemoveField: "إزالة الحقل",
  customFieldsLayoutSavedToast: "حُفظ التخطيط الافتراضي.",
  customFieldsLayoutOverrideSavedToast: "حُفظ تجاوز الدور.",
  customFieldsLayoutDeleteOverride: "حذف التجاوز",
  customFieldsLayoutOverrideDeletedToast: "حُذف تجاوز الدور — يعود الدور إلى التخطيط الافتراضي.",
  customFieldsRoleOwner: "المالك",
  customFieldsRoleAccountant: "المحاسب",
  customFieldsRoleSales: "المبيعات",
  customFieldsRolePurchasing: "المشتريات",
  customFieldsRoleWarehouse: "المستودع",
  customFieldsRoleCashier: "أمين الصندوق",
  customFieldsRoleViewer: "المشاهد",
  customFieldsRolePayrollOfficer: "مسؤول الرواتب",
  customFieldsErrorKeyTaken: "المفتاح مستخدم بالفعل لهذا الكيان.",
  customFieldsErrorKeyInvalid: "مفتاح غير صالح: {reason}",
  customFieldsErrorConfigInvalid: "إعداد غير صالح لهذا النوع: {reason}",
  customFieldsErrorEntityUnknown: "نوع الكيان غير مسجل للحقول المخصصة.",
  customFieldsErrorValidationMismatch: "قاعدة التحقق لا تنطبق على نوع البيانات هذا.",
  customFieldsErrorNotFound: "العنصر غير موجود في هذا المستأجر.",
  customFieldsErrorArchived: "الحقل المخصص مؤرشف — قيمه للقراءة فقط.",
  customFieldsErrorUnknownKey: "الحقل المخصص {key} غير معرَّف لهذا الكيان.",
  customFieldsErrorRequired: "الحقل المخصص {key} إلزامي.",
  customFieldsErrorValueInvalid: "قيمة غير صالحة للحقل المخصص {key}.",
  customFieldsErrorImmutable: "الكيان والمفتاح والنوع ثابتة — أرشف الحقل وأنشئ بديلًا.",
  customFieldsErrorPicklistKeyTaken: "مفتاح قائمة القيم مستخدم بالفعل.",
  customFieldsErrorPicklistNotFound: "قائمة القيم غير موجودة.",
  customFieldsErrorPicklistOptionNotFound: "الخيار غير موجود.",
  customFieldsErrorPicklistArchived: "قائمة القيم مؤرشفة — اختر قائمة نشطة.",
  customFieldsErrorPicklistOrderInvalid: "يجب أن يشمل الترتيب كل الخيارات النشطة مرة واحدة كل منها.",
  customFieldsErrorLayoutNotFound: "لا يوجد تخطيط لهذا الكيان.",
  customFieldsErrorLayoutInvalid: "تخطيط غير صالح: {reason}",
  customFieldsErrorLayoutProtected: "قاعدة BR-059: {violation}",
  customFieldsErrorLayoutProtectedHint: "الحقول الأصلية الإلزامية لا يمكن حذفها أو إعادة ترتيبها.",
  customFieldsFormSectionTitle: "الحقول المخصصة",
  customFieldsFormSectionDescription: "حقول إضافية خاصة بمنشأتك.",
  customFieldsYesOption: "نعم",
  customFieldsNoOption: "لا",
  customFieldsSelectEmpty: "—",
  customFieldsMultiselectEmpty: "لا خيارات متاحة",
  customFieldsReferenceHint: "معرّف UUID لسجل في: {entity}",
  // WEB-038 (PHASE-038) — المصادر والمشتريات والتعاون مع الموردين (عربي أولًا).
  navPurchasing: "المشتريات",
  sourcingRfqsNav: "طلبات عروض الأسعار",
  sourcingBlanketNav: "الاتفاقيات الإطارية",
  sourcingScorecardsNav: "تقييم الموردين",
  sourcingCapexNav: "الشراء الرأسمالي",
  sourcingRfqTitle: "المشتريات — طلبات عروض الأسعار",
  sourcingRfqSubtitle:
    "حلقة التفاوض كاملة: إصدار طلب عرض الأسعار، استلام العروض، مقارنة العروض، ثم الترسية.",
  sourcingBlanketTitle: "المشتريات — الاتفاقيات الإطارية",
  sourcingBlanketSubtitle:
    "الاتفاقيات الإطارية مع الموردين والصرف منها ضمن سقف الالتزام.",
  sourcingScorecardsTitle: "المشتريات — تقييم الموردين",
  sourcingScorecardsSubtitle:
    "بطاقات تقييم الموردين وقائمة الموردين المعتمدين للأصناف.",
  sourcingCapexTitle: "المشتريات — طلبات الشراء الرأسمالي",
  sourcingCapexSubtitle:
    "طلبات الشراء الرأسمالي مع تقييم الموازنة لحظة الإرسال.",
  sourcingRfqsTab: "طلبات عروض الأسعار",
  sourcingQuotesTab: "العروض",
  sourcingComparisonTab: "المقارنة والترسية",
  sourcingColRfqNo: "رقم الطلب",
  sourcingColTitle: "العنوان",
  sourcingColMode: "النمط",
  sourcingColStatus: "الحالة",
  sourcingColDue: "موعد الاستحقاق",
  sourcingColQuotes: "العروض",
  sourcingColQuoteRef: "مرجع العرض",
  sourcingColSubmitted: "تاريخ التقديم",
  sourcingColSubmittedVia: "قناة التقديم",
  sourcingColExpires: "ينتهي في",
  sourcingColBlanketNo: "رقم الاتفاقية",
  sourcingColValidity: "مدة السريان",
  sourcingColReleased: "المصروف من السقف",
  sourcingColProgress: "نسبة الصرف",
  sourcingColWindow: "نافذة التقييم",
  sourcingColDelivery: "الالتزام بالتسليم",
  sourcingColQuality: "الجودة",
  sourcingColPrice: "السعر",
  sourcingColOverall: "التقييم العام",
  sourcingColSample: "حجم العينة",
  sourcingColRequestNo: "رقم الطلب",
  sourcingColAmount: "المبلغ",
  sourcingColBudgetEval: "تقييم الموازنة",
  sourcingColLine: "السطر",
  sourcingColOfferSupplier: "المورد",
  sourcingColOfferPrice: "سعر الوحدة",
  sourcingColLineTotal: "الإجمالي",
  sourcingColLeadTime: "مدة التوريد",
  sourcingColWeighted: "النتيجة المرجحة",
  sourcingColWinner: "مُرسَّى عليه",
  sourcingModeOpen: "مفتوح",
  sourcingModeInvited: "بدعوة",
  sourcingStatusRfqDraft: "مسودة",
  sourcingStatusRfqIssued: "مُصدر",
  sourcingStatusRfqQuoted: "عروض مستلمة",
  sourcingStatusRfqAwarded: "مُرسَّى",
  sourcingStatusRfqClosed: "مغلق",
  sourcingStatusRfqCancelled: "ملغى",
  sourcingStatusQuoteSubmitted: "مقدَّم",
  sourcingStatusQuoteWithdrawn: "مسحوب",
  sourcingViaPortal: "بوابة الموردين",
  sourcingViaBackOffice: "الإدارة الخلفية",
  sourcingStatusComparisonPrepared: "مُعدَّة",
  sourcingStatusComparisonAwarded: "مُرسَّاة",
  sourcingStatusComparisonCancelled: "ملغاة",
  sourcingStatusBlanketActive: "نشطة",
  sourcingStatusBlanketExpired: "منتهية",
  sourcingStatusBlanketClosed: "مغلقة",
  sourcingStatusBlanketCancelled: "ملغاة",
  sourcingStatusApproved: "معتمد",
  sourcingStatusSuspended: "موقوف",
  sourcingStatusCapexDraft: "مسودة",
  sourcingStatusCapexPending: "بانتظار الاعتماد",
  sourcingStatusCapexApproved: "معتمد",
  sourcingStatusCapexConverted: "محوَّل",
  sourcingStatusCapexRejected: "مرفوض",
  sourcingStatusCapexCancelled: "ملغى",
  sourcingBudgetModeOff: "بدون رقابة",
  sourcingBudgetModeAdvisory: "استشاري",
  sourcingBudgetModeEnforce: "رقابة صارمة",
  sourcingFormTitle: "العنوان",
  sourcingFormTitleAr: "العنوان (عربي)",
  sourcingFormMode: "نمط الطلب",
  sourcingFormCurrency: "العملة",
  sourcingFormDue: "موعد الاستحقاق",
  sourcingFormInvitedSuppliers: "الموردون المدعوون",
  sourcingFormTargetPrice: "السعر المستهدف",
  sourcingFormOptional: "اختياري",
  sourcingFormQuoteRef: "مرجع العرض",
  sourcingFormLeadTime: "مدة التوريد (أيام)",
  sourcingFormValidUntil: "صالح حتى",
  sourcingFormRfqLine: "سطر الطلب",
  sourcingFormExpiresAt: "ينتهي في",
  sourcingFormBranch: "الفرع",
  sourcingFormAccount: "الحساب",
  sourcingFormDescription: "الوصف",
  sourcingFormEstimatedAmount: "المبلغ التقديري",
  sourcingFormNeededBy: "مطلوب بحلول",
  sourcingFormContractId: "معرّف العقد (اختياري)",
  sourcingFormValidFrom: "يبدأ في",
  sourcingFormValidTo: "ينتهي في",
  sourcingFormMinCommitment: "الحد الأدنى للالتزام",
  sourcingFormMaxCommitment: "الحد الأقصى للالتزام",
  sourcingFormPriceLock: "الأسعار المثبتة",
  sourcingFormWindowDays: "نافذة التقييم (أيام)",
  sourcingFormStatus: "الحالة",
  sourcingFormExpires: "تاريخ الانتهاء (اختياري)",
  sourcingFormReason: "السبب",
  sourcingActionCreate: "إنشاء",
  sourcingActionEdit: "تعديل",
  sourcingActionIssue: "إصدار",
  sourcingActionCancel: "إلغاء",
  sourcingActionClose: "إغلاق",
  sourcingActionCompare: "تجهيز المقارنة",
  sourcingActionAward: "ترسية",
  sourcingActionCancelComparison: "إلغاء المقارنة",
  sourcingActionMintInvite: "دعوة عبر البوابة",
  sourcingActionRecompute: "إعادة الاحتساب",
  sourcingActionRelease: "صرف من الاتفاقية",
  sourcingActionSubmit: "إرسال للاعتماد",
  sourcingActionApprove: "اعتماد",
  sourcingActionReject: "رفض",
  sourcingActionBack: "رجوع",
  sourcingActionCopy: "نسخ",
  sourcingActionCopyDone: "تم النسخ",
  sourcingActionDismiss: "إخفاء",
  sourcingActionViewQuotes: "العروض",
  sourcingQuotesFor: "عروض الطلب {no}",
  sourcingQuotesEmpty: "لا عروض مستلمة لهذا الطلب بعد.",
  sourcingQuotesPickFirst: "اختر طلب عرض أسعار أولًا لعرض عروضه.",
  sourcingQuoteFormTitle: "تسجيل عرض مورد (من الإدارة)",
  sourcingLeadTimeDays: "{days} يوم",
  sourcingInviteTitle: "دعوة مورد إلى البوابة",
  sourcingInviteExpiresHint: "رابط الدعوة ينتهي في التاريخ المحدد ويمكن سحبه في أي وقت.",
  sourcingInviteTokenTitle: "رمز الدعوة (يُعرض مرة واحدة)",
  sourcingInviteTokenOnce:
    "انسخ هذا الرمز الآن وشاركه مع المورد — لا يُخزَّن نصه أبدًا (الهاش فقط) ولن يُعرض مرة أخرى.",
  sourcingComparisonNone: "لا توجد مقارنة حية لهذا الطلب.",
  sourcingComparisonPrepareHint:
    "تُجمَّد لقطة المقارنة عند التجهيز (السعر 60٪ · التسليم 30٪ · الشروط 10٪) ولا تُعاد احتسابها أبدًا.",
  sourcingComparisonPreparedAt: "جُهِّزت في",
  sourcingComparisonAwardHint:
    "اختر العرض الفائز لكل سطر ثم رسِّي الجولة (قاعدة العروض الثلاثة BR-062 تُفحص على الخادم).",
  sourcingComparisonAwardedDocs: "المستندات المتولدة من الترسية",
  sourcingDocKindPo: "أمر شراء",
  sourcingDocKindRelease: "صرف من اتفاقية إطارية",
  sourcingReleaseTitle: "صرف من الاتفاقية الإطارية",
  sourcingReleasedOf: "{released} من {max}",
  sourcingApprovedItemsTitle: "الموردون المعتمدون للأصناف",
  sourcingApprovedItemsEmpty: "لا أصناف معتمدة للموردين بعد.",
  sourcingRfqsEmpty: "لا طلبات عروض أسعار بعد.",
  sourcingBlanketEmpty: "لا اتفاقيات إطارية بعد.",
  sourcingScorecardsEmpty: "لا بطاقات تقييم بعد — أعد الاحتساب لتوليدها.",
  sourcingCapexEmpty: "لا طلبات شراء رأسمالي بعد.",
  sourcingConfirmIssue: "إصدار الطلب يرسله إلى الموردين المدعوين. متابعة؟",
  sourcingConfirmCancel: "إلغاء الطلب لا يمكن التراجع عنه. متابعة؟",
  sourcingConfirmClose: "إغلاق الطلب ينهي جولة التفاوض. متابعة؟",
  sourcingConfirmAward: "الترسية تولّد أوامر الشراء حسب الموردين الفائزين. متابعة؟",
  sourcingConfirmRelease: "الصرف ينشئ أمر شراء من الاتفاقية. متابعة؟",
  sourcingConfirmRecompute: "إعادة الاحتساب تعيد بناء البطاقة من حركات النافذة. متابعة؟",
  sourcingToastCreated: "تم الإنشاء بنجاح.",
  sourcingToastDone: "تم تنفيذ الإجراء بنجاح.",
  sourcingToastCopied: "تم النسخ إلى الحافظة.",
  sourcingErrState: "حالة المستند لا تسمح بهذا الإجراء.",
  sourcingErrThreeBid: "قاعدة العروض الثلاثة (BR-062) غير مستوفاة لهذا السطر.",
  sourcingErrOverRelease: "الصرف يتجاوز سقف الالتزام المتبقي للاتفاقية.",
  sourcingErrDuePassed: "انقضى موعد استحقاق الطلب — لا مزيد من العروض.",
  sourcingErrNotInvited: "المورد غير مدرج في قائمة المدعوين لهذا الطلب.",
  sourcingErrCurrencyMismatch: "عملة العرض لا تطابق عملة الطلب.",
  sourcingErrNoQuotes: "لا عروض مقدَّمة لمقارنتها — جهّز المقارنة بعد استلام العروض.",
  // WEB-039 (PHASE-039) — المرتجعات والتحصيل (عربي أولًا).
  returnsNav: "مرتجعات البيع",
  dunningNav: "التحصيل والمطالبات",
  supplierReturnsNav: "مرتجعات الموردين",
  returnsTitle: "المبيعات — مرتجعات البيع",
  returnsSubtitle:
    "طلبات إذن الإرجاع من العملاء مع الفحص والقرار، وسجلات الضمان.",
  dunningTitle: "المبيعات — التحصيل والمطالبات",
  dunningSubtitle:
    "سلّم خطابات الاستذكار والرسوم المتأخرة، ومتابعة إجراءات التحصيل، ومراجعات الائتمان، ووكالات التحصيل.",
  supplierReturnsTitle: "المشتريات — مرتجعات الموردين",
  supplierReturnsSubtitle:
    "طلبات إرجاع البضاعة إلى الموردين حتى الإشعار الدائن (G-38).",
  returnsTabRmas: "أذونات الإرجاع",
  returnsTabWarranties: "الضمانات",
  dunningTabLetters: "خطابات الاستذكار",
  dunningTabPolicies: "سياسات الاستذكار",
  dunningTabActions: "إجراءات التحصيل",
  dunningTabReviews: "مراجعات الائتمان",
  dunningTabAgencies: "وكالات التحصيل",
  returnsColRmaNo: "رقم الإرجاع",
  returnsColPartner: "العميل",
  returnsColInvoice: "الفاتورة",
  returnsColStatus: "الحالة",
  returnsColDisposition: "القرار",
  returnsColTotal: "الإجمالي",
  returnsColRequested: "تاريخ الطلب",
  returnsColCompleted: "تاريخ الإتمام",
  returnsColLine: "السطر",
  returnsColItem: "الصنف",
  returnsColQty: "الكمية",
  returnsColUnitPrice: "سعر الوحدة",
  returnsColNet: "الصافي",
  returnsColTax: "الضريبة",
  returnsColNote: "ملاحظة",
  returnsStatusRequested: "مطلوب",
  returnsStatusApproved: "معتمد",
  returnsStatusReceived: "مستلم",
  returnsStatusInspected: "مفحوص",
  returnsStatusRestocked: "معاد للمخزون",
  returnsStatusScrapped: "متلف",
  returnsStatusRefunded: "مسترد",
  returnsStatusCancelled: "ملغى",
  returnsDispositionRestock: "إعادة للمخزون",
  returnsDispositionScrap: "إتلاف",
  returnsDispositionRefund: "استرداد نقدي",
  returnsDispositionNone: "بدون قرار",
  returnsReasonDamaged: "تالف",
  returnsReasonDefective: "معيب",
  returnsReasonWrongItem: "صنف خاطئ",
  returnsReasonLateDelivery: "تأخر التسليم",
  returnsReasonCustomerRemorse: "عدول العميل",
  returnsReasonOverShipment: "زيادة في التوريد",
  returnsReasonExpired: "منتهي الصلاحية",
  returnsReasonRecall: "سحب من السوق",
  returnsReasonOther: "أخرى",
  returnsFormInvoice: "الفاتورة المرجعية",
  returnsFormPickInvoice: "اختر فاتورة مرحّلة",
  returnsFormReasonCode: "سبب الإرجاع",
  returnsFormReason: "السبب",
  returnsFormReasonAr: "السبب (عربي)",
  returnsFormNote: "ملاحظة",
  returnsFormInvoiceLine: "سطر الفاتورة",
  returnsActionCreate: "طلب إرجاع",
  returnsActionView: "عرض",
  returnsActionApprove: "اعتماد",
  returnsActionReceive: "استلام",
  returnsActionInspect: "فحص",
  returnsActionComplete: "إتمام",
  returnsActionCancel: "إلغاء",
  returnsActionVoid: "إبطال",
  returnsCreateTitle: "طلب إرجاع جديد",
  returnsDetailTitle: "تفاصيل الإرجاع",
  returnsInspectTitle: "فحص المرتجع وتحديد القرار",
  returnsCompleteTitle: "إتمام الإرجاع",
  returnsCancelReasonLabel: "سبب الإلغاء",
  returnsCashAccountLabel: "حساب النقدية للاسترداد",
  returnsRefundHint:
    "قرار الاسترداد النقدي يتطلب اختيار حساب نقدية تُصرف منه القيمة.",
  returnsInvoiceHint:
    "تُنشأ أذونات الإرجاع على فواتير مرحّلة ضمن نافذة الإرجاع المعمول بها.",
  returnsConfirmApprove: "اعتماد طلب الإرجاع؟",
  returnsConfirmReceive: "تأكيد استلام المرتجع؟",
  returnsConfirmComplete: "إتمام الإرجاع وإصدار المستندات؟ لا يمكن التراجع.",
  returnsConfirmCancel: "إلغاء طلب الإرجاع؟",
  returnsToastCreated: "تم إنشاء طلب الإرجاع بنجاح.",
  returnsToastDone: "تم تنفيذ الإجراء.",
  returnsRmasEmpty: "لا توجد طلبات إرجاع.",
  returnsInvoiceLinesEmpty: "لا توجد أسطر على هذه الفاتورة.",
  returnsColSerial: "الرقم التسلسلي",
  returnsColStart: "يبدأ في",
  returnsColEnd: "ينتهي في",
  returnsColCoverage: "نطاق التغطية",
  returnsColDuration: "المدة",
  returnsColMileage: "حد الأميال",
  returnsWarrantyActive: "نشط",
  returnsWarrantyExpired: "منتهي",
  returnsWarrantyVoid: "مبطل",
  returnsCoverageRepair: "إصلاح",
  returnsCoverageReplace: "استبدال",
  returnsCoverageRefund: "استرداد",
  returnsCoverageLaborOnly: "العمالة فقط",
  returnsCoveragePartsOnly: "قطع الغيار فقط",
  returnsBasisInvoiceDate: "تاريخ الفاتورة",
  returnsBasisDeliveryDate: "تاريخ التسليم",
  returnsDurationMonths: "{months} شهر",
  returnsMileageKm: "{km} كم",
  returnsWarrantyCreateTitle: "تسجيل ضمان",
  returnsFormSerial: "الرقم التسلسلي",
  returnsFormStart: "تاريخ البداية",
  returnsFormDuration: "المدة (أشهر)",
  returnsFormCoverage: "نطاق التغطية",
  returnsFormBasis: "أساس الاحتساب",
  returnsFormMileageOptional: "حد الأميال (كم)",
  returnsFormInvoiceOptional: "الفاتورة",
  returnsConfirmVoid: "إبطال الضمان؟ لا يمكن التراجع.",
  returnsWarrantiesEmpty: "لا توجد ضمانات مسجلة.",
  returnsErrState: "الحالة الحالية لا تسمح بهذا الإجراء.",
  returnsErrQtyExceeds: "الكمية المطلوب إرجاعها تتجاوز الرصيد المتاح لهذا السطر.",
  returnsErrDisposition: "يجب تسجيل قرار الفحص قبل الإتمام.",
  returnsErrScrapUnmapped:
    "حساب خسارة الإتلاف غير مربوط — اربط إعداد sales.scrap_loss_account ثم أعد المحاولة.",
  returnsErrWarrantyTerms: "شروط الضمان غير صالحة.",
  dunningColPartner: "العميل",
  dunningColInvoice: "الفاتورة",
  dunningColStep: "الخطوة",
  dunningColDays: "أيام التأخير",
  dunningColChannel: "القناة",
  dunningColLetterDate: "تاريخ الخطاب",
  dunningColSent: "أُرسل في",
  dunningColSubject: "الموضوع",
  dunningColFee: "الرسوم",
  dunningColFeeInvoice: "فاتورة الرسوم",
  dunningColWaiver: "التنازل",
  dunningChannelEmail: "بريد إلكتروني",
  dunningChannelWhatsapp: "واتساب",
  dunningChannelSms: "رسالة نصية",
  dunningLetterQueued: "في الانتظار",
  dunningLetterSent: "مُرسل",
  dunningLetterFailed: "فشل الإرسال",
  dunningFeeWaived: "تم التنازل عن الرسوم",
  dunningDaysValue: "{days} يوم",
  dunningActionRunSweep: "تشغيل دورة الاستذكار",
  dunningSweepHint:
    "تفحص الدورة الفواتير المتأخرة وتصدر الخطوة التالية لكل فاتورة (خطوة واحدة لكل دورة).",
  dunningSweepAsOfLabel: "كما في تاريخ",
  dunningSweepResult: "صدر {letters} خطاب · تصعيد {escalated} · فحص {scanned} بند.",
  dunningActionChargeFee: "احتساب الرسوم",
  dunningActionWaiveFee: "التنازل عن الرسوم",
  dunningWaiveTitle: "التنازل عن الرسوم المتأخرة",
  dunningWaiveReasonLabel: "سبب التنازل",
  dunningConfirmCharge: "احتساب الرسوم المتأخرة على فاتورة هذا الخطاب؟",
  dunningConfirmWaive: "التنازل عن الرسوم؟ تبقى فاتورة الرسوم دليلًا محاسبيًا.",
  dunningToastSweepDone: "اكتملت دورة الاستذكار.",
  dunningPolicyDraft: "مسودة",
  dunningPolicyActive: "نشطة",
  dunningPolicyArchived: "مؤرشفة",
  dunningFeeModeDisabled: "بدون رسوم",
  dunningFeeModeContractRate: "نسبة تعاقدية",
  dunningFeeModeStatutoryCap: "السقف النظامي",
  dunningDefaultBadge: "افتراضية",
  dunningEscalateBadge: "تصعيد",
  dunningReferAgencyBadge: "إحالة لوكالة",
  dunningLadderTitle: "سلّم الخطوات",
  dunningLateFeeTitle: "الرسوم المتأخرة",
  dunningLateFeeRateLabel: "نسبة {rate}%",
  dunningLateFeeGraceLabel: "سماحة {days} يوم",
  dunningLateFeeMaxLabel: "سقف {amount}",
  dunningPolicyCreateTitle: "سياسة استذكار جديدة",
  dunningFormPolicyName: "اسم السياسة",
  dunningFormPolicyNameAr: "اسم السياسة (عربي)",
  dunningFormIsDefault: "السياسة الافتراضية",
  dunningFormStepNo: "الخطوة",
  dunningFormDaysOverdue: "أيام التأخير",
  dunningFormChannel: "القناة",
  dunningFormTemplateKey: "مفتاح القالب",
  dunningFormEscalate: "تصعيد",
  dunningFormReferToAgency: "إحالة لوكالة",
  dunningAddStep: "إضافة خطوة",
  dunningRemoveStep: "حذف الخطوة",
  dunningFormFeeMode: "نظام الرسوم",
  dunningFormRatePct: "النسبة (%)",
  dunningFormGraceDays: "أيام السماحة",
  dunningFormMaxAmount: "الحد الأقصى للرسوم",
  dunningFormFeeSource: "المصدر النظامي",
  dunningActionCreatePolicy: "سياسة جديدة",
  dunningActionActivate: "تنشيط",
  dunningActionArchive: "أرشفة",
  dunningConfirmActivate: "تنشيط هذه السياسة؟",
  dunningConfirmArchive: "أرشفة هذه السياسة؟",
  dunningActionTypeCall: "مكالمة",
  dunningActionTypeEmail: "بريد إلكتروني",
  dunningActionTypePromiseToPay: "وعد بالسداد",
  dunningActionTypeDispute: "نزاع",
  dunningActionTypeFieldVisit: "زيارة ميدانية",
  dunningActionTypePaymentPlan: "خطة سداد",
  dunningActionTypeWriteOffRequest: "طلب شطب",
  dunningActionTypeAgencyReferral: "إحالة لوكالة",
  dunningActionTypeOther: "أخرى",
  dunningOutcomePending: "قيد المتابعة",
  dunningOutcomePromised: "وعد بالسداد",
  dunningOutcomeBroken: "أخل بالوعد",
  dunningOutcomePaid: "سدد",
  dunningOutcomeEscalated: "مُصعَّد",
  dunningOutcomeNoAnswer: "لا رد",
  dunningOutcomeOther: "أخرى",
  dunningColActionType: "نوع الإجراء",
  dunningColActionDate: "التاريخ",
  dunningColOutcome: "النتيجة",
  dunningColPromised: "موعد الوعد",
  dunningColAmount: "المبلغ",
  dunningActionLogTitle: "تسجيل إجراء تحصيل",
  dunningFormActionType: "نوع الإجراء",
  dunningFormActionDate: "تاريخ الإجراء",
  dunningFormOutcome: "النتيجة",
  dunningFormPromisedDate: "موعد الوعد بالسداد",
  dunningFormFollowUpDate: "موعد المتابعة",
  dunningFormAmount: "المبلغ",
  dunningFormNote: "ملاحظة",
  dunningPromiseDateHint: "إجراء «وعد بالسداد» يتطلب تحديد موعد الوعد.",
  dunningFormInvoiceOptional: "الفاتورة",
  dunningColCode: "الرمز",
  dunningColClass: "الفئة",
  dunningColNextReview: "المراجعة القادمة",
  dunningColLastReview: "آخر مراجعة",
  dunningNoClass: "بدون فئة",
  dunningRecordReviewTitle: "تسجيل مراجعة ائتمان",
  dunningFormScoreClass: "الفئة الائتمانية",
  dunningFormNextReview: "تاريخ المراجعة القادمة",
  dunningFormReviewNote: "ملاحظة المراجعة",
  dunningAgencyActive: "نشطة",
  dunningAgencySuspended: "موقوفة",
  dunningColAgency: "الوكالة",
  dunningColContact: "جهة الاتصال",
  dunningColCommissionMode: "نظام العمولة",
  dunningColCommissionPct: "النسبة",
  dunningColFlatFee: "عمولة ثابتة",
  dunningColTokenIssued: "آخر إصدار توكن",
  dunningColReferralDate: "تاريخ الإحالة",
  dunningColReferredAmount: "المبلغ المحال",
  dunningColSettledAmount: "المبلغ المحصّل",
  dunningColCommissionAmount: "العمولة",
  dunningCommissionPctOfCollected: "نسبة من المحصّل",
  dunningCommissionFlatFee: "عمولة ثابتة",
  dunningAgencyCreateTitle: "تسجيل وكالة تحصيل",
  dunningFormContactName: "جهة الاتصال",
  dunningFormEmail: "البريد الإلكتروني",
  dunningFormPhone: "الهاتف",
  dunningFormCommissionMode: "نظام العمولة",
  dunningActionIssueToken: "إصدار توكن",
  dunningActionSuspend: "إيقاف",
  dunningAgencyTokenTitle: "توكن بوابة الوكالة",
  dunningAgencyTokenOnce:
    "يظهر هذا التوكن مرة واحدة فقط ولا يمكن استعادته لاحقًا — انسخه الآن وسلّمه للوكالة عبر قناة آمنة.",
  dunningConfirmIssueToken: "إصدار توكن جديد؟ يبطل أي توكن سابق للوكالة.",
  dunningConfirmSuspend: "إيقاف الوكالة؟ لن تستقبل إحالات جديدة.",
  dunningReferralReferred: "مُحالة",
  dunningReferralAcknowledged: "مؤكدة من الوكالة",
  dunningReferralPartial: "تحصيل جزئي",
  dunningReferralSettled: "مسددة",
  dunningReferralCommissionPosted: "مُرحّلة العمولة",
  dunningReferralClosed: "مغلقة",
  dunningReferralCancelled: "ملغاة",
  dunningReferralCreateTitle: "إحالة إلى وكالة تحصيل",
  dunningSettleTitle: "تسجيل مبلغ محصّل",
  dunningFormAgency: "الوكالة",
  dunningFormPartner: "العميل",
  dunningFormReferredAmount: "المبلغ المحال",
  dunningFormReferralDate: "تاريخ الإحالة",
  dunningFormSettledAmount: "المبلغ المحصّل",
  dunningActionRefer: "إحالة",
  dunningActionSettle: "تسجيل تحصيل",
  dunningActionPostCommission: "ترحيل العمولة",
  dunningActionCloseReferral: "إغلاق",
  dunningConfirmPostCommission: "ترحيل عمولة الوكالة (G-39)؟",
  dunningConfirmClose: "إغلاق الإحالة؟",
  dunningToastDone: "تم تنفيذ الإجراء.",
  dunningLettersEmpty: "لا توجد خطابات استذكار.",
  dunningPoliciesEmpty: "لا توجد سياسات استذكار.",
  dunningActionsEmpty: "لا توجد إجراءات تحصيل مسجلة.",
  dunningReviewsEmpty: "لا توجد مراجعات ائتمان مستحقة.",
  dunningAgenciesEmpty: "لا توجد وكالات تحصيل مسجلة.",
  dunningReferralsEmpty: "لا توجد إحالات.",
  dunningErrSteps: "سلّم الخطوات غير صالح — أيام التأخير يجب أن تتزايد بدءًا من الخطوة 1.",
  dunningErrLateFee: "إعدادات الرسوم المتأخرة غير مكتملة.",
  dunningErrFeeAlreadyCharged: "حُمّلت هذه الفاتورة رسومًا متأخرة بالفعل — رسوم واحدة لكل فاتورة.",
  dunningErrFeeNotWaivable: "لا يمكن التنازل عن هذه الرسوم (غير موجودة أو متنازل عنها سابقًا).",
  dunningErrReview: "بيانات المراجعة غير صالحة.",
  dunningErrReferralState: "حالة الإحالة لا تسمح بهذا الإجراء.",
  dunningErrCommissionUnmapped:
    "حساب عمولة التحصيل غير مربوط — اربط إعداد sales.collection_commission_account.",
  srmaColNo: "رقم الإرجاع",
  srmaColSupplier: "المورد",
  srmaColPo: "أمر الشراء",
  srmaColTotal: "الإجمالي",
  srmaColRequested: "تاريخ الطلب",
  srmaColLine: "السطر",
  srmaColItem: "الصنف",
  srmaColQty: "الكمية",
  srmaColUnitCost: "تكلفة الوحدة",
  srmaColNet: "الصافي",
  srmaStatusRequested: "مطلوب",
  srmaStatusApproved: "معتمد",
  srmaStatusShipped: "مشحون",
  srmaStatusCredited: "مُقيَّد دائنًا",
  srmaStatusCancelled: "ملغى",
  srmaActionCreate: "طلب إرجاع لمورد",
  srmaActionView: "عرض",
  srmaActionApprove: "اعتماد",
  srmaActionShip: "شحن",
  srmaActionCredit: "قيد دائن",
  srmaActionCancel: "إلغاء",
  srmaCreateTitle: "طلب إرجاع مورد جديد",
  srmaDetailTitle: "تفاصيل إرجاع المورد",
  srmaShipTitle: "شحن المرتجع إلى المورد",
  srmaFormPo: "أمر الشراء",
  srmaFormPickPo: "اختر أمر شراء",
  srmaFormPoLine: "سطر أمر الشراء",
  srmaFormWarehouse: "المستودع",
  srmaConfirmApprove: "اعتماد طلب الإرجاع؟",
  srmaConfirmShip: "شحن المرتجع؟ سيُخصم من رصيد المستودع المختار.",
  srmaConfirmCredit: "إصدار الإشعار الدائن للمورد (G-38)؟",
  srmaConfirmCancel: "إلغاء طلب الإرجاع؟",
  srmaToastCreated: "تم إنشاء طلب الإرجاع بنجاح.",
  srmaToastDone: "تم تنفيذ الإجراء.",
  srmaEmpty: "لا توجد طلبات إرجاع موردين.",
  srmaLinesEmpty: "لا توجد أسطر على هذا الأمر.",
  srmaErrState: "الحالة الحالية لا تسمح بهذا الإجراء.",
  srmaErrQtyExceeds: "الكمية المطلوب إرجاعها تتجاوز الرصيد المتاح لهذا السطر.",
  srmaErrUnmapped:
    "حساب مرتجعات المشتريات غير مربوط — اربط إعداد purchasing.supplier_return_account.",
  // -- PHASE-041 (T-10): مركز الاتصالات ---------------------------------------
  commTitle: "مركز الاتصالات",
  commSubtitle:
    "قوالب الرسائل واختيار المزوّدين ومصفوفة الإشعارات الافتراضية — كل إرسال يمر عبر منفذ القنوات، والمزوّد الافتراضي لا يجري أي اتصال خارجي قبل الإعداد.",
  commTabTemplates: "القوالب",
  commTabProviders: "المزوّدون",
  commTabDefaults: "الإشعارات الافتراضية",
  commTemplatesHint:
    "قوالب قناة × لغة × وحدة مع متغيّرات موثّقة — التعديل ينشئ نسخة خاصة بالمستأجر، والحذف يعيد القالب المدمج. المعاينة تفشل بنفس أخطاء الإرسال (مبدأ الإغلاق عند الفشل).",
  commTplColKey: "المفتاح",
  commTplColChannel: "القناة",
  commTplColLocale: "اللغة",
  commTplColModule: "الوحدة",
  commTplColStatus: "الحالة",
  commTplColAction: "إجراءات",
  commTplChannelEmail: "بريد إلكتروني",
  commTplChannelWhatsapp: "واتساب",
  commTplChannelSms: "رسالة نصية",
  commTplOverrideBadge: "مخصّص",
  commTplBuiltinBadge: "مدمج",
  commTplActive: "مفعّل",
  commTplInactive: "معطّل",
  commTplEditBtn: "تعديل",
  commTplPreviewBtn: "معاينة",
  commTplDeleteBtn: "حذف التخصيص",
  commTplDeletedToast: "عاد القالب المدمج.",
  commTplEditorNewTitle: "قالب جديد",
  commTplEditorEditTitle: "تعديل القالب",
  commTplFormKey: "المفتاح",
  commTplFormModule: "الوحدة",
  commTplFormSubject: "الموضوع",
  commTplFormBody: "النص",
  commTplFormVars: "المتغيّرات",
  commTplFormActive: "مفعّل",
  commTplSaveBtn: "حفظ",
  commTplSavedToast: "تم حفظ القالب.",
  commTplCancelBtn: "إلغاء",
  commTplPreviewTitle: "المعاينة",
  commTplPreviewVarsHint:
    "أدخل قيماً تجريبية للمتغيّرات المطلوبة — المعاينة تعرض الناتج النهائي كما سيُرسل.",
  commTplPreviewRunBtn: "عرض النتيجة",
  commTplPreviewSubject: "الموضوع",
  commTplPreviewBody: "النص",
  commTplPreviewWhatsappParams: "معاملات واتساب المرتّبة",
  commTplErrInvalid: "قالب غير صالح — راجع الحقول المطلوبة والمتغيّرات.",
  commProvidersHint:
    "اختيار المزوّد لكل قناة مع بيانات الاعتماد (تُخزَّن مختومة ولا تُعرض أبداً بعد الحفظ) وأرقام الإرسال حسب السوق وسقف الإرسال اليومي. ما لم يُضبط مزوّد كامل الاعتماد تعمل القناة على الوضع الرملي بلا أي اتصال خارجي.",
  commProvColProvider: "المزوّد",
  commProvColChannel: "القناة",
  commProvColStatus: "الحالة",
  commProvColAction: "إجراءات",
  commProvSelectLabel: "المزوّد العامل",
  commProvSelectSandbox: "رملي (افتراضي — بلا اتصال خارجي)",
  commProvLiveBadge: "فعلي",
  commProvSandboxBadge: "رملي",
  commProvBlockedBadge: "بانتظار بيانات الاعتماد",
  commProvRequiresVerification: "يتطلب تحققاً من المزوّد",
  commProvCredsTitle: "بيانات الاعتماد",
  commProvCredsHint:
    "الحقول السرية تُخزَّن مختومة ولا تُستعاد للعرض — يظهر فقط هل هي مضبوطة. اترك الحقل فارغاً للإبقاء على القيمة المحفوظة.",
  commProvCredsConfigured: "مضبوط",
  commProvCredsNotConfigured: "غير مضبوط",
  commProvCredSaveBtn: "حفظ بيانات الاعتماد",
  commProvCredsSavedToast: "تم حفظ بيانات الاعتماد (مختومة).",
  commProvMarketsTitle: "أرقام الإرسال حسب السوق",
  commProvMarketsHint:
    "لكل سوق (رمز ISO من حرفين) رقم واتساب أو اسم مرسل SMS أو عنوان بريدي — الإرسال يستخدم رقم السوق عند توفره.",
  commProvMarketCodeLabel: "السوق",
  commProvMarketWhatsappId: "معرّف رقم واتساب",
  commProvMarketSmsSender: "اسم مرسل SMS",
  commProvMarketEmailFrom: "عنوان البريد المرسل",
  commProvMarketRemoveBtn: "إزالة",
  commProvMarketAddBtn: "إضافة سوق",
  commProvCapTitle: "سقف الإرسال اليومي",
  commProvCapHint:
    "حد أقصى صارم لعدد الرسائل الصادرة يومياً على مستوى المستأجر — حماية من استنزاف قنوات مدفوعة.",
  commProvCapLabel: "أقصى عدد رسائل يومياً",
  commProvCapSavedToast: "تم حفظ السقف.",
  commDefaultsHint:
    "القيم الافتراضية للمستأجر لمصفوفة الإشعارات (وحدة × قناة) — المستخدم يرثها ما لم يضبط صفه الخاص من صندوق الاتصالات.",
  commPrefColModule: "الوحدة",
  commPrefChInApp: "داخل التطبيق",
  commPrefChEmail: "بريد",
  commPrefChSms: "SMS",
  commPrefChWhatsapp: "واتساب",
  commPrefSavedToast: "تم حفظ تفضيلات الإشعارات.",
  commInboxTitle: "صندوق الاتصالات الموحد",
  commInboxSubtitle:
    "كل الرسائل والمكالمات في خط زمني واحد لكل جهة — مع مرشحات النوع والقناة والاتجاه، وتسجيل المكالمات يدوياً بنتيجتها ومدتها.",
  commInboxTabTimeline: "الخط الزمني",
  commInboxTabCall: "تسجيل مكالمة",
  commInboxTabPrefs: "تفضيلاتي",
  commInboxFilterKind: "النوع",
  commInboxFilterChannel: "القناة",
  commInboxFilterDirection: "الاتجاه",
  commInboxFilterAll: "الكل",
  commInboxKindMessage: "رسالة",
  commInboxKindCall: "مكالمة",
  commInboxDirInbound: "وارد",
  commInboxDirOutbound: "صادر",
  commInboxColAt: "الوقت",
  commInboxColKind: "النوع",
  commInboxColChannel: "القناة",
  commInboxColCounterparty: "الطرف",
  commInboxColSummary: "الملخص",
  commInboxColOutcome: "النتيجة",
  commInboxColDuration: "المدة",
  commInboxColUser: "المستخدم",
  commInboxEmpty: "لا توجد اتصالات بعد — ستظهر الرسائل المرسلة والمكالمات المسجلة هنا.",
  commInboxRefresh: "تحديث",
  commInboxDurationValue: "{minutes} دقيقة",
  commCallFormTitle: "تسجيل مكالمة",
  commCallFormHint:
    "مكالمة صادرة أو واردة مرتبطة بجهة — النتيجة والمدة والملاحظات تظهر في الخط الزمني الموحد.",
  commCallPartnerLabel: "الجهة",
  commCallDirectionLabel: "الاتجاه",
  commCallOutcomeLabel: "النتيجة",
  commCallSummaryLabel: "الملخص",
  commCallBodyLabel: "الملاحظات",
  commCallDurationLabel: "المدة (بالدقائق)",
  commCallAtLabel: "وقت المكالمة",
  commCallSubmitBtn: "تسجيل",
  commCallLoggedToast: "تم تسجيل المكالمة.",
  commCallOutcomeCompleted: "مكتملة",
  commCallOutcomeNoAnswer: "بلا رد",
  commCallOutcomeBusy: "مشغول",
  commCallOutcomeVoicemail: "بريد صوتي",
  commCallOutcomeFailed: "فاشلة",
  commCallOutcomeScheduled: "مجدولة",
  commCallErrInvalid: "بيانات المكالمة غير صالحة — راجع الجهة والملخص والمدة.",
  commMyPrefsTitle: "تفضيلات إشعاراتي",
  commMyPrefsHint:
    "مصفوفة الوحدة × القناة — تعطيل قناة لوحدة يمنع إرسالها إليك نهائياً (بما فيها الرسائل التحصيلية). القنوات المدفوعة مغلقة افتراضياً.",
  commMyPrefsExplicitBadge: "مخصّص",
  commMyPrefsInheritNote: "غير المخصّص يرث الافتراضي",
  commMyPrefsSavedToast: "تم حفظ تفضيلاتك.",
  commPrefModuleLimits: "حدود الاستخدام",
  commPrefModuleSubscription: "الاشتراك",
  commPrefModuleReconciliation: "المطابقات",
  commPrefModuleInvoiceOverdue: "الفواتير المتأخرة",
  commPrefModuleStock: "المخزون",
  commPrefModuleTemplates: "قوالب القطاعات",
  commPrefModuleCrm: "إدارة العلاقات",
  commPrefModuleEinvoicing: "الفوترة الإلكترونية",
  commPrefModuleNotes: "الشيكات والأوراق",
  commPrefModuleInstallments: "الأقساط",
  commPrefModuleBudgeting: "الموازنات",
  commPrefModulePurchasing: "المشتريات",
  commPrefModuleCollections: "التحصيل",
  commPrefModuleWarranties: "الضمانات",
  commPrefModuleDigest: "الملخص اليومي",
};

const en: Dictionary = {
  appTitle: "Universal Business ERP",
  switchLabel: "العربية",
  signOut: "Sign out",
  loading: "Loading...",
  phaseNote: "PHASE-003 UI — sign-in, sessions and admin screens via the secure web BFF.",

  navHome: "Home",
  navUsers: "Users & invitations",
  navSessions: "Sessions",
  navMfa: "Two-factor (TOTP)",
  navRoles: "Roles",
  navPassword: "Password",

  loginTitle: "Sign in",
  loginSubtitle: "Use your work account to access the platform.",
  loginEmailLabel: "Email",
  loginPasswordLabel: "Password",
  loginMfaLabel: "MFA code",
  loginMfaHint: "Six digits from your authenticator app.",
  loginMfaShow: "Enter an MFA code",
  loginMfaHide: "Hide the MFA code",
  loginSubmit: "Sign in",
  loginForgotLink: "Forgot your password?",
  loginNoAccount: "No account yet?",
  loginErrorInvalidCredentials: "Email or password is incorrect.",
  loginErrorMfaRequired: "This account is protected with two-factor authentication — enter your MFA code.",
  loginErrorMfaBootstrapIneligible:
    "The enforced-enrollment path is not available for this account — sign in the usual way.",
  loginErrorRateLimited: "Too many attempts — try again in {seconds} seconds.",
  loginErrorAccountLocked: "This account is temporarily locked — try again in {seconds} seconds.",
  loginErrorGeneric: "Could not sign you in — please try again.",

  forgotTitle: "Reset your password",
  forgotDescription: "Enter your email; if the account exists, a reset link will be sent to it.",
  forgotEmailLabel: "Email",
  forgotSubmit: "Send reset link",
  forgotSuccess: "If that email is registered, a password reset message is on its way.",
  forgotBack: "Back to sign in",

  acceptTitle: "Accept your invitation",
  acceptTenantLabel: "Organization",
  acceptRoleLabel: "Role",
  acceptEmailLabel: "Invited email",
  acceptFullNameLabel: "Full name",
  acceptPasswordLabel: "New password",
  acceptPasswordHint: "At least 10 characters.",
  acceptSubmit: "Create account and sign in",
  acceptErrorExpired: "This invitation has expired.",
  acceptErrorRevoked: "This invitation was revoked.",
  acceptErrorAccepted: "This invitation has already been used.",
  acceptErrorNotFound: "This invitation link is not valid.",
  acceptErrorGeneric: "Could not accept this invitation.",

  homeWelcome: "Welcome, {name}",
  homeTenantLabel: "Active organization",
  homeSwitchTenant: "Switch organization",
  homeRoleLabel: "Your role",
  homePermissionsLabel: "Granted permissions: {count}",
  homeScreens: "Admin screens",

  usersTitle: "Users & invitations",
  usersNoPermission: "You do not have permission to view this screen.",
  usersColEmail: "Email",
  usersColName: "Name",
  usersColRole: "Role",
  usersColStatus: "Status",
  usersColLastLogin: "Last sign-in",
  usersNever: "Never signed in",
  usersEmpty: "No users in this organization yet.",
  usersInviteTitle: "Invite a user",
  usersInviteEmailLabel: "Invitee email",
  usersInviteRoleLabel: "Role on joining",
  usersInviteSubmit: "Send invitation",
  usersInviteLinkTitle: "Accept link (dev environment — no real mail delivery):",
  usersInviteExpiresLabel: "Expires:",
  usersInvitationsTitle: "Invitations",
  usersColExpires: "Expires",
  usersColActions: "Actions",
  usersRevoke: "Revoke",
  usersNoRoles: "No roles are available to assign.",
  usersEmptyInvitations: "No invitations.",

  statusActive: "Active",
  statusPending: "Pending",
  statusRevoked: "Revoked",
  statusExpired: "Expired",
  statusAccepted: "Accepted",
  statusSuspended: "Suspended",

  sessionsTitle: "Active sessions",
  sessionsHint:
    "Revoking a session signs that device out immediately; to sign yourself out everywhere, revoke your sessions one by one.",
  sessionsColUser: "User",
  sessionsColCreated: "Started",
  sessionsColExpires: "Expires",
  sessionsColLastSeen: "Last seen",
  sessionsColIp: "IP address",
  sessionsRevoke: "Revoke session",
  sessionsEmpty: "No active sessions.",

  mfaTitle: "Two-factor authentication (TOTP)",
  mfaDescription: "Enroll an authenticator app, confirm with a code, then generate recovery codes.",
  mfaEnrollTitle: "Step 1 — Start enrollment",
  mfaEnrollButton: "Start enrollment",
  mfaSecretLabel: "Secret (enter it manually in your authenticator app):",
  mfaOtpauthLabel: "otpauth data (QR payload):",
  mfaEnrollHint: "Enter the current code from your authenticator app to confirm enrollment.",
  mfaVerifyTitle: "Step 2 — Confirm the code",
  mfaVerifyCodeLabel: "MFA code",
  mfaVerifySubmit: "Confirm",
  mfaVerified: "Two-factor authentication is now active.",
  mfaRecoveryTitle: "Step 3 — Recovery codes",
  mfaRecoveryDescription: "Recovery codes are shown once — store them somewhere safe now.",
  mfaRecoveryGenerate: "Generate recovery codes",
  mfaRecoveryRegenerate: "Regenerate codes",
  mfaInvalidCode: "That code is not valid.",
  mfaNeedConfirmed: "Confirm enrollment first, then generate recovery codes.",
  mfaEnforcedNotice:
    "Your organization requires multi-factor authentication — complete enrollment to continue. This session expires in 15 minutes.",

  rolesTitle: "Roles",
  rolesDescription: "Clone a system template to create a role for your organization.",
  rolesTenantTitle: "Organization roles",
  rolesTemplatesTitle: "System templates",
  rolesColKey: "Key",
  rolesColName: "Name",
  rolesColSystem: "System?",
  rolesColActions: "Actions",
  rolesClone: "Clone",
  rolesCloned: "Role {name} created.",
  rolesYes: "Yes",
  rolesNo: "No",

  passwordTitle: "Change password",
  passwordDescription: "After the change your other sessions are revoked; this browser stays signed in.",
  passwordCurrentLabel: "Current password",
  passwordNextLabel: "New password",
  passwordNextHint: "At least 10 characters.",
  passwordSubmit: "Change password",
  passwordSuccess: "Your password has been changed.",
  passwordErrorCurrent: "Your current password is not correct.",

  errorsForbidden: "You do not have permission to do that.",
  errorsUnauthorized: "Your session has expired — sign in again.",
  errorsValidation: "Invalid input — please check the fields.",
  errorsNotFound: "Not found.",
  errorsNetwork: "Could not reach the server.",
  errorsGeneric: "Something went wrong.",
  errorsRateLimited: "Too many attempts — try again in {seconds} seconds.",

  navOnboarding: "Onboarding",
  navBranches: "Branches",
  navSettings: "Settings",
  navSupport: "Support sessions",
  navPlatformSection: "Platform administration",
  navPlatformConsole: "Platform",
  navPlatformAudit: "Platform audit",

  statusInactive: "Inactive",
  statusClosed: "Closed",
  statusIssued: "Issued",
  statusRejected: "Rejected",
  statusConverted: "Converted",
  statusTerminated: "Terminated",
  taxStatusLabel: "Tax registration status",
  taxStatusRegistered: "Registered",
  taxStatusNotRegistered: "Not registered",
  taxStatusDeregistered: "Deregistered",
  taxNumberLabel: "Tax registration number",
  fiscalStartMonthLabel: "Fiscal year start month",
  numberingAssignAtLabel: "Document number assignment",
  numberingAssignAtPosting: "At posting",
  numberingAssignAtApproval: "At approval",
  localeArabic: "العربية",
  localeEnglish: "English",

  registerTitle: "Create a new organization",
  registerSubtitle: "Create an owner account and a new organization in one step, then start a trial.",
  registerBusinessNameLabel: "Business name (English)",
  registerBusinessNameArLabel: "Business name (Arabic, optional)",
  registerCountryLabel: "Country",
  registerCurrencyLabel: "Base currency (derived from the country)",
  registerTemplateLabel: "Industry template",
  registerTaxNumberHint: "Required when the status is “Registered”.",
  registerOwnerSection: "Owner account",
  registerOwnerEmailLabel: "Owner email",
  registerOwnerNameLabel: "Owner full name",
  registerSubmit: "Create organization",
  registerSuccessTitle: "Your organization has been created",
  registerSuccessBody: "Check your email ({email}) then sign in. The trial period ends on {date}.",
  registerGoLogin: "Sign in",
  registerLoginPrompt: "Already have an account?",
  registerErrorEmailTaken: "This email is already registered — sign in instead of creating a new account.",
  registerErrorOptions: "Could not load the registration options (countries/templates) — reload the page.",

  onboardingTitle: "Workspace onboarding",
  onboardingSubtitle:
    "Provisioning creates your organization roles, the chart of accounts and the default numbering policies. It is safe to re-run: a second run creates no duplicates.",
  onboardingProvisionButton: "Provision workspace",
  onboardingResultTitle: "Provisioning result",
  onboardingRolesLabel: "Roles",
  onboardingAccountsLabel: "Accounts",
  onboardingPurposesLabel: "Account purposes",
  onboardingSettingsLabel: "Settings",
  onboardingCreatedCount: "Created: {created} — already existing: {existing}",
  onboardingZeroDuplicatesHint:
    "Nothing new was created — the workspace is already provisioned, which confirms that re-runs produce zero duplicates.",
  onboardingGoHome: "Go to home",
  onboardingGoBranches: "Manage branches",

  branchesTitle: "Branches",
  branchesEmpty: "No branches yet.",
  branchesColCode: "Code",
  branchesColName: "Name",
  branchesColNameAr: "Arabic name",
  branchesCreateTitle: "Create a branch",
  branchesCodeLabel: "Branch code",
  branchesNameLabel: "Branch name",
  branchesNameArLabel: "Arabic name (optional)",
  branchesCreateSubmit: "Add branch",
  branchesActivate: "Activate",
  branchesDeactivate: "Deactivate",
  branchesErrorCodeTaken: "This branch code is already used in this organization.",

  settingsTitle: "Organization settings",
  settingsProfileTitle: "Profile",
  settingsNameLabel: "Name (English)",
  settingsNameArLabel: "Arabic name",
  settingsTimezoneLabel: "Timezone",
  settingsProfileSubmit: "Save profile",
  settingsProfileSaved: "The profile has been saved.",
  settingsGeneralTitle: "General settings",
  settingsDefaultLocaleLabel: "Default locale",
  settingsNumeralSystemLabel: "Numeral system",
  settingsNumeralLatn: "Western digits (123)",
  settingsNumeralArab: "Arabic-Indic digits (١٢٣)",
  settingsHijriLabel: "Hijri date display",
  settingsHijriHint: "Display-only overlay — fiscal years stay Gregorian.",
  settingsFiscalNumberingTitle: "Fiscal calendar & numbering",
  settingsSupportTitle: "Support",
  settingsSupportOptInLabel: "Allow support sessions",
  settingsSupportOptInWarning:
    "Warning: enabling this allows the platform team to open time-boxed, audited support sessions that read your organization's data.",
  settingsTaxTitle: "Tax registration",
  settingsTaxPairHint:
    "The status and number are validated as a pair: the number is required while “Registered” and rejected otherwise.",
  settingsSave: "Save",
  settingsSaved: "Saved.",
  settingsErrorInvalidValue: "Invalid value for this setting.",

  // -- PHASE-024 T4: MFA policy settings card
  mfaPolicyTitle: "Multi-factor authentication policy",
  mfaPolicyDescription: "Choose which roles must enroll in two-factor authentication at sign-in.",
  mfaPolicyModeLabel: "Mode",
  mfaPolicyModePlan: "Inherit plan",
  mfaPolicyModeCustom: "Custom",
  mfaPolicyModePlanHint: "Inherit-plan mode applies the mandatory roles defined by your subscription plan.",
  mfaPolicyModeCustomHint:
    "Custom mode replaces the plan's list with the roles below — an explicitly empty list makes MFA optional for everyone.",
  mfaPolicyRolesLabel: "Roles required to use MFA",
  mfaPolicyRolesHint:
    "Pick the tenant roles that will be asked to complete MFA enrollment at their next sign-in (up to 20 roles).",
  mfaPolicyRolesUnavailable: "The roles list could not be loaded — only the currently selected keys are shown.",
  mfaPolicyNoRoles: "This tenant has no roles yet.",
  mfaPolicyRoleMissing: "Stored role missing from the current list:",
  mfaPolicySelectedCount: "Selected: {count} of {max}",
  mfaPolicyRolesMaxError: "The maximum is {max} roles.",

  supportSessionsTitle: "Support sessions",
  supportSessionsHint:
    "These are sessions the platform team opens on your request or with your consent; you can terminate any active opt-in session at any time.",
  supportColReason: "Reason",
  supportColTicket: "Ticket ref",
  supportColOpened: "Opened",
  supportColClosed: "Closed",
  supportColOptIn: "Opt-in?",
  supportEmpty: "No support sessions.",
  supportTerminate: "Terminate session",
  supportErrorAccessDenied:
    "Opening a support session requires the organization's opt-in or a declared incident ticket reference.",
  supportErrorExpired: "The support session has expired.",
  supportErrorNotActive: "This session is not active.",

  tenancyErrorFeatureNotEntitled: "This feature is not enabled for your organization.",
  tenancyErrorDependenciesMissing: "Activating the feature requires dependency keys that are not granted yet: {keys}",

  platformConsoleTitle: "Platform administration console",
  platformNoAccess: "This is the platform administration area — available to platform operations staff only.",
  platformTenantBadge: "Platform",
  platformSearchLabel: "Search organizations",
  platformSearchSubmit: "Search",
  platformColTenant: "Organization",
  platformColCountry: "Country",
  platformColPlan: "Plan",
  platformColCreated: "Created",
  platformEmpty: "No matching organizations.",
  platformProfileTitle: "Profile",
  platformPlanTitle: "Plan & subscription",
  platformPlanCurrentLabel: "Current plan",
  platformPlanNone: "No active subscription.",
  platformPlanAssignTitle: "Assign a plan",
  platformPlanLabel: "Plan",
  platformTrialDaysLabel: "Trial days (optional)",
  platformPlanSubmit: "Assign plan",
  platformPlanAssigned: "Plan “{plan}” assigned — granted keys: {count}.",
  platformEntitlementsTitle: "Entitlements",
  platformColFeatureKey: "Feature key",
  platformColSource: "Source",
  platformEntitlementsEmpty: "No entitlements granted.",
  platformGrantTitle: "Grant a feature",
  platformGrantFeatureLabel: "Feature key",
  platformGrantSourceLabel: "Source",
  platformGrantExpiresLabel: "Expires at",
  platformGrantExpiresHint: "Required for MANUAL grants.",
  platformGrantReasonLabel: "Reason",
  platformGrantSubmit: "Grant",
  platformGrantDone: "The feature has been granted.",
  platformRevoke: "Revoke",
  platformRevokeReasonLabel: "Revocation reason",
  platformGrantExpiryRequired: "Manual grants must carry an explicit expiry.",
  platformGrantUnknownKey: "Unknown feature key.",
  platformMembershipsTitle: "Memberships",
  platformBranchesTitle: "Organization branches",
  platformLifecycleTitle: "Suspend & restore",
  platformReasonLabel: "Reason (required)",
  platformSuspendButton: "Suspend organization",
  platformRestoreButton: "Restore organization",
  platformSuspendDone: "Organization suspended — {count} user session(s) killed.",
  platformRestoreDone: "Organization restored to active.",
  platformSupportTitle: "Support sessions",
  platformSupportOpenTitle: "Open a support session",
  platformSupportReasonLabel: "Reason",
  platformSupportTicketLabel: "Ticket reference (optional)",
  platformSupportHoursLabel: "Duration in hours (1-4)",
  platformSupportOpenSubmit: "Open session",
  platformSupportClose: "Close",
  platformSupportCloseReasonLabel: "Close reason",
  platformSupportSessionLabel: "Active session",
  platformReadDataTitle: "Read organization data",
  platformReadResourceLabel: "Resource",
  platformReadSubmit: "Read",
  platformNoActiveSession: "No active support session — open one first.",
  resourceUsers: "Users",
  resourceMemberships: "Memberships",
  resourceRoles: "Roles",
  resourceBranches: "Branches",
  resourceSettings: "Settings",
  resourceEntitlements: "Entitlements",
  resourceSubscription: "Subscription",
  resourceAccounts: "Accounts",
  resourceAuditEvents: "Audit events",

  platformAuditTitle: "Platform audit log",
  platformAuditPlatformOnly: "Platform events only",
  platformAuditTenantFilter: "Tenant id (optional)",
  platformAuditActionFilter: "Action (optional)",
  platformAuditApply: "Apply filters",
  platformAuditColAt: "When",
  platformAuditColAction: "Action",
  platformAuditColActor: "Actor",
  platformAuditViaPlatform: "Via platform admin",
  platformAuditNextPage: "Next page",
  platformAuditEmpty: "No events.",
  platformErrorInvalidTransition: "The organization's state does not allow this transition.",
  platformErrorPlanNotFound: "Unknown plan.",

  // -- PHASE-024 T8: tenant audit review console
  auditReviewTitle: "Audit review",
  auditReviewHint:
    "Review your tenant's audit events — the action, actor, entity and correlation id of every operation — with a CSV export of the same filter set.",
  auditFilterAction: "Action (optional)",
  auditFilterActorId: "Actor id (UUID, optional)",
  auditFilterEntityType: "Entity type (optional)",
  auditFilterEntityId: "Entity id (UUID, optional)",
  auditFilterCorrelationId: "Correlation id (UUID, optional)",
  auditFilterFromAt: "From (UTC)",
  auditFilterToAt: "To (UTC)",
  auditFilterLimit: "Row limit",
  auditFilterApply: "Apply filters",
  auditColAt: "When",
  auditColAction: "Action",
  auditColEntityType: "Entity type",
  auditColEntityId: "Entity id",
  auditColActor: "Actor",
  auditColCorrelation: "Correlation id",
  auditEmpty: "No matching events.",
  auditExportCsv: "Export CSV",
  auditResultCount: "Results: {count}",
  auditOrderHint: "Results are ordered oldest-first.",

  shellSkipToContent: "Skip to content",
  shellCommandSearch: "Search or jump to…",
  shellShortcutsTitle: "Keyboard shortcuts",
  shellClose: "Close",
  shellMore: "More",
  statusOffboarded: "Offboarded",
  wizardStepOf: "Step {current} of {total}",
  platformBackToConsole: "Back to the platform console",
  rolesEmpty: "No roles yet.",
  retryLabel: "Try again",

  // -- P6-T11a: shared labels -------------------------------------------------
  commonSave: "Save",
  commonCreate: "Create",
  commonCancel: "Cancel",
  commonOpen: "Open",
  commonClear: "Clear",
  commonConfirm: "Confirm",
  commonUnsavedChanges: "There are unsaved changes — continue anyway?",
  commonVersionConflict: "The record changed elsewhere — reload and retry.",
  statusDraft: "Draft",
  statusArchived: "Archived",
  kindLabel: "Kind",
  kindFilterAll: "All",
  colStatus: "Status",
  colName: "Name",
  listNextPage: "Next page",
  listPrevPage: "Previous page",
  listSearchLabel: "Search",
  namePreviewLabel: "Name preview",

  // -- P6-T11a: navigation + breadcrumbs ----------------------------------------
  navPartners: "Partners",
  navPartnersDirectory: "Partner directory",
  navPartnersNew: "New partner",
  navOpeningBalances: "Opening balances",
  navInventory: "Inventory",
  navItems: "Items",
  navItemsNew: "New item",
  navPriceLists: "Price lists",
  navImport: "Import & export",
  // PHASE-035: tracking surfaces breadcrumb fallbacks
  navBatches: "Batches & expiry",
  navSerials: "Serial numbers",
  navAdjustments: "Stock adjustments",

  // -- PHASE-007: accounting -----------------------------------------------------
  navAccountingCoa: "Chart of accounts",
  navAccountingJournals: "Journal entries",
  navAccountingGl: "General ledger",
  navAccountingPeriods: "Fiscal calendar",
  navAccountingApprovals: "Approvals",
  navAccountingRates: "Exchange rates",
  accountingTitle: "Accounting",
  accountingJournalsTitle: "Journal entries",
  accountingJournalsNew: "New journal",
  accountingJournalsEmpty: "No journal entries yet",
  accountingColEntryNo: "Entry no.",
  accountingColEntryDate: "Date",
  accountingColCurrency: "Currency",
  accountingColTotal: "Total",
  accountingColStatus: "Status",
  accountingColCode: "Code",
  accountingColName: "Name",
  accountingColType: "Type",
  accountingColPostable: "Postable",
  accountingColDebit: "Debit",
  accountingColCredit: "Credit",
  accountingColBalance: "Balance",
  accountingSubmit: "Submit",
  accountingApprove: "Approve",
  accountingPost: "Post",
  accountingReverse: "Reverse",
  accountingCancel: "Cancel",
  accountingSaveDraft: "Save draft",
  accountingAddLine: "Add line",
  accountingRemoveLine: "Remove line",
  accountingDuplicateLine: "Duplicate line",
  accountingPartnerRequired: "Partner is required on this account",
  accountingBalanced: "Balanced",
  accountingUnbalanced: "Entry unbalanced",
  accountingDifference: "Δ",
  accountingLineTotal: "Line",
  accountingMemo: "Description",
  accountingCostCenter: "Cost center",
  accountingPartner: "Partner",
  accountingTaxCode: "Tax code",
  accountingAccount: "Account",
  accountingDescription: "Description",
  accountingCoaTitle: "Chart of accounts",
  accountingCoaEmpty: "No accounts",
  accountingPurposesTitle: "Account purposes",
  accountingPurposesEmpty: "No purpose mappings",
  accountingGlTitle: "General ledger",
  accountingGlEmpty: "No movements",
  accountingGlDrill: "Open entry",
  accountingPeriodsTitle: "Fiscal periods",
  accountingPeriodsEmpty: "No periods",
  accountingYearsTitle: "Fiscal years",
  accountingCreateYear: "Create fiscal year",
  accountingYearName: "Year name",
  accountingYearStart: "Start date",
  accountingYearEnd: "End date",
  accountingSoftClose: "Soft-close",
  accountingLock: "Lock",
  accountingReopen: "Reopen",
  accountingReopenReason: "Reopen reason",
  accountingReopenPrompt: "Enter the reopen reason (required)",
  accountingChecklist: "Close checklist",
  accountingChecklistOk: "OK",
  accountingChecklistBroken: "Broken",
  accountingChecklistNotRun: "Not run",
  accountingChecklistNotApplicable: "Not yet applicable",
  accountingApprovalsTitle: "Pending approvals",
  accountingApprovalsEmpty: "Nothing awaiting approval",
  accountingApprovalsSelfHint: "You cannot approve your own document",
  accountingApprovalsSubmittedBy: "Submitted by",
  accountingApprovalsTotalBase: "Total (base)",
  accountingApprovalsPreview: "Preview",
  accountingReject: "Reject",
  accountingRatesTitle: "Exchange rates",
  accountingRatesEmpty: "No rates",
  accountingRatesCurrency: "Currency",
  accountingRatesDate: "Date",
  accountingRatesRate: "Rate",
  accountingRatesSave: "Save rate",
  accountingPostedAt: "Posted at",
  accountingSource: "Source",
  accountingPreviewTitle: "Journal preview",
  statusPendingApproval: "Pending approval",
  statusApproved: "Approved",
  statusPosted: "Posted",
  statusReversed: "Reversed",
  statusCancelled: "Cancelled",
  accountingStatusOpen: "Open",
  accountingStatusSoftClosed: "Soft-closed",
  accountingStatusLocked: "Locked",
  accountingKindRegular: "Regular",
  accountingKindOpening: "Opening",
  accountingKindClosing: "Closing",
  accountingSearchPlaceholder: "Search by code or name…",
  accountingNewAccount: "New account",
  accountingAccountParent: "Parent account",
  accountingAccountCurrency: "Account currency (optional)",
  accountingIsGroup: "Group account (not postable)",
  accountingMapPurpose: "Map purpose to account",
  accountingPurposeKey: "Purpose",
  accountingPurposeAccount: "Account",
  accountingActiveFrom: "Active from",
  accountingLines: "Entry lines",
  accountingColAmount: "Amount",
  accountingColBase: "Base amount",
  accountingColDirection: "Direction",
  accountingColPeriod: "Period",
  accountingReference: "Reference",
  accountingExchangeRate: "Exchange rate",
  accountingRecurringTitle: "Recurring journals",
  accountingRecurringNew: "New recurring journal",
  accountingRecurringEmpty: "No recurring journals",
  accountingRecurringSchedule: "Schedule",
  accountingRecurringNextRun: "Next run",
  accountingRecurringAmountPolicy: "Amount policy",
  accountingRecurringFixed: "Fixed",
  accountingRecurringReenter: "Re-enter",
  accountingRecurringPause: "Pause",
  accountingRecurringActivate: "Activate",
  accountingRecurringGenerateDue: "Generate due entries",
  accountingPoliciesTitle: "Approval policies",
  accountingPoliciesEmpty: "No policies defined",
  accountingPolicyMode: "Mode",
  accountingPolicyThreshold: "Threshold (base currency)",
  accountingRunAr: "Run AR reconciliation",
  accountingRunAp: "Run AP reconciliation",
  accountingReconStatusOk: "Reconciled",
  accountingReconStatusBroken: "Broken",
  accountingPostOpening: "Post opening balances",
  accountingPostOpeningConfirm: "Opening balances post once through the OPENING period of the selected fiscal year. Continue?",
  obPostReadyNote: "Drafts are ready — posting runs once through the OPENING period of the selected fiscal year.",
  accountingYearEndExecute: "Execute year-end close",
  accountingYearEndReverse: "Reverse year-end close",
  accountingYearEndConfirm: "The system closing entry for the year will be generated. Continue?",
  accountingMovementsTitle: "Account movements",
  accountingRegisterTitle: "Journal register",
  accountingSelectAccount: "Select an account",
  accountingFromDate: "From date",
  accountingToDate: "To date",
  accountingReversalDate: "Reversal entry date",
  accountingReversalReason: "Reversal reason",
  accountingSoftClosePrompt: "Reason for posting into a soft-closed period (optional)",
  accountingRateHint: "Rate = base-currency units per 1 foreign unit",
  accountingErrEntryNotBalanced: "Entry unbalanced — total debits must equal total credits.",
  accountingErrPeriodLocked: "The fiscal period is locked — posting is not allowed.",
  accountingErrAccountNotPostable: "Account is not postable (archived or group).",
  accountingErrPurposeNotMapped: "Purpose is not mapped to an active account — no fallback posting, ever.",
  accountingErrMissingPartner: "AR/AP control lines require a partner.",
  accountingErrMissingFxRate: "No exchange rate for the given date.",
  accountingErrAlreadyPosted: "This document is already posted.",
  accountingErrAlreadyReversed: "This entry is already reversed.",
  accountingErrApprovalLimit: "Amount exceeds the approval threshold.",
  accountingErrSelfApproval: "You cannot approve a document you created.",
  accountingErrImmutable: "Posted entries are immutable — correction is reversal-only.",
  accountingErrState: "Document state does not allow this action.",
  accountTypeAsset: "Asset",
  accountTypeLiability: "Liability",
  accountTypeEquity: "Equity",
  accountTypeRevenue: "Revenue",
  accountTypeExpense: "Expense",
  accountingPostableYes: "Postable",
  accountingPostableNo: "Group",
  accountingPurposesHint: "One active mapping per purpose — the engine fails closed on any unmapped purpose (no fallback posting).",

  // -- T14-UI: PHASE-008 treasury --------------------------------------------------
  navTreasury: "Treasury",
  navTreasuryAccounts: "Cash accounts",
  navTreasuryReceipts: "Receipts",
  navTreasuryPayments: "Payments",
  navTreasuryExpenses: "Expenses",
  navTreasuryTransfers: "Cash transfers",
  navTreasuryShifts: "Cashier shifts",
  navTreasuryBankRec: "Bank reconciliation",
  treasuryAccountsTitle: "Cash accounts",
  treasuryAccountsEmpty: "No cash accounts yet — open the first one.",
  treasuryAccountOpenTitle: "Open cash account",
  treasuryAccountName: "Name (English)",
  treasuryAccountNameAr: "Name (Arabic)",
  treasuryAccountType: "Account type",
  treasuryAccountTypeCash: "Cash",
  treasuryAccountTypeBank: "Bank",
  treasuryAccountTypePetty: "Petty cash",
  treasuryAccountGlAccount: "GL control account",
  treasuryAccountCurrency: "Currency",
  treasuryAccountBranch: "Branch (optional)",
  treasuryColGlCode: "GL code",
  treasuryAccountBalance: "Balance",
  treasuryColMovements: "Movements",
  treasuryAccountCreatedToast: "Cash account opened.",
  treasuryAccountCloseBtn: "Close account",
  treasuryAccountCloseReason: "Close reason",
  treasuryAccountClosedToast: "Cash account closed.",
  treasuryAccountOpenedAt: "Opened at",
  treasuryAccountClosedAt: "Closed at",
  treasuryAccountMovementsTitle: "Account movements",
  treasuryAccountMovementsEmpty: "No movements yet.",
  treasuryColDirectionIn: "In",
  treasuryColDirectionOut: "Out",
  treasuryColBaseAmount: "Base amount",
  treasuryColValueDate: "Value date",
  treasuryColRate: "Rate",
  treasuryColSource: "Source",
  treasuryColMemo: "Memo",
  treasuryMethodCash: "Cash",
  treasuryMethodBank: "Bank transfer",
  treasuryMethodCheque: "Cheque",
  treasuryMethodCard: "Card",
  treasuryMethodTransfer: "Wire transfer",
  treasuryReceiptsTitle: "Receipts",
  treasuryReceiptsEmpty: "No receipts yet.",
  treasuryReceiptsNew: "New receipt",
  treasuryPaymentsTitle: "Payments",
  treasuryPaymentsEmpty: "No payments yet.",
  treasuryPaymentsNew: "New payment",
  treasuryColDocNo: "Doc no.",
  treasuryColPartner: "Partner",
  treasuryColMethod: "Method",
  treasuryColAmount: "Amount",
  treasuryColAllocated: "Allocated",
  treasuryColFx: "FX gain/loss",
  treasuryColPayer: "Payer",
  treasuryColPayee: "Payee",
  treasuryDocCashAccount: "Cash account",
  treasuryDocPartner: "Partner",
  treasuryDocMethod: "Method",
  treasuryDocCurrency: "Currency",
  treasuryDocAmount: "Amount",
  treasuryDocRate: "Exchange rate (optional)",
  treasuryDocRateHint: "Leave empty to use the value-date rate",
  treasuryDocValueDate: "Value date",
  treasuryDocReference: "Reference",
  treasuryDocDescription: "Description",
  treasuryDocDescriptionAr: "Description (Arabic)",
  treasuryDocCreatedToast: "Document created.",
  treasuryDocDetailTitle: "Document detail",
  treasuryDocPostedToast: "Posted {no} — journal {entry}.",
  treasuryDocReverseToast: "Document reversed.",
  treasuryDocReverseDate: "Reversal date",
  treasuryDocReverseReason: "Reversal reason",
  treasuryDocCancelToast: "Document cancelled.",
  treasuryDocOnAccount: "On account",
  treasuryDocJournalNo: "Journal no.",
  treasuryDocSideHint: "Receipts allocate AR (customer) open items; payments allocate AP (supplier) open items.",
  treasuryCancelReason: "Cancellation reason",
  treasuryOpenItemsTitle: "Open items",
  treasuryAllocationsTitle: "Document allocation",
  treasuryAllocationsEmpty: "No open items for this partner.",
  treasuryAllocationsHint: "Allocate the amount across open items — the remainder posts on account.",
  treasuryAllocationSuggestBtn: "Suggest FIFO allocation",
  treasuryAllocationSuggestToast: "Suggestion applied to {count} item(s).",
  treasuryAllocationColOutstanding: "Outstanding",
  treasuryAllocationTotals: "Allocation summary",
  treasuryAllocationTotalAllocated: "Total allocated",
  treasuryAllocationRemainder: "Unallocated",
  treasuryAllocationOnAccountHint: "The unallocated remainder posts to the partner's on-account balance.",
  treasuryAllocationOverError: "Allocations exceed the document amount.",
  treasuryAllocationSaveBtn: "Save allocation",
  treasuryAllocationSavedToast: "Allocation saved.",
  treasuryAllocationReloadBtn: "Reload items",
  treasuryExpensesTitle: "Expenses",
  treasuryExpensesEmpty: "No expense claims yet.",
  treasuryExpenseClaimNew: "Record expense",
  treasuryExpenseCategoriesTitle: "Expense categories",
  treasuryExpenseCategoriesEmpty: "No categories yet — create the first one.",
  treasuryExpenseCategoryNew: "New category",
  treasuryExpenseCategoryCode: "Category code",
  treasuryExpenseCategoryAccount: "Expense account",
  treasuryExpenseCategoryApproval: "Approval mode",
  treasuryExpenseApprovalNone: "No approval",
  treasuryExpenseApprovalSingle: "Single approver",
  treasuryExpenseCategoryCreatedToast: "Category created.",
  treasuryExpenseCreatedToast: "Expense recorded.",
  treasuryExpenseReceiptNote: "Receipt file uploads arrive with the files workspace — paste an existing receipt file id if you have one.",
  treasuryExpenseReceiptFileId: "Receipt file id (optional)",
  treasuryExpenseColNo: "Expense no.",
  treasuryExpenseColPayee: "Payee",
  treasuryExpenseColCategory: "Category",
  treasuryTransfersTitle: "Cash transfers",
  treasuryTransfersEmpty: "No transfers yet.",
  treasuryTransferNew: "New transfer",
  treasuryTransferFrom: "From account",
  treasuryTransferTo: "To account",
  treasuryTransferCreatedToast: "Transfer created.",
  treasuryTransferPostedToast: "Transfer posted.",
  treasuryTransferCancelledToast: "Transfer cancelled.",
  treasuryTransferSameAccountError: "Source and destination accounts must differ.",
  treasuryColFrom: "From",
  treasuryColTo: "To",
  treasuryColNo: "No.",
  treasuryColFee: "Fee",
  treasuryShiftsTitle: "Cashier shifts",
  treasuryShiftsEmpty: "No shifts yet.",
  treasuryShiftOpenTitle: "Open shift",
  treasuryShiftOpenBtn: "Open shift",
  treasuryShiftOpeningAmount: "Opening float",
  treasuryShiftCreatedToast: "Shift opened.",
  treasuryShiftStatusOpen: "Open",
  treasuryShiftStatusClosed: "Closed",
  treasuryShiftStatusCancelled: "Cancelled",
  treasuryShiftColShiftNo: "Shift no.",
  treasuryShiftColOpenedAt: "Opened at",
  treasuryShiftColClosedAt: "Closed at",
  treasuryShiftColCapturedIn: "Captured in",
  treasuryShiftColCapturedOut: "Captured out",
  treasuryShiftExpected: "Expected",
  treasuryShiftCounted: "Counted",
  treasuryShiftDifference: "Variance",
  treasuryShiftVarianceJournal: "Variance journal",
  treasuryShiftSupervisor: "Supervisor",
  treasuryShiftSupervisorPin: "Supervisor PIN",
  treasuryShiftSupervisorHint: "Required when the variance exceeds tolerance",
  treasuryShiftReason: "Close reason",
  treasuryShiftCloseToast: "Shift closed.",
  treasuryShiftCancelBtn: "Cancel shift",
  treasuryShiftCancelledToast: "Shift cancelled.",
  treasuryShiftPanelTitle: "Cashier shift",
  treasuryShiftCaptureTitle: "Capture movement",
  treasuryShiftCaptureHint: "Record cash in/out movements during the shift.",
  treasuryShiftCaptureBtn: "Capture",
  treasuryShiftCloseTitle: "Close shift",
  treasuryShiftCloseBtn: "Close",
  treasuryShiftBalanced: "Counts match",
  treasuryShiftVarianceNote: "Variance is non-zero — enter a reason and supervisor details when beyond tolerance.",
  treasuryShiftClosedNote: "Shift closed — read-only summary.",
  treasuryBankRecTitle: "Bank reconciliation",
  treasuryBankRecEmpty: "No statements yet — import the first one.",
  treasuryBankRecImportTitle: "Import statement",
  treasuryBankRecAdapter: "Import adapter",
  treasuryBankRecFile: "File",
  treasuryBankRecFileHint: "CSV or Excel file",
  treasuryBankRecPeriodStart: "Period start",
  treasuryBankRecPeriodEnd: "Period end",
  treasuryBankRecMappingHint: "Column mapping — optional with the generic adapters",
  treasuryBankRecMappingDate: "Date column",
  treasuryBankRecMappingAmount: "Amount column",
  treasuryBankRecMappingReference: "Reference column",
  treasuryBankRecMappingDescription: "Description column",
  treasuryBankRecImportBtn: "Import statement",
  treasuryBankRecImportedToast: "Statement imported.",
  treasuryBankRecStatementsTitle: "Bank statements",
  treasuryBankRecColFile: "File",
  treasuryBankRecColPeriod: "Period",
  treasuryBankRecColLines: "Lines",
  treasuryBankRecColImportedAt: "Imported at",
  treasuryBankRecStatusImported: "Imported",
  treasuryBankRecStatusReconciled: "Reconciled",
  treasuryBankRecOpeningBalance: "Opening balance",
  treasuryBankRecClosingBalance: "Closing balance",
  treasuryBankRecSelectStatement: "Select a statement to work on its lines.",
  treasuryBankRecLinesTitle: "Statement lines",
  treasuryBankRecColLineNo: "Line",
  treasuryBankRecColMatchState: "Match state",
  treasuryBankRecMatched: "Matched",
  treasuryBankRecUnmatched: "Unmatched",
  treasuryBankRecMatchAuto: "Auto",
  treasuryBankRecMatchManual: "Manual",
  treasuryBankRecAutoMatchBtn: "Auto-match",
  treasuryBankRecAutoMatchToast: "Matched {count} line(s).",
  treasuryBankRecManualMatch: "Manual match",
  treasuryBankRecMatchMovement: "Matched movement",
  treasuryBankRecUnmatchBtn: "Remove match",
  treasuryBankRecMatchedToast: "Match updated.",
  treasuryBankRecReconcileBtn: "Reconcile statement",
  treasuryBankRecReconcileHint: "Reconciling locks the statement period for this account.",
  treasuryBankRecReconciledToast: "Reconciled — period locked.",
  treasuryBankRecAgingTitle: "Aging — unmatched",
  treasuryBankRecAgingAsOf: "Aging as of",
  treasuryBankRecUnmatchedLinesTitle: "Unmatched statement lines",
  treasuryBankRecUnmatchedMovementsTitle: "Unmatched ledger movements",
  treasuryBankRecColAgeDays: "Age (days)",
  treasuryBankRecLoadAgingBtn: "Show aging",
  treasuryBankRecCashCheckTitle: "Cash reconciliation check",
  treasuryBankRecCashCheckAsOf: "As of",
  treasuryBankRecCashCheckBtn: "Run check",
  treasuryBankRecCashCheckOk: "Cash reconciles — no difference.",
  treasuryBankRecCashCheckBroken: "Cash reconciliation difference.",
  treasuryBankRecColControlBalance: "Control balance",
  treasuryBankRecColSubledgerBalance: "Subledger balance",
  treasuryBankRecColDiffCount: "Diffs",
  treasuryBankRecFilterAccount: "Filter by cash account",
  treasuryErrAccountExists: "A cash account with this name already exists.",
  treasuryErrAccountClosed: "The cash account is CLOSED — it cannot receive new documents.",
  treasuryErrAccountNotCloseable: "This account cannot be closed in its current state.",
  treasuryErrCurrencyMismatch: "The cash account currency does not match the document currency.",
  treasuryErrTypeInvalid: "Invalid cash-account type.",
  treasuryErrInvalidAmount: "Invalid amount — must be a positive decimal.",
  treasuryErrDocState: "The document state does not allow this action.",
  treasuryErrMissingFxRate: "No exchange rate for the given date.",
  treasuryErrAllocationExceedsDoc: "Allocations exceed the document amount.",
  treasuryErrAllocationExceedsItem: "Allocation exceeds the open item's outstanding amount.",
  treasuryErrOpenItemCurrency: "The open item currency differs from the document currency.",
  treasuryErrOpenItemPartner: "The open item belongs to a different partner.",
  treasuryErrOpenItemSide: "This document type allocates only the matching side (AR for receipts, AP for payments).",
  treasuryErrPettyLimit: "Amount exceeds the petty-cash limits — use the bank path or split the payment.",
  treasuryErrCategoryTaken: "Expense category code already in use.",
  treasuryErrReceiptRequired: "A receipt attachment is required at this amount.",
  treasuryErrApprovalRequired: "The expense must be approved before payout posting.",
  treasuryErrShiftAlreadyOpen: "This cash account already has an OPEN shift.",
  treasuryErrSupervisorRequired: "Variance exceeds tolerance — supervisor id + PIN + reason required.",
  treasuryErrSupervisorPin: "Supervisor PIN not set or incorrect.",
  treasuryErrShiftReason: "A reason is required to close a shift with a variance.",
  treasuryErrStatementTooLarge: "Statement exceeds the maximum line count.",
  treasuryErrStatementFormat: "Could not parse the statement file — check the format or adapter.",
  treasuryErrStatementReconciled: "Statement already reconciled — the period is locked.",
  treasuryErrPeriodLocked: "The date falls in a reconciled statement period for this account.",
  treasuryErrMovementMatched: "The cash movement is already matched to another statement line.",

  // -- P6-T11a: partner directory ------------------------------------------------
  partnersSearchPlaceholder: "Search by name, code, or tax number…",
  partnersKindLabel: "Partner kind",
  kindCustomer: "Customer",
  kindSupplier: "Supplier",
  kindBoth: "Customer & supplier",
  partnersColCode: "Code",
  partnersColCreditLimit: "Credit limit",
  partnersEmpty: "No partners yet — create the first one.",
  partnersNewButton: "New partner",
  partnerFormTitleCreate: "Create a partner",
  partnerCodeLabel: "Partner code",
  partnerCodeHint: "Leave empty for auto-numbering (P-000001).",
  partnerNameLabel: "Name (English)",
  partnerNameArLabel: "Name (Arabic)",
  partnerTaxNumberLabel: "Tax number",
  partnerCreditTermsLabel: "Credit terms",
  partnerPriceListLabel: "Price list",
  partnerStatusLabel: "Status",
  partnerCreatedToast: "Partner created.",
  partnerSavedToast: "Changes saved.",
  partnerCodeTaken: "Partner code is already in use.",
  partnerArchivedError: "The partner is archived — it cannot be edited.",
  partnerKindChangeLabel: "Change partner kind",
  partnerKindChangedToast: "Partner kind changed.",
  partnerKindImmutable: "The kind cannot change once posted entries exist.",
  partnerArchiveButton: "Archive partner",
  partnerArchiveConfirmTitle: "Confirm partner archive",
  partnerArchiveConfirmBody: "The archived partner disappears from new lists. Continue?",
  partnerArchivedToast: "Partner archived.",
  partnerTabOverview: "Overview",
  partnerContactsTitle: "Contacts",
  partnerContactNameLabel: "Name",
  partnerContactPhoneLabel: "Phone",
  partnerContactEmailLabel: "Email",
  partnerContactRoleLabel: "Role",
  partnerContactPrimaryLabel: "Primary",
  partnerContactAdd: "Add contact",
  partnerContactsEmpty: "No contacts.",
  partnerAddressesTitle: "Addresses",
  addressTypeLabel: "Address type",
  addressTypeBilling: "Billing",
  addressTypeShipping: "Shipping",
  addressTypeOther: "Other",
  partnerAddressLine1Label: "Address line 1",
  partnerAddressLine2Label: "Address line 2",
  partnerAddressCityLabel: "City",
  partnerAddressCountryLabel: "Country code (2 letters)",
  partnerAddressAdd: "Add address",
  partnerAddressesEmpty: "No addresses.",
  partnerBalanceTitle: "Balance",
  partnerBalanceOpenAmount: "Opening draft",
  partnerBalanceDraftLabel: "Draft balance",
  partnerBalanceOverdueLabel: "Overdue",
  partnerBalanceDraftBadge: "Drafts only",
  partnerBalanceDraftNote: "Balances at this phase derive from opening-balance DRAFTs only — nothing is posted yet (posting lands with accounting).",

  // -- P6-T11a: item master ----------------------------------------------------------
  itemsSearchPlaceholder: "Search by name or SKU…",
  itemsFilterCategoryLabel: "Category",
  categoryLabel: "Category",
  itemsColSku: "Item SKU",
  itemsColBasePrice: "Base price",
  itemsEmpty: "No items yet — create the first one.",
  itemsNewButton: "New item",
  itemFormTitleCreate: "Create an item",
  itemFormTitleEdit: "Item details",
  itemSkuLabel: "Item SKU",
  itemNameLabel: "Name (English)",
  itemNameArLabel: "Name (Arabic)",
  itemKindLabel: "Item kind",
  kindStock: "Stock",
  kindService: "Service",
  kindComposite: "Composite",
  itemUomLabel: "Unit of measure",
  itemCostingLabel: "Costing method",
  costingWac: "Weighted average (WAC)",
  costingFifo: "First-in first-out (FIFO)",
  itemTrackingLabel: "Tracking",
  itemTrackBatch: "Track batches",
  itemTrackSerial: "Serial numbers",
  itemTrackImei: "IMEI",
  itemHasExpiry: "Has expiry",
  itemExpiryRequiresBatch: "Expiry requires batch tracking — batch tracking was enabled automatically.",
  itemReorderLevelLabel: "Reorder level",
  itemReorderQtyLabel: "Reorder quantity",
  itemBasePriceLabel: "Base price",
  itemCreatedToast: "Item created.",
  itemSavedToast: "Changes saved.",
  itemSkuTaken: "Item SKU is already in use.",
  itemArchivedError: "The item is archived — it cannot be edited.",
  itemArchiveButton: "Archive item",
  itemArchiveConfirmTitle: "Confirm item archive",
  itemArchiveConfirmBody: "The archived item disappears from new documents. Continue?",
  itemArchivedToast: "Item archived.",
  barcodesTitle: "Barcodes",
  barcodeCodeLabel: "Barcode",
  barcodeAdd: "Add barcode",
  barcodesEmpty: "No barcodes.",
  barcodeTaken: "Barcode already in use (tenant-wide scan-unique).",

  // -- P6-T11a: price lists -----------------------------------------------------------
  priceListCreateTitle: "New price list",
  priceListsListTitle: "Lists",
  priceListNameLabel: "Name (English)",
  priceListNameArLabel: "Name (Arabic)",
  priceListKindLabel: "List kind",
  priceListKindSale: "Sale",
  priceListKindPurchase: "Purchase",
  priceListCurrencyLabel: "Currency",
  priceListValidFromLabel: "Valid from (optional)",
  priceListValidToLabel: "Valid to (optional)",
  priceListCreateSubmit: "Create list",
  priceListSelectHint: "Select a list in the table to edit its rows.",
  priceListRowsTitle: "List rows",
  priceListRowItemLabel: "Item",
  priceListRowUomLabel: "Unit of measure",
  priceListRowPriceLabel: "Unit price",
  priceListRowMinQtyLabel: "Minimum quantity",
  priceListRowAdd: "Add row",
  priceListRowAddedToast: "Row added.",
  priceListRowsEmpty: "No rows yet — add the first price.",
  priceListsEmpty: "No price lists yet.",
  priceListColValidLabel: "Period",
  priceListCreatedToast: "Price list created.",
  priceListCurrencySar: "Saudi riyal (SAR)",

  // -- P6-T11a: import & export wizard ---------------------------------------------------
  importStep1Title: "File & kind",
  importDataKindLabel: "Data kind",
  importKindPartners: "Partners",
  importKindItems: "Items",
  importKindOpeningBalances: "Opening balances",
  importFormatLabel: "Format",
  importCarrierLabel: "Upload carrier partner",
  importCarrierHint: "The import file is uploaded through the selected partner's attachment slot — this is this phase's direct-upload pattern.",
  importFileLabel: "File",
  importFileHint: "CSV or XLSX up to 8 MB and at most 5000 rows.",
  importSubmitPreview: "Upload & preview",
  importStep2Title: "Preview",
  importColTotal: "Total rows",
  importColValid: "Valid",
  importColInvalid: "Invalid",
  importColDuplicates: "Duplicates",
  importCommit: "Apply import",
  importCommitToast: "Import applied.",
  importCommitFailed: "Commit failed — check the job status.",
  importStep3Title: "Applied",
  importCommittedRows: "Applied {count} rows.",
  importColRow: "Row",
  importColPreview: "Preview",
  importColErrors: "Errors",
  importColWarnings: "Warnings",
  importRowValid: "Valid",
  importRowError: "Error",
  importRowDuplicate: "Duplicate",
  importRowWarning: "Warning",
  importPreviewEmpty: "The file has no rows.",
  importNewJob: "New import",
  importCarrierRequired: "Pick a carrier partner first.",
  importFileRequired: "Choose a file first.",
  importFileTooLarge: "The file exceeds the 8MB limit.",
  importFileTypeInvalid: "Unsupported type — CSV or XLSX only.",
  importUploadFailed: "Could not upload the file to storage.",
  importFormatCsv: "CSV",
  importFormatXlsx: "XLSX (Excel)",
  importJobsColCreated: "Created",
  importJobsTitle: "Import jobs",
  importJobsEmpty: "No import jobs.",
  importJobColRows: "Rows",
  importStatusPreviewing: "Previewing",
  importStatusPreviewReady: "Ready to apply",
  importStatusCommitting: "Committing",
  importStatusCommitted: "Committed",
  importStatusFailed: "Failed",
  importErrorFileInvalid: "Invalid file — check the format and the bounds.",
  // -- PHASE-040 (T-08): the data import & migration hub ---------------------
  toolkitTitle: "Data import & migration",
  toolkitSubtitle: "Upload your file, map the columns, preview with zero writes, then apply — from QuickBooks, Odoo, or a plain Excel file.",
  toolkitTabWizard: "Import wizard",
  toolkitTabJobs: "Jobs history",
  toolkitTabMappings: "Saved mappings",
  toolkitTabAdapters: "Migration adapters",
  toolkitStepKindTitle: "1. Data kind",
  toolkitStepKindHint: "Pick what you are bringing in — every kind has its canonical columns and rules.",
  toolkitStepFileTitle: "2. The file",
  toolkitFilePick: "Choose a CSV or XLSX file",
  toolkitUploadAndAnalyze: "Upload & analyze columns",
  toolkitAnalyzing: "Analyzing…",
  toolkitKindFormats: "Accepted formats",
  toolkitRequiredOption: "Required option",
  toolkitBudgetPick: "Target budget (draft)",
  toolkitBudgetRequired: "The budget grid kind needs a DRAFT budget selected first.",
  toolkitGridKindNote: "This kind rides the standard period grid (PHASE-028) — no column mapping needed.",
  toolkitPiiNote: "Contains personal data",
  toolkitStepMapTitle: "3. Column mapping",
  toolkitStepMapHint: "Match every canonical column to a file column — auto-detect proposes, you approve or adjust.",
  toolkitColCanonical: "Canonical column",
  toolkitColHeader: "File column",
  toolkitColRequired: "Required",
  toolkitColOptional: "Optional",
  toolkitColType: "Type",
  toolkitMapEmpty: "No columns mapped yet.",
  toolkitAutoDetected: "Auto-detected mapping",
  toolkitSampleTitle: "First rows of the file (preview)",
  toolkitUnmappedHeaders: "Unmapped file columns",
  toolkitSaveMappingName: "Saved-mapping name",
  toolkitSaveMappingBtn: "Save this mapping for reuse",
  toolkitMappingSaveToast: "Mapping saved.",
  toolkitStepReviewTitle: "4. Preview & apply",
  toolkitRunDryRun: "Run the dry-run (zero writes)",
  toolkitDryRunRunning: "Validating rows…",
  toolkitReportUnmapped: "Required canonical columns left unmapped",
  toolkitCommitAckLabel: "I acknowledge invalid/duplicate rows and want to apply the valid ones only",
  toolkitCommitAckHint: "The apply is atomic: all valid rows in one shot or nothing at all (BR-066).",
  toolkitCommitBtn: "Apply import",
  toolkitCommitting: "Applying…",
  toolkitCommitFailed: "The apply failed — zero rows written (you can retry).",
  toolkitCommittedTitle: "Import applied",
  toolkitCommittedSummary: "{count} rows applied successfully.",
  toolkitErrorExportBtn: "Download the error report (AR/EN)",
  toolkitStartNew: "New import",
  toolkitJobsTitle: "Import jobs history",
  toolkitJobsEmpty: "No jobs yet.",
  toolkitJobsColFile: "File",
  toolkitJobsRefresh: "Refresh",
  toolkitMappingsTitle: "Saved mappings",
  toolkitMappingsEmpty: "No saved mappings yet — create one from the column-mapping step.",
  toolkitMappingColName: "Name",
  toolkitMappingColKind: "Kind",
  toolkitMappingColDirection: "Direction",
  toolkitMappingColUpdated: "Last updated",
  toolkitMappingDirectionImport: "Import",
  toolkitMappingDirectionExport: "Export",
  toolkitMappingDeleteBtn: "Delete",
  toolkitMappingDeletedToast: "Mapping deleted.",
  toolkitAdaptersTitle: "Migration adapters from other systems",
  toolkitAdaptersHint: "Download the CSV template matching your system, export your data into it, then import through the wizard — every column mapping is documented.",
  toolkitAdapterColSource: "Source system",
  toolkitAdapterColTarget: "Target kind",
  toolkitAdapterColFormat: "Format",
  toolkitAdapterTemplateBtn: "Download template",
  toolkitAdapterEngineConsole: "Imports through the baseline inventory console",
  toolkitAdapterRequiresVerification: "Requires verification",
  toolkitErrKindUnknown: "Unknown import kind.",
  toolkitErrFileInvalid: "Invalid file — check the format and size bounds.",
  toolkitErrJobNotFound: "The import job does not exist.",
  toolkitErrCommitConflict: "The job is already committing.",
  toolkitErrNotPreviewed: "No previewed rows to apply.",
  toolkitErrOptionsMissing: "A required option is missing.",
  toolkitErrBudgetInvalid: "The budget is not importable (drafts only).",
  toolkitErrMappingInvalid: "Invalid column mapping.",
  toolkitErrDemoRefused: "Demo seeding refused — this tenant carries posted real documents.",
  // -- PHASE-040 (T-06/T-09): the one-click demo data -----------------------
  demoDataTitle: "Start with realistic demo data",
  demoDataHint: "One click seeds partners, items, posted invoices, receipts, and full GL journals for your industry — ideal for trials and demos.",
  demoDataTemplateLabel: "Industry template",
  demoDataSeedBtn: "Seed demo data",
  demoDataSeeding: "Seeding…",
  demoDataSeededBadge: "Seeded",
  demoDataSeededAt: "Seeded at",
  demoDataDoneTitle: "Demo data seeded",
  demoDataSummaryLine: "Partners: {partners} · Items: {items} · Invoices: {invoices} · Receipts: {receipts} — all through the posting engine.",
  demoDataRefused: "Seeding refused — there may be posted real documents, or a prior seed with another template.",
  onboardingImportDataCta: "Import your data from your previous system",
  onboardingImportDataHint: "Chart of accounts, opening balances, assets, employees, price lists, contracts — from QuickBooks, Odoo, or Excel.",
  onboardingDemoDataCta: "Or start with ready-made demo data",
  exportTitle: "Export",
  exportHint: "Immediate export up to 10,000 rows — returns a temporary download link.",
  exportSubmit: "Export",
  exportDone: "Export ready — {rows} rows.",
  exportRows: "Row count",
  exportDownloadLabel: "Download the file",
  exportExpiresNote: "The link is valid for {seconds} seconds.",

  // -- P6-T11a: opening balances (DRAFT only) ------------------------------------------
  obTabPartner: "Partner",
  obTabAccount: "Account",
  obTabStock: "Stock",
  obCreateTitle: "Create opening balance (draft)",
  obAmountLabel: "Amount",
  obNoteLabel: "Note",
  obQtyLabel: "Quantity",
  obUnitCostLabel: "Unit cost",
  obAccountLabel: "Account id",
  obAccountHint: "The full account tree lands with accounting (PHASE-007) — enter the current account id.",
  obCreateSubmit: "Create draft",
  obEmpty: "No drafts yet.",
  obListTitle: "Current drafts",
  obDraftOnlyNote: "No posting at this phase — every opening balance is created as a DRAFT only.",
  obCreatedToast: "Draft created.",
  obColTarget: "Target",
  obColAmount: "Amount",
  obColQty: "Quantity",
  obColNote: "Note",
  obQtyAtCostLabel: "{qty} × {cost}",
  obTargetUnknown: "Unknown target",
  obDuplicateError: "A draft already exists for this target — one draft per target.",

  // -- P6-T11a: attachments --------------------------------------------------------------
  attachmentsTitle: "Attachments",
  attachmentIssueFormTitle: "Issue an upload slot",
  attachmentFilenameLabel: "Filename",
  attachmentContentTypeLabel: "Content type",
  attachmentSizeLabel: "Size (bytes)",
  attachmentTypePdf: "PDF",
  attachmentTypePng: "PNG",
  attachmentTypeJpeg: "JPEG",
  attachmentTypeWebp: "WebP",
  attachmentTypeCsv: "CSV",
  attachmentIssueButton: "Issue upload link",
  attachmentIssuedTitle: "Issued upload URL",
  attachmentIssuedHint: "PUT the file to the URL above within {seconds} seconds of issuance — direct browser upload completes with the full files module.",
  attachmentIssuedToast: "Upload link issued.",
  attachmentUrlLabel: "URL",
  attachmentKeyLabel: "Storage key",
  attachmentExpiresLabel: "Expires in (seconds)",
  attachmentsEmpty: "No attachments.",
  attachmentDownloadLabel: "Download",
  attachmentIssueFailed: "Could not issue the upload link.",

  // -- P6-T11a: pickers + command-menu remote groups ---------------------------------------
  partnerPickerPlaceholder: "Select a partner…",
  itemPickerPlaceholder: "Select an item…",
  pickerEmptyText: "No matches",
  commandGroupPartners: "Partners",
  commandGroupItems: "Items",

  // -- T15-UI: PHASE-009 tax screens --------------------------------------------------------
  taxCodesTitle: "Tax codes",
  taxCodesEmpty: "No tax codes yet — create the first one.",
  taxCodesCode: "Code",
  taxCodesName: "Name (English)",
  taxCodesNameAr: "Name (Arabic)",
  taxCodesCountry: "Country",
  taxCodesTreatment: "Tax treatment",
  taxCodesUsage: "Usage",
  taxCodesCreateTitle: "Create a tax code",
  taxCodesCreatedToast: "Tax code created.",
  taxCodesArchive: "Archive code",
  taxCodesArchiveConfirm: "The archived code disappears from new documents. Continue?",
  taxCodesArchiveBlocked: "Cannot archive a code referenced by items or categories — reassign them first.",
  taxCodesArchivedToast: "Tax code archived.",
  taxTreatmentStandardRated: "Standard rated",
  taxTreatmentZeroRated: "Zero rated",
  taxTreatmentExempt: "Exempt",
  taxTreatmentOutOfScope: "Out of scope",
  taxTreatmentReverseCharge: "Reverse charge",
  taxTreatmentNotSubject: "Not subject",
  taxResolveTitle: "Tax resolution preview",
  taxResolveDate: "Document date",
  taxResolveAmount: "Amount",
  taxResolveCode: "Tax code",
  taxResolveAction: "Resolve",
  taxResolveTreatment: "Treatment",
  taxResolveRate: "Rate",
  taxResolveBase: "Tax base",
  taxResolveTax: "Tax",
  taxResolveGross: "Gross (incl. tax)",
  taxResolveNotSubject: "This line is not subject to tax — no tax is computed.",
  taxResolveBoundaryWarning:
    "Boundary warning (BR-033): a rate of {rate} takes effect on {date} — drafts spanning the boundary are warned on open; posted snapshots never move.",
  taxRegistrationsTitle: "Tax registrations",
  taxRegistrationsEmpty: "No tax registrations yet.",
  taxRegistrationsStatus: "Registration status",
  taxRegistrationsNumber: "Tax registration number",
  taxRegistrationsEffectiveFrom: "Effective from",
  taxRegistrationsEffectiveTo: "Effective to",
  taxRegistrationsRegistered: "Registered",
  taxRegistrationsNotRegistered: "Not registered",
  taxRegistrationsDeregistered: "Deregistered",
  taxRegistrationsCreateTitle: "Update registration status",
  taxRegistrationsSavedToast: "Tax registration saved.",
  einvoicingTitle: "E-invoicing",
  einvoicingSubtitle: "Submission registry status — the sole source of authority truth",
  einvoicingRegistryTitle: "Submission log",
  einvoicingStatus: "Status",
  einvoicingDocument: "Document",
  einvoicingAdapter: "Adapter",
  einvoicingAttempts: "Attempts",
  einvoicingAuthorityRef: "Authority reference",
  einvoicingLastError: "Last error",
  einvoicingSubmittedAt: "Submitted at",
  einvoicingEmpty: "No submissions yet — adapters are OFF by default until certificates are provisioned.",
  einvoicingAdaptersTitle: "Adapters",
  einvoicingAdaptersUnverifiedNote: "UNVERIFIED adapter: refuses real submissions until the verification gate passes (no compliance claim without evidence).",
  einvoicingRegimeVerified: "Regime verified",
  einvoicingRegimeUnverified: "Unverified",
  einvoicingCertsTitle: "Certificates",
  einvoicingCertLabel: "Label",
  einvoicingCertFingerprint: "Fingerprint",
  einvoicingCertValidUntil: "Valid until",
  einvoicingCertStatus: "Status",
  einvoicingCertSignCount: "Signature count",
  einvoicingCertsEmpty: "No certificates enrolled.",
  einvoicingResubmit: "Resubmit",
  einvoicingResubmitDone: "New submission created — the previous row stays in history.",
  einvoicingStatusPending: "Pending",
  einvoicingStatusGenerated: "Generated",
  einvoicingStatusSigned: "Signed",
  einvoicingStatusSubmitted: "Submitted",
  einvoicingStatusAccepted: "Accepted",
  einvoicingStatusRejected: "Rejected",
  einvoicingStatusReported: "Reported",
  einvoicingStatusFailed: "Failed",
  einvoicingFunnelTitle: "E-invoicing funnel",
  einvoicingFunnelSubtitle: "Operations monitoring — submissions, latency, rejection reasons",
  einvoicingFunnelByState: "Submissions by state",
  einvoicingFunnelLatency: "Latency",
  einvoicingFunnelRejectionReasons: "Rejection reasons",
  einvoicingFunnelDeadLetter: "Dead letters",
  einvoicingFunnelRejectRate: "Rejection rate (15 min)",
  einvoicingFunnelNoData: "No data yet.",
  // WEB-037 (PHASE-037) — ZATCA Phase-1 device registry (EN mirror).
  zatcaNavLabel: "ZATCA devices",
  zatcaDevicesTitle: "ZATCA e-invoicing devices",
  zatcaDevicesSubtitle:
    "The EIAS device registry — Phase-1 QR generation with a per-device hash chain and ICV counter.",
  zatcaDevicesDevicesTab: "Devices",
  zatcaDevicesChainTab: "Chain & verification",
  zatcaDevicesBackfillTab: "Backfill",
  zatcaDevicesPhase2Note:
    "Phase-1 (QR generation) only — clearance/reporting and CSID registration with ZATCA are a later phase (PHASE-054) and deliberately not implemented here.",
  zatcaDevicesDeviceName: "Device name",
  zatcaDevicesDeviceNameAr: "Arabic name",
  zatcaDevicesDeviceUuid: "Device UUID",
  zatcaDevicesDeviceUuidHint: "The device's unique ID at ZATCA — optional in Phase-1.",
  zatcaDevicesDeviceSerial: "Device serial",
  zatcaDevicesProviderName: "Solution provider",
  zatcaDevicesProviderVat: "Solution provider VAT",
  zatcaDevicesProviderVatHint: "15 digits — the VAT number of the e-invoicing solution provider.",
  zatcaDevicesProviderVatInvalid: "The solution-provider VAT must be exactly 15 digits.",
  zatcaDevicesBranch: "Branch",
  zatcaDevicesBranchAny: "No branch",
  zatcaDevicesNote: "Note",
  zatcaDevicesOptional: "optional",
  zatcaDevicesNameRequired: "Device name is required.",
  zatcaDevicesCreateDevice: "New device",
  zatcaDevicesEditDevice: "Edit device",
  zatcaDevicesSaveDevice: "Save device",
  zatcaDevicesCancelEdit: "Cancel edit",
  zatcaDevicesDeleteDisabled: "Devices cannot be deleted — each device anchors an ICV stamp chain and deleting it would break the audit trail.",
  zatcaDevicesEmpty: "No devices yet — create an EIAS device to start stamping invoices with QR.",
  zatcaDevicesColName: "Device",
  zatcaDevicesColStatus: "Registration",
  zatcaDevicesColCounter: "ICV counter",
  zatcaDevicesColDeviceUuid: "UUID",
  zatcaDevicesColSerial: "Serial",
  zatcaDevicesColBranch: "Branch",
  zatcaDevicesColCreatedAt: "Created",
  zatcaDevicesStatusPlaceholder: "Not registered yet — Phase-2 CSID registration comes later",
  zatcaDevicesIcvCounter: "ICV counter",
  zatcaDevicesChainHead: "Chain head (highest ICV)",
  zatcaDevicesPickDevice: "Pick a device",
  zatcaDevicesPickDeviceFirst: "Pick a device to view its chain.",
  zatcaDevicesChainTitle: "Stamped invoice chain",
  zatcaDevicesChainEmpty: "No stamped invoices on this device yet.",
  zatcaDevicesChainColInvoice: "Invoice",
  zatcaDevicesChainColIcv: "ICV",
  zatcaDevicesChainColPih: "PIH (previous hash)",
  zatcaDevicesChainColHash: "Invoice hash",
  zatcaDevicesChainColHashVersion: "Hash version",
  zatcaDevicesChainColQr: "QR",
  zatcaDevicesChainColClassification: "Classification",
  zatcaDevicesChainColPosted: "Posted",
  zatcaDevicesChainColAmount: "Total",
  zatcaDevicesClassificationStandard: "Standard",
  zatcaDevicesClassificationSimplified: "Simplified",
  zatcaDevicesClassificationNone: "Unclassified",
  zatcaDevicesQrPresent: "Present",
  zatcaDevicesQrMissing: "Missing",
  zatcaDevicesGenesisPih: "The first invoice carries the genesis PIH — it has no predecessor.",
  zatcaDevicesHashTruncated: "Truncated for display — the full value is stored in the record.",
  zatcaDevicesVerificationTitle: "Chain verification",
  zatcaDevicesVerificationOk: "Chain verified",
  zatcaDevicesVerificationChecked: "Invoices checked: {checked}",
  zatcaDevicesVerificationFailed: "Verification FAILED — the chain is broken",
  zatcaDevicesVerificationFailureIcv: "At ICV",
  zatcaDevicesVerificationFailureReason: "Reason",
  zatcaDevicesVerifyNow: "Verify again",
  zatcaDevicesVerifyDone: "Verification complete — the chain holds.",
  zatcaDevicesBackfillTitle: "Stamp backfill",
  zatcaDevicesBackfillPlan: "Dry-run plan",
  zatcaDevicesBackfillPlanNote: "Posted invoices not yet stamped that would attach to this device.",
  zatcaDevicesBackfillDryRunNote: "Dry-run first — nothing is written before you confirm",
  zatcaDevicesBackfillLimit: "Limit",
  zatcaDevicesBackfillCandidates: "Candidates",
  zatcaDevicesBackfillColInvoice: "Invoice",
  zatcaDevicesBackfillColPosted: "Posted",
  zatcaDevicesBackfillColGross: "Total gross",
  zatcaDevicesBackfillStampable: "Stampable: {count}",
  zatcaDevicesBackfillRun: "Run stamping",
  zatcaDevicesConfirmBackfill:
    "Up to {count} invoices will be stamped onto this device and its ICV counter advanced — continue?",
  zatcaDevicesBackfillStamped: "Stamped: {stamped}",
  zatcaDevicesBackfillSkipped: "Skipped: {skipped}",
  zatcaDevicesBackfillEmpty: "No unstamped posted invoices — nothing to backfill.",
  zatcaDevicesBackfillResults: "Run results",
  zatcaDevicesBackfillColIcv: "ICV minted",
  zatcaDevicesIssuanceOrder: "In issuance order (posted_at, then created_at, then id).",
  zatcaDevicesIdempotentNote: "The run is idempotent and resumable — already-stamped rows are skipped automatically.",
  zatcaDevicesBackfillRequiresVat:
    "Stamping failed: ZATCA stamps require an active Saudi VAT registration (the seller number inside the QR).",
  zatcaDevicesCreateSuccess: "Device created — status: not registered (Phase-1).",
  zatcaDevicesUpdateSuccess: "Device changes saved.",
  zatcaDevicesBackfillSuccess: "Backfill complete.",
  zatcaDevicesErrorsGeneric: "The ZATCA action could not be completed — try again.",
  taxPacksTitle: "Jurisdiction packs",
  taxPacksEmpty: "No seeded packs.",
  taxPacksCountry: "Country",
  taxPacksVatStatus: "VAT status",
  taxPacksVatInForce: "In force",
  taxPacksVatPlanned: "Planned",
  taxPacksVatNoVat: "No VAT",
  taxPacksVersion: "Pack version",
  taxPacksVerification: "Verification",
  taxPacksVerified: "Verified",
  taxPacksRequiresVerification: "Requires verification",
  taxPacksRate: "Rate",
  taxPacksEffectiveFrom: "Effective from",
  taxPacksEffectiveTo: "Effective to",
  taxPacksSource: "Source ref",
  taxPacksWindowsTitle: "Rate windows",
  taxPacksNoRates: "No rate windows for this pack.",
  taxPacksApply: "Pin version",
  taxPacksApplied: "Pack version pinned for this workspace.",
  taxPacksBinding: "Pinned version (workspace)",
  taxPacksBindingNone: "No pin — the seeded version applies automatically.",
  taxPacksPreviewNote:
    "Upgrading a pack never rewrites posted snapshots — new windows apply to new documents only (BR-033).",
  vatReturnTitle: "VAT return",
  vatReturnEmpty: "No VAT returns yet.",
  vatReturnCountry: "Country",
  vatReturnPeriod: "Period",
  vatReturnPeriodStart: "Period start",
  vatReturnPeriodEnd: "Period end",
  vatReturnStatus: "Status",
  vatReturnDraft: "Draft",
  vatReturnReady: "Ready",
  vatReturnFiled: "Filed",
  vatReturnCreateTitle: "Create a VAT return",
  vatReturnCreatedToast: "VAT return created.",
  vatReturnPrepare: "Prepare return",
  vatReturnPreparedToast: "VAT return prepared.",
  vatReturnMarkFiled: "Mark as filed",
  vatReturnFiledToast: "VAT return marked as filed.",
  vatReturnFilingReference: "Filing reference",
  vatReturnFilingNote: "Filing note",
  vatReturnExport: "Export",
  vatReturnExportCsv: "Export CSV",
  vatReturnExportXlsx: "Export XLSX",
  vatReturnSummaryTitle: "Period summary by treatment",
  vatReturnDirection: "Direction",
  vatReturnDirectionOutput: "Output",
  vatReturnDirectionInput: "Input",
  vatReturnTaxableBase: "Taxable base",
  vatReturnTaxAmount: "Tax amount",
  vatReturnCrossCheck: "General-ledger cross-check",
  vatReturnDocumentSide: "Document side",
  vatReturnGlSide: "General ledger side",
  vatReturnOutputTax: "Output tax",
  vatReturnInputTax: "Input tax (recoverable)",
  vatReturnInputTaxExpensed: "Input tax (expensed)",
  vatReturnMismatch:
    "Cross-check failed (INV-012) — document totals differ from the general ledger; filing stays blocked until both sides agree.",
  vatReturnReadyNote: "Return is ready — the ledger cross-check agrees",
  taxErrCodeTaken: "This tax code already exists for this country.",
  taxErrCodeInUse: "The code is referenced by items or categories — reassign them first.",
  taxErrCodeArchived: "The tax code is archived and cannot be assigned to new documents.",
  taxErrRegistrationNumber:
    "A registration number (3–50 characters) is required while the status is “Registered” and rejected otherwise.",
  taxErrJurisdiction: "No seeded pack exists for this country.",
  taxErrNoRateForDate: "No seeded rate covers this date — resolution fails closed, never guessing.",
  taxErrWindowTaken: "A return for this period already exists.",
  taxErrCrossCheck: "The general-ledger cross-check failed — review the differences, then re-prepare.",
  taxErrState: "The VAT return's state does not allow this action.",
  taxErrAlreadyFiled: "The VAT return is filed and immutable.",
  taxErrPackBinding: "That pack version is not seeded — upgrades ship as seed migrations only.",

  // -- T14-UI (PHASE-010): inventory & warehousing --------------------------------
  navInventoryWarehouses: "Warehouses",
  navInventoryStock: "Stock on hand",
  navInventoryMoves: "Stock movements",
  navInventoryTransfers: "Stock transfers",
  navInventoryCounts: "Stock counting",
  warehousesTitle: "Warehouses",
  warehousesEmpty: "No warehouses yet.",
  warehousesCreateTitle: "Create warehouse",
  warehousesCodeLabel: "Warehouse code",
  warehousesNameLabel: "Name (English)",
  warehousesNameArLabel: "Name (Arabic)",
  warehousesBranchLabel: "Branch",
  warehousesGlAccountLabel: "GL inventory account (optional)",
  warehousesNoteLabel: "Note",
  warehousesCreatedToast: "Warehouse created.",
  warehousesDeactivate: "Deactivate",
  warehousesDeactivateTitle: "Deactivate warehouse",
  warehousesDeactivateConfirm:
    "Deactivating blocks new movements on this warehouse; movement history is preserved.",
  warehousesDeactivatedToast: "Warehouse deactivated.",
  warehousesReactivate: "Reactivate",
  warehousesReactivatedToast: "Warehouse reactivated.",
  warehousesColCode: "Code",
  warehousesColBranch: "Branch",
  warehousesColGlAccount: "GL account",
  stockTitle: "Stock on hand",
  stockEmpty: "No stock rows yet.",
  stockFilterWarehouse: "Warehouse",
  stockColItem: "Item",
  stockColWarehouse: "Warehouse",
  stockColQty: "Quantity",
  stockColAvgCost: "Average cost",
  stockNegativeBadge: "negative",
  movesTitle: "Stock movements",
  movesEmpty: "No stock movements yet.",
  movesFilterDirection: "Direction",
  movesFilterKind: "Move kind",
  movesColDate: "Date",
  movesColDirection: "Direction",
  movesColKind: "Kind",
  movesColUnitCost: "Unit cost",
  movesColValue: "Value",
  movesColReason: "Reason",
  movesColBatch: "Batch",
  movesColSerial: "Serial",
  movesColSource: "Source",
  movesDirectionIn: "IN",
  movesDirectionOut: "OUT",
  movesKindReceipt: "Receipt",
  movesKindIssue: "Issue",
  movesKindTransferIn: "Transfer in",
  movesKindTransferOut: "Transfer out",
  movesKindAdjust: "Adjustment",
  movesReasonDamage: "Damage",
  movesReasonExpired: "Expired",
  movesReasonCountLoss: "Count loss",
  movesReasonCountGain: "Count gain",
  movesReasonCustomerReturn: "Customer return",
  movesReasonOther: "Other",
  // PHASE-035 (T-02): the batch & expiry registry
  batchesTitle: "Batches & expiry",
  batchesEmpty: "No batches registered",
  batchesSearchLabel: "Search (SKU / batch no / ref)",
  batchesFilterExpired: "Expiry",
  batchesExpiredOnly: "Expired only",
  batchesExpiredBadge: "expired",
  batchesColNo: "Batch no",
  batchesColExpiry: "Expiry date",
  batchesColSource: "Source ref",
  batchesStatusActive: "Active",
  batchesStatusWrittenOff: "Written off",
  batchesNewTitle: "Register batch",
  batchesItemLabel: "Item",
  batchesNoLabel: "Batch no",
  batchesExpiryLabel: "Expiry date",
  batchesSourceLabel: "Source ref (optional)",
  batchesCreate: "Register",
  batchesCreatedToast: "Batch registered",
  batchesWriteOff: "Write off expiry",
  batchesWriteOffTitle: "Write off batch",
  batchesWriteOffHint: "Writes the batch's full on-hand off with one EXPIRED expense journal",
  batchesWriteOffDate: "Value date",
  batchesWriteOffConfirm: "Confirm write-off",
  batchesWriteOffCancel: "Cancel",
  batchesWrittenOffToast: "Batch written off and journal posted",
  // PHASE-035 (T-03): the serial/IMEI registry
  serialsTitle: "Serial numbers",
  serialsEmpty: "No serials registered",
  serialsSearchLabel: "Search (SKU / serial / IMEI)",
  serialsFilterStatus: "Status",
  serialsColNo: "Serial no",
  serialsColImei: "IMEI",
  serialsColSoldAt: "Sold at",
  serialsColReturnedAt: "Returned at",
  serialsStatusInStock: "In stock",
  serialsStatusSold: "Sold",
  serialsStatusReturned: "Returned",
  serialsSaleView: "View sale",
  serialsNewTitle: "Register serial",
  serialsItemLabel: "Item",
  serialsNoLabel: "Serial no",
  serialsImeiLabel: "IMEI (optional)",
  serialsImeiHint: "15–17 digits",
  serialsCreate: "Register",
  serialsCreatedToast: "Serial registered",
  serialsSaleTitle: "Original sale move",
  serialsSaleClose: "Close",
  serialsSaleLoading: "Loading…",
  serialsSaleNone: "This serial has not been sold yet",
  serialsSaleUnitCost: "Unit cost",
  serialsSaleMovedAt: "Moved at",
  serialsSaleWarehouse: "Warehouse",
  // PHASE-035 (T-04): the stock-adjustments read register
  adjustmentsTitle: "Stock adjustments",
  adjustmentsEmpty: "No adjustments",
  adjustmentsSearchLabel: "Search (SKU / adjustment no / note)",
  adjustmentsFilterStatus: "Status",
  adjustmentsColNo: "Adjustment no",
  adjustmentsColItem: "Item",
  adjustmentsColDelta: "Qty delta",
  adjustmentsColPostingDate: "Posting date",
  adjustmentsColNote: "Note",
  adjustmentsStatusDraft: "Draft",
  adjustmentsStatusPosted: "Posted",
  adjustmentsStatusCancelled: "Cancelled",
  adjustmentsReadNote: "Read-only surface — adjustments are created and posted through stock-count sessions (recorded design intent).",
  transfersTitle: "Stock transfers",
  transfersEmpty: "No transfers yet.",
  transfersColNo: "Transfer no.",
  transfersColFrom: "From warehouse",
  transfersColTo: "To warehouse",
  transfersColLines: "Lines",
  transfersColDispatchDate: "Dispatched",
  transfersColReceiveDate: "Received",
  transfersStatusInTransit: "In transit",
  transfersNewTitle: "New transfer",
  transfersFromLabel: "From warehouse",
  transfersToLabel: "To warehouse",
  transfersNoteLabel: "Note",
  transfersLinesTitle: "Transfer lines",
  transfersLineItemLabel: "Item",
  transfersLineQtyLabel: "Quantity",
  transfersAddLine: "Add line",
  transfersRemoveLine: "Remove line",
  transfersSameWarehouseError: "Source and destination warehouses must differ.",
  transfersLineMissingError: "Every line needs an item and a positive quantity.",
  transfersCreatedToast: "Transfer created (draft).",
  transfersDispatch: "Dispatch",
  transfersDispatchedToast: "Transfer dispatched — stock is in transit (not sellable).",
  transfersReceive: "Receive",
  transfersReceivedToast: "Transfer received at the destination warehouse.",
  transfersCancel: "Cancel",
  transfersCancelledToast: "Transfer cancelled.",
  countingTitle: "Stock counting",
  countingEmpty: "No count sessions yet.",
  countingNewTitle: "New count session",
  countingWarehouseLabel: "Warehouse",
  countingBlindLabel: "Blind count (hide book quantities)",
  countingPickItemsTitle: "Pick items",
  countingPickSearchPlaceholder: "Search by SKU or name…",
  countingPickEmpty: "No matching items.",
  countingSelectedCount: "Selected items",
  countingCreate: "Create session",
  countingCreatedToast: "Count session created — system-qty snapshot frozen.",
  countingColNo: "Count no.",
  countingColBlind: "Blind",
  countingBlindYes: "Yes",
  countingBlindNo: "No",
  countingColVariance: "Variance",
  countingOpenSession: "Open session",
  countingCloseSession: "Close session",
  countingSnapshotAt: "Snapshot at",
  countingSessionLinesTitle: "Count lines",
  countingColLineNo: "Line",
  countingColSystemQty: "System qty",
  countingColCountedQty: "Counted qty",
  countingColDiff: "Diff",
  countingColValueImpact: "Value impact",
  countingSaveEntries: "Save counts",
  countingEntriesSavedToast: "Counted quantities saved.",
  countingSubmit: "Submit for review",
  countingSubmittedToast: "Session submitted to variance review.",
  countingReviewTitle: "Variance review",
  countingReviewHint:
    "Review variances before approval — approval posts the count adjustment (loss/gain) through the posting engine.",
  countingApprove: "Approve",
  countingApproveSupervisor: "Approve with supervisor override",
  countingApprovedToast: "Count approved and the adjustment posted.",
  countingCancel: "Cancel",
  countingCancelledToast: "Count session cancelled.",
  countingRecountTitle: "Recount line",
  countingRecountLineLabel: "Line no.",
  countingRecountNoteLabel: "Recount reason",
  countingRecountedToast: "Recount recorded with audit.",
  countingStatusCounted: "Counted",
  countingStatusVarianceReview: "Variance review",
  inventoryErrWarehouseCodeTaken: "Warehouse code is already taken.",
  inventoryErrWarehouseInactive: "Warehouse is inactive.",
  inventoryErrWarehouseNotDeactivatable: "Warehouse cannot be deactivated (movements or count sessions in flight).",
  inventoryErrItemNotStocked: "Item is not stocked at this warehouse.",
  inventoryErrInsufficientStock: "Insufficient stock (negative stock is off by default).",
  inventoryErrBatchInsufficient: "Batch quantity is insufficient.",
  inventoryErrBatchRequired: "Item tracks batches — a batch is required.",
  inventoryErrBatchTaken: "Batch number is already taken for this item.",
  inventoryErrSerialRequired: "Item tracks serials — select the units.",
  inventoryErrSerialNotInStock: "Serial unit is not in stock.",
  inventoryErrSerialTaken: "Serial number is already taken.",
  inventoryErrSerialReturnBinding: "A serial return must reference the originally sold unit.",
  inventoryErrState: "Document state does not allow this action.",
  inventoryErrTransferEmpty: "A transfer needs at least one line.",
  inventoryErrTransferSameWarehouse: "Source and destination warehouses must differ.",
  inventoryErrCountTolerance: "Variance exceeds tolerance — supervisor approval required.",
  inventoryErrMethodSwitchInFlight: "Cannot switch method with in-flight movements.",
  inventoryErrMethodSwitchInvalid: "Method switch is not valid (no balance or same method).",
  inventoryErrMethodSwitchSame: "Item already uses this method.",
  // PHASE-011 purchasing (T13-UI).
  purchasingEmpty: "No documents yet",
  purchasingNoticeCreated: "Document created",
  purchasingNoticeUpdated: "Updated",
  purchasingNoticePosted: "Posted",
  expensesColAccount: "Account",
  navPurchasingOrders: "Purchase orders",
  navPurchasingReceipts: "Goods receipts",
  navPurchasingInvoices: "Supplier invoices",
  navPurchasingDebitNotes: "Debit notes",
  navPurchasingAp: "Payables",
  purchasingOrdersTitle: "Purchasing — Purchase orders",
  purchasingReceiptsTitle: "Purchasing — Goods receipts",
  purchasingInvoicesTitle: "Purchasing — Supplier invoices",
  purchasingDebitNotesTitle: "Purchasing — Debit notes",
  purchasingApTitle: "Purchasing — Payables",
  purchasingRequestsSection: "Purchase requests",
  purchasingOrdersSection: "Purchase orders",
  purchasingNewRequest: "New purchase request",
  purchasingNewOrder: "New purchase order",
  purchasingRequestNo: "Request no.",
  purchasingNeededBy: "Needed by",
  purchasingSubmit: "Submit",
  purchasingApprove: "Approve",
  purchasingReject: "Reject",
  purchasingIssue: "Issue",
  purchasingClose: "Close",
  purchasingCancel: "Cancel",
  purchasingOrderNo: "Order no.",
  purchasingOrderDate: "Order date",
  purchasingExpectedDate: "Expected date",
  purchasingSupplier: "Supplier",
  purchasingLines: "Lines",
  purchasingAddLine: "Add line",
  purchasingRemoveLine: "Remove line",
  purchasingItem: "Item",
  purchasingQty: "Qty",
  purchasingUnitPrice: "Unit price",
  purchasingTaxCode: "Tax code",
  purchasingUnitCost: "Unit cost",
  purchasingTotalNet: "Net",
  purchasingTotalTax: "Tax",
  purchasingTotalGross: "Gross",
  purchasingStatus: "Status",
  purchasingNewReceipt: "New goods receipt",
  purchasingReceiptNo: "Receipt no.",
  purchasingReceiptDate: "Receipt date",
  purchasingWarehouse: "Warehouse",
  purchasingPo: "Purchase order",
  purchasingPoLessReason: "PO-less reason (direct purchase)",
  purchasingPost: "Post",
  purchasingBatchNo: "Batch no.",
  purchasingBatchExpiry: "Expiry date",
  purchasingNewInvoice: "New supplier invoice",
  purchasingInvoiceNo: "Supplier invoice no.",
  purchasingInvoiceDate: "Invoice date",
  purchasingDueDate: "Due date",
  purchasingInternalNo: "Internal no.",
  purchasingMatchStatus: "Match status",
  purchasingMatchPreview: "Three-way match preview",
  purchasingRecordMatch: "Record match",
  purchasingDisposition: "Disposition",
  purchasingDispositionReason: "Disposition reason",
  purchasingDispositionAccept: "Accept with reason",
  purchasingMatchOutcomeMatched: "Matched",
  purchasingMatchOutcomeException: "Exception",
  purchasingMatchOutcomeDispositioned: "Disposed",
  purchasingMatchOutcomePending: "Pending",
  purchasingQtyVariance: "Qty variance %",
  purchasingPriceVariance: "Price variance %",
  purchasingNewDebitNote: "New debit note",
  purchasingNoteNo: "Note no.",
  purchasingNoteDate: "Note date",
  purchasingRefInvoice: "Referenced invoice",
  purchasingApAging: "AP aging",
  purchasingApStatement: "Supplier statement",
  purchasingGrniRegister: "GRNI register",
  purchasingAgingNotDue: "Not due",
  purchasingAging1_30: "1–30 days",
  purchasingAging31_60: "31–60 days",
  purchasingAging61_90: "61–90 days",
  purchasingAging90Plus: "90+ days",
  purchasingAgingTotal: "Total",
  purchasingAsOf: "As of",
  purchasingOpeningBalance: "Opening balance",
  purchasingClosingBalance: "Closing balance",
  purchasingDebit: "Debit",
  purchasingCredit: "Credit",
  purchasingBalance: "Balance",
  purchasingOutstanding: "Outstanding",
  purchasingReceivedValue: "Received value",
  purchasingInvoicedValue: "Invoiced value",
  purchasingGrniRemaining: "Not invoiced",
  purchasingSelectSupplier: "Select supplier",
  purchasingSelectWarehouse: "Select warehouse",
  purchasingSelectPo: "Select purchase order",
  purchasingNoPo: "No purchase order",
  purchasingErrState: "Document state does not allow this operation",
  purchasingErrDuplicate: "Duplicate supplier invoice (number + amount)",
  purchasingErrMatchMissing: "Record the three-way match outcome first",
  purchasingErrMatchException: "Undisposed match exceptions — dispose them first",
  purchasingErrPoLess: "Policy forbids receipts without a purchase order",
  purchasingErrPoLessReason: "A PO-less reason is required",
  purchasingErrOverReceipt: "Receipt exceeds the purchase order line",
  purchasingErrOverInvoice: "Invoiced quantity exceeds the received quantity",
  purchasingErrNotSupplier: "Partner is not a supplier",
  purchasingErrGrnSupplier: "GRN line belongs to a different supplier",
  purchasingErrSelfApproval: "The document creator cannot approve it",
  purchasingErrReallocation: "Re-allocation exceeds the allowed bounds",
  // PHASE-012 sales (T13-UI).
  salesEmpty: "No documents yet",
  salesNoticeCreated: "Document created",
  salesNoticeUpdated: "Updated",
  salesNoticePosted: "Posted",
  navSalesQuotes: "Quotations",
  navSalesOrders: "Sales orders",
  navSalesDeliveries: "Delivery notes",
  navSalesInvoices: "Sales invoices",
  navSalesCreditNotes: "Credit notes",
  navSalesAr: "Receivables",
  salesQuotesTitle: "Sales — Quotations & orders",
  salesOrdersTitle: "Sales — Sales orders",
  salesDeliveriesTitle: "Sales — Delivery notes",
  salesInvoicesTitle: "Sales — Invoices",
  salesCreditNotesTitle: "Sales — Credit notes",
  salesArTitle: "Sales — Receivables",
  salesQuotesSection: "Quotations",
  salesOrdersSection: "Sales orders",
  salesStatus: "Status",
  salesStatusSent: "Sent",
  salesNewQuote: "New quotation",
  salesNewOrder: "New sales order",
  salesQuoteNo: "Quote no.",
  salesQuoteDate: "Quote date",
  salesValidUntil: "Valid until",
  salesOrderNo: "Order no.",
  salesOrderDate: "Order date",
  salesExpectedDate: "Expected date",
  salesSalesOrder: "Sales order",
  salesNoOrder: "No sales order",
  salesCustomer: "Customer",
  salesSelectCustomer: "Select customer",
  salesBranch: "Branch",
  salesSelectBranch: "Select branch",
  salesWarehouse: "Warehouse",
  salesSelectWarehouse: "Select warehouse",
  salesCurrency: "Currency",
  salesExchangeRate: "Exchange rate",
  salesItem: "Item",
  salesQty: "Qty",
  salesUnitPrice: "Unit price",
  salesDiscount: "Discount",
  salesTaxCode: "Tax code",
  salesAccount: "Account",
  salesLines: "Lines",
  salesAddLine: "Add line",
  salesRemoveLine: "Remove line",
  salesTotalNet: "Net",
  salesTotalTax: "Tax",
  salesTotalGross: "Gross",
  salesSend: "Send",
  salesAccept: "Accept & convert",
  salesReject: "Reject",
  salesSubmit: "Submit",
  salesApprove: "Approve",
  salesIssue: "Issue",
  salesClose: "Close",
  salesPost: "Post",
  salesCancel: "Cancel",
  salesCancelReason: "Cancel reason",
  salesReserve: "Reserve stock",
  salesAcceptWarehouse: "Conversion warehouse",
  salesNewDelivery: "New delivery note",
  salesDeliveryNo: "Delivery no.",
  salesDeliveryDate: "Delivery date",
  salesDelivery: "Delivery note",
  salesCogsValue: "COGS value",
  salesNewInvoice: "New sales invoice",
  salesInvoiceNo: "Invoice no.",
  salesInvoiceDate: "Invoice date",
  salesDueDate: "Due date",
  salesKind: "Invoice kind",
  salesKindCash: "Cash",
  salesKindCredit: "Credit",
  salesCashAccount: "Cash account",
  salesSelectCashAccount: "Select cash account",
  salesOverrideCredit: "Override credit block",
  salesCreditCheck: "Credit check",
  salesCreditAllow: "Allow",
  salesCreditWarn: "Warn",
  salesCreditBlock: "Block",
  salesNewCreditNote: "New credit note",
  salesNoteNo: "Note no.",
  salesNoteDate: "Note date",
  salesRefInvoice: "Referenced invoice",
  salesInvoiceLineId: "Invoice line id",
  salesReturnToStock: "Return to stock",
  salesArAging: "AR aging",
  salesArStatement: "Customer statement",
  salesArOpenItems: "Open items",
  salesOpenItemsHint: "These open items are the allocation surface consumed by receipts (FIFO / partial / on-account)",
  salesAgingNotDue: "Not due",
  salesAging1_30: "1–30 days",
  salesAging31_60: "31–60 days",
  salesAging61_90: "61–90 days",
  salesAging90Plus: "90+ days",
  salesAgingTotal: "Total",
  salesAsOf: "As of",
  salesOpeningBalance: "Opening balance",
  salesClosingBalance: "Closing balance",
  salesDebit: "Debit",
  salesCredit: "Credit",
  salesBalance: "Balance",
  salesOutstanding: "Outstanding",
  salesBaseBalance: "Base-currency balance",
  salesSubledgerTie: "AR subledger tie",
  salesTieOk: "Tied",
  salesTieBroken: "Broken",
  salesSource: "Source",
  salesAmount: "Amount",
  salesRunOverdueScan: "Overdue scan",
  salesOverdueScanDone: "Scan complete: {overdue} overdue invoices, {alerted} alerts",
  salesPrint: "Print",
  salesPrintDisabled: "Printing arrives with the reporting release (PHASE-013)",
  salesErrState: "Document state does not allow this operation",
  salesErrQuotationExpired: "The quotation expired — issue a new one",
  salesErrCreditLimit: "Credit limit exceeded (block/warn per policy)",
  salesErrReturnWindow: "Return outside the allowed return window",
  salesErrPriceChanged: "Price changed — re-open the document to recompute",
  salesErrItemInactive: "Item is inactive and cannot receive sales documents",
  salesErrDeliveryInvoiced: "Invoiced quantity exceeds the delivered quantity",
  salesErrCreditNoteExceeds: "Credit note exceeds the invoice outstanding",
  salesErrReallocation: "Re-allocation exceeds the allowed bounds",

  // -- T-WEB (PHASE-013): the report workspace (report archetype §7) --------
  navReports: "Reports",
  reportsNavWorkspace: "Reports",
  reportWorkspaceTitle: "Reports workspace",
  reportWorkspaceCatalog: "Report catalog",
  reportWorkspaceNoReport: "No report selected yet — pick one from the catalog",
  reportWorkspaceDateFrom: "From date",
  reportWorkspaceDateTo: "To date",
  reportWorkspaceAsOfLabel: "As-of date",
  reportWorkspaceLocale: "Report language",
  reportWorkspaceRun: "Run report",
  reportWorkspaceQueued: "Queued",
  reportWorkspaceRunning: "Running",
  reportWorkspaceStage: "Stage",
  reportWorkspaceStatus: "Status",
  reportWorkspaceStatusSucceeded: "Succeeded",
  reportWorkspaceStatusFailed: "Failed",
  reportWorkspaceDuration: "Duration",
  reportWorkspaceTotals: "Totals",
  reportWorkspaceAssertions: "Reconciliation assertions",
  reportWorkspaceAssertionFailed: "Reconciliation assertion failed — export disabled",
  reportWorkspaceAsOf: "As of {date}",
  reportWorkspaceComputedAt: "Computed {datetime}",
  reportWorkspaceEmpty: "This result has no rows",
  reportWorkspaceSavedViews: "Saved views",
  reportWorkspaceSaveView: "Save current view",
  reportWorkspaceViewNameAr: "View name (Arabic)",
  reportWorkspaceViewNameEn: "View name (English)",
  reportWorkspaceApply: "Apply",
  reportWorkspaceDeleteView: "Delete",
  reportWorkspaceRunHistory: "Run history",
  reportWorkspaceRefresh: "Refresh",
  reportWorkspaceBack: "Back to catalog",
  reportWorkspaceExportPdf: "Export PDF",
  reportWorkspaceExportXlsx: "Export XLSX",
  reportWorkspaceExportCsv: "Export CSV",
  reportWorkspacePrintPreview: "Print preview",
  reportWorkspaceExportBlocked: "Export blocked: this result failed its reconciliation check",
  reportWorkspaceViewSaved: "View saved",
  reportWorkspaceColReport: "Report",
  reportWorkspaceNoRuns: "No previous runs",

  // -- T19-WEB (PHASE-014): subscription, billing, onboarding & dashboards --
  navDashboard: "Dashboard",
  statusTrial: "Trial",
  statusPastDue: "Past due",
  statusGraceReadOnly: "Grace (read-only)",
  readOnlyBanner:
    "Read-only mode: grace period — posting is paused; reports, export, and printing stay available. Pay or upgrade the plan to restore posting.",
  readOnlyPayNow: "Pay now",
  readOnlyError:
    "Read-only mode: posting is paused during the grace period — paying is the resolving action",
  readOnlyReason:
    "Read-only during the grace period — creating and editing return once payment is made",

  pricingTitle: "Pricing & plans",
  pricingIntro:
    "The three self-serve plans — every price and limit is a placeholder carried by the plan data itself (no hard-coded numbers in the page).",
  pricingPlaceholderNote:
    "⚠ All prices are placeholders (OQ-002) — pending pricing approval; the numbers shown come from the plan configuration only.",
  pricingPlaceholderBadge: "Placeholder price — pending pricing approval (OQ-002)",
  pricingPlansHeading: "Plans",
  pricingMonthly: "Monthly",
  pricingAnnual: "Annual",
  pricingHighlightBadge: "Most suitable",
  pricingCta: "Choose plan",
  pricingMatrixHeading: "Feature comparison",
  pricingMatrixHint:
    "Each plan's feature-key count within the family, over the three-plan union (derived from the plans' feature keys).",
  pricingMatrixArea: "Area",
  pricingMatrixCellOf: "{present} of {total}",
  pricingFamilyPlatform: "Platform",
  pricingFamilyAccounting: "Accounting",
  pricingFamilyTrade: "Master data & trade",
  pricingFamilyTreasuryTax: "Treasury & tax",
  pricingFamilyReporting: "Reporting",
  pricingFamilyGrowth: "Growth tier",
  pricingHaveAccount: "Already have an account?",
  pricingGoLogin: "Sign in",

  landingKicker: "The ERP platform for regional businesses",
  landingHeroTitle: "One rigorous core that becomes your business",
  landingHeroSubtitle:
    "A double-entry financial core with a centralized posting engine, an Arabic-first RTL-native experience, and ready templates for thirteen business activities — from the retail counter to the factory, clinic, and farm.",
  landingCtaStartFree: "Start free",
  landingCtaStartFreeNote: "Trial without a card — your account and workspace in minutes",
  landingCtaPricing: "See plans & pricing",
  landingCtaLogin: "Have an account? Sign in",
  landingTrustCore: "Double-entry books + one central posting engine",
  landingTrustBilingual: "Full Arabic/English with native RTL and correct printing",
  landingTrustIndustries: "Industry templates — configuration, never code forks",
  landingTrustOffline: "POS and field sales keep selling offline",
  landingFeaturesHeading: "Why this platform",
  landingFeaturesIntro:
    "Four pillars designed for growing businesses: from one counter to multi-branch, factory, field reps, and farms — on the same rigorous financial core.",
  landingFeatureCoreTitle: "One non-negotiable accounting core",
  landingFeatureCoreBody:
    "Double-entry books, a bilingual chart of accounts, fiscal periods and closes, ready financial statements — every document flows through the same centralized posting engine, for every industry and every plan. Accounting correctness is never an upsell.",
  landingFeatureBilingualTitle: "Arabic-first — not a translated afterthought",
  landingFeatureBilingualBody:
    "A native right-to-left Arabic interface with per-industry terminology (patient, claim, waybill…), correct Arabic A4 and 80mm receipt printing, and full English — for every user, screen, and report.",
  landingFeatureIndustriesTitle: "Industry templates instead of code forks",
  landingFeatureIndustriesBody:
    "Pick your activity at registration: retail, grocery, restaurant, auto workshop, field distribution, food manufacturing, professional services, rental & logistics, wholesale, electronics, healthcare, education, agriculture — the template sets terminology, menus, reports, and policies over the shared core.",
  landingFeatureJurisdictionTitle: "Jurisdiction packs per country",
  landingFeatureJurisdictionBody:
    "Versioned packs (Saudi 15%, UAE 5%, and no-VAT jurisdictions like Kuwait and Yemen) drive codes, returns, and e-invoicing through verifiable adapters — the law as managed releases, never hard-coded rules.",
  landingFeatureOfflineTitle: "Works where connectivity drops",
  landingFeatureOfflineBody:
    "POS terminals keep selling without Internet using reconcilable OFF- numbers, field reps sell from van stock then sync — the server stays authoritative for posted financial records, with no blind last-write-wins for money.",
  landingFeaturePlatformTitle: "One platform under one console",
  landingFeaturePlatformBody:
    "Tenants, plans, and entitlements managed from the platform console, with granular per-branch roles and permissions, approval flows, and an immutable audit trail — from a one-person shop to a multi-entity enterprise with consolidated statements.",
  landingIndustriesHeading: "Supported business activities",
  landingIndustriesIntro:
    "The templates registered in the industry engine (read live from the registry — the single source of truth): pick your activity at registration or in the onboarding wizard, and switch later without losing data.",
  landingIndustriesUnavailable:
    "Could not load the activity list right now — head to the registration page to choose your activity.",
  landingIndustriesCountLabel: "ready business activities",
  landingIndustriesVersionLabel: "Version",
  landingIndustriesCta: "Choose your activity and start",
  landingPlansHeading: "Three self-serve plans",
  landingPlansIntro:
    "Every plan includes the full financial core — prices and limits render from the plan configuration (placeholder values, OQ-002).",
  landingPlansCta: "Full plan comparison",
  landingFooterNote:
    "\"the Platform\" — the regional business ERP: rigorous accounting, trade & inventory, treasury & tax, reporting, offline work, and desktop + Android apps.",
  landingSkipToRegister: "Skip straight to registration",

  checkoutTitle: "Checkout",
  checkoutGraceNote: "This page stays usable in read-only mode — paying is the resolving action.",
  checkoutPlansHeading: "Choose a plan",
  checkoutCurrentPlan: "Your current plan",
  checkoutSelected: "Selected",
  checkoutChoose: "Choose",
  checkoutConfirmTitle: "Confirm the plan request",
  checkoutConfirmMeta: "Plan: {plan} — {price} (placeholder price)",
  checkoutPeriodLabel: "Period length",
  checkoutPeriodMonths: "{months} month(s)",
  checkoutConfirmButton: "Continue to payment",
  checkoutCancelSelection: "Clear selection",
  checkoutSessionTitle: "Checkout session",
  checkoutInvoiceMeta: "Invoice {number} — {plan} plan",
  checkoutPeriod: "Period",
  checkoutDueDate: "Due date",
  checkoutAmount: "Amount",
  checkoutPayNow: "Pay now (sandbox)",
  checkoutSimulateFailure: "Simulate payment failure",
  checkoutSandboxNote:
    "Sandbox mode: the payment provider runs in sandbox — no real money; payment flows through the same webhook pipeline.",
  checkoutSuccessTitle: "Payment succeeded",
  checkoutSuccessBody:
    "The invoice is settled and the plan is active. It will show as paid in the billing history, and you can continue from the dashboard.",
  checkoutFailureTitle: "Payment failed (simulated)",
  checkoutFailureBody:
    "The failure is recorded — dunning continues per policy, and you can retry from the billing page.",
  checkoutGoBilling: "Go to billing & subscription",
  checkoutGoDashboard: "Dashboard",
  checkoutBackToPlans: "Back to plans",
  checkoutAlreadySettled: "This session is already settled.",
  checkoutBlockersTitle: "Downgrade blocked",
  checkoutBlockerLine:
    "{usage} {limit} exist; the {plan} plan allows {limitValue} — reduce to {limitValue} or fewer and retry.",
  checkoutLimitUsers: "users",
  checkoutLimitBranches: "branches",
  checkoutLimitWarehouses: "warehouses",
  checkoutErrorDowngradeBlocked:
    "The downgrade is blocked while usage exceeds the target plan's limits — see the list below.",
  checkoutErrorPlanUnchanged: "The subscription is already on this plan.",
  checkoutErrorSessionNotFound: "Unknown checkout session — it may have expired.",
  checkoutErrorSessionSettled: "The checkout session is already settled.",
  checkoutErrorTransition: "The subscription state does not allow this operation.",
  checkoutErrorLimitExceeded:
    "Plan limit: {limit} — usage {usage} of {limitValue}. Upgrade the plan or free a seat.",
  checkoutErrorNoSessionRef: "Could not extract the checkout session ref from the provider URL.",

  billingTitle: "Billing & subscription",
  billingGraceNote:
    "Read-only until {date} — paying is available from this page to restore posting.",
  billingPlanCardTitle: "Current plan",
  billingNoSubscription: "No active subscription for this tenant.",
  billingPrice: "Price",
  billingPeriod: "Period",
  billingTrialEndsAt: "Trial ends",
  billingTrialCountdown: "{days} days left",
  billingTrialDaysNote: "Trial duration is {days} days (placeholder).",
  billingChangePlan: "Change plan",
  billingUsageTitle: "Usage",
  billingUnlimited: "Unlimited",
  billingWarn80: "80% threshold",
  billingWarn100: "100%",
  billingInvoicesTitle: "Billing history",
  billingNoInvoices: "No invoices yet.",
  billingColNumber: "Number",
  billingColPlan: "Plan",
  billingColPeriod: "Period",
  billingColAmount: "Amount",
  billingColDueDate: "Due date",
  billingColPaidVia: "Paid via",
  billingPaidViaWebhook: "Payment provider",
  billingPaidViaManual: "Manual recording",
  billingEventsTitle: "Billing events",
  billingNoEvents: "No events yet.",
  billingViaPlatformAdmin: "via platform admin",
  billingEventTrialStarted: "Trial started",
  billingEventTrialExpired: "Trial expired",
  billingEventGraceEntered: "Grace entered",
  billingEventDunningWarned: "Dunning warning",
  billingEventPlanChangeRequested: "Plan change requested",
  billingEventPlanChanged: "Plan changed",
  billingEventDowngradeBlocked: "Downgrade blocked",
  billingEventCheckoutCreated: "Checkout session created",
  billingEventManualPaymentRecorded: "Manual payment recorded",
  billingEventSuspensionExecuted: "Suspension executed",
  billingEventSubscriptionRestored: "Subscription restored",
  billingEventEntitlementsChanged: "Entitlements changed",

  dashboardTitle: "Dashboard",
  dashboardFreshness:
    "Today {date} — every number on this page comes from a report run bound to the same parameters (no parallel math).",
  dashboardSalesToday: "Sales today",
  dashboardCashPosition: "Cash position (net today)",
  dashboardArOverdue: "AR overdue",
  dashboardStockAlerts: "Stock alerts",
  dashboardInvoicesCount: "{count} invoices",
  dashboardAccountsCount: "{count} cash accounts",
  dashboardCustomersCount: "{count} customers",
  dashboardStockPreviewHeading: "First 5 alerts (SKU · warehouse — on hand / reorder level)",
  dashboardDrillAria: "Open the report with the same parameters",
  dashboardWidgetFailed: "Report run failed",
  dashboardAssertionFailed: "Reconciliation assertion failed: {ids}",
  dashboardUsageHeading: "Usage summary",
  dashboardUsageUnavailable: "Usage summary unavailable — requires the subscription-manage permission.",
  dashboardTrialBanner: "The trial ends in {days} days",
  dashboardPastDueBanner: "An invoice is past due",
  dashboardGoBilling: "Manage subscription",
  dashboardGraceNote: "The dashboard stays fully usable in read-only mode — reports and exports continue.",

  notificationsTitle: "Notifications",
  notificationsUnreadCount: "Unread: {count}",
  notificationsUnreadOnly: "Unread only",
  notificationsRefresh: "Refresh",
  notificationsSyncLine: "Unread: {count}",
  notificationsInboxHeading: "Inbox",
  notificationsEmpty: "No notifications.",
  notificationsMarkRead: "Mark as read",
  notificationsReadAt: "Read:",
  notificationsPrefsTitle: "Notification preferences",
  notificationsPrefsHint: "An absent row means both channels are on; preferences suppress only, never fabricate.",
  notificationsPrefsCategory: "Category",
  notificationsPrefsInApp: "In-app",
  notificationsPrefsEmail: "Email",
  notificationsPrefsSaved: "Preference saved.",
  notificationsCategoryLimits: "Usage limits",
  notificationsCategorySubscription: "Subscription",
  notificationsCategoryReconciliation: "Reconciliation",
  notificationsCategoryInvoiceOverdue: "Overdue invoices",

  onboardingStepItem: "First item",
  onboardingStepCustomer: "First customer",
  onboardingStepInvoice: "First invoice",
  onboardingStepPrint: "Print",
  onboardingContinueJourney: "Continue the guided journey",
  onboardingNeedPcsUom:
    "Could not find the Piece (PCS) unit of measure — add it on the units screen and retry.",
  onboardingItemSku: "SKU",
  onboardingItemName: "Name (English)",
  onboardingItemNameAr: "Name (Arabic)",
  onboardingItemPrice: "Sale price",
  onboardingItemFixed:
    "Fixed for this step: kind stock · UoM {uom} — both changeable later on the items screen.",
  onboardingCreateItem: "Create item",
  onboardingSkipItem: "Skip this step",
  onboardingCustomerCode: "Code",
  onboardingCustomerName: "Name (English)",
  onboardingCustomerNameAr: "Name (Arabic)",
  onboardingCustomerFixed: "Kind for this step: customer — changeable later on the partners screen.",
  onboardingCreateCustomer: "Create customer",
  onboardingSkipCustomer: "Skip this step",
  onboardingSelectItem: "Select an item",
  onboardingTaxPreview: "Tax preview",
  onboardingPreviewEstimate: "(estimate — final numbers are set on create)",
  onboardingPreviewPending: "Enter quantity and price to see the preview.",
  onboardingNoTaxNote: "No tax — the guided invoice line carries no tax code.",
  onboardingInvoiceStageCreated: "Draft created (DRAFT)…",
  onboardingInvoiceStageSubmitted: "Submitted (PENDING_APPROVAL)…",
  onboardingInvoiceStageApproved: "Approved (APPROVED)…",
  onboardingInvoiceStagePosted: "Posted (POSTED) — the official number is assigned.",
  onboardingCreateInvoice: "Create & post the invoice",
  onboardingSkipInvoice: "Skip this step",
  onboardingInvoiceSummary: "Posted invoice summary",
  onboardingNoPostedInvoice: "No posted invoice yet.",
  onboardingPrintQueueNote:
    "Invoice printing arrives with the document print queue — this step is recorded done-with-note; no print route is invented.",
  onboardingSkipPrint: "Skip printing",
  onboardingFinish: "Finish the journey",
  onboardingGoInvoices: "Sales invoices",
  onboardingGoDashboard: "Dashboard",
  onboardingCompletedNote: "The onboarding journey is complete — you can now run your business from the dashboard.",
  onboardingSkippedNote:
    "Recorded stop at “first invoice posted” — the journey is resumable from here at any time.",

  billingAdminTitle: "Subscription billing (platform console)",
  billingAdminCaption:
    "Recordings from this panel are audited under the platform admin's name (via_platform_admin).",
  billingAdminSubscription: "Subscription",
  billingAdminNoSubscription: "No subscription for this tenant.",
  billingAdminManualTitle: "Record a manual payment (manual invoicing fallback)",
  billingAdminInvoice: "Invoice",
  billingAdminSelectInvoice: "Pick an invoice (OPEN only)",
  billingAdminVia: "Via",
  billingAdminViaBankTransfer: "Bank transfer",
  billingAdminViaCash: "Cash",
  billingAdminViaCheque: "Cheque",
  billingAdminReference: "Reference (min 3 chars)",
  billingAdminReason: "Reason (min 3 chars)",
  billingAdminRecordButton: "Record payment",
  billingAdminNoOpenInvoices: "No OPEN invoices to record a payment against.",
  billingAdminManualDone: "Payment recorded for invoice {number} — subscription status: {status}",
  billingAdminLifecycleTitle: "Suspend / restore (billing)",
  billingAdminSuspendButton: "Suspend",
  billingAdminRestoreButton: "Restore",
  billingAdminSuspendDone: "Suspended — {count} sessions killed.",
  billingAdminRestoreDone: "Restored.",
  billingAdminDailyPassTitle: "Daily pass",
  billingAdminDailyPassHint:
    "Runs the pass on demand: trial expiries, grace expiries, scheduled downgrades, and the documents-counter reconciliation.",
  billingAdminDailyPassButton: "Run the daily pass",
  billingAdminDailyPassDone:
    "Done: trials expired {trials} · suspensions {suspensions} · downgrades applied {applied} · downgrades blocked {blocked} · overdue invoices {overdue} · documents reconciled {reconciled}",
  billingAdminAuditNote:
    "Every action from this panel appears in the audit log with the via_platform_admin marker — reason and reference are mandatory.",
  billingAdminConfirmSuspend: "Confirm suspension",
  billingAdminConfirmSuspendBody:
    "Suspension kills the tenant's sessions immediately under the suspension semantics. Continue?",
  billingAdminConfirmRestore: "Confirm restore",
  billingAdminConfirmRestoreBody:
    "Restoration re-enables membership and re-materializes the plan entitlements in a paid posture. Continue?",
  billingAdminConfirmButton: "Confirm",
  billingAdminErrorNotOpen: "The target invoice is not OPEN.",
  billingAdminErrorReasonRequired: "Manual payment recording requires a reason and a reference.",

  // -- PHASE-015 T11 (3-a): onboarding industry step -------------------------
  onboardingStepIndustry: "Choose your industry",
  industryIntro:
    "Start by telling us your industry — your workspace opens speaking your sector's language: its menus, terminology, and workflow defaults. You can also continue without a template.",
  industryActivityQuestion: "What is your line of business?",
  industryActivityOther: "Describe your activity in your own words (optional)",
  industryActivityResolve: "Suggest a template",
  industryResolvedExact: "Exact match: the suggested template is \"{template}\".",
  industryResolvedSuggested:
    "Based on your description we suggest the \"{template}\" template — review and confirm it, or pick another one yourself.",
  industryNoMatch:
    "No template matches your description. Pick one from the list below, or continue without a template.",
  industryTemplatesLabel: "Industry templates",
  industryCapabilitiesLabel: "Capabilities",
  industryCapabilitiesPending: "Loading the capability preview…",
  industryCapIncluded: "Included",
  industryCapPhaseGated: "coming with PHASE-{phase}",
  industryCapOptional: "Optional — not on your plan",
  industryCapBlocked: "Needs a higher plan",
  industryCapRequired: "required",
  industrySelect: "Select",
  industryDeselect: "Deselect",
  industrySelectedBadge: "Selected",
  industryBlockedBadge: "Not available on your plan",
  industrySkipPlain: "No industry template — plain workspace",
  industryContinue: "Continue",
  industryApplyAfterProvisionNote:
    "The template is applied automatically after your workspace is provisioned — and if the apply fails, onboarding continues unaffected.",
  industryAlreadyAppliedTitle: "Template already applied",
  industryAlreadyApplied: "Your workspace currently runs the \"{template}\" template",
  industryLoadError:
    "Could not load the industry templates — you can continue without one and retry later from the \"Industry & templates\" screen.",
  industryOutcomeTitle: "Industry template",
  industryPlainChosen:
    "Continuing without an industry template — the workspace runs on the platform defaults; you can apply one later from the \"Industry & templates\" screen.",
  industryAppliedOk: "Template \"{template}\" applied (version {version}).",
  industryApplyAlready: "The template is already applied — nothing changed.",
  industryApplyForbidden: "The template was not applied — you do not have the template-apply permission.",
  industryApplyFailedContinue:
    "Continue setting up on the platform defaults — your workspace setup is not blocked by this.",
  industryApplyBlockedPrefix: "The template was not applied:",
  industryRetryHint:
    "You can review the templates and plan options later from Settings → \"Industry & templates\".",

  // -- PHASE-015 T11 (3-a): template-derived navigation labels -----------------
  industryNavComingPhase: "coming with {phase}",
  industryNavNotInWebApp: "not yet in the web app",

  // -- PHASE-015 T11 (3-a): admin "Industry & templates" screen --------------
  templatesTitle: "Industry & templates",
  templatesAppliedCard: "Applied template",
  templatesNoneApplied:
    "No industry template is applied — the workspace runs on the platform defaults.",
  templatesAppliedNotInRegistry:
    "The applied template has no ACTIVE registry row — contact platform administration.",
  templatesKey: "Key",
  templatesName: "Name",
  templatesAppliedVersion: "Applied version",
  templatesHash: "Manifest hash",
  templatesStatus: "Status",
  templatesStatusActive: "Active",
  templatesAppliedNote: "The applied-at date is not shown — no API read route exposes it yet.",
  templatesDriftTitle: "Template updates",
  templatesDriftPending: "Could not check for template updates right now.",
  templatesDriftCurrent: "You are on the latest version of the applied template.",
  templatesDriftBehind:
    "Data anomaly: the registry version is older than the applied one — contact platform administration.",
  templatesDriftAvailable: "Update available: version {registry} (currently applied: {applied}).",
  templatesDriftMajor: "MAJOR version — review the migration note before upgrading.",
  templatesDriftWhatNext: "Review what will change before upgrading.",
  templatesDriftRecorded: "The upgrade offer was recorded in your notifications.",
  templatesDriftReview: "Review changes",
  templatesDriftNeverAuto: "Template updates are never auto-applied — upgrading is your call.",
  templatesRegistryTitle: "Available templates",
  templatesNoPermission:
    "Read-only view — applying and switching templates requires the \"configuration.templates.apply\" permission.",
  templatesAppliedBadge: "Currently applied",
  templatesApplyButton: "Apply",
  templatesPreviewSwitch: "Preview switch",
  templatesPreviewExtend: "Preview extend",
  templatesApplyDone: "Template \"{template}\" applied (version {version}).",
  templatesApplyAlready: "The template is already applied — nothing changed.",
  templatesBlockedGeneric:
    "Blocked: required capabilities are missing from your current plan — choose a higher plan to finish setting up this template.",
  templatesSwitchDone: "Switched to the \"{template}\" template.",
  templatesExtendDone: "The \"{template}\" template was added to your workspace.",
  templatesAckRequiredNote:
    "This change includes REQUIRED phase-gated capabilities — they arrive later with the coming phases, and that must be acknowledged before proceeding.",
  templatesAckLabel:
    "I acknowledge that the phase-gated features ({phases}) arrive later when their phase ships.",
  templatesDiffTitle: "What will change?",
  templatesDiffDescription: "{mode} preview — nothing changes until you confirm.",
  templatesModeSwitch: "switch",
  templatesModeExtend: "extend",
  templatesDiffFromTo: "From {from} to {to}",
  templatesDiffBlocked: "The operation is blocked — missing keys:",
  templatesDiffAddedCaps: "Added capabilities",
  templatesDiffAddedIncluded: "Available immediately",
  templatesDiffAddedPhaseGated: "Phase-gated — arriving later",
  templatesDiffAddedOptionalMissing: "Optional, not on your plan (their menus stay hidden)",
  templatesDiffEmpty: "No additions.",
  templatesDiffArchived: "Archived capabilities",
  templatesDiffArchivedNote: "Kept read-only — switching never deletes data.",
  templatesDiffRenamed: "Renamed labels",
  templatesDiffSeries: "New numbering series",
  templatesDiffKeptSeries: "Existing series stay unchanged:",
  templatesDiffInventory: "Inventory default changes",
  templatesDiffInventoryNote:
    "Apply to newly created items only — existing item data never changes.",
  templatesDiffPolicies: "Workflow policies",
  templatesDiffPolicyConflict: "Conflict recorded — the primary value stays",
  templatesDiffPins: "Pinned reports",
  templatesDiffPinsAdded: "Added:",
  templatesDiffPinsRemoved: "Removed:",
  templatesDiffChecklist: "Onboarding checklist steps",
  templatesSwitchButton: "Switch template",
  templatesExtendButton: "Extend workspace",
  templatesPoliciesTitle: "Effective policies",
  templatesPoliciesNote: "The effective values after all layers merged — read-only.",
  templatesPolicyKey: "Key",
  templatesPolicyValue: "Value",
  templatesPolicySource: "Source",
  templatesPolicySourceTemplate: "Industry template",
  templatesPolicySourceTenant: "Your setting",
  templatesPolicyOn: "On",
  templatesPolicyOff: "Off",
  templatesPolicyLegend:
    "\"Industry template\" = a default from the applied template · \"Your setting\" = an explicit value from your settings · \"—\" = the payload does not carry this key's provenance (it may be your explicit setting, a template default, or the platform default).",

  // -- PHASE-017 (T6/T14): automotive + distribution navigation & crumbs ------
  navSales: "Sales",
  distributionNavSection: "Distribution",
  jobCardsTitle: "Job cards",
  vehiclesTitle: "Vehicles",
  commissionsTitle: "Commissions",
  distributionRoutesTitle: "Routes & visits",
  distributionVanTitle: "Van stock",
  distributionSettlementsTitle: "Rep settlements",
  distributionTiersTitle: "Customer tiers",

  // -- PHASE-017-T6 automotive screens (job cards + vehicles) ------------------
  jobCardsEmpty: "No job cards yet.",
  jobCardsNew: "New job card",
  jcFilterAll: "All",
  jcCardNo: "Card no",
  jcCustomer: "Customer",
  jcVehicle: "Vehicle",
  jcBranch: "Branch",
  jcWarehouse: "Warehouse",
  jcPartsIssueMode: "Parts issue mode",
  jcModeReserve: "Reserve parts (reserve)",
  jcModeIssueImmediate: "Issue immediately (issue_immediate)",
  jcOdometer: "Odometer (km)",
  jcComplaints: "Complaints",
  jcDiagnosis: "Diagnosis",
  jcNote: "Note",
  jcLaborHoursTotal: "Labor hours total",
  jcLineParts: "Parts",
  jcLineLabor: "Labor",
  jcItem: "Item",
  jcQty: "Qty",
  jcUnitPrice: "Unit price",
  jcHourlyRate: "Hourly rate",
  jcEstimatedHours: "Estimated hours",
  jcLoggedHours: "Logged hours",
  jcDiscount: "Discount",
  jcTaxCode: "Tax code",
  jcAddLine: "Add line",
  jcRemoveLine: "Remove line",
  jcStatusDraft: "Draft",
  jcStatusInProgress: "In progress",
  jcStatusCompleted: "Completed",
  jcStatusInvoiced: "Invoiced",
  jcStatusCancelled: "Cancelled",
  jcActionQuotation: "Generate quotation",
  jcActionApprove: "Customer approval",
  jcActionComplete: "Complete work",
  jcActionInvoice: "Issue invoice",
  jcActionCancel: "Cancel card",
  jcCancelReason: "Cancellation reason",
  jcLogHours: "Log hours",
  jcSearchPlaceholder: "Search by card no or customer…",
  jcClose: "Close",
  jcCreated: "Opened at",
  jcNoticeCreated: "Job card {no} opened.",
  jcNoticeQuotation: "Quotation {no} generated.",
  jcNoticeUpdated: "Job card updated.",
  jcNoticeHoursLogged: "Hours logged.",
  jcErrState: "This action is not allowed in the card's current state.",
  jcErrNotCancelable:
    "Cannot cancel after parts were issued or the card was invoiced — correct with a credit note.",
  jcErrLineInvalid: "Invalid line — check the item kind, quantity, and hours.",
  jcErrPosting: "Job-card posting is not configured yet; this action is unavailable.",
  vehiclesEmpty: "No vehicles registered yet.",
  vehNew: "New vehicle",
  vehPartner: "Partner",
  vehNote: "Note",
  vehMake: "Make",
  vehModel: "Model",
  vehModelYear: "Model year",
  vehChassis: "Chassis no (VIN)",
  vehPlate: "Plate no",
  vehColor: "Color",
  vehEngineNo: "Engine no",
  vehOdometer: "Odometer (km)",
  vehSearchPlaceholder: "Search plate, chassis, or make…",
  vehStatusActive: "Active",
  vehStatusArchived: "Archived",
  vehArchive: "Archive",
  vehArchiveHint:
    "The vehicle stays in the registry for history and disappears from new selections.",
  vehHistory: "Service history",
  vehHistoryKindJobCard: "Job card",
  vehHistoryKindInvoice: "Invoice",
  vehHistoryKindCreditNote: "Credit note",
  vehHistoryEmpty: "No service history for this vehicle.",
  vehNoticeCreated: "Vehicle registered.",
  vehNoticeArchived: "Vehicle archived.",
  vehErrChassisTaken: "Chassis number is already registered in this tenant.",
  vehErrArchived: "Vehicle is archived — it is read-only.",
  vehErrChassisInvalid:
    "Invalid chassis number: 6–17 characters of A–H, J–N, P, R–Z and digits (VIN shape, no I/O/Q).",

  // -- PHASE-017-T14 distribution + commissions screens ------------------------
  // (9a-dist) routes & visits + van stock + rep settlements + tiers/FOC + commissions

  // routes & visits (T14 routes screen)
  distRoutesCreate: "Create route",
  distRoutesCode: "Code",
  distRoutesName: "Name",
  distRoutesRep: "Sales rep",
  distRoutesVan: "Van",
  distRoutesDayPattern: "Day pattern",
  distRoutesDayPatternHint: "Pick at least one day per route — visits are planned for its days only.",
  distRoutesEmpty: "No routes yet — create the first one.",
  distRoutesCreatedToast: "Route {code} created.",
  distRoutesErrCodeTaken: "Route code is already in use in this tenant.",
  distRoutesErrPlanning: "The planning data is invalid — check the date, day pattern and customers.",
  distDayMon: "Mon",
  distDayTue: "Tue",
  distDayWed: "Wed",
  distDayThu: "Thu",
  distDayFri: "Fri",
  distDaySat: "Sat",
  distDaySun: "Sun",
  distCompTitle: "Customer composition",
  distCompHint: "Order sets the visit sequence when planning; pin the regulars to the top.",
  distCompDerivedHint: "The current composition is derived from the route's planned visits; saving replaces it in full with the order shown.",
  distCompCount: "{count} customers",
  distCompOrder: "Order",
  distCompPinned: "Pinned",
  distCompAddCustomer: "Add customer",
  distCompRemove: "Remove",
  distCompSave: "Save composition",
  distCompEmpty: "No customers on this route yet — add some from the list.",
  distCompSavedToast: "Composition saved ({count}).",
  distPlanTitle: "Plan visits",
  distPlanDate: "Planning date",
  distPlanBtn: "Plan visits for the date",
  distPlanToast: "Planned {planned} visit(s) ({skipped} already planned).",
  distBoardTitle: "Visit board",
  distBoardDate: "Visit date",
  distBoardAllStatuses: "All statuses",
  distVisitPlanned: "Planned",
  distVisitCompleted: "Completed",
  distVisitSkipped: "Skipped",
  distVisitMissed: "Missed",
  distVisitCheckIn: "Check in",
  distVisitComplete: "Complete",
  distVisitSkip: "Skip",
  distVisitCheckedIn: "Checked in",
  distVisitCustomer: "Customer",
  distVisitRoute: "Route",
  distVisitNote: "Note",
  distVisitEmpty: "No visits match these filters.",
  distCompleteTitle: "Complete visit",
  distCompleteInvoice: "Sales invoice (UUID)",
  distCompleteCreditNote: "Credit note (UUID)",
  distCompleteReceipt: "Receipt (UUID)",
  distCompleteHint: "Optional — paste a document UUID to link it to the visit on completion, plus a note if needed.",
  distVisitCheckedInToast: "Visit checked in.",
  distVisitCompletedToast: "Visit completed.",
  distVisitSkippedToast: "Visit skipped.",
  distErrVisitState: "The visit's state does not allow this action — only PLANNED visits are managed.",
  distErrVisitDocument: "A linked document does not exist in this tenant.",

  // van stock (T14 van screen)
  distVanRegister: "Register van",
  distVanCode: "Code",
  distVanName: "Name",
  distVanBranch: "Branch",
  distVanRep: "Bound rep",
  distVanEmpty: "No vans registered — register the first one.",
  distVanRegisteredToast: "Van {code} registered and bound to rep {rep}.",
  distVanBalancesTitle: "Van balances",
  distVanPickVan: "Pick a van",
  distVanItem: "Item",
  distVanSku: "SKU",
  distVanQty: "Qty",
  distVanValue: "Value",
  distVanTotals: "Totals",
  distVanBalancesEmpty: "No stock on this van yet — load it from a main warehouse.",
  distLoadOutTitle: "Load van (load-out)",
  distLoadOutFrom: "From warehouse",
  distLoadOutVan: "To van",
  distLoadOutAddLine: "Add line",
  distLoadOutBtn: "Load out",
  distLoadOutToast: "Load-out transfer {no} dispatched — in transit until received.",
  distUnloadTitle: "Unload van",
  distUnloadVan: "From van",
  distUnloadTo: "To warehouse",
  distUnloadBtn: "Unload",
  distUnloadToast: "Unload transfer {no} in transit — receive it on the other side.",
  distTransfersTitle: "In-transit transfers to vans",
  distTransfersEmpty: "No in-transit transfers to vans right now.",
  distTransfersVanOnly: "Only transfers addressed to distribution vans are listed (receive refreshes the van stock mirror).",
  distTransfersReceiveToast: "Transfer received — the van balance now reflects it.",
  distErrVanCodeTaken: "Warehouse code is already in use in this tenant.",
  distErrVanRepBinding: "Invalid rep binding — needs an ACTIVE rep not already bound to another van (one van per rep).",
  distErrVanLoadOut: "The load/unload operation is invalid — check the van, the warehouse and the lines.",
  distErrVanNotFound: "Van not found (or not a VAN-type warehouse).",

  // rep settlements (T14 settlements screen)
  distSettlementsOpen: "Open a settlement",
  distSettlementsRep: "Rep",
  distSettlementsCashAccount: "Rep cash account",
  distSettlementsVan: "Van",
  distSettlementsDate: "Settlement date",
  distSettlementsOpening: "Opening cash",
  distSettlementsNo: "Settlement no.",
  distSettlementsEmpty: "No settlements yet — open today's settlement for a rep.",
  distSettlementsOpenedToast: "Settlement opened for rep {rep} on {date} (the STL- number lands at posting).",
  distSettlementAllStatuses: "All statuses",
  distSettlementDraft: "Draft",
  distSettlementCounted: "Counted",
  distSettlementApproved: "Approved",
  distSettlementPosted: "Posted",
  distSettlementCancelled: "Cancelled",
  distSettlementDetail: "Settlement detail",
  distSettlementLines: "Expected-cash breakdown",
  distSettlementLineNo: "#",
  distSettlementComponent: "Component",
  distSettlementAmount: "Amount",
  distSettlementDescription: "Description",
  distSettlementCashSales: "Cash sales",
  distSettlementCollections: "Collections",
  distSettlementRefunds: "Cash refunds",
  distSettlementExpenses: "Rep expenses",
  distSettlementExpected: "Expected cash",
  distSettlementCountedCash: "Counted cash",
  distSettlementVariance: "Variance",
  distSettlementShortage: "Shortage",
  distSettlementSurplus: "Surplus",
  distSettlementNone: "None",
  distSettlementVarianceReason: "Variance reason",
  distSettlementApprovalBadge: "Approval required",
  distSettlementCountAction: "Count drawer",
  distSettlementApproveAction: "Approve",
  distSettlementPostAction: "Post",
  distSettlementCancelAction: "Cancel settlement",
  distSettlementCancelReason: "Cancel reason",
  distSettlementDepositAccount: "Deposit account",
  distSettlementDepositAmount: "Deposit amount",
  distSettlementDepositHint: "Optional — deposit part of the drawer into another account (bank/box) at posting; never above the counted cash.",
  distSettlementShift: "Linked shift",
  distSettlementCountedToast: "Settlement counted — variance {variance} ({direction}).",
  distSettlementApprovedToast: "Settlement approved.",
  distSettlementPostedToast: "Settlement {no} posted — the variance and deposit legs are booked.",
  distSettlementCancelledToast: "Settlement cancelled.",
  distComponentOpeningCash: "Opening cash",
  distComponentCashSale: "Cash sale",
  distComponentCollection: "Collection",
  distComponentCashRefund: "Cash refund",
  distComponentRepExpense: "Rep expense",
  distComponentVariance: "Count variance",
  distComponentBankDeposit: "Bank deposit",
  distErrSettlementPendingDocs: "The rep's day still has draft/pending documents — post or cancel them before settling.",
  distErrSettlementDayLocked: "The rep's day is already locked by a live settlement (or the settlement is POSTED and immutable).",
  distErrSettlementApprovalRequired: "The variance is beyond tolerance (or an approval policy is active) — a separate approval is required before posting.",
  distErrSettlementVarianceReason: "A non-zero variance requires a documented reason.",
  distErrSettlementSelfApproval: "The settlement's creator cannot approve it (creator ≠ approver).",
  distErrSettlementState: "The settlement's state does not allow this action — count precedes posting.",
  distErrSettlementNotFound: "Settlement not found in this tenant.",

  // customer tiers + free goods (T14 tiers screen)
  distTiersCreate: "Create tier",
  distTiersEdit: "Edit tier",
  distTiersCode: "Code",
  distTiersName: "Name",
  distTiersPriceList: "Price list",
  distTiersDiscountCap: "Discount cap %",
  distTiersDiscountCapHint: "Optional 0–100 — caps any discount granted to this tier's customers.",
  distTiersVisitFrequency: "Visit frequency (days)",
  distTiersVisitFrequencyHint: "Optional 0–365 — how often this tier's customers are visited.",
  distTiersEmpty: "No tiers yet — create the first one.",
  distTiersSavedToast: "Tier {code} saved.",
  distErrTierCodeTaken: "Tier code is already in use in this tenant.",
  distErrTierPriceList: "Invalid price list — must be an active SALE list.",
  distErrTierInvalid: "Invalid tier data (discount cap 0–100, non-negative frequency).",
  distFocTitle: "Free goods (FOC) rules",
  distFocCreate: "Create rule",
  distFocCode: "Code",
  distFocName: "Name",
  distFocBuy: "Buy item",
  distFocBuyQty: "Buy qty",
  distFocGet: "Get item",
  distFocGetQty: "Get qty",
  distFocPerMultiple: "Per multiple",
  distFocMaxFree: "Max free per order",
  distFocMaxFreeHint: "Optional — 0 or empty means uncapped.",
  distFocTier: "Target tier",
  distFocAnyTier: "Any tier",
  distFocReason: "Reason code",
  distFocReasonHint: "Required — why the free goods are granted (BR-008), up to 30 chars.",
  distFocValidFrom: "Valid from",
  distFocValidTo: "Valid to",
  distFocEmpty: "No free-goods rules yet — create the first one (buy X get Y).",
  distFocSavedToast: "Free-goods rule {code} saved.",
  distFocErrInvalid: "Invalid rule data (positive qtys, a sane validity window, a reason code).",

  // commissions (T14 commissions screen)
  commissionsRunsTitle: "Commission runs",
  commissionsNewRun: "New run",
  commissionsPeriodFrom: "Period from",
  commissionsPeriodTo: "Period to",
  commissionsBasis: "Basis",
  commissionsBasisInvoiced: "Invoiced",
  commissionsBasisCollected: "Collected",
  commissionsTotalBase: "Total base",
  commissionsTotalCommission: "Total commission",
  commissionsEmpty: "No runs yet — create one for a period.",
  commissionsAllStatuses: "All statuses",
  commissionsStatusDraft: "Draft",
  commissionsStatusPosted: "Posted",
  commissionsStatusCancelled: "Cancelled",
  commissionsRunCreatedToast: "Run created and computed — posting is the accrual point.",
  commissionsRunPostedToast: "Run posted — the commission accrual is booked (expense/accrual).",
  commissionsRunCancelledToast: "Run cancelled.",
  commissionsDetail: "Run detail",
  commissionsLines: "Commission lines",
  commissionsRep: "Rep",
  commissionsBase: "Base",
  commissionsRate: "Rate %",
  commissionsAmount: "Commission",
  commissionsPayout: "Payout",
  commissionsPayoutAccrued: "Accrued",
  commissionsPayoutPaid: "Paid",
  commissionsExcluded: "Excluded — the rep rule basis ≠ the run basis",
  commissionsNoLines: "No computed lines for this run (no activity, or rules without commission).",
  commissionsPostRun: "Post run",
  commissionsCancelRun: "Cancel run",
  commissionsCancelReason: "Cancel reason",
  commissionsRulesTitle: "Per-rep commission rules",
  commissionsRulesHint: "Pick a rep to view and edit their rule (method/rate/basis).",
  commissionsRuleRep: "Rep",
  commissionsRuleMethod: "Method",
  commissionsMethodNone: "No commission",
  commissionsMethodPercentage: "Percentage",
  commissionsRuleRate: "Rate %",
  commissionsRuleRateHint: "0–100 applied to the computed base; leaving it empty with a tiered rule keeps the bands.",
  commissionsRuleBasis: "Basis",
  commissionsRuleTiers: "Tier bands",
  commissionsRuleTiersHint: "Read-only on this screen — entering a flat rate replaces them.",
  commissionsRuleSavedToast: "Commission rule saved for {rep}.",
  commErrRuleInvalid: "Invalid rule data (rate 0–100, or well-formed tier bands — never both).",
  commErrRunState: "The run's state does not allow this action (POSTED runs are immutable — corrections reverse the accrual journal).",

  // -- PHASE-016 T4/T10 — POS (counter, floor, reconciliation, terminals, offline) --

  posNavSection: "Point of sale",
  posNavCounter: "POS counter",
  posNavFloor: "Floor plan",
  posNavReconciliation: "Reconciliation",
  posNavTerminals: "POS terminals",

  posCounterTitle: "POS — counter sale",
  posCounterNoTerminals: "No POS terminals registered — register one first.",
  posCounterRegisterTerminal: "Register terminal",
  posCounterTerminalLabel: "Terminal",
  posCounterShiftOpen: "Shift open",
  posCounterShiftNone: "No open shift",
  posCounterOpenShiftBtn: "Open shift",
  posCounterCloseShiftBtn: "Close shift",
  posCounterZReportLink: "Z report",
  posCounterScanLabel: "Scan barcode / item code",
  posCounterScanPlaceholder: "Scan or type a code, then Enter",
  posCounterScanNotFound: "No item matches that code.",
  posCounterScanPerf: "Last lookup: {ms}ms",
  posCounterItemsTitle: "Items",
  posCounterItemsEmpty: "No sellable items.",
  posCounterSearchPlaceholder: "Search by name or code…",
  posCounterCartTitle: "Cart",
  posCounterCartEmpty: "Cart is empty — add items from the grid or by scanning.",
  posCounterQty: "Qty",
  posCounterRemove: "Remove",
  posCounterTotal: "Total",
  posCounterTaxNote: "Final tax is computed at posting.",
  posCounterPayBtn: "Pay",
  posCounterClearBtn: "Clear cart",
  posCounterCustomer: "Customer",
  posCounterWalkIn: "Walk-in customer",
  posCounterPickCustomer: "Choose customer",
  posCounterCustomerSearch: "Search by name or code…",
  posCounterNewSale: "New sale",
  posCounterSalePosted: "Invoice {no} posted.",
  posCounterPreloadedCheck: "Table check {no} loaded — paying settles the check and frees the table.",
  posCounterErrTerminalRequired: "Select a terminal first.",
  posCounterErrCartEmpty: "Add at least one line.",
  posCounterErrTerminalInactive: "The terminal is INACTIVE — activate it before selling.",
  posCounterErrDiscountCeiling: "The discount exceeds the allowed ceiling — a supervisor must approve.",
  posCounterReturnBtn: "Return",
  posCounterOfflineQueued: "Offline — sale {no} stored locally pending sync.",

  posShiftOpenTitle: "Open shift on {terminal}",
  posShiftOpeningAmount: "Opening float",
  posShiftDenominations: "Denominations (optional)",
  posShiftDenomination: "Denomination",
  posShiftCount: "Count",
  posShiftCountedTotal: "Counted total",
  posShiftOpenAction: "Open shift",
  posShiftAlreadyOpen: "A shift is already open on this terminal's till.",
  posShiftOpenedToast: "Shift {no} opened.",
  posShiftCloseTitle: "Close shift — blind count",
  posShiftBlindNote: "Blind count: expected stays hidden until close.",
  posShiftCloseAction: "Close shift",
  posShiftClosedToast: "Shift {no} closed.",
  posShiftSupervisorRequired: "Variance beyond tolerance — supervisor id + PIN + reason required.",
  posShiftErrOpenMismatch: "An open shift already exists on this till — one open shift per till.",
  posShiftErrNotOnTerminal: "That shift is not the open shift on this terminal.",

  posTenderTitle: "Payment",
  posTenderMethod: "Method",
  posTenderAmount: "Amount",
  posTenderCash: "Cash",
  posTenderCard: "Card",
  posTenderRemaining: "Remaining",
  posTenderChangeDue: "Change due",
  posTenderAddRow: "Add tender row",
  posTenderConfirm: "Confirm payment",
  posTenderErrInvalid: "Invalid tender amount — must be a positive decimal.",
  posTenderErrOverflow: "Tendered total far exceeds the sale total — review the rows.",
  posTenderErrUnderpaid: "Tendered total is below the sale total.",

  posReceiptTitle: "Receipt preview",
  posReceiptPrint: "Print",
  posReceiptLoading: "Loading receipt…",
  posReceiptErrLoad: "Could not load the receipt.",
  posReceiptOfflineNote: "Local pending-sync receipt — the official number appears once the server accepts it.",

  posReturnTitle: "POS return",
  posReturnInvoiceLabel: "Original invoice (id or number)",
  posReturnLoad: "Load invoice",
  posReturnLines: "Return lines",
  posReturnReason: "Return reason",
  posReturnNote: "Note",
  posReturnSubmit: "Submit return",
  posReturnPosted: "Credit note {no} posted.",
  posReturnErrNoLines: "Pick at least one line with a positive qty.",
  posReturnErrInvoice: "Could not load the original invoice.",

  posFloorTitle: "Floor plan — table service",
  posFloorBranch: "Branch",
  posFloorZone: "Zone",
  posFloorSeats: "Seats",
  posFloorSortKey: "Sort",
  posFloorFree: "Free",
  posFloorOccupied: "Occupied",
  posFloorTableLabel: "Table label",
  posFloorOpenCheck: "Open check",
  posFloorOrderType: "Order type",
  posFloorGuests: "Guests",
  posFloorAddTable: "Add table",
  posFloorTableAdded: "Table added.",
  posFloorEmpty: "No tables in this branch yet.",
  posFloorOpenChecks: "Open checks",
  posFloorCheckNo: "Check no.",
  posFloorLines: "Lines",
  posFloorAddItem: "Add item",
  posFloorSaveLines: "Save lines",
  posFloorLinesSaved: "Check lines saved.",
  posFloorKitchenSend: "Send kitchen ticket",
  posFloorKitchenSent: "Kitchen ticket {no} sent.",
  posFloorTickets: "Kitchen tickets",
  posFloorTransfer: "Transfer to table",
  posFloorTransferTo: "To table",
  posFloorTransferred: "Check transferred to the new table.",
  posFloorSplit: "Split check",
  posFloorSplitHint: "Pick the lines to move to a new check.",
  posFloorSplitDone: "Moved {n} line(s) to a new check.",
  posFloorGuestCheck: "Guest check",
  posFloorPay: "Pay",
  posFloorCancelCheck: "Cancel check",
  posFloorCancelReason: "Cancel reason",
  posFloorCheckCancelled: "Check cancelled and the table freed.",
  posFloorSent: "Sent",
  posFloorUnsent: "Unsent",
  posFloorOrderDineIn: "Dine-in",
  posFloorOrderTakeaway: "Takeaway",
  posFloorOrderDelivery: "Delivery",
  posFloorOrderCounter: "Counter",
  posFloorCheckPaid: "Paid",
  posFloorErrCheckNotOpen: "The check is not OPEN — it cannot be modified.",
  posFloorErrOpenTables: "Open checks still exist — settle or cancel them before closing the day.",

  posReconciliationTitle: "Reconciliation — Z report",
  posReconciliationDate: "Date",
  posReconciliationBranch: "Branch",
  posReconciliationLoad: "Show report",
  posReconciliationZNumber: "Z number",
  posReconciliationTotals: "Totals",
  posReconciliationInvoiceCount: "Invoices",
  posReconciliationByOrderType: "By order type",
  posReconciliationByTender: "By tender",
  posReconciliationByTerminal: "By terminal",
  posReconciliationByHour: "By hour",
  posReconciliationOfflinePairs: "Offline reconciliation (OFF- ⇄ official)",
  posReconciliationOfflineNo: "OFF- no.",
  posReconciliationOfficialNo: "Official no.",
  posReconciliationPrint: "Print Z report",
  posReconciliationEmpty: "No results for this day.",
  posReconciliationOpenChecks: "Open checks ({n})",
  posReconciliationRejections: "Rejected sales in the sync queue",
  posReconciliationColType: "Type",
  posReconciliationColCount: "Count",
  posReconciliationColTax: "Tax",

  posTerminalsTitle: "POS terminals",
  posTerminalsCode: "Code",
  posTerminalsName: "Name",
  posTerminalsBranch: "Branch",
  posTerminalsTill: "Cash till",
  posTerminalsWarehouse: "Warehouse",
  posTerminalsReceiptSize: "Receipt size",
  posTerminalsStatus: "Status",
  posTerminalsDevice: "Bound device",
  posTerminalsLastSeen: "Last seen",
  posTerminalsActive: "Active",
  posTerminalsInactive: "Inactive",
  posTerminalsRegister: "Register terminal",
  posTerminalsRegisterAction: "Register",
  posTerminalsRegistered: "Terminal {code} registered.",
  posTerminalsActivate: "Activate",
  posTerminalsDeactivate: "Deactivate",
  posTerminalsActivated: "Terminal activated.",
  posTerminalsDeactivated: "Terminal deactivated.",
  posTerminalsEnrollDevice: "Enroll device",
  posTerminalsDeviceName: "Device name",
  posTerminalsDeviceKey: "Device key",
  posTerminalsDeviceKeyNote: "Generated locally and shown once — copy it now.",
  posTerminalsEnrollAction: "Enroll",
  posTerminalsEnrolled: "Device enrolled.",
  posTerminalsRevoke: "Revoke device",
  posTerminalsRevoked: "Device revoked.",
  posTerminalsErrCodePattern: "Code: 2–30 letters/digits (. _ - allowed).",
  posTerminalsErrCodeTaken: "That code is already used by another terminal.",
  posTerminalsEmpty: "No terminals registered.",

  posOfflineBanner: "You are offline — sales are stored locally with an OFF- number and sync when back.",
  posOfflineQueue: "Sync queue ({n})",
  posOfflinePendingSync: "PENDING_SYNC",
  posOfflineSynced: "Synced",
  posOfflineRejected: "Rejected",
  posOfflineKept: "Kept locally",
  posOfflineRetry: "Retry",
  posOfflineKeep: "Keep",
  posOfflineRemove: "Remove",
  posOfflineSyncNow: "Sync now",
  posOfflineSyncedToast: "Synced {n} sale(s).",
  posOfflineRejectionReason: "Rejection reason",
  posOfflineEditResend: "Edit & resend",
  posOfflineAcceptPrice: "Accept server price",
  posOfflineCancelWithReason: "Cancel with reason",
  posOfflineCancelledLocal: "Cancelled locally — the record is kept.",
  posOfflineReasonPeriodLocked: "The accounting period is locked.",
  posOfflineReasonPriceChanged: "The item price changed on the server.",
  posOfflineReasonInsufficientStock: "Insufficient stock for the line.",
  posOfflineReasonCreditLimit: "The customer credit limit is exceeded.",
  posOfflineReasonValidation: "The payload failed validation.",
  posOfflineLocalReceiptTitle: "Local receipt",

  // -- PHASE-018 (T41): manufacturing navigation & screens ---------------------
  // (boms + production orders + QC inspections + batch genealogy; the
  // food_manufacturing template's production/traceability surfaces)

  manufacturingNavSection: "Manufacturing",
  mfgBomsTitle: "Bills of materials",
  mfgOrdersTitle: "Production orders",
  mfgQcTitle: "Quality inspections",
  mfgGenealogyTitle: "Batch genealogy",

  // BOM screen (the version registry + the lines editor + explosion preview)
  mfgBomsNew: "New version",
  mfgBomsEmpty: "No bills of materials yet.",
  mfgBomFilterItem: "Filter by item",
  mfgBomsAllStatuses: "All statuses",
  mfgBomStatusDraft: "Draft",
  mfgBomStatusActive: "Active",
  mfgBomStatusArchived: "Archived",
  mfgBomItem: "Output item",
  mfgBomVersion: "Version",
  mfgBomYield: "Yield (%)",
  mfgBomYieldHint: "Greater than 0 and at most 100 — the explosion divides quantities by it.",
  mfgBomEffectiveFrom: "Effective from",
  mfgBomNote: "Note",
  mfgBomOutputUom: "Output unit",
  mfgBomComponent: "Component",
  mfgBomQtyPerOutput: "Qty per output unit",
  mfgBomScrapPct: "Component scrap (%)",
  mfgBomLines: "Component lines",
  mfgBomLineNo: "#",
  mfgBomAddLine: "Add component",
  mfgBomRemoveLine: "Remove",
  mfgBomCreateTitle: "New BOM version",
  mfgBomEditTitle: "Edit BOM (draft)",
  mfgBomDraftOnlyHint: "Only DRAFT versions accept edits; after activation create a new version.",
  mfgBomActivate: "Activate",
  mfgBomActivateTitle: "Activate version",
  mfgBomArchive: "Archive",
  mfgBomArchiveHint: "This version stops being the item's active recipe for production orders.",
  mfgBomCreatedToast: "Version {version} created — edit the lines then activate it.",
  mfgBomSavedToast: "Version {version} saved.",
  mfgBomActivatedToast: "Version {version} activated (the previous active version was archived).",
  mfgBomArchivedToast: "Version {version} archived.",
  mfgBomWorkspace: "Version workspace",
  mfgExplodeTitle: "Explosion preview",
  mfgExplodeQty: "Requested output qty",
  mfgExplodeBom: "Version (optional)",
  mfgExplodeBomAuto: "The item's active version",
  mfgExplodeRun: "Explode",
  mfgExplodeLevels: "Levels",
  mfgExplodeColVia: "Via semi-finished",
  mfgExplodeTotals: "Totals per item",
  mfgExplodeEmpty: "No results — make sure the item has an explodable version.",
  mfgExplodeHint: "Level 1 is direct; deeper levels derive from the semi-finished components' own BOMs.",
  mfgColLevel: "Level",

  // Production-order screen (list + create + the lifecycle workspace)
  mfgOrdersNew: "New production order",
  mfgOrdersEmpty: "No production orders yet.",
  mfgOrdersAllStatuses: "All statuses",
  mfgOrderStatusDraft: "Draft",
  mfgOrderStatusReleased: "Released",
  mfgOrderStatusInProgress: "In progress",
  mfgOrderStatusCompleted: "Completed",
  mfgOrderStatusCancelled: "Cancelled",
  mfgOrderNo: "Order no.",
  mfgOrderPlannedQty: "Planned qty",
  mfgOrderActualQty: "Actual qty",
  mfgOrderFgValue: "FG value",
  mfgOrderCompletedAt: "Completed at",
  mfgOrderBranch: "Branch",
  mfgOrderBom: "BOM version (optional)",
  mfgOrderBomActive: "The active version at release",
  mfgOrderPlannedDate: "Planned date",
  mfgOrderMaterialsWarehouse: "Materials warehouse",
  mfgOrderFgWarehouse: "Finished-goods warehouse",
  mfgOrderLaborRate: "Labor rate per unit",
  mfgOrderOverheadRate: "Overhead rate per unit",
  mfgOrderRatesHint: "Optional — absorbed into the completion journal at release time when above zero.",
  mfgOrderCreatedToast: "Production order created (DRAFT) — release it to reserve the PRD number and freeze the plan lines.",
  mfgOrderDetail: "Production order detail",
  mfgOrderBatch: "Produced batch",
  mfgOrderExpiry: "Expiry",
  mfgOrderWipCredit: "WIP credit",
  mfgOrderLabor: "Absorbed labor",
  mfgOrderOverhead: "Absorbed overhead",
  mfgOrderNoEditHint: "No inline edit — create a replacement order or correct via adjusted consumptions.",
  mfgOrderPlanLines: "Plan lines (release snapshot)",
  mfgOrderOverPlan: "Over plan",
  mfgOrderRelease: "Release",
  mfgOrderStart: "Start",
  mfgOrderConsume: "Consume materials",
  mfgOrderScrap: "Scrap",
  mfgOrderComplete: "Complete",
  mfgOrderCancel: "Cancel order",
  mfgOrderCancelTitle: "Cancel the production order",
  mfgOrderCancelReason: "Cancel reason",
  mfgOrderReleasedToast: "Order {no} released and the plan lines were frozen.",
  mfgOrderStartedToast: "Order {no} is now in progress.",
  mfgOrderCancelledToast: "The order was cancelled.",
  mfgConsumeQty: "Consumed qty",
  mfgConsumeBatch: "Batch (optional)",
  mfgConsumeBatchAuto: "Automatic (FEFO)",
  mfgConsumeAt: "Consumption date",
  mfgConsumeAddLine: "Add line",
  mfgConsumeToast: "Consumption posted — journal {journal}.",
  mfgScrapTitle: "Record WIP scrap",
  mfgScrapQty: "Scrapped qty",
  mfgScrapReason: "Reason code",
  mfgScrapValue: "Scrap value",
  mfgScrapAt: "Scrapped at",
  mfgScrapToast: "Scrap of {value} posted — journal {journal}.",
  mfgCompleteTitle: "Complete the production order",
  mfgCompleteActualQty: "Actual produced qty",
  mfgCompleteBatchNo: "Batch no. (optional)",
  mfgCompleteToast: "Order completed — FG value {value}, batch {batch}.",
  mfgConsumptions: "Consumptions",
  mfgConsumptionBatch: "Batch",
  mfgConsumptionUnitCost: "Unit cost",
  mfgConsumptionValue: "Value",
  mfgConsumptionJournal: "Journal",
  mfgScraps: "Recorded scraps",

  // QC screen (the inspection log + the entry dialog)
  mfgQcNew: "Record inspection",
  mfgQcEmpty: "No inspections recorded yet.",
  mfgQcAllTargets: "All targets",
  mfgQcResultPass: "Pass",
  mfgQcResultFail: "Fail",
  mfgQcDispAccept: "Accept",
  mfgQcDispScrap: "Scrap",
  mfgQcDispRework: "Rework",
  mfgQcDispReturn: "Return to supplier",
  mfgQcDispNone: "No disposition",
  mfgQcTargetProductionOrder: "Production order",
  mfgQcTargetGoodsReceipt: "Goods receipt",
  mfgQcColInspectedAt: "Inspected at",
  mfgQcColTarget: "Target",
  mfgQcColGrn: "Goods receipt (id)",
  mfgQcColBatch: "FG batch",
  mfgQcColSampled: "Sample",
  mfgQcCreateTitle: "Record a QC inspection",
  mfgQcTargetType: "Target type",
  mfgQcOrder: "Production order (completed)",
  mfgQcGrnId: "Goods receipt id (UUID)",
  mfgQcGrnHint: "There is no GRN list API — paste the id from the purchasing screen.",
  mfgQcResult: "Result",
  mfgQcSampled: "Sampled inspection",
  mfgQcSampleSize: "Sample size",
  mfgQcDisposition: "Disposition",
  mfgQcDispositionHint: "FAIL requires a disposition; PASS allows none or ACCEPT only; return-to-supplier is goods-receipt-only.",
  mfgQcCreatedToast: "Inspection recorded ({result}).",
  mfgQcReleasedToast: "The quarantined batch was released (now active).",
  mfgQcScrapToast: "QC scrap posted: qty {qty}, value {value} — journal {journal}.",

  // Genealogy screen (the read-only recall search)
  mfgGenealogyItem: "Item",
  mfgGenealogyBatchId: "Or paste a batch id (UUID)",
  mfgGenealogyBatchHint: "Pick an item then a batch, or paste the id directly — this screen is read-only and never posts.",
  mfgGenealogyUpstream: "Upstream",
  mfgGenealogyDownstream: "Downstream",
  mfgGenealogySummary: "Summary",
  mfgGenealogyBatchCard: "Batch card",
  mfgGenealogyOnHand: "On hand",
  mfgGenealogyProducingOrder: "Producing order",
  mfgGenealogyConsumedBy: "Consumed by orders",
  mfgGenealogySalesCount: "Sales count",
  mfgGenealogyInspectionsCount: "Inspections count",
  mfgBatchStatusActive: "Active",
  mfgBatchStatusQuarantined: "Quarantined",
  mfgBatchStatusWrittenOff: "Written off",
  mfgGenealogyMaterials: "Upstream materials",
  mfgGenealogyColConsumedBy: "Consumed by",
  mfgGenealogyColProducedBy: "Produced by",
  mfgGenealogyProductions: "Downstream productions",
  mfgGenealogyColFromBatch: "From batch",
  mfgGenealogyColOrder: "Order",
  mfgGenealogySales: "Downstream sales",
  mfgGenealogyColDocType: "Doc type",
  mfgGenealogyColDocId: "Document",
  mfgGenealogyColDocDate: "Doc date",
  mfgGenealogyIdsHint: "This screen shows document ids only — the batch-genealogy report adds their numbers.",
  mfgDocSalesInvoice: "Sales invoice",
  mfgDocDeliveryNote: "Delivery note",
  mfgGenealogyKindMaterial: "Material",
  mfgGenealogyKindProduced: "Produced",
  mfgGenealogyKindSold: "Sold",

  // Manufacturing typed errors (manufacturing-errors.ts codes → mfgErr*)
  mfgErrBomNotFound: "The bill of materials does not exist in this tenant.",
  mfgErrBomVersionConflict: "That version number is already in use for this item — create a new version.",
  mfgErrBomNotDraft: "The version is not a draft — editing and activation apply to drafts only.",
  mfgErrBomNotActive: "The version is not active — only active versions archive.",
  mfgErrBomActiveExists: "The item already has another active version — archive it first (one active per item).",
  mfgErrBomLineInvalid: "Invalid component line — check the item, a positive qty, and no duplicate component.",
  mfgErrBomCycle: "The recipe chain revisits an item — circular bills of materials are rejected.",
  mfgErrBomTooDeep: "The explosion exceeds the 16-level depth cap.",
  mfgErrBomItemNotStock: "The item must be a stock item — services never enter bills of materials.",
  mfgErrBomSelfReference: "An item cannot be a component of its own bill of materials.",
  mfgErrBomYieldInvalid: "Yield must be greater than 0 and at most 100 (≤ 4 decimal places).",
  mfgErrBomUomMismatch: "The output unit must match the item's base unit of measure.",
  mfgErrBomRequired: "The item has no active bill of materials — create and activate one, or pick an explicit version.",
  mfgErrOrderNotFound: "The production order does not exist in this tenant.",
  mfgErrOrderState: "The order's state does not allow this action (completed and cancelled are terminal).",
  mfgErrOrderInputInvalid: "Invalid order data — check the quantities, dates and warehouses.",
  mfgErrOrderItemNotStock: "The output item must be a stock item — services are never manufactured.",
  mfgErrConsumptionNotPlanned: "The item is not one of the frozen plan's components — correct with an adjusted consumption of a planned component.",
  mfgErrScrapReasonRequired: "A scrap reason code is required by the tenant's policy (1–40 characters).",
  mfgErrScrapExceedsWip: "The scrap value exceeds the order's current WIP balance.",
  mfgErrCompleteWithoutConsumption: "The order cannot complete before materials are consumed — record a consumption first.",
  mfgErrCostRounding: "The unit cost cannot represent the FG value at 4 decimal places — review the actual qty.",
  mfgErrFgShelfLifeRequired: "The item tracks expiry and the shelf-life policy is on, but the item carries no shelf-life days.",
  mfgErrOrderNotCancelable: "The order has consumptions — corrections are adjusted consumptions, not cancels.",
  mfgErrInspectionNotFound: "The inspection does not exist in this tenant.",
  mfgErrInspectionTargetNotFound: "The goods receipt does not exist in this tenant.",
  mfgErrInspectionTargetInvalid: "Invalid inspection target — a production order must be COMPLETED, and a goods receipt needs its id.",
  mfgErrInspectionInputInvalid: "Invalid inspection data — check the sample flag, its size, and the date.",
  mfgErrDispositionRequired: "A FAIL inspection requires a disposition (accept, scrap, rework or return to supplier).",
  mfgErrDispositionInvalid: "The disposition does not fit the result — PASS allows none or ACCEPT only; return-to-supplier is goods-receipt-only.",
  mfgErrQcScrapBatchNotQuarantined: "The order has no QUARANTINED finished-goods batch — the QC scrap flow needs a held batch.",
  mfgErrQcScrapEmptyBatch: "The quarantined batch is empty — no on-hand left to scrap.",
  mfgErrGenealogyBatchNotFound: "The batch does not exist in this tenant.",

  // -- PHASE-019 (T50): crm navigation & screens ---------------------
  // (leads pipeline + tasks/activities + service contracts + recurring
  // billing + time entries + service orders + the projects dimension +
  // the GL project filter + the dashboard CRM card)

  crmNavSection: "CRM",
  crmPipelineTitle: "Lead pipeline",
  crmTasksTitle: "Follow-up tasks & activities",
  crmContractsTitle: "Service contracts",
  crmBillingTitle: "Recurring billing",
  crmTimeTitle: "Time entries",
  crmServiceOrdersTitle: "Service orders",
  accountingProjectsTitle: "Projects",

  // GL project filter (the T44 projectId query param)
  accountingGlProjectFilter: "Project",
  accountingGlAllProjects: "All projects",

  // Lead pipeline screen (the board + conversion wizard + lose dialog)
  crmLeadsNew: "New lead",
  crmLeadsEmpty: "No leads recorded yet.",
  crmLeadsAllStatuses: "All statuses",
  crmLeadStatusNew: "New",
  crmLeadStatusQualified: "Qualified",
  crmLeadStatusConverted: "Converted",
  crmLeadStatusLost: "Lost",
  crmLeadColName: "Name",
  crmLeadColCompany: "Company",
  crmLeadColContact: "Contact",
  crmLeadColSource: "Source",
  crmLeadColOwner: "Owner",
  crmLeadColPartner: "Partner",
  crmLeadColCreated: "Created",
  crmLeadColLostReason: "Lost reason",
  crmLeadSourceWalkIn: "Walk-in",
  crmLeadSourceReferral: "Referral",
  crmLeadSourceWebsite: "Website",
  crmLeadSourceCampaign: "Campaign",
  crmLeadSourceCall: "Call",
  crmLeadSourceOther: "Other",
  crmLeadCreateTitle: "Register a lead",
  crmLeadEditTitle: "Edit the lead",
  crmLeadName: "Name",
  crmLeadNameAr: "Arabic name",
  crmLeadPhone: "Phone",
  crmLeadEmail: "Email",
  crmLeadCompany: "Company",
  crmLeadSource: "Source",
  crmLeadOwner: "Owning sales rep",
  crmLeadNote: "Note",
  crmLeadConvert: "Convert",
  crmLeadConvertTitle: "Convert the lead to a partner",
  crmLeadConvertMode: "Conversion mode",
  crmLeadConvertNewPartner: "Create a new partner",
  crmLeadConvertMerge: "Link an existing partner",
  crmLeadConvertPartner: "Target partner",
  crmLeadConvertHint: "Conversion is final — the lead links to the partner forever and accepts no further edits.",
  crmLeadLose: "Mark lost",
  crmLeadLoseTitle: "Mark the lead lost",
  crmLeadLoseReason: "Lost reason (1–200 characters)",
  crmLeadCreatedToast: "Lead recorded.",
  crmLeadSavedToast: "Lead changes saved.",
  crmLeadConvertedToast: "Lead converted — partner {partner}.",
  crmLeadLostToast: "Lead marked lost.",

  // Tasks + activities screen (future work + the logged-past timeline)
  crmTasksNew: "New task",
  crmTasksEmpty: "No tasks yet.",
  crmTasksAllStatuses: "All statuses",
  crmTaskStatusOpen: "Open",
  crmTaskStatusDone: "Done",
  crmTaskStatusCancelled: "Cancelled",
  crmTaskColTitle: "Task",
  crmTaskColDue: "Due",
  crmTaskColRemind: "Remind",
  crmTaskColAssignee: "Assignee",
  crmTaskColRelated: "Related to",
  crmTaskCreateTitle: "New follow-up task",
  crmTaskEditTitle: "Edit the task",
  crmTaskTitleLabel: "Task title",
  crmTaskAssignee: "Assignee",
  crmTaskDueDate: "Due date",
  crmTaskRemindAt: "Reminder date",
  crmTaskRemindTime: "Reminder time",
  crmTaskNote: "Note",
  crmTaskRelatedType: "Related type",
  crmTaskRelatedLead: "Lead",
  crmTaskRelatedPartner: "Partner",
  crmTaskRelatedContract: "Service contract",
  crmTaskRelatedServiceOrder: "Service order",
  crmTaskRelatedTarget: "Related record",
  crmTaskCreatedToast: "Task created.",
  crmTaskSavedToast: "Task changes saved.",
  crmTaskComplete: "Complete",
  crmTaskCompletedToast: "Task completed.",
  crmTaskCancelledToast: "Task cancelled.",
  crmActivitiesTitle: "Activity timeline",
  crmActivitiesEmpty: "No activities logged for this relation.",
  crmActivitiesHint: "Select a task to load the activities of its related record.",
  crmActivityColOccurredAt: "Date",
  crmActivityColKind: "Kind",
  crmActivityColSummary: "Summary",
  crmActivityColDuration: "Duration (min)",
  crmActivityKindCall: "Call",
  crmActivityKindMeeting: "Meeting",
  crmActivityKindEmail: "Email",
  crmActivityKindNote: "Note",
  crmActivityLogTitle: "Log an activity",
  crmActivityKindLabel: "Activity kind",
  crmActivityOccurredAt: "Activity date",
  crmActivityOccurredTime: "Activity time",
  crmActivitySummary: "Summary",
  crmActivityDuration: "Duration in minutes (optional)",
  crmActivityLoggedToast: "Activity logged.",

  // Service contracts screen (list + create/edit + schedule + preview + advances)
  crmContractsNew: "New contract",
  crmContractsEmpty: "No contracts yet.",
  crmContractsAllStatuses: "All statuses",
  crmContractStatusDraft: "Draft",
  crmContractStatusActive: "Active",
  crmContractStatusCancelled: "Cancelled",
  crmContractStatusRenewed: "Renewed",
  crmContractExpiredChip: "Expired",
  crmContractColNo: "Contract no",
  crmContractColPartner: "Partner",
  crmContractColTitle: "Title",
  crmContractColFeeModel: "Fee model",
  crmContractColTerm: "Term",
  crmContractColMonthly: "Monthly amount",
  crmFeeModelRetainer: "Retainer",
  crmFeeModelMilestones: "Milestones",
  crmFeeModelHourly: "Hourly",
  crmContractCreateTitle: "New service contract",
  crmContractPartner: "Partner (customer)",
  crmContractProject: "Project (optional)",
  crmContractTitleLabel: "Contract title",
  crmContractTitleAr: "Arabic title",
  crmContractScope: "Scope of work",
  crmContractFeeModel: "Fee model",
  crmContractStartDate: "Start date",
  crmContractEndDate: "End date",
  crmContractMonthlyAmount: "Monthly amount (retainer)",
  crmContractFeeItem: "Default fee item",
  crmContractFeeItemHint: "Stamped into the billing-schedule rows at creation (a SERVICE item).",
  crmContractNote: "Note",
  crmContractMilestones: "Milestones",
  crmContractMilestoneLabel: "Milestone label",
  crmContractMilestoneDue: "Due date",
  crmContractMilestoneAmount: "Amount",
  crmContractAddMilestone: "Add milestone",
  crmContractRemoveMilestone: "Remove",
  crmContractEditTitle: "Edit the contract (draft)",
  crmContractWorkspace: "Contract workspace",
  crmContractActivatedAt: "Activated at",
  crmContractRenewedTo: "Renewal contract",
  crmContractCancelReasonLabel: "Cancellation reason",
  crmContractActivate: "Activate",
  crmContractActivateHint: "Activation reserves the CT- contract number and stamps the final billing schedule — the active contract accepts no edits afterwards.",
  crmContractCancelAction: "Cancel contract",
  crmContractCancelTitle: "Cancel the service contract",
  crmContractRenew: "Renew",
  crmContractRenewTitle: "Renew the contract",
  crmContractRenewStart: "New term start (optional)",
  crmContractRenewEnd: "New term end (optional)",
  crmContractRenewHint: "Renewing creates a fresh DRAFT copy of this contract's lines and links it as the renewal.",
  crmContractCreatedToast: "Contract created (DRAFT) — the schedule is stamped at activation.",
  crmContractSavedToast: "Contract changes saved.",
  crmContractActivatedToast: "Contract activated — number {no}.",
  crmContractCancelledToast: "Contract cancelled.",
  crmContractRenewedToast: "Renewal contract created — number {no}.",
  crmScheduleTitle: "Billing schedule",
  crmScheduleEmpty: "No schedule rows.",
  crmScheduleColEntryType: "Type",
  crmScheduleColPeriod: "Period",
  crmScheduleColWindow: "Window",
  crmScheduleColBillDate: "Bill date",
  crmScheduleColAmount: "Amount",
  crmScheduleColMilestone: "Milestone",
  crmScheduleEntryRetainer: "Retainer period",
  crmScheduleEntryMilestone: "Milestone",
  crmScheduleEntryHourly: "Hourly period",
  crmScheduleStatusPlanned: "Planned",
  crmScheduleStatusInvoiced: "Invoiced",
  crmScheduleStatusSkipped: "Skipped",
  crmPreviewTitle: "Billing preview",
  crmPreviewAsOf: "As of",
  crmPreviewRun: "Show preview",
  crmPreviewEmpty: "No entries due as of the selected date.",
  crmPreviewLockedChip: "period locked",
  crmPreviewNarrativeChip: "no narrative",
  crmPreviewPullable: "Billable time entries",
  crmPreviewNeedsNarrative: "Entries needing a narrative before billing",
  crmAdvancesTitle: "Advances",
  crmAdvancesEmpty: "No advances tagged to this contract.",
  crmAdvancesTag: "Tag an advance",
  crmAdvancesTagTitle: "Tag an advance to the contract",
  crmAdvanceReceipt: "Receipt",
  crmAdvanceNote: "Note",
  crmAdvancePolicyHint: "Draws on the receipt's unallocated on-account credit; the tenant policy decides the deferral journal.",
  crmAdvanceColReceipt: "Receipt",
  crmAdvanceColAmount: "Amount",
  crmAdvanceColStatus: "Status",
  crmAdvanceColJournals: "Journals",
  crmAdvanceStatusHeld: "Held",
  crmAdvanceStatusReleased: "Released",
  crmAdvanceTaggedToast: "Advance tagged to the contract.",

  // Recurring billing screen (runs history + manual run + drafts review)
  crmBillingRunsTitle: "Billing run history",
  crmBillingRunsEmpty: "No recurring billing runs yet.",
  crmBillingColAt: "At",
  crmBillingColActor: "Run by",
  crmBillingColAsOf: "As of",
  crmBillingColScanned: "Contracts scanned",
  crmBillingColDrafts: "Drafts",
  crmBillingColLocked: "Locked",
  crmBillingColDuplicates: "Duplicates",
  crmBillingColNarrative: "No narrative",
  crmBillingRunAction: "Run billing",
  crmBillingRunTitle: "Run recurring billing",
  crmBillingRunAsOf: "As of",
  crmBillingPreviewAll: "Dry preview (all active contracts)",
  crmBillingPreviewTitle: "Dry preview",
  crmBillingPreviewEmpty: "No entries due as of the selected date.",
  crmBillingPreviewContract: "Contract",
  crmBillingRunToast: "Run complete — {drafts} draft invoices, {scanned} contracts scanned.",
  crmBillingDraftsTitle: "Contract invoices (drafts & history)",
  crmBillingDraftsEmpty: "No contract-generated invoices yet.",
  crmBillingDraftsColContract: "Contract",
  crmBillingDraftsColInvoice: "Invoice",
  crmBillingDraftsColPeriod: "Period",
  crmBillingDraftsColMilestone: "Milestone",
  crmBillingDraftsColCreatedAt: "Created",
  crmBillingDraftsLink: "Open the sales invoices screen",

  // Time entries screen (timeslips + weekly review)
  crmTimeNew: "Log time",
  crmTimeEmpty: "No time entries yet.",
  crmTimeColDate: "Date",
  crmTimeColProject: "Project",
  crmTimeColFeeItem: "Fee item",
  crmTimeColHours: "Hours",
  crmTimeColRate: "Rate/hour",
  crmTimeColNarrative: "Narrative",
  crmTimeColBillable: "Billable",
  crmTimeColEarner: "Fee earner",
  crmTimeCreateTitle: "Log time",
  crmTimeEditTitle: "Edit the time entry",
  crmTimeEntryDate: "Entry date",
  crmTimeHours: "Hours",
  crmTimeFeeItem: "Fee item",
  crmTimeProject: "Project",
  crmTimeCaseHint: "This tenant requires a project (case) on every time entry.",
  crmTimeContract: "Contract (optional — resolves the rate from the price list)",
  crmTimeFeeEarner: "Fee earner",
  crmTimeRate: "Rate/hour (manual — optional)",
  crmTimeRateHint: "The rate is snapshotted at recording and never recomputed; leave empty to resolve it from the contract partner's price list.",
  crmTimeNarrative: "Narrative (required for hourly billing)",
  crmTimeBillable: "Billable",
  crmTimeYes: "Yes",
  crmTimeNo: "No",
  crmTimeCreatedToast: "Time recorded.",
  crmTimeSavedToast: "Time entry saved.",
  crmTimeVoid: "Void",
  crmTimeVoidedToast: "Time entry voided.",
  crmTimeStatusDraft: "Draft",
  crmTimeStatusApproved: "Approved",
  crmTimeStatusBilled: "Billed",
  crmTimeStatusVoid: "Void",
  crmTimeReviewTitle: "Approve a weekly timesheet",
  crmTimeReviewWeek: "Week start (Monday)",
  crmTimeReviewHint: "Approves every DRAFT time entry in the selected week (Monday → Sunday).",
  crmTimeReviewToast: "Approved {count} time entries for the week of {week}.",

  // Service orders screen (the job-card workspace pattern)
  crmServiceOrdersNew: "New service order",
  crmServiceOrdersEmpty: "No service orders yet.",
  crmServiceOrdersAllStatuses: "All statuses",
  crmServiceOrderStatusDraft: "Draft",
  crmServiceOrderStatusInProgress: "In progress",
  crmServiceOrderStatusCompleted: "Completed",
  crmServiceOrderStatusInvoiced: "Invoiced",
  crmServiceOrderStatusCancelled: "Cancelled",
  crmServiceOrderColNo: "Order no",
  crmServiceOrderColPartner: "Partner",
  crmServiceOrderColContract: "Contract",
  crmServiceOrderCreateTitle: "New service order",
  crmServiceOrderPartner: "Partner (customer)",
  crmServiceOrderContract: "Contract (optional)",
  crmServiceOrderContractHint: "The contract link is provenance only — it never alters a journal.",
  crmServiceOrderLines: "Order lines",
  crmServiceOrderLineType: "Type",
  crmServiceOrderLineService: "Service",
  crmServiceOrderLineParts: "Parts",
  crmServiceOrderItem: "Item",
  crmServiceOrderDescription: "Description",
  crmServiceOrderHours: "Estimated hours",
  crmServiceOrderQty: "Qty",
  crmServiceOrderUnitPrice: "Unit price",
  crmServiceOrderAddLine: "Add line",
  crmServiceOrderRemoveLine: "Remove",
  crmServiceOrderWorkspace: "Service order workspace",
  crmServiceOrderEditTitle: "Edit the service order (draft)",
  crmServiceOrderApprove: "Approve",
  crmServiceOrderApproveTitle: "Approve the service order",
  crmServiceOrderIssueMode: "Parts issue mode",
  crmServiceOrderIssueImmediate: "Issue immediately (COGS journal at approval)",
  crmServiceOrderIssueReserve: "Reserve (consumed at invoicing)",
  crmServiceOrderLogHours: "Log hours",
  crmServiceOrderLogHoursTitle: "Log hours on a service line",
  crmServiceOrderLine: "Line",
  crmServiceOrderComplete: "Complete",
  crmServiceOrderInvoiceAction: "Invoice",
  crmServiceOrderCancelAction: "Cancel order",
  crmServiceOrderCancelTitle: "Cancel the service order",
  crmServiceOrderCancelReason: "Cancellation reason",
  crmServiceOrderCreatedToast: "Service order created — number {no}.",
  crmServiceOrderSavedToast: "Service order changes saved.",
  crmServiceOrderApprovedToast: "Service order approved.",
  crmServiceOrderHoursToast: "Hours logged on the line.",
  crmServiceOrderCompletedToast: "Service order completed.",
  crmServiceOrderInvoicedToast: "Service order invoiced — invoice {invoice}.",
  crmServiceOrderCancelledToast: "Service order cancelled.",
  crmServiceOrderColLineNo: "#",
  crmServiceOrderColLineType: "Type",
  crmServiceOrderColItem: "Item",
  crmServiceOrderColHours: "Hours",
  crmServiceOrderColQty: "Qty",
  crmServiceOrderColPrice: "Price",
  crmServiceOrderColLogged: "Logged",
  crmServiceOrderColStatus: "Status",
  crmServiceOrderLineStatusPending: "Pending",
  crmServiceOrderLineStatusReserved: "Reserved",
  crmServiceOrderLineStatusIssued: "Issued",
  crmServiceOrderLineStatusInvoiced: "Invoiced",
  crmServiceOrderLineStatusVoid: "Void",
  crmServiceOrderIssueValue: "Issue value",

  // Projects screen (accounting.projects — the cost-center mirror)
  accountingProjectsNew: "New project",
  accountingProjectsEmpty: "No projects yet.",
  accountingProjectColParent: "Parent project",
  accountingProjectCreateTitle: "New project",
  accountingProjectCode: "Project code",
  accountingProjectCodeHint: "Letters, digits and dashes only, 1–20 characters (e.g. CASE-01).",
  accountingProjectNameAr: "Arabic name",
  accountingProjectParent: "Parent project (optional)",
  accountingProjectStatusOpen: "Open",
  accountingProjectStatusClosed: "Closed",
  accountingProjectEditTitle: "Edit the project",
  accountingProjectClose: "Close",
  accountingProjectReopen: "Reopen",
  accountingProjectCloseTitle: "Close the project",
  accountingProjectCloseHint: "A closed project rejects new journal-line stamps; posted history stays untouched.",
  accountingProjectCreatedToast: "Project created.",
  accountingProjectSavedToast: "Project changes saved.",
  accountingProjectStatusToast: "Project status updated.",
  accountingProjectErrCodeTaken: "That project code is already in use in this tenant.",

  // Dashboard CRM card (the permission-gated summary section)
  dashboardCrmTitle: "CRM at a glance",
  dashboardCrmPipeline: "Pipeline: {newCount} new · {qualifiedCount} qualified",
  dashboardCrmFollowUps: "Follow-ups due today: {dueToday} · overdue: {overdue}",
  dashboardCrmExpiring: "Contracts expiring within 30 days: {count}",
  dashboardCrmUpcoming: "Billing entries within 7 days: {count}",
  dashboardCrmOpen: "Open the lead pipeline",

  // CRM typed errors (crm-errors.ts codes → crmErr*)
  crmErrLeadNotFound: "The lead does not exist in this tenant.",
  crmErrLeadInputInvalid: "Invalid lead input — please check the fields.",
  crmErrLeadConverted: "The lead is converted or closed — it accepts no further operations.",
  crmErrLeadLostReason: "Marking a lead lost requires a reason (1–200 characters).",
  crmErrLeadMergeTarget: "Invalid merge target — it must be an existing customer partner in this tenant.",
  crmErrTaskNotFound: "The task does not exist in this tenant.",
  crmErrTaskState: "The task's status does not allow this operation.",
  crmErrTaskInput: "Invalid task input — check the title, the relation and the dates.",
  crmErrActivityInput: "Invalid activity input — check the kind, the summary and the date.",
  crmErrContractNotFound: "The service contract does not exist in this tenant.",
  crmErrContractState: "The contract's status does not allow this operation (only drafts edit and activate).",
  crmErrContractInput: "Invalid contract input — check the partner, the term, the fee model and the fee items.",
  crmErrContractTerm: "Invalid contract term — the end must be on or after the start.",
  crmErrScheduleNotFound: "The schedule entry does not exist in this tenant.",
  crmErrAdvanceState: "The receipt cannot back this advance — check its status, partner, currency and that it is not already tagged.",
  crmErrAdvanceInsufficient: "The receipt's unallocated on-account credit is smaller than the requested advance.",
  crmErrTimeNotFound: "The time entry does not exist in this tenant.",
  crmErrTimeState: "The time entry's status does not allow this operation.",
  crmErrTimeInput: "Invalid time entry — check the hours, the fee item and the rate.",
  crmErrTimeCaseRequired: "This tenant requires a projectId (case) on every time entry.",
  crmErrTimesheetEmpty: "The selected week has no DRAFT time entries to approve.",
  crmErrServiceOrderNotFound: "The service order does not exist in this tenant.",
  crmErrServiceOrderState: "The service order's status does not allow this operation (an invoiced order is cancelled by credit note, never in place).",
  crmErrServiceOrderInput: "Invalid service order input — check the partner, the contract and the lines.",
  crmErrServiceOrderLine: "Invalid line — service lines need a SERVICE item with hours; parts lines need a STOCK item with a qty.",
  crmErrServiceOrderPosting: "The service-order posting configuration is incomplete — contact the administrator.",

  // -- PHASE-020 (T14): sync admin screens — English -------------------
  syncDevicesTitle: "Device management",
  syncHealthTitle: "Sync health",
  syncReconciliationTitle: "Revoked-device reconciliation",
  syncDevicesSubtitle:
    "The registered device registry (class, platform, contract version, attestation state, trust flags, last pull/push, data expiry) with the revoke / trust-flag / data-expiry actions.",
  syncHealthSubtitle:
    "The sync health dashboard: push success and processing latency, cursor lag per entity, conflicts and rejections, the outbox lag gauge, and derived alerts.",
  syncReconciliationSubtitle:
    "The revoked-device queue for unresolved state — pending commands and device-owned drafts; reassign draft ownership to close the queue.",

  // Device registry screen (/platform/devices)
  syncDevicesEmpty: "No devices are registered in this tenant.",
  syncDevicesColName: "Device",
  syncDevicesColClass: "Class",
  syncDevicesColPlatform: "Platform",
  syncDevicesColContract: "Contract",
  syncDevicesColAttestation: "Attestation",
  syncDevicesColTrustFlags: "Trust flags",
  syncDevicesColLastPull: "Last pull",
  syncDevicesColLastPush: "Last push",
  syncDevicesColStatus: "Status",
  syncDevicesColDataExpiry: "Data expiry",
  syncDevicesColPending: "Pending commands",
  syncDevicesFilterClass: "Device class",
  syncDevicesFilterClassAll: "All classes",
  syncDevicesFilterStatus: "Status",
  syncDevicesFilterStatusAll: "All statuses",
  syncDevicesFilterStatusActive: "Active",
  syncDevicesFilterStatusRevoked: "Revoked",
  syncDevicesFilterApply: "Apply",
  syncDevicesClassPosTerminal: "POS terminal",
  syncDevicesClassTauriDesktop: "Tauri desktop",
  syncDevicesClassAndroidField: "Android field",
  syncDevicesClassAndroidPersonal: "Android personal",
  syncDevicesAttested: "Attested",
  syncDevicesAttestationPending: "Attestation pending",
  syncDevicesStatusActive: "Active",
  syncDevicesStatusRevoked: "Revoked",
  syncDevicesTrustFlagsNone: "None",
  syncDevicesActionRevoke: "Revoke device",
  syncDevicesActionFlag: "Flag trust",
  syncDevicesActionExpiry: "Set data expiry",
  syncDevicesActionDetail: "Sync state",
  syncDevicesRevokeTitle: "Revoke device",
  syncDevicesRevokeReason: "Reason (optional)",
  syncDevicesRevokeReasonPlaceholder: "Device lost…",
  syncDevicesRevokeConfirm:
    "Revocation kills every credential immediately and cannot be undone. Continue?",
  syncDevicesRevokeAction: "Revoke permanently",
  syncDevicesRevokedToast: "The device has been revoked.",
  syncDevicesFlagTitle: "Flag device trust",
  syncDevicesFlagKey: "Key",
  syncDevicesFlagValue: "Value",
  syncDevicesFlagHint: "Merged into the existing flags (never replaces them) — e.g. key jailbroken, value suspected.",
  syncDevicesFlagAction: "Flag",
  syncDevicesFlaggedToast: "The trust flag was merged.",
  syncDevicesExpiryTitle: "Set the device data expiry",
  syncDevicesExpiryAt: "Data expires at",
  syncDevicesExpiryClear: "Clear",
  syncDevicesExpiryAction: "Save",
  syncDevicesExpirySetToast: "The device data expiry was set.",
  syncDevicesExpiryClearedToast: "The device data expiry was cleared.",
  syncDevicesDetailTitle: "Device sync state",
  syncDevicesDetailCursors: "Per-entity cursors",
  syncDevicesDetailEntity: "Entity",
  syncDevicesDetailLastSeq: "Last seq",
  syncDevicesDetailAckedAt: "Acknowledged",
  syncDevicesDetailNoCursors: "This device has no cursors yet.",
  syncDevicesDetailLoadError: "Failed to load the sync state.",
  syncDevicesPendingCommands: "Pending commands: {count}",

  // Sync health dashboard (/platform/sync-health)
  syncHealthPushTitle: "Push stats (last 7 days)",
  syncHealthPushTotal: "Total",
  syncHealthPushAccepted: "Accepted",
  syncHealthPushRejected: "Rejected",
  syncHealthPushDeferred: "Deferred",
  syncHealthPushSuccessRate: "Success rate",
  syncHealthPushP95: "p95 processing",
  syncHealthPushP95None: "No samples",
  syncHealthPullLagTitle: "Pull cursor lag by entity",
  syncHealthPullLagEntity: "Entity",
  syncHealthPullLagMaxLag: "Max lag",
  syncHealthPullLagDevices: "Devices",
  syncHealthPullLagEmpty: "No acknowledged cursors yet.",
  syncHealthPullLagNeverAck: "Never acknowledged",
  syncHealthConflictsTitle: "Conflicts by command type",
  syncHealthRejectionsTitle: "Rejections by reason",
  syncHealthBreakdownCount: "Count",
  syncHealthBreakdownEmpty: "No rejections in the window.",
  syncHealthOutboxTitle: "Outbox lag gauge (by last push)",
  syncHealthOutboxNever: "Never pushed",
  syncHealthOutboxLt1h: "Under 1 hour",
  syncHealthOutboxLt6h: "Under 6 hours",
  syncHealthOutboxLt24h: "Under 24 hours",
  syncHealthOutboxLt7d: "Under 7 days",
  syncHealthOutboxGt7d: "Over 7 days",
  syncHealthOutboxDevices: "devices",
  syncHealthRevokedTitle: "Revoked devices with pending ops",
  syncHealthRevokedDevices: "devices",
  syncHealthRevokedPending: "Pending commands",
  syncHealthRevokedDrafts: "Owned drafts",
  syncHealthTombstones: "Tombstones (GC ledger)",
  syncHealthAlertsTitle: "Alerts",
  syncHealthAlertsEmpty: "No alerts — every gauge is within its threshold.",
  syncHealthAlertSyncCursorStall:
    "Entity \"{entity}\" has not acknowledged a pull cursor for {days} days ({devices} device(s) affected).",
  syncHealthAlertSyncPushFailSpike:
    "Push success rate is {rate}% over the last 7 days ({total} commands, {rejected} rejected) — below the 90% threshold.",
  syncHealthGeneratedAt: "Report generated:",
  syncHealthLagDays: "days",
  syncHealthLagHours: "hours",
  syncHealthLagMinutes: "minutes",

  // Revoked-device reconciliation queue (/platform/sync-reconciliation)
  syncReconciliationEmpty: "The queue is empty — no revoked devices carry unresolved state.",
  syncReconciliationColDevice: "Id",
  syncReconciliationColName: "Device",
  syncReconciliationColRevokedAt: "Revoked at",
  syncReconciliationColPending: "Pending commands",
  syncReconciliationColDrafts: "Owned drafts",
  syncReconciliationColOldest: "Oldest pending",
  syncReconciliationReassign: "Reassign drafts",
  syncReconciliationReassignTitle: "Reassign draft ownership",
  syncReconciliationReassignFrom: "From device (revoked)",
  syncReconciliationReassignTo: "To device",
  syncReconciliationReassignToPlaceholder: "Pick an active device…",
  syncReconciliationReassignNoTargets:
    "Could not load the active-device list — enter the target device id manually.",
  syncReconciliationReassignAction: "Reassign",
  syncReconciliationReassignedToast: "Reassigned ownership of {count} draft(s).",

  // -- PHASE-021 (T2-b): the Offline Console dictionaries (EN) -------------------
  // (DR-P21-06 / MASTER-PLAN §6 — honest states, the CONFLICT_RESOLUTION §3
  // rejection action table, the 9 draft flows, cached reads, reprint, the
  // D-04 unlock screen, and the nav/dashboard affordances)

  // Console + shell states
  offlineNavSection: "Offline",
  offlineConsoleTitle: "Offline Console",
  offlineConsoleIntro:
    "Drafts, cached reads, and the sync queue — they run offline inside the desktop app; the server decides at sync time.",
  offlinePhaseBrowser: "Browser mode — online only",
  offlinePhaseIdle: "Idle",
  offlinePhaseSyncing: "Syncing…",
  offlinePhaseReadOnly: "Read-only",
  offlinePhaseRevoked: "Device revoked",
  offlinePhaseCorrupt: "Local store quarantined",
  offlineQueueLabel: "Queue",
  offlineAsOfLabel: "As of {time}",
  offlineAsOfNever: "Never synced",
  offlineOnlineLabel: "Online",
  offlineOfflineLabel: "Offline",
  offlineSyncNow: "Sync now",
  offlinePushNow: "Push now",
  offlineSyncUnavailable: "Unavailable in this shell build — update the app",
  offlineUpdatePrompt: "Update the app to resume syncing.",
  offlineUpdateAction: "Update the app now",
  offlineBannerReadOnly:
    "Read-only — the server's sync contract version is newer than this build understands. Reads stay available; local writes are refused until the update (C-08).",
  offlineBannerRevoked:
    "This device was revoked — no command can be sent, and the local tenant data was purged. Re-enroll with your administrator.",
  offlineBannerCorrupt:
    "The local store is quarantined (integrity check failed) — writes are refused until the documented recovery path runs.",
  offlineReadOnlyGate: "Local capture refused — the shell is read-only or quarantined.",

  // Online-only reasons (capability gating — never a silent no-op)
  offlineOnlineOnlyTitle: "Online only",
  offlineReasonBrowser:
    "This flow requires the desktop app — the browser never queues anything or simulates offline work.",
  offlineReasonNoStore: "The shell is present but the SQLite store is unavailable in this build.",
  offlineReasonNoSync: "The sync driver is unavailable in this shell build (update required).",
  offlineReasonNoPrint: "Printing is unavailable in this shell build.",

  // Honest states (draft_docs + outbox)
  offlineStateDraftLocal: "Local draft",
  offlineStatePendingMerge: "Pending merge",
  offlineStateSyncFailed: "Sync failed",
  offlineStateMerged: "Synced",
  offlineStateCancelledLocal: "Cancelled locally",
  offlineStatusQueued: "Queued",
  offlineStatusInFlight: "In flight",
  offlineStatusAcked: "Accepted",
  offlineStatusRejected: "Rejected",
  offlineStatusCancelled: "Cancelled",

  // Outbox / rejection queue view
  offlineOutboxTitle: "Queue & rejections",
  offlineOutboxIntro:
    "Every local command with its honest status — official numbers appear on acceptance only, and rejection payloads render exactly as the server sent them.",
  offlineOutboxEmpty: "The queue is empty — nothing pending.",
  offlineOutboxColCommand: "Command",
  offlineOutboxColStatus: "Status",
  offlineOutboxColCreated: "Created",
  offlineOutboxOfficialNo: "Official no.: {no}",
  offlineOutboxServerResponse: "Server response",
  offlineOutboxNoDraft: "No local draft row is linked to this command — it cannot be opened for editing here.",

  // Rejection reasons + meanings (CONFLICT_RESOLUTION §3 — the full table)
  offlineRejPeriodLocked: "Period locked",
  offlineRejPriceChanged: "Price changed",
  offlineRejInsufficientStock: "Insufficient stock",
  offlineRejCreditLimitExceeded: "Credit limit exceeded",
  offlineRejStaleVersion: "Stale version",
  offlineRejItemInactive: "Item inactive",
  offlineRejPartnerInactive: "Partner inactive",
  offlineRejValidationError: "Validation error",
  offlineRejDeviceRevoked: "Device revoked",
  offlineRejTenantSuspended: "Tenant suspended",
  offlineRejMeaningPeriodLocked: "The document date falls in a closed/locked period at sync time.",
  offlineRejMeaningPriceChanged: "The line price differs from the current server price beyond the tolerance policy.",
  offlineRejMeaningInsufficientStock: "Available quantity was below the requested one at execution.",
  offlineRejMeaningCreditLimitExceeded: "The partner's credit limit is exceeded including this document.",
  offlineRejMeaningStaleVersion: "The server row moved past baseVersion — review the diff and reconcile manually.",
  offlineRejMeaningItemInactive: "The referenced item was deactivated while offline.",
  offlineRejMeaningPartnerInactive: "The referenced partner was deactivated while offline.",
  offlineRejMeaningValidationError: "A structural/contract failure (missing line data or a bad amount format).",
  offlineRejMeaningDeviceRevoked: "The device lost sync rights — an administrative state, no resubmission.",
  offlineRejMeaningTenantSuspended: "The tenant account was suspended — an administrative state, no resubmission.",
  offlineRejAdminNote: "Administrative state — no resubmission; contact your administrator.",

  // Rejection actions (every choice is audit-logged via local_events)
  offlineActionEditResend: "Edit & resend",
  offlineActionAcceptServerPrice: "Accept server price",
  offlineActionCancel: "Cancel",
  offlineActionAcceptPartial: "Accept partial",
  offlineActionRequestApproval: "Request approval online",
  offlineActionReviewMerge: "Review & merge",
  offlineActionDiscard: "Discard local edit",
  offlineActionSubstitute: "Substitute & resend",
  offlineChoiceRecorded: "Your choice was recorded — it is audited on the next sync contact.",
  offlineEffectAcceptPrice: "Will resend with the server's price {price}.",
  offlineEffectAcceptPartial: "Will resend with qty {qty}.",
  offlineEffectApproval: "Collect a prepayment via an online receipt, then edit the document and resend it.",
  offlineEffectDiscard: "The local edit was discarded (audited).",
  offlineActionUnavailable: "The server response lacks the needed details — this action is unavailable.",
  offlineDiffServerRow: "Current server row",
  offlineDiffLocalRow: "Your local edit",

  // The 9 draft-flow tabs
  offlineTabInvoice: "Sales invoice draft",
  offlineTabQuotation: "Quotation draft",
  offlineTabDelivery: "Delivery note",
  offlineTabStockCount: "Stock count lines",
  offlineTabPartnerContact: "Partner contact edit",
  offlineTabPartnerCreate: "Partner create",
  offlineTabExpense: "Expense entry",
  offlineTabCashTransfer: "Cash transfer / drawer drop",
  offlineTabStockTransfer: "Stock transfer draft",
  offlineNoteDraft: "Offline draft — created locally; submit and approve online later.",
  offlineNoteMerge: "Field-level merge (non-constrained fields only) — every merge writes an audit event.",
  offlineNoteCount: "Counted quantities are facts — variance and adjustment are computed server-side only.",

  // Form fields
  offlineFieldCustomer: "Customer",
  offlineFieldItem: "Item",
  offlineFieldQty: "Qty",
  offlineFieldUnitPrice: "Unit price",
  offlineFieldServerPriceHint: "Leave empty and the server resolves the price at push",
  offlineFieldDiscount: "Discount",
  offlineFieldTaxCode: "Tax code",
  offlineFieldNote: "Note (EN)",
  offlineFieldNoteAr: "Note (AR)",
  offlineFieldDescription: "Description (EN)",
  offlineFieldDescriptionAr: "Description (AR)",
  offlineFieldAmount: "Amount",
  offlineFieldFee: "Fee",
  offlineFieldCurrency: "Currency code (3 letters)",
  offlineFieldExchangeRate: "Exchange rate",
  offlineFieldReference: "Reference",
  offlineFieldDate: "Date",
  offlineFieldValidUntil: "Valid until",
  offlineFieldValueDate: "Value date",
  offlineFieldWarehouseId: "Warehouse id (UUID)",
  offlineFieldFromWarehouse: "From warehouse (UUID)",
  offlineFieldToWarehouse: "To warehouse (UUID)",
  offlineFieldFromAccount: "From account (UUID)",
  offlineFieldToAccount: "To account (UUID)",
  offlineFieldCategoryId: "Expense category id (UUID)",
  offlineFieldCashAccountId: "Paid from account (UUID)",
  offlineFieldCountSession: "Count session",
  offlineFieldOrderId: "Linked sales order (UUID)",
  offlineFieldPartnerId: "Partner",
  offlineFieldKind: "Kind",
  offlineFieldCode: "Code",
  offlineFieldName: "Name (EN)",
  offlineFieldNameAr: "Name (AR)",
  offlineFieldTaxNumber: "Tax number",
  offlineFieldCreditLimit: "Credit limit",
  offlineFieldCreditTermsId: "Credit terms (UUID)",
  offlineFieldPriceListId: "Price list (UUID)",
  offlineFieldPhone: "Phone",
  offlineFieldPhone2: "Phone 2",
  offlineFieldEmail: "Email",
  offlineFieldAddress1: "Address — line 1",
  offlineFieldAddress2: "Address — line 2",
  offlineFieldCity: "City",
  offlineFieldContactPerson: "Contact person",
  offlineFieldPayee: "Payee",
  offlineFieldBatchRef: "Batch ref (UUID)",
  offlineFieldBatchId: "Batch (UUID)",
  offlineFieldSerialIds: "Serials (UUID)",
  offlineFieldSerialIdsHint: "comma-separated UUIDs",
  offlineFieldOptional: "optional",
  offlineFieldNoCatalog: "This directory is not cached locally yet — enter the UUID directly.",
  offlineLinesTitle: "Lines",
  offlineLinesAdd: "Add line",
  offlineLinesRemove: "Remove line",

  // Validation errors
  offlineErrRequired: "This field is required.",
  offlineErrUuid: "Enter a valid UUID.",
  offlineErrMoney: "Enter a valid decimal with at most 4 dp.",
  offlineErrQty: "Enter a valid decimal quantity with at most 6 dp.",
  offlineErrUnitPrice: "Enter a non-negative price with at most 6 dp.",
  offlineErrCountedQty: "Enter a non-negative counted qty with at most 6 dp (zero is legitimate).",
  offlineErrDate: "Enter a date as YYYY-MM-DD.",
  offlineErrFx: "Enter a valid exchange rate with at most 8 dp.",
  offlineErrCurrency: "Three Latin letters (e.g. SAR).",
  offlineErrKind: "Pick a kind from the list.",
  offlineErrMinLen: "The value is shorter than the minimum.",
  offlineErrMaxLen: "The value is longer than the maximum.",
  offlineErrLinesMin: "Add at least one line.",
  offlineErrLinesMax: "You exceeded the maximum line count.",
  offlineErrSameWarehouse: "The two warehouses must differ.",
  offlineErrSameAccount: "The two accounts must differ.",
  offlineErrAmountPositive: "The amount must be greater than zero.",
  offlineErrFeeRange: "The fee must be at least zero and strictly below the amount.",
  offlineErrContactOneField: "Enter at least one contact field.",

  // Submit + queue feedback
  offlineSubmitQueue: "Save draft locally",
  offlineSubmitting: "Saving…",
  offlineQueuedToast: "The draft was saved locally and will ride the next push.",

  // Cached reads + reprint
  offlineReadsTitle: "Cached reads",
  offlineReadsIntro: "Reads from the local store with an as-of label — stale data is labeled, never guessed.",
  offlineReadsSearchItems: "Search items",
  offlineReadsSearchPartners: "Search partners",
  offlineReadsItemsEmpty: "No results.",
  offlineReadsPartnersEmpty: "No results.",
  offlineReadsInvoicesTitle: "Sales invoices",
  offlineReadsInvoicesEmpty: "No invoices in the cache.",
  offlineReadsColDocNo: "Doc no.",
  offlineReadsColStatus: "Status",
  offlineReadsColDate: "Date",
  offlineReadsColTotal: "Total",
  offlineReadsColActions: "Actions",
  offlineReadsReprint: "Reprint",
  offlineReadsReprintNotPosted: "Not posted — only POSTED documents can be reprinted.",
  offlineReadsReprintSent: "The reprint was sent to the printer.",

  // The unlock screen (D-04)
  unlockTitle: "Unlock",
  unlockIntro: "The app unlocks against the cached permission snapshot — the server stays the final authority on every push.",
  unlockModeFull: "Full access per the cached permission snapshot",
  unlockModeReadOnly: "Read-only — online required",
  unlockReasonExpired: "The snapshot passed the 7-day watermark (D-04).",
  unlockReasonNone: "No cached snapshot — this device has never pulled permissions.",
  unlockSnapshotAt: "Snapshot from {date}",
  unlockPermissionsHeading: "Cached permission keys",
  unlockGoOffline: "Open the Offline Console",
  unlockBrowserNote: "In a browser there is no local store — access is read-only and requires a connection.",
  unlockRuleNote: "Within 7 days of the last permissions pull, unlock grants full access per the cached keys; beyond it the app degrades to read-only until it reconnects.",

  // Dashboard quick action
  dashboardOfflineNote: "Drafts, cached reads, and the sync queue — working without a connection inside the desktop app.",

  // Security disclosure policy page (PHASE-024 T14)
  disclosureTitle: "Security disclosure policy",
  disclosureIntro:
    "How to report security vulnerabilities to us, what we commit to in return, and the ground rules that keep research in good faith.",
  disclosureContactHeading: "Reporting a vulnerability",
  disclosureContactBody:
    "Email us with a description of the issue, the steps to reproduce it, and any proof of concept. Please encrypt sensitive details where you can, and include a contact address so we can reach you.",
  disclosureContactAddress: "security@erp.example",
  disclosureContactPlaceholderNote:
    "The address above is a documented placeholder in this deployment's documentation; the live contact address is configured at deployment time.",
  disclosureCommitmentHeading: "Our commitment",
  disclosureCommitmentAck: "We acknowledge reports within 48 hours.",
  disclosureCommitmentUpdates:
    "We keep reporters informed of triage, progress, and the fix timeline until the issue is resolved.",
  disclosureCommitmentCoordinated:
    "We follow coordinated disclosure: details are published only after a fix is available, in agreement with the reporter.",
  disclosureSafeHarborHeading: "Safe harbor",
  disclosureSafeHarborBody:
    "We will not take legal action against researchers who act in good faith, respect the guidelines below, and avoid harming our service or our tenants' data.",
  disclosureGuidelinesHeading: "What we ask of you",
  disclosureGuidelineTesting:
    "Please avoid production tenant data: test only with your own accounts and tenants, and never access, modify, or exfiltrate another tenant's data.",
  disclosureGuidelineNoDegrade:
    "Do not attempt denial-of-service, spam, or social engineering, and do not use scanners that generate heavy load.",
  disclosureGuidelineReport:
    "Report promptly once you find an issue, and give us reasonable time to fix it before any public disclosure.",
  disclosureScopeHeading: "Scope",
  disclosureScopeBody:
    "In scope: the web application and its API, the desktop and Android clients, the synchronization endpoints, and the e-invoicing sandbox surface. Reports about availability, spam, or configuration guesses outside these surfaces are out of scope.",
  disclosureTriageHeading: "How reports are handled",
  disclosureTriageBody:
    "Reports route to the on-call triage path and are classified on the incident severity ladder (SEV-1 to SEV-4); confirmed vulnerabilities follow severity-mapped fix timelines, and every confirmed report is retested before it is closed.",
  disclosureBountyNote:
    "A paid bug-bounty program is a separate post-GA decision; this page is the disclosure policy itself.",
  loginSecurityLink: "Security disclosure policy",

  // -- PHASE-025 (T9d): SLO dashboard — English -----------------------
  sloTitle: "Service SLOs",
  sloSubtitle:
    "The SLO / error-budget dashboard: the six finalized indicators (availability, latency, posting success, backup + restore-smoke, sync push, report rendering) with budget burn rates and burn alerts.",
  sloStateOk: "OK",
  sloStateBurning2x: "Burning 2×",
  sloStateBurning4x: "Burning 4×",
  sloStateNoData: "No data",
  sloNoDataNote: "No samples in the current measurement window.",
  sloBudgetLabel: "Error budget remaining",
  sloBudgetExhausted: "Budget exhausted",
  sloBurnLabel: "Burn rate",
  sloCardApiAvailability: "API availability",
  sloCardApiLatency: "API latency (p95)",
  sloCardPosting: "Posting success",
  sloCardBackup: "Backup + restore-smoke",
  sloCardSync: "Sync push success",
  sloCardReport: "Report render SLA",
  sloSummaryTitle: "Counter summary",
  sloAvailabilityRequests: "Requests (current window)",
  sloAvailabilityErrors: "5xx errors",
  sloPostingAttempts: "Posting attempts",
  sloPostingInvariantFailures: "Invariant failures",
  sloSyncDeferred: "Deferred commands",
  sloLatencyColGroup: "Group",
  sloLatencyColP50: "p50",
  sloLatencyColP95: "p95",
  sloLatencyColP99: "p99",
  sloLatencyColBudget: "Budget",
  sloLatencyColOverBudget: "Over budget",
  sloRouteGroupIdentity: "Identity & tenancy",
  sloRouteGroupAccounting: "Accounting",
  sloRouteGroupSales: "Sales",
  sloRouteGroupPurchasing: "Purchasing",
  sloRouteGroupTreasury: "Treasury & tax",
  sloRouteGroupInventory: "Inventory & manufacturing",
  sloRouteGroupSync: "Sync",
  sloRouteGroupPlatform: "Platform & reports",
  sloReportColClass: "Class",
  sloReportColRenders: "Renders",
  sloReportColBudget: "Budget",
  sloReportColOverBudget: "Over budget",
  sloReportClassInline: "Interactive",
  sloReportClassJob: "Background job",
  sloReportTemplatesTitle: "Slowest templates (p95)",
  sloBackupNoteTitle: "Backup + restore-smoke note",
  sloBackupExternalCadence:
    "No data in this window: the nightly restore-smoke and the drills run out-of-process — this card is fed through the recording seam when the metrics pipeline lands, and it is never shown green without data.",
  sloBackupNoFailuresNote:
    "Every restore-smoke run recorded in this window succeeded; any single miss exhausts the budget instantly (the 100% target).",
  sloBurnAlertsTitle: "Budget burn alerts",
  sloBurnAlertsEmpty: "No active burn alerts in this window.",
  sloAlertSev1: "Sev-1",
  sloAlertSev2: "Sev-2",
  sloAlertSloBurn:
    "Error-budget burning at {burn}× on “{slo}” — follow the runbook (MONITORING §5 + TROUBLESHOOTING §api).",
  sloAlertPostingInvariant:
    "The posting engine rejected an unbalanced entry {count} time(s) — zero tolerance (RISK-009); investigate immediately per the runbook (TROUBLESHOOTING §api).",
  sloDataSourceTitle: "Data source",
  sloDataSourceNote:
    "This dashboard is computed from the in-process metrics registry (the SF-024-021 pattern): cumulative counters and latency samples under unified erp_ names, which the OpenTelemetry exporter swap picks up unchanged once a backend is chosen.",
  sloWindowNote:
    "The measurement window is the current process lifetime (counters reset on restart); the 30-day error-budget window is the metrics pipeline's concern and is never fabricated here. A “no data” state is explicit and is never treated as green.",
  sloGeneratedAt: "Last evaluated:",

  // -- PHASE-026 (T13-UI): fixed assets & depreciation (EN) --------------------
  commonEdit: "Edit",
  navAccounting: "Accounting",
  navFixedAssets: "Fixed assets",

  faStatusActive: "Active",
  faStatusFullyDepreciated: "Fully depreciated",
  faStatusDisposed: "Disposed",
  faStatusWrittenOff: "Written off",
  faMethodSl: "Straight line",
  faMethodDb: "Declining balance",
  faMethodUop: "Units of production",

  faTitle: "Fixed assets",
  faAssetsEmpty: "No assets yet.",
  faAssetsNewButton: "New asset",
  faSearchPlaceholder: "Search by asset code or name…",
  faAllStatuses: "All statuses",
  faFilterCategory: "Category",
  faFilterBranch: "Branch",
  faFilterCustodian: "Custodian",
  faColCode: "Code",
  faColAcquisitionDate: "Acquisition date",
  faColCost: "Cost",
  faColAccumulated: "Accumulated",
  faColNbv: "Net book value",
  faColBranch: "Branch",
  faColCustodian: "Custodian",

  faFormTitleCreate: "New fixed asset",
  faFormTitleEdit: "Edit asset",
  faFormCode: "Code",
  faFormCodeHint: "auto-generated when left empty",
  faFormName: "Name (English)",
  faFormNameAr: "Name (Arabic)",
  faFormCategory: "Category",
  faFormCategoryHint: "Active categories listed; the server validates purpose completeness before use",
  faFormAcquisitionDate: "Acquisition date",
  faFormCost: "Cost",
  faFormSalvage: "Salvage value",
  faFormSalvageHint: "must be less than or equal to the cost",
  faFormLife: "Useful life (months)",
  faFormMethod: "Depreciation method",
  faFormBranch: "Branch",
  faFormCustodian: "Custodian",
  faFormNote: "Note (English)",
  faFormNoteAr: "Note (Arabic)",
  faFormUnitsTotal: "Total estimated units",
  faFormUnitsHint: "required for units of production",
  faFormOpeningAccumulated: "Opening accumulated to date",
  faFormOpeningHint: "for assets onboarded mid-life — future runs resume from the true NBV",
  faFormCreatedToast: "Asset created.",
  faFormSavedToast: "Asset saved.",
  faFormImmutableHint:
    "Basis fields are immutable after creation (cost/salvage/life/method/category/acquisition) — corrections are reversal-only via the posting engine",

  faOverviewTitle: "Asset details",
  faFinancialTitle: "Financial position",
  faAccumulatedCard: "Accumulated depreciation",
  faNbvCard: "Net book value",
  faSourceLabel: "Source",
  faSourceNone: "Not capitalized — no capitalization journal yet",
  faHistoryTitle: "Depreciation history",
  faHistoryColDate: "Date",
  faHistoryColAmount: "Period depreciation",
  faHistoryColAccumAfter: "Accumulated after",
  faHistoryColUnits: "Period units",
  faHistoryEmpty: "No depreciation yet.",
  faReversedBadge: "Reversed",
  faLifecycleTitle: "Lifecycle",
  faJournalEntry: "Journal entry",

  faCapitalizeTitle: "Capitalize asset (G-21)",
  faCapitalizeHint: "posts the capitalization journal through the engine — fixed assets never write GL directly",
  faCapitalizeFunding: "Funding source",
  faFundingCredit: "Credit (AP control)",
  faFundingCash: "Cash",
  faFundingOpening: "Opening equity",
  faCapitalizePartner: "Supplier",
  faCapitalizeOpeningNote: "the asset's recorded opening accumulated rides the same journal",
  faCapitalizeButton: "Capitalize",
  faCapitalizePostedToast: "Capitalized — journal entry {entry}",

  faRevaluateTitle: "Asset revaluation",
  faRevNewGross: "New gross value",
  faRevNewAccum: "New accumulated",
  faRevDeltaPreview: "NBV delta (posts to revaluation reserve)",
  faRevReason: "Reason",
  faRevCreateButton: "Create draft",
  faRevPostButton: "Post",
  faRevCreatedToast: "Revaluation draft created.",
  faRevPostedToast: "Revaluation posted to the revaluation reserve.",

  faCategoriesTitle: "Asset categories",
  faCategoriesEmpty: "No categories yet — create one first.",
  faCatNewButton: "New category",
  faCatColLife: "Default life (months)",
  faCatColMethod: "Default method",
  faCatColActive: "Active",
  faCatInUseBadge: "In use",
  faCatCode: "Category code",
  faCatCodeHint: "tenant-scoped natural key",
  faCatName: "Name (English)",
  faCatNameAr: "Name (Arabic)",
  faCatLife: "Default life (months)",
  faCatMethod: "Default method",
  faCatPurposesTitle: "Purpose links (advanced)",
  faCatPurposesHint:
    "defaults shown below; the server re-checks they resolve to active accounts before any use (BR-041)",
  faCatPurposeAsset: "Asset purpose",
  faCatPurposeAccum: "Accum. depreciation purpose",
  faCatPurposeExpense: "Depreciation expense purpose",
  faCatActive: "Active",
  faCatEditTitle: "Edit category",
  faCatCreatedToast: "Category created.",
  faCatSavedToast: "Category saved.",

  faDepTitle: "Depreciation runs",
  faDepEmpty: "No runs yet.",
  faDepPeriodLabel: "Fiscal period",
  faDepPeriodYear: "Fiscal year",
  faDepPeriodPeriod: "Period",
  faDepAssembleButton: "Assemble run",
  faDepAssembleHint: "one run per fiscal period — an existing draft is reused",
  faDepAssembledToast: "Run assembled.",
  faDepApplyUsage: "Apply usage & re-assemble",
  faDepApplyUsageHint: "rewrites the draft lines with the updated unit values",
  faDepPostButton: "Post run",
  faDepPostConfirmTitle: "Confirm run posting",
  faDepPostConfirmBody:
    "One journal entry of {amount} will be created (G-22); undo is engine-reversal only. Continue?",
  faDepPostedToast: "Run posted — journal entry {entry}",
  faDepReverseTitle: "Reverse run",
  faDepReverseReason: "Reversal reason",
  faDepReverseButton: "Reverse",
  faDepReversedToast: "Run reversed — the lines stay for audit.",
  faDepColPeriod: "Period",
  faDepColAssets: "Assets",
  faDepColTotal: "Total",
  faDepColPostedAt: "Posted at",
  faDepWorkspaceTitle: "Depreciation run workspace",
  faDepColMethod: "Method",
  faDepColUnits: "Period units",
  faDepColPeriodAmount: "Period amount",
  faDepColAccumAfter: "Accumulated after",
  faDepColNbvAfter: "NBV after",
  faDepNoLines: "No draft lines — assemble first.",
  faDepUopHint: "usage is manual per line for units of production (no metering)",
  faDepPreviewNote:
    "the preview is exact local math (no floats); the server re-assembly is the authority at posting",

  faDisposalsTitle: "Asset disposals",
  faDisposalsEmpty: "No disposals yet.",
  faDispNewButton: "New disposal",
  faDispColNo: "No.",
  faDispColAsset: "Asset",
  faDispColKind: "Kind",
  faDispColDate: "Date",
  faDispColProceeds: "Proceeds",
  faDispColNbv: "Net book value",
  faDispColGainLoss: "Gain/(loss)",
  faDispKindSale: "Sale",
  faDispKindScrap: "Scrap",
  faDispWizardTitle: "Disposal wizard",
  faDispStep1: "Pick asset",
  faDispStep2: "Disposal details",
  faDispStep3: "Review & submit",
  faDispNext: "Continue",
  faDispBack: "Back",
  faDispCreatedToast: "Disposal draft created — awaiting a second-user approval.",
  faDispAssetLabel: "Asset",
  faDispAssetHint: "active or fully depreciated assets only",
  faDispKindLabel: "Disposal kind",
  faDispDateLabel: "Disposal date",
  faDispProceedsLabel: "Proceeds",
  faDispProceedsHint: "for scrap: the zero must be explicit",
  faDispScrapZeroLabel: "I confirm proceeds are zero (scrap)",
  faDispReviewTitle: "Computed review",
  faDispReviewCost: "Cost",
  faDispReviewAccum: "Accumulated",
  faDispReviewNbv: "Net book value",
  faDispReviewGainLoss: "Gain/(loss)",
  faDispSubmitButton: "Create draft",
  faDispApproveHint:
    "separation of duties: a second user must approve — the draft creator cannot approve or post",
  faDispApproveButton: "Approve (second user)",
  faDispApprovedToast: "Disposal approved.",
  faDispPostButton: "Post & show voucher",
  faDispPostedToast: "Disposal {no} posted — journal entry {entry}",
  faDispVoucherTitle: "Disposal voucher (A4)",
  faDispPrintButton: "Print",
  faDispVoucherTotalsProceeds: "Proceeds",
  faDispVoucherTotalsAccum: "Accumulated depreciation",
  faDispVoucherTotalsCost: "Asset cost",
  faDispVoucherTotalsGainLoss: "Gain/(loss)",

  faReportsTitle: "Fixed-asset reports",
  faReportsHint: "asset register (as-of), depreciation schedule, and movements — with the tie assertions",
  faReportsEmpty: "No fixed-asset reports available yet.",

  faErrCategoryCodeTaken: "Category code is already taken.",
  faErrAssetCodeTaken: "Asset code is already taken.",
  faErrAssetImmutable: "Basis fields are immutable on an existing asset.",
  faErrPurposesNotMapped: "The category purposes do not resolve to active accounts (BR-041).",
  faErrInvalidAmount: "Invalid value — check cost, salvage value and life.",
  faErrUopUnitsRequired: "Total estimated units is required for units of production.",
  faErrImmutableDocument: "The document is posted and immutable — corrections are reversal-only.",
  faErrRunNotDraft: "The run is not a draft — it cannot be modified.",
  faErrRunDuplicate: "Only one run per fiscal period is allowed.",
  faErrPeriodLocked: "The fiscal period is locked (INV-011).",
  faErrNbvFloor: "Net book value would drop below the floor (salvage value).",
  faErrDisposalState: "The disposal state does not allow this operation.",
  faErrDisposalSod: "Separation of duties: the creator cannot approve or post.",
  faErrDisposalProceeds: "Invalid proceeds value.",
  faErrRevalState: "The revaluation state does not allow this operation.",
  faErrCapitalizeState: "The asset is already capitalized or not in a capitalizable state.",
  faErrAssetDisposedReuse: "Disposal happens exactly once, only from active/fully depreciated (INV-023).",

  // -- PHASE-027 (wave F): cheques & notes + installment plans ----------------
  navChequesNotes: "Cheques & notes",
  navPdcCalendar: "Maturity calendar",
  navInstallmentPlans: "Installment plans",

  notesKindCheque: "Cheque",
  notesKindPromissoryNote: "Promissory note",
  notesDirectionReceived: "Received",
  notesDirectionIssued: "Issued",
  notesStatusInCustody: "In custody",
  notesStatusEndorsedOut: "Endorsed out",
  notesStatusDeposited: "Deposited",
  notesStatusCollected: "Collected",
  notesStatusDishonored: "Dishonored",
  notesStatusDiscounted: "Discounted",
  notesStatusReturned: "Returned",

  notesTitle: "Cheques & notes",
  notesNewTitle: "Register a note",
  notesCalendarTitle: "Maturity calendar",
  notesReportsTitle: "Notes reports",
  notesReportsHint: "The notes register + custody report family (the notes.* scope).",
  notesReportsEmpty: "No report contracts registered for this module yet — no fabricated catalogs.",
  notesEmpty: "No matching notes.",
  notesNewButton: "Register note",
  notesSearchPlaceholder: "Search by note number or bank…",
  notesAllStatuses: "All statuses",
  notesFilterKind: "Kind",
  notesFilterDirection: "Direction",
  notesFilterPartner: "Partner",
  notesFilterMaturityRange: "Maturity date range",

  notesFormDirection: "Direction",
  notesFormDirectionHint:
    "Received = take a cheque/promissory note from a customer against a sales invoice (G-24). Issued = issue one to a supplier against a supplier invoice (G-27).",
  notesFormPartner: "Partner",
  notesFormNumber: "Note number",
  notesFormNumberHint: "The cheque/note number as printed (optional).",
  notesFormBank: "Issuing bank",
  notesFormBankHint: "The drawee bank (optional).",
  notesFormAmount: "Amount",
  notesFormCurrency: "Currency",
  notesFormRate: "Exchange rate",
  notesFormRateHint: "Required for foreign currency — must match the open item's original rate (INV-008).",
  notesFormIssueDate: "Issue date",
  notesFormMaturityDate: "Maturity date",
  notesFormSourceInvoice: "Source document",
  notesFormSourceInvoiceHint:
    "Posted documents only: a posted CREDIT sales invoice (received) or a posted supplier invoice (issued). Leaving it empty posts on-account.",
  notesFormSourceNone: "No source document (on account)",
  notesFormNote: "Note (EN)",
  notesFormNoteAr: "Note (AR)",
  notesFormSubmit: "Register the note",
  notesFormInvalid: "Invalid input — complete the required fields.",
  notesFormCreatedToast: "Note {number} registered — in custody.",

  notesOverviewTitle: "Note details",
  notesCustodyTitle: "Custody log",
  notesCustodyEmpty: "No custody events recorded yet.",
  notesJournalEntry: "Journal entry",
  notesCashAccountLabel: "Cash account",
  notesSourceLabel: "Source document",
  notesTerminalHint: "This status is terminal — no further custody events (INV-024).",
  notesActionsTitle: "Custody actions",

  notesEventReceive: "Note received",
  notesEventIssue: "Note issued",
  notesEventEndorse: "Endorsed out",
  notesEventDeposit: "Deposited at bank",
  notesEventCollect: "Collected at maturity",
  notesEventDishonor: "Dishonored",
  notesEventDiscount: "Discounted at bank",
  notesEventReturn: "Returned to partner",
  notesEventReclassify: "Reclassified (metadata correction)",

  notesActionEndorse: "Endorse",
  notesActionDeposit: "Deposit",
  notesActionCollect: "Collect",
  notesActionDishonor: "Dishonor",
  notesActionDiscount: "Discount",
  notesActionReturn: "Return",
  notesActionEndorsee: "Endorsee",
  notesActionDate: "Event date",
  notesActionReason: "Dishonor reason",
  notesActionReasonHint: "The reason is required (BR-046).",
  notesActionBankFee: "Bank fee",
  notesActionFee: "Discount fee",
  notesActionAccount: "Cash account",
  notesActionRate: "Exchange rate",
  notesEndorseToast: "Endorsed — the note is with the endorsee (no journal).",
  notesDepositToast: "Deposited — the cash account is stored (no journal).",
  notesCollectToast: "Collected — journal {entry}.",
  notesDishonorToast: "Dishonor recorded — journal {entry}.",
  notesDiscountToast: "Discounted — proceeds {proceeds} via journal {entry}.",
  notesReturnToast: "Returned — journal {entry}.",

  pdcAsOfLabel: "As of",
  pdcComputedAtLabel: "Last computed",
  pdcStaleWarning: "Data may be stale",
  pdcStaleHint: "The calendar refreshes daily; its age exceeded {hours} hours.",
  pdcBucketOverdue: "Overdue",
  pdcBucketThisWeek: "This week",
  pdcBucket30: "7–30 days",
  pdcBucket60: "30–60 days",
  pdcBucket90: "60–90 days",
  pdcBucketBeyond: "Beyond 90 days",
  pdcCountLabel: "Count",
  pdcAmountBaseLabel: "Base-currency amount",
  pdcReceivedSide: "Received notes",
  pdcIssuedSide: "Issued notes",
  pdcByPartnerTitle: "By partner",
  pdcByBankTitle: "By issuing bank",
  pdcNotesTitle: "Live notes",
  pdcBankUnspecified: "Unspecified",
  pdcDrillLink: "Open in register",
  pdcEmpty: "No live notes (unresolved custody).",

  notesErrSourceInvalid: "The source document is invalid — it must be a posted settleable invoice for the same partner and currency.",
  notesErrAlreadyPosted: "The note is already resolved by this event — the same money event cannot run twice (INV-013).",
  notesErrCustodyTransition: "This transition is not legal from the current status (the BR-047 custody machine).",
  notesErrDishonorReason: "A dishonor reason is required (BR-046).",
  notesErrRateMismatch: "The exchange rate must match the open item's original stored rate (INV-008).",
  notesErrCurrencyMismatch: "The note currency must match the source document currency.",
  notesErrAccountRequired: "This action requires a treasury cash account (pass one or deposit the note first).",
  notesErrFeeInvalid: "The fee is invalid — it must be between zero and the note amount.",
  notesErrDiscountCurrency: "Discounting non-base-currency notes is not supported in this phase — collect at maturity or return it.",
  notesErrFieldsImmutable: "Substantive fields are immutable after create — reclassify covers metadata only.",
  notesErrAccountCurrency: "The cash account currency must match the note currency.",

  instTitle: "Installment plans",
  instNewTitle: "Installment plan wizard",
  instReportsTitle: "Installments reports",
  instReportsHint: "The plan/schedule/collection report family (the installments.* scope).",
  instReportsEmpty: "No report contracts registered for this module yet — no fabricated catalogs.",
  instEmpty: "No matching installment plans.",
  instNewButton: "New plan",
  instSearchPlaceholder: "Search by source number…",
  instAllStatuses: "All statuses",
  instStatusDraft: "Draft",
  instStatusActive: "Active",
  instStatusClosed: "Closed",
  instStatusDefaulted: "Defaulted",
  instFilterPartner: "Partner",
  instFilterStatus: "Status",
  instFilterSource: "Source type",
  instSourceSalesInvoice: "Sales invoice",
  instSourceServiceContract: "Service contract",
  instColSource: "Source",
  instColTotal: "Total",
  instColSeq: "#",
  instColAmount: "Amount",
  instColReceipts: "Receipts",
  instColCollected: "Collected",
  instColLateFee: "Late fee",

  instFreqWeekly: "Weekly",
  instFreqBiweekly: "Biweekly",
  instFreqMonthly: "Monthly",
  instFreqQuarterly: "Quarterly",

  instDetailOverview: "Plan details",
  instDetailSchedule: "Installment schedule",
  instDetailScheduleEmpty: "No lines recorded for this plan.",
  instDetailPolicy: "Late-fee policy",
  instLineStatusPending: "Pending",
  instLineStatusDue: "Due",
  instLineStatusPaid: "Paid",
  instLineStatusOverdue: "Overdue",
  instLineStatusWaived: "Waived",
  instWaiveAction: "Waive line",
  instWaiveReason: "Waive reason",
  instWaiveToast: "Line {seq} waived — reason recorded.",
  instChargeLateFeeAction: "Charge late fee",
  instChargeLateFeeToast: "Late fee {fee} charged — journal {entry}.",

  instWizStepSource: "Source document",
  instWizStepSchedule: "Schedule parameters",
  instWizStepPolicy: "Late-fee policy",
  instWizStepOf: "Step {current} of {total}",
  instWizBack: "Back",
  instWizNext: "Next",
  instWizSourceType: "Source type",
  instWizSourceInvoice: "Posted credit sales invoice",
  instWizSourceContract: "Active service contract",
  instWizSourceTotal: "Source document total",
  instWizEstimateChip: "Estimate — preview only",
  instWizDownPayment: "Down payment",
  instWizCount: "Installment count",
  instWizStartDate: "First due date",
  instWizFrequency: "Frequency",
  instWizPreviewTitle: "Live schedule preview",
  instWizPreviewInvalid: "The computed schedule is invalid — adjust the down payment or the count.",
  instWizPolicyTitle: "Late-fee policy (BR-049)",
  instWizPolicyHint: "The values below are PLACEHOLDER defaults pending the final policy decision.",
  instWizPolicyRate: "Rate (per overdue line)",
  instWizPolicyCap: "Fee cap",
  instWizPolicyGrace: "Grace days",
  instWizPolicyAuto: "Auto-charge fees",
  instWizPolicyDefaulted: "Default after (unpaid lines)",
  instWizPlaceholderChip: "PLACEHOLDER (OQ-002)",
  instWizCreate: "Create plan (draft)",
  instWizActivate: "Activate plan",
  instWizActivateHint: "Activation verifies the plan total equals the live source document total EXACTLY (BR-048); the schedule is immutable afterwards.",
  instWizCreatedToast: "Plan created as a draft — review the schedule then activate.",
  instWizActivatedToast: "Plan activated — the schedule is final (BR-048).",
  instWizBrTotal: "Plan total (BR-048)",

  instErrSourceInvalid: "The source document is not plannable — a posted CREDIT sales invoice or an ACTIVE base-currency service contract.",
  instErrScheduleImmutable: "The plan is activated — the schedule is immutable (BR-048); corrections are waivers/audited close.",
  instErrSourceTaken: "A live plan already exists for this source document — one plan per source.",
  instErrTotalMismatch: "The plan total does not equal the source document total (BR-048) — rebuild the draft.",
  instErrScheduleInvalid: "The computed schedule is invalid — adjust the down payment or the count.",
  instErrSourceCurrency: "Plans over non-base-currency documents are not supported in this phase.",
  instErrPolicyInvalid: "The late-fee policy is invalid — check the rate, cap and grace days.",
  instErrLateFeeNotChargeable: "Late fees post only on OVERDUE lines not already charged (G-28).",
  instErrWaiveReason: "A waive reason is required (BR-049).",

  // -- PHASE-028 (budgeting): the period-column planning grid ----------------
  navBudgets: "Budgets",

  budgetsTitle: "Budgets",
  budgetsNewTitle: "New budget",
  budgetsImportTitle: "Import a budget grid",
  budgetsImportLink: "Import grid",
  budgetReportsTitle: "Budget reports",
  budgetReportsHint: "The budget-vs-actual + variance report family (the budgeting.* scope).",
  budgetReportsEmpty: "No report contracts registered for this module yet — no fabricated catalogs.",
  budgetsEmpty: "No matching budgets.",
  budgetsNewButton: "New budget",
  budgetsSearchPlaceholder: "Search by code or name…",
  budgetsAllStatuses: "All statuses",
  budgetsFilterStatus: "Status",
  budgetsFilterScope: "Scope",
  budgetsFilterYear: "Fiscal year",

  budgetStatusDraft: "Draft",
  budgetStatusPendingApproval: "Pending approval",
  budgetStatusActive: "Active",
  budgetStatusRevised: "Revised (superseded)",
  budgetStatusClosed: "Closed",
  budgetScopeAccounts: "Accounts",
  budgetScopeCostCenters: "Cost centers",
  budgetScopeProjects: "Projects",
  budgetScopeBranches: "Branches",

  budgetColCode: "Code",
  budgetColName: "Name",
  budgetColScope: "Scope",
  budgetColStatus: "Status",
  budgetColYear: "Fiscal year",
  budgetColRevision: "Revision",
  budgetColLines: "Lines",
  budgetColTotal: "Year total",

  budgetFormName: "Name (EN)",
  budgetFormNameAr: "Name (AR)",
  budgetFormFiscalYear: "Fiscal year",
  budgetFormScope: "Scope",
  budgetFormScopeHint:
    "Scope is a filter, not a fork — the four scopes share one engine; the scope only picks the optional dimension the grid groups by.",
  budgetFormNote: "Note (EN)",
  budgetFormNoteAr: "Note (AR)",
  budgetFormSubmit: "Create budget (draft)",
  budgetFormInvalid: "Invalid input — complete the required fields.",
  budgetFormCreatedToast: "Budget {code} created as a draft — enter the grid lines then submit it.",

  budgetGridTitle: "Budget grid",
  budgetGridDimension: "Dimension",
  budgetGridRowTotal: "Year total",
  budgetGridPeriodTotals: "Period totals",
  budgetGridYearTotal: "Year total",
  budgetGridAccount: "Account",
  budgetGridAddLine: "Add line",
  budgetGridRemoveLine: "Remove line",
  budgetGridSave: "Save grid",
  budgetGridSavedToast: "Grid saved — {lines} lines, year total {total}.",
  budgetGridReadOnly: "The grid is read-only — line edits are DRAFT-only (BR-050).",
  budgetGridEmpty: "No budget lines yet — add a line or import a grid.",
  budgetLiveTotals: "Live totals",

  budgetSubmit: "Submit for approval",
  budgetApprove: "Approve",
  budgetActivate: "Activate",
  budgetSupersede: "Create revision",
  budgetClose: "Close",
  budgetSubmitToast: "Budget submitted for approval (BR-050).",
  budgetApproveToast: "Approval stamped — it can be activated now.",
  budgetActivateToast: "Budget activated — the predecessor (if any) moved to revised.",
  budgetSupersedeToast: "A fresh DRAFT revision was created copying this budget's lines (BR-050).",
  budgetCloseToast: "Budget closed — it stays readable forever.",
  budgetSupersedeHint:
    "Supersede copies the lines into a new DRAFT linked to this version's chain; direct edits after draft are forbidden (BR-050).",

  budgetConsumption: "Budget vs actual",
  budgetActual: "Actual",
  budgetVariance: "Variance",
  budgetOverBudget: "Over budget",
  budgetAtOverBudget: "A period exceeded its budget",
  budgetAdvisoryNote: "Controls are advisory — no posting is ever blocked",
  budgetStaleWarning: "Data may be stale",
  budgetComputedAt: "Last computed",
  budgetConsumptionEmpty: "No consumption recorded against this budget's lines yet.",

  budgetImportChooseFile: "Choose the grid file (XLSX)",
  budgetImportFileRequired: "Choose an XLSX file first.",
  budgetImportFileTooLarge: "The file exceeds the allowed size (15 MB).",
  budgetImportBudgetRequired: "Choose a draft budget first.",
  budgetImportNoDrafts: "No draft budgets available — create a budget first (the import replaces the draft's grid whole).",
  budgetImportStepSetup: "Choose budget + file",
  budgetImportStepReview: "Dry-run report",
  budgetImportDryRun: "Dry run (no writes)",
  budgetImportDryRunTitle: "Dry-run report",
  budgetImportRowCount: "Row count",
  budgetImportValidRows: "Valid rows",
  budgetImportTotalsPreview: "Totals preview",
  budgetImportErrors: "Row errors",
  budgetImportClean: "All rows valid — the import can be committed.",
  budgetImportCommit: "Commit import (replace grid)",
  budgetImportCommitToast: "Import committed — {lines} lines, year total {total}.",
  budgetImportRowCap: "The import cap is 5,000 data rows — split the file per dimension.",
  budgetExportLabel: "Export grid",
  budgetExportAr: "Export (Arabic)",
  budgetExportEn: "Export (English)",

  budgetReportVsActual: "Budget vs actual",
  budgetReportVarianceAnalysis: "Variance analysis",

  budgetChainHistory: "Version chain",
  budgetChainEmpty: "No revision chain — this is the original version.",
  budgetSupersedes: "Supersedes",
  budgetSupersededBy: "Superseded by",
  budgetCreatedAt: "Created at",

  budgetErrImmutable: "The budget is not a draft — line edits are DRAFT-only; revise via supersede (BR-050).",
  budgetErrState: "This transition is not legal from the current status (the BR-050 machine).",
  budgetErrSelfApproval: "Separation of duties: the budget's creator cannot approve it — the stamp needs a distinct approver (BR-034).",
  budgetErrActiveExists: "An ACTIVE budget already exists for this fiscal year and scope — supersede it, never activate a sibling (BR-050).",
  budgetErrPeriodMismatch: "The period does not belong to the budget's fiscal year.",
  budgetErrExceeded: "Over budget on the document's periods — the tenant policy is ENFORCE_DRAFT (BR-051): revise the budget or reduce the document.",
  budgetErrNotApproved: "No approval stamp — approve the budget (a distinct approver) before activating.",
  budgetErrScopeDimension: "Line dimensions are inconsistent with the scope — exactly one dimension per scope, none for the ACCOUNTS scope.",
  budgetErrDuplicateLine: "Duplicate grid line for the same (period × dimension key) — one row per period and key.",
  budgetErrLineLimit: "The grid exceeds the 20,000-line bound — split the import per dimension.",
  budgetErrImportFormat: "The file is not a budget grid — check the three identity columns + the period columns (AR or EN header sets accepted).",
  budgetErrImportRowLimit: "The import exceeds the 5,000-data-row cap — split the file.",
  budgetErrImportRow: "The file carries invalid rows — fix them and re-run the dry run.",
  // -- PHASE-029 (payroll): salaries, loans & end-of-service ---------
  navHr: "HR & Payroll",
  navPayrollEmployees: "Employees",
  navPayrollStructures: "Salary structures",
  navPayrollRuns: "Payroll runs",
  navPayrollLoans: "Employee loans",
  payTitle: "Payroll",
  payEmployeesTitle: "Employees",
  payEmployeesNew: "New employee",
  payEmployeesSearch: "Search by code or name…",
  payEmployeesEmpty: "No employees yet — add the first one.",
  payEmployeeCode: "Code",
  payEmployeeName: "Name",
  payEmployeeHireDate: "Hire date",
  payEmployeeContract: "Contract type",
  payEmployeeBasicSalary: "Basic salary",
  payEmployeeStructure: "Salary structure",
  payEmployeeBranch: "Branch",
  payEmployeeCostCenter: "Cost center",
  payEmployeeProject: "Project",
  payEmployeeNationalId: "National ID (masked)",
  payEmployeeBank: "Bank (masked)",
  payEmployeeStatus: "Status",
  payEmployeeEosBalance: "EOS provision balance",
  payStatusActive: "Active",
  payStatusSuspended: "Suspended",
  payStatusTerminated: "Terminated",
  payContractFullTime: "Full-time",
  payContractPartTime: "Part-time",
  payContractContractor: "Contractor",
  payEmployeeCreateTitle: "New employee",
  payEmployeeEditTitle: "Employee file",
  payEmployeeTerminate: "Terminate",
  payEmployeeTerminateDate: "Termination date",
  payEmployeeTerminateReason: "Termination reason",
  payEmployeeSuspend: "Suspend",
  payEmployeeReactivate: "Reactivate",
  payEmployeeSave: "Save",
  payEmployeeCreatedToast: "Employee {code} created.",
  payEmployeeUpdatedToast: "Employee {code} saved.",
  payEmployeeTerminatedToast: "{code} terminated on {date} — the EOS settlement is a separate step.",
  payPiiNote: "Employee data is C-PII: national ID and bank fields are masked by construction, and every read is audit-logged.",
  payEmployeeTerminatedNote: "TERMINATED rows are frozen — note edits only (the EOS/audit history stays).",
  payStructuresTitle: "Salary structures",
  payStructureNew: "New structure",
  payStructureCode: "Code",
  payStructureName: "Name",
  payStructureCurrency: "Currency",
  payStructureStatus: "Status",
  payStructureComponents: "Components",
  payComponentKey: "Key",
  payComponentKind: "Kind",
  payComponentCalc: "Calculation",
  payComponentAmount: "Amount",
  payComponentRate: "Rate %",
  payComponentAccount: "GL account",
  payComponentEosBase: "EOS base",
  payKindAllowance: "Allowance",
  payKindDeduction: "Deduction",
  payKindEmployer: "Employer contribution",
  payCalcFixed: "Fixed",
  payCalcPercentBasic: "Percent of basic",
  payCalcPercentGross: "Percent of gross",
  payStructureAddComponent: "Add component",
  payStructureRemoveComponent: "Remove component",
  payStructureSave: "Save components",
  payStructureArchived: "Archived",
  payStructureVersion: "Create new version",
  payStructureVersionedToast: "Version {code} created; the predecessor archived (BR-052).",
  payStructureSavedToast: "Structure components saved.",
  payStructureInUseNote: "Structures snapshotted by posted runs version, never edit — create a new version (BR-052).",
  payRunsTitle: "Payroll runs",
  payRunNew: "New run",
  payRunPeriod: "Fiscal period",
  payRunStatus: "Status",
  payRunGross: "Gross",
  payRunDeductions: "Deductions",
  payRunNet: "Net",
  payRunEmployer: "Employer",
  payRunEos: "EOS accrual",
  payRunPaid: "Paid",
  payRunNumber: "Run no",
  payRunLines: "Run lines",
  payRunCalculate: "Calculate",
  payRunSubmit: "Submit",
  payRunApprove: "Approve",
  payRunPost: "Post (G-29)",
  payRunPayout: "Payout (G-30)",
  payRunReverse: "Reverse",
  payRunPayslips: "Payslips",
  payRunDraft: "Draft",
  payRunPending: "Pending approval",
  payRunPosted: "Posted",
  payRunCalculatedToast: "Run calculated: {count} line(s) (gross {gross} / net {net}).",
  payRunSubmittedToast: "Run submitted for approval.",
  payRunApprovedToast: "Run approved — posting is now available.",
  payRunPostedToast: "Run {runNo} posted — journal {entryNo} (G-29).",
  payRunPayoutToast: "Paid out {amount} via the bank account (G-30) — outstanding {outstanding}.",
  payRunEmptyLines: "No calculated lines — calculate the run first.",
  payRunLoanClampWarning: "Loan deduction clamped to the cap ({clampedTo} of {scheduled}) — BR-054.",
  payRunSkippedWarning: "Skipped employees: {list}.",
  payRunOutstanding: "Outstanding",
  payLoansTitle: "Employee loans",
  payLoanNew: "New loan",
  payLoanCode: "Code",
  payLoanEmployee: "Employee",
  payLoanAmount: "Amount",
  payLoanInstallments: "Installments",
  payLoanStartPeriod: "Start period",
  payLoanCashAccount: "Paying account",
  payLoanSchedule: "Schedule",
  payLoanLineAmount: "Installment amount",
  payLoanLineStatus: "Status",
  payLoanPending: "Pending",
  payLoanDeducted: "Deducted",
  payLoanWaived: "Waived",
  payLoanWaive: "Waive installment",
  payLoanWaiveReason: "Waive reason",
  payLoanWriteOff: "Write off loan",
  payLoanWriteOffReason: "Write-off reason",
  payLoanActive: "Active",
  payLoanClosed: "Closed",
  payLoanWriteOffStatus: "Written off",
  payLoanDisbursedToast: "Loan {code} disbursed — {amount} via the selected account.",
  payLoanWaivedToast: "Installment waived ({reason}).",
  payLoanWrittenOffToast: "Loan {code} written off ({reason}).",
  payEosTitle: "End-of-service provision",
  payEosAccrued: "Accrued",
  payEosSettled: "Cash settled",
  payEosBalance: "Balance",
  payEosSettle: "Settle EOS (G-31)",
  payEosSettleAmount: "Cash settled amount",
  payEosPolicy: "Provision policy: enabled with basis {days} days per service year (tenant value — no jurisdiction rates).",
  payEosDisabled: "Provision disabled (default) — the tenant policy enables it with an explicit value.",
  payEosSettledToast: "Provision settled: {settled} cash, {residual} released (G-31).",
  payReportsTitle: "Payroll reports",
  payReportsEmpty: "No payroll report contracts registered.",
  payErrNotFound: "Record not found (or belongs to another tenant).",
  payErrStateInvalid: "The record's state does not allow this step.",
  payErrSelfApproval: "Separation of duties: the run's creator cannot approve it.",
  payErrImmutable: "The document is posted and immutable — reversal is the only correction path.",
  payErrRunPeriodExists: "A live run already exists for this period — one run per period.",
  payErrStructureInUse: "The structure is frozen by a posted run — create a new version (BR-052).",
  payErrStructureNotActive: "The structure is archived — runs require an ACTIVE structure (BR-052).",
  payErrStructureCurrency: "The structure's currency differs from the tenant base.",
  payErrEmployeeStructureMissing: "The employee carries no ACTIVE salary structure — assign one before calculating.",
  payErrLoanCap: "The loan deduction exceeds the cap percent of net (BR-054).",
  payErrLoanUnmapped: "The employee-loan control account is unmapped — set payroll.loans.control_account_id.",
  payErrEosBasis: "The provision is enabled without an explicit basis — BR-055 refuses the silent path.",
  payErrEosExceeds: "The settlement exceeds the employee's provision balance.",
  payErrPayoutExceeds: "The amount exceeds the run's outstanding net.",
  payErrEmployeeState: "The employee's state does not allow this step.",
  payErrCodeConflict: "The code is already used in this tenant.",
  payErrEngineOnly: "Payroll accounts post only via runs — manual journals are rejected (BR-053).",
  payErrPurposeNotMapped: "An accounting purpose is unmapped — map the account before posting.",
  payErrPeriodLocked: "The fiscal period is locked — posting is rejected.",

  // -- PHASE-034 (T11): multi-entity consolidation (القوائم الموحدة) --------

  navConsolidated: "Consolidated statements",
  consolidationGroupsNav: "Consolidation groups",
  consolidationEliminationsNav: "Eliminations",
  consolidationRunsNav: "Consolidation runs",

  consolidationTitle: "Consolidated statements",
  consolidationHubHint:
    "The multi-entity consolidation workspace: consolidation groups & members, intercompany eliminations, and consolidation runs with consolidated-statement snapshots.",
  consolidationDisclaimer: "Group view — never replaces member statutory books.",
  consolidationColGroup: "Group",
  consolidationFiscalPeriod: "Fiscal period",
  consolidationColCreated: "Created",
  consolidationStatusActive: "Active",
  consolidationStatusArchived: "Archived",
  consolidationFxMethodClosingRate: "Closing rate",
  consolidationFxMethodTemporary: "Temporary method",
  consolidationNoteEn: "Note (EN)",
  consolidationNoteAr: "Note (AR)",
  consolidationRunStatusQueued: "Queued",
  consolidationRunStatusRunning: "Running",
  consolidationRunStatusCompleted: "Completed",
  consolidationRunStatusFailed: "Failed",

  consolidationEmptyGroups: "No consolidation groups yet — create the first group.",
  consolidationNewGroupButton: "New group",
  consolidationCreateGroupTitle: "Create consolidation group",
  consolidationGroupName: "Name (EN)",
  consolidationGroupNameAr: "Name (AR)",
  consolidationGroupBaseCurrency: "Group base currency",
  consolidationGroupFxMethod: "FX translation method",
  consolidationGroupCreateToast: "Group created — add members, then author eliminations.",
  consolidationGroupMembersLabel: "Members",
  consolidationRecentRunsCard: "Recent consolidation runs",
  consolidationViewRuns: "All runs",
  consolidationViewEliminations: "Eliminations log",
  consolidationNewElimination: "New elimination",
  consolidationNewRun: "New consolidation run",
  consolidationRunsEmpty: "No consolidation runs yet.",

  consolidationGroupSettingsCard: "Group settings",
  consolidationGroupArchivedWarning: "This group is ARCHIVED — reactivate it before making changes.",
  consolidationArchiveGroupAction: "Archive group",
  consolidationReactivateGroupAction: "Reactivate group",
  consolidationGroupStatusToast: "Group status updated.",
  consolidationMembersCard: "Group members",
  consolidationAddMemberTitle: "Add member",
  consolidationMemberTenantId: "Member tenant id (UUID)",
  consolidationMemberTenantIdHint: "Enter the member tenant's id as-is — manual entry at this phase.",
  consolidationMemberOwnershipPercent: "Ownership percent (%)",
  consolidationMemberIncludeFrom: "Include from",
  consolidationAddMemberButton: "Add member",
  consolidationMemberAddedToast: "Member added to the group.",
  consolidationMemberStatusRemoved: "Removed",
  consolidationUpdateMemberTitle: "Update member",
  consolidationMemberUpdateAction: "Update",
  consolidationMemberRemoveAction: "Remove member",
  consolidationMemberUpdatedToast: "Member updated.",
  consolidationGroupEliminationsCard: "Group eliminations",
  consolidationGroupRunsCard: "Group runs",

  eliminationsTitle: "Eliminations log",
  eliminationsEmpty: "No eliminations yet — create the first one.",
  eliminationsFilterKind: "Kind",
  eliminationsKindIntercompany: "Intercompany",
  eliminationsKindInvestmentEquity: "Investment & equity",
  eliminationsColNo: "Elimination no.",
  eliminationsColDescription: "Description",
  eliminationsColLines: "Lines",
  eliminationsColJournals: "Journal entries",
  eliminationsColReversalOf: "Reversal of",
  eliminationsApprovedBadge: "Approved",
  eliminationsReverseAction: "Reverse",
  eliminationsApproveToast: "Elimination approved — it can be posted now.",
  eliminationsPostToast: "Elimination {no} posted — journal {entry} created.",
  eliminationsReverseToast: "Reversal draft created — approve and post it like any elimination.",
  eliminationsSodHint: "Separation of duties: another user (not the draft creator) must approve before posting.",
  eliminationsPostConfirmTitle: "Confirm posting",
  eliminationsPostConfirmBody: "The elimination journal will post into the parent's consolidation books for a total of {amount}.",
  eliminationsReverseConfirmTitle: "Reverse posted elimination",
  eliminationsLinesTitle: "Elimination lines",
  eliminationsLinePurpose: "Purpose",
  eliminationsLineDirection: "Direction",
  eliminationsLineMember: "Member",
  eliminationsLineMemoEn: "Memo (EN)",
  eliminationsLineMemoAr: "Memo (AR)",
  eliminationsPurposeArControl: "AR control (AR_CONTROL)",
  eliminationsPurposeApControl: "AP control (AP_CONTROL)",
  eliminationsPurposeConsolidationAdjustment: "Consolidation adjustment (CONSOLIDATION_ADJUSTMENT)",
  eliminationsAddLine: "Add line",
  eliminationsRemoveLine: "Remove line",

  eliminationFormKind: "Elimination kind",
  eliminationFormMemberA: "Member (A)",
  eliminationFormMemberB: "Member (B)",
  eliminationFormMemberHint: "Tenant id (UUID) of an ACTIVE member of the selected group.",
  eliminationSuggestionsCard: "Intercompany suggestions (member A)",
  eliminationSuggestionsButton: "Load suggestions",
  eliminationSuggestionsAsOf: "As of date",
  eliminationSuggestionsEmpty: "No suggestions for this member at this date.",
  eliminationSuggestionColPartner: "Partner",
  eliminationSuggestionColAr: "AR balance",
  eliminationSuggestionColAp: "AP balance",
  eliminationPreviewTitle: "Live balance preview",
  eliminationSubmitButton: "Create draft",
  eliminationCreatedToast: "Elimination draft created — approve it, then post.",
  eliminationCreatedCard: "Created draft",

  consolidationRunCreateHint: "One run per (group, period) — created QUEUED, then executed.",
  consolidationRunCreateButton: "Create run",
  consolidationRunCreatedToast: "Run created (QUEUED) — execute it now.",
  consolidationRunExecuteAction: "Execute",
  consolidationRunExecutedToast: "Run executed — status: {status}.",
  consolidationRunErrorCodeCol: "Error code",
  consolidationRunSnapshotCard: "Run snapshot",
  consolidationSnapshotPending: "The snapshot is available only after the run completes — execute the run first.",
  consolidationSnapshotMembersCard: "Members & applied rates",
  consolidationSnapshotColType: "Account type",
  consolidationSnapshotColNet: "Net",
  consolidationSnapshotColRates: "Applied rates",
  consolidationSnapshotConsolidatedCard: "Consolidated lines",
  consolidationSnapshotEliminationsCard: "Elimination effects",
  consolidationInv026Pass: "INV-026: PASS",
  consolidationInv026Fail: "INV-026: FAIL",
  consolidationInv026Compared: "Compared: {left} vs {right}",

  // -- WEB-036 (PHASE-036): custom fields extensibility core ---------------------
  customFieldsTitle: "Custom fields",
  customFieldsSubtitle:
    "Extend your entity forms with workspace-owned fields — definitions, picklists and the form designer",
  customFieldsDefinitionsTab: "Definitions",
  customFieldsPicklistsTab: "Picklists",
  customFieldsLayoutsTab: "Form designer",
  customFieldsEntityFilter: "Filter by entity",
  customFieldsAllEntities: "All entities",
  customFieldsColEntity: "Entity",
  customFieldsColKey: "Key",
  customFieldsColLabel: "Label",
  customFieldsColDataType: "Data type",
  customFieldsColRequired: "Required",
  customFieldsColOptions: "Options",
  customFieldsColVersion: "Version",
  customFieldsColOrder: "Order",
  customFieldsDefinitionsNote:
    "ACTIVE fields render automatically on the entity's forms and lists; validation rules apply on save.",
  customFieldsEmpty: "No custom fields yet — create the first one.",
  customFieldsAddField: "Add field",
  customFieldsCreateTitle: "Create custom field",
  customFieldsEditTitle: "Edit custom field",
  customFieldsEntityLabel: "Entity",
  customFieldsEntityPlaceholder: "Choose an entity",
  customFieldsKeyLabel: "Key",
  customFieldsKeyHint: "lowercase snake_case, e.g. preferred_branch",
  customFieldsLabelEn: "Label (English)",
  customFieldsLabelAr: "Label (Arabic)",
  customFieldsDataTypeLabel: "Data type",
  customFieldsTypeText: "Text",
  customFieldsTypeNumber: "Number",
  customFieldsTypeDate: "Date",
  customFieldsTypeBoolean: "Yes/No",
  customFieldsTypeSelect: "Single select",
  customFieldsTypeMultiselect: "Multi select",
  customFieldsTypeReference: "Record reference",
  customFieldsPicklistLabel: "Picklist",
  customFieldsPicklistPlaceholder: "Choose a picklist",
  customFieldsReferenceEntityLabel: "Reference entity",
  customFieldsPrecisionLabel: "Decimal precision",
  customFieldsPrecisionHint: "0 to 6 decimal places (default 2)",
  customFieldsRequiredLabel: "Required field",
  customFieldsValidationTitle: "Validation rules",
  customFieldsValidationTextOnly: "Regex and length bounds apply to TEXT fields only.",
  customFieldsValidationNumberOnly: "Numeric bounds apply to NUMBER fields only.",
  customFieldsRegexLabel: "Regex pattern",
  customFieldsMinLengthLabel: "Min length",
  customFieldsMaxLengthLabel: "Max length",
  customFieldsMinValueLabel: "Min value",
  customFieldsMaxValueLabel: "Max value",
  customFieldsImmutableNote:
    "Entity, key and data type are immutable after creation — archive the field and create a new one if needed.",
  customFieldsCreatedToast: "Custom field created.",
  customFieldsSavedToast: "Custom field saved.",
  customFieldsArchivedToast: "Custom field archived — historical values keep rendering.",
  customFieldsRestoredToast: "Custom field restored.",
  customFieldsArchiveAction: "Archive",
  customFieldsRestoreAction: "Restore",
  customFieldsArchiveConfirm:
    "The archived field disappears from new forms while historical values stay. Continue?",
  customFieldsPicklistsNote:
    "Shared value lists for select fields — archived options are rejected for new values and stay in history.",
  customFieldsPicklistsEmpty: "No picklists yet.",
  customFieldsPicklistCreateTitle: "Create picklist",
  customFieldsPicklistNameEn: "Name (English)",
  customFieldsPicklistNameAr: "Name (Arabic)",
  customFieldsPicklistKeyHint: "unique lowercase snake_case key",
  customFieldsPicklistCreatedToast: "Picklist created.",
  customFieldsPicklistSavedToast: "Picklist saved.",
  customFieldsPicklistArchivedToast: "Picklist archived.",
  customFieldsPicklistRestoredToast: "Picklist restored.",
  customFieldsManageOptions: "Manage options",
  customFieldsOptionsTitle: "Options",
  customFieldsPicklistOptionsForTitle: "Options: {name}",
  customFieldsOptionsEmpty: "No options in this picklist yet.",
  customFieldsOptionLabelEn: "Option (English)",
  customFieldsOptionLabelAr: "Option (Arabic)",
  customFieldsOptionAdd: "Add option",
  customFieldsOptionAddedToast: "Option added.",
  customFieldsOptionSavedToast: "Option saved.",
  customFieldsOptionArchivedToast: "Option archived.",
  customFieldsOptionRestoredToast: "Option restored.",
  customFieldsOptionMoveUp: "Move up",
  customFieldsOptionMoveDown: "Move down",
  customFieldsOptionsReorderedToast: "Option order saved.",
  customFieldsOptionEdit: "Edit option",
  customFieldsLayoutsNote:
    "Design each entity's section/field order; a role override wins over the default layout for that role only.",
  customFieldsLayoutsEmpty:
    "No saved layout for this entity yet — the native form renders in its usual order.",
  customFieldsLayoutEntityLabel: "Entity",
  customFieldsLayoutDefaultLabel: "Default layout",
  customFieldsLayoutDefaultBadge: "Default",
  customFieldsLayoutRoleLabel: "Role",
  customFieldsLayoutNewOverride: "New role override",
  customFieldsLayoutOverrideBadge: "Override",
  customFieldsLayoutOverridesList: "Saved overrides",
  customFieldsLayoutEditingDefault: "Editing the default layout",
  customFieldsLayoutEditingOverride: "Editing a role override",
  customFieldsLayoutNameLabel: "Layout name",
  customFieldsLayoutNoLayout: "No layout",
  customFieldsLayoutDefaultNote: "The default layout applies to every role without its own override.",
  customFieldsLayoutOverrideNote: "This override applies to holders of this role only.",
  customFieldsLayoutSectionsTitle: "Sections",
  customFieldsLayoutAddSection: "Add section",
  customFieldsLayoutSectionNew: "New section",
  customFieldsLayoutSectionLabelEn: "Section title (English)",
  customFieldsLayoutSectionLabelAr: "Section title (Arabic)",
  customFieldsLayoutSectionUp: "Move section up",
  customFieldsLayoutSectionDown: "Move section down",
  customFieldsLayoutRemoveSection: "Remove section",
  customFieldsLayoutCollapsedLabel: "Collapsed by default",
  customFieldsLayoutColumnsLabel: "Columns",
  customFieldsLayoutFieldsTitle: "Fields",
  customFieldsLayoutAddField: "Add field to section",
  customFieldsLayoutFieldPlaceholder: "Choose a field",
  customFieldsNativeFieldsGroup: "Native fields",
  customFieldsCustomFieldsGroup: "Custom fields",
  customFieldsLayoutFieldNative: "Native",
  customFieldsLayoutFieldCustom: "Custom",
  customFieldsLayoutMandatoryBadge: "Mandatory",
  customFieldsLayoutLockHint:
    "Mandatory native fields are protected (BR-059) — they cannot be removed or reordered.",
  customFieldsLayoutFieldUp: "Move field up",
  customFieldsLayoutFieldDown: "Move field down",
  customFieldsLayoutRemoveField: "Remove field",
  customFieldsLayoutSavedToast: "Default layout saved.",
  customFieldsLayoutOverrideSavedToast: "Role override saved.",
  customFieldsLayoutDeleteOverride: "Delete override",
  customFieldsLayoutOverrideDeletedToast: "Role override deleted — the role falls back to the default layout.",
  customFieldsRoleOwner: "Owner",
  customFieldsRoleAccountant: "Accountant",
  customFieldsRoleSales: "Sales",
  customFieldsRolePurchasing: "Purchasing",
  customFieldsRoleWarehouse: "Warehouse",
  customFieldsRoleCashier: "Cashier",
  customFieldsRoleViewer: "Viewer",
  customFieldsRolePayrollOfficer: "Payroll officer",
  customFieldsErrorKeyTaken: "This key is already used for this entity.",
  customFieldsErrorKeyInvalid: "Invalid key: {reason}",
  customFieldsErrorConfigInvalid: "Invalid config for this data type: {reason}",
  customFieldsErrorEntityUnknown: "The entity type is not registered for custom fields.",
  customFieldsErrorValidationMismatch: "The validation rule does not apply to this data type.",
  customFieldsErrorNotFound: "Not found in this tenant.",
  customFieldsErrorArchived: "The custom field is archived — its values are read-only.",
  customFieldsErrorUnknownKey: "Custom field {key} is not defined for this entity.",
  customFieldsErrorRequired: "Custom field {key} is required.",
  customFieldsErrorValueInvalid: "Invalid value for custom field {key}.",
  customFieldsErrorImmutable:
    "Entity, key and data type are immutable — archive the field and create a new one.",
  customFieldsErrorPicklistKeyTaken: "The picklist key is already used.",
  customFieldsErrorPicklistNotFound: "Picklist not found.",
  customFieldsErrorPicklistOptionNotFound: "Picklist option not found.",
  customFieldsErrorPicklistArchived: "The picklist is archived — choose an ACTIVE one.",
  customFieldsErrorPicklistOrderInvalid: "The order must list every ACTIVE option exactly once.",
  customFieldsErrorLayoutNotFound: "No form layout exists for this entity.",
  customFieldsErrorLayoutInvalid: "Invalid layout: {reason}",
  customFieldsErrorLayoutProtected: "BR-059: {violation}",
  customFieldsErrorLayoutProtectedHint: "Mandatory native fields cannot be removed or reordered.",
  customFieldsFormSectionTitle: "Custom fields",
  customFieldsFormSectionDescription: "Additional fields defined by your workspace.",
  customFieldsYesOption: "Yes",
  customFieldsNoOption: "No",
  customFieldsSelectEmpty: "—",
  customFieldsMultiselectEmpty: "No options available",
  customFieldsReferenceHint: "UUID of a record in: {entity}",
  // WEB-038 (PHASE-038) — procurement sourcing & supplier collaboration (EN mirror).
  navPurchasing: "Purchasing",
  sourcingRfqsNav: "RFQs & sourcing",
  sourcingBlanketNav: "Blanket agreements",
  sourcingScorecardsNav: "Supplier scorecards",
  sourcingCapexNav: "CAPEX requests",
  sourcingRfqTitle: "Purchasing — RFQs & sourcing",
  sourcingRfqSubtitle:
    "The full negotiation loop: issue the RFQ, collect quotes, compare offers, then award.",
  sourcingBlanketTitle: "Purchasing — Blanket agreements",
  sourcingBlanketSubtitle:
    "Standing blanket agreements with suppliers and releases within the commitment ceiling.",
  sourcingScorecardsTitle: "Purchasing — Supplier scorecards",
  sourcingScorecardsSubtitle:
    "Supplier scorecard windows and the approved-vendor item list.",
  sourcingCapexTitle: "Purchasing — CAPEX requests",
  sourcingCapexSubtitle:
    "Capital-expenditure requests with the budget evaluation taken at submit.",
  sourcingRfqsTab: "RFQs",
  sourcingQuotesTab: "Quotes",
  sourcingComparisonTab: "Comparison & award",
  sourcingColRfqNo: "RFQ no.",
  sourcingColTitle: "Title",
  sourcingColMode: "Mode",
  sourcingColStatus: "Status",
  sourcingColDue: "Due at",
  sourcingColQuotes: "Quotes",
  sourcingColQuoteRef: "Quote ref.",
  sourcingColSubmitted: "Submitted at",
  sourcingColSubmittedVia: "Channel",
  sourcingColExpires: "Expires at",
  sourcingColBlanketNo: "Blanket no.",
  sourcingColValidity: "Validity",
  sourcingColReleased: "Released of ceiling",
  sourcingColProgress: "Release ratio",
  sourcingColWindow: "Window",
  sourcingColDelivery: "Delivery",
  sourcingColQuality: "Quality",
  sourcingColPrice: "Price",
  sourcingColOverall: "Overall",
  sourcingColSample: "Sample size",
  sourcingColRequestNo: "Request no.",
  sourcingColAmount: "Amount",
  sourcingColBudgetEval: "Budget evaluation",
  sourcingColLine: "Line",
  sourcingColOfferSupplier: "Supplier",
  sourcingColOfferPrice: "Unit price",
  sourcingColLineTotal: "Line total",
  sourcingColLeadTime: "Lead time",
  sourcingColWeighted: "Weighted score",
  sourcingColWinner: "Winner",
  sourcingModeOpen: "Open",
  sourcingModeInvited: "Invited",
  sourcingStatusRfqDraft: "Draft",
  sourcingStatusRfqIssued: "Issued",
  sourcingStatusRfqQuoted: "Quotes received",
  sourcingStatusRfqAwarded: "Awarded",
  sourcingStatusRfqClosed: "Closed",
  sourcingStatusRfqCancelled: "Cancelled",
  sourcingStatusQuoteSubmitted: "Submitted",
  sourcingStatusQuoteWithdrawn: "Withdrawn",
  sourcingViaPortal: "Supplier portal",
  sourcingViaBackOffice: "Back office",
  sourcingStatusComparisonPrepared: "Prepared",
  sourcingStatusComparisonAwarded: "Awarded",
  sourcingStatusComparisonCancelled: "Cancelled",
  sourcingStatusBlanketActive: "Active",
  sourcingStatusBlanketExpired: "Expired",
  sourcingStatusBlanketClosed: "Closed",
  sourcingStatusBlanketCancelled: "Cancelled",
  sourcingStatusApproved: "Approved",
  sourcingStatusSuspended: "Suspended",
  sourcingStatusCapexDraft: "Draft",
  sourcingStatusCapexPending: "Pending approval",
  sourcingStatusCapexApproved: "Approved",
  sourcingStatusCapexConverted: "Converted",
  sourcingStatusCapexRejected: "Rejected",
  sourcingStatusCapexCancelled: "Cancelled",
  sourcingBudgetModeOff: "No control",
  sourcingBudgetModeAdvisory: "Advisory",
  sourcingBudgetModeEnforce: "Enforced",
  sourcingFormTitle: "Title",
  sourcingFormTitleAr: "Title (Arabic)",
  sourcingFormMode: "RFQ mode",
  sourcingFormCurrency: "Currency",
  sourcingFormDue: "Due at",
  sourcingFormInvitedSuppliers: "Invited suppliers",
  sourcingFormTargetPrice: "Target price",
  sourcingFormOptional: "optional",
  sourcingFormQuoteRef: "Quote ref.",
  sourcingFormLeadTime: "Lead time (days)",
  sourcingFormValidUntil: "Valid until",
  sourcingFormRfqLine: "RFQ line",
  sourcingFormExpiresAt: "Expires at",
  sourcingFormBranch: "Branch",
  sourcingFormAccount: "Account",
  sourcingFormDescription: "Description",
  sourcingFormEstimatedAmount: "Estimated amount",
  sourcingFormNeededBy: "Needed by",
  sourcingFormContractId: "Contract id (optional)",
  sourcingFormValidFrom: "Valid from",
  sourcingFormValidTo: "Valid to",
  sourcingFormMinCommitment: "Minimum commitment",
  sourcingFormMaxCommitment: "Maximum commitment",
  sourcingFormPriceLock: "Price locks",
  sourcingFormWindowDays: "Window (days)",
  sourcingFormStatus: "Status",
  sourcingFormExpires: "Expires (optional)",
  sourcingFormReason: "Reason",
  sourcingActionCreate: "Create",
  sourcingActionEdit: "Edit",
  sourcingActionIssue: "Issue",
  sourcingActionCancel: "Cancel",
  sourcingActionClose: "Close",
  sourcingActionCompare: "Prepare comparison",
  sourcingActionAward: "Award",
  sourcingActionCancelComparison: "Cancel comparison",
  sourcingActionMintInvite: "Portal invite",
  sourcingActionRecompute: "Recompute",
  sourcingActionRelease: "Release",
  sourcingActionSubmit: "Submit for approval",
  sourcingActionApprove: "Approve",
  sourcingActionReject: "Reject",
  sourcingActionBack: "Back",
  sourcingActionCopy: "Copy",
  sourcingActionCopyDone: "Copied",
  sourcingActionDismiss: "Dismiss",
  sourcingActionViewQuotes: "Quotes",
  sourcingQuotesFor: "Quotes for {no}",
  sourcingQuotesEmpty: "No quotes received for this RFQ yet.",
  sourcingQuotesPickFirst: "Select an RFQ first to see its quotes.",
  sourcingQuoteFormTitle: "Record a supplier quote (back office)",
  sourcingLeadTimeDays: "{days} days",
  sourcingInviteTitle: "Invite a supplier to the portal",
  sourcingInviteExpiresHint:
    "The invite link expires on the chosen date and can be revoked at any time.",
  sourcingInviteTokenTitle: "Invite token (shown once)",
  sourcingInviteTokenOnce:
    "Copy this token now and share it with the supplier — the plaintext is never stored (hash only) and will not be shown again.",
  sourcingComparisonNone: "No live comparison for this RFQ.",
  sourcingComparisonPrepareHint:
    "The comparison snapshot freezes at prepare (price 60% · delivery 30% · terms 10%) and is never recomputed.",
  sourcingComparisonPreparedAt: "Prepared at",
  sourcingComparisonAwardHint:
    "Pick the winning offer per line, then award the round (the BR-062 three-bid floor is enforced server-side).",
  sourcingComparisonAwardedDocs: "Documents generated by the award",
  sourcingDocKindPo: "Purchase order",
  sourcingDocKindRelease: "Blanket release",
  sourcingReleaseTitle: "Release from blanket agreement",
  sourcingReleasedOf: "{released} of {max}",
  sourcingApprovedItemsTitle: "Approved supplier items",
  sourcingApprovedItemsEmpty: "No approved supplier items yet.",
  sourcingRfqsEmpty: "No RFQs yet.",
  sourcingBlanketEmpty: "No blanket agreements yet.",
  sourcingScorecardsEmpty: "No scorecards yet — recompute to generate them.",
  sourcingCapexEmpty: "No CAPEX requests yet.",
  sourcingConfirmIssue: "Issuing sends the RFQ to the invited suppliers. Continue?",
  sourcingConfirmCancel: "Cancelling the RFQ cannot be undone. Continue?",
  sourcingConfirmClose: "Closing ends the negotiation round. Continue?",
  sourcingConfirmAward: "The award generates purchase orders per winning supplier. Continue?",
  sourcingConfirmRelease: "A release creates a purchase order from the agreement. Continue?",
  sourcingConfirmRecompute:
    "Recomputing rebuilds the scorecard from the window's movements. Continue?",
  sourcingToastCreated: "Created successfully.",
  sourcingToastDone: "Action completed successfully.",
  sourcingToastCopied: "Copied to the clipboard.",
  sourcingErrState: "The document state does not allow this action.",
  sourcingErrThreeBid: "The three-bid floor (BR-062) is not met for this line.",
  sourcingErrOverRelease: "The release exceeds the agreement's remaining commitment.",
  sourcingErrDuePassed: "The RFQ due date has passed — no further quotes.",
  sourcingErrNotInvited: "The supplier is not on this RFQ's invited list.",
  sourcingErrCurrencyMismatch: "The quote currency does not match the RFQ currency.",
  sourcingErrNoQuotes:
    "No submitted quotes to compare — prepare the comparison after quotes arrive.",
  // WEB-039 (PHASE-039) — returns & collections (EN mirror).
  returnsNav: "Sales returns",
  dunningNav: "Collections & dunning",
  supplierReturnsNav: "Supplier returns",
  returnsTitle: "Sales — customer returns",
  returnsSubtitle:
    "Customer RMA requests with inspection and disposition, plus the managed-warranty register.",
  dunningTitle: "Sales — collections & dunning",
  dunningSubtitle:
    "The dunning letter ladder and late fees, collection actions, credit reviews, and collection agencies.",
  supplierReturnsTitle: "Purchasing — supplier returns",
  supplierReturnsSubtitle:
    "Return-to-vendor authorizations through the supplier credit (G-38).",
  returnsTabRmas: "RMAs",
  returnsTabWarranties: "Warranties",
  dunningTabLetters: "Letters",
  dunningTabPolicies: "Policies",
  dunningTabActions: "Actions",
  dunningTabReviews: "Credit reviews",
  dunningTabAgencies: "Agencies",
  returnsColRmaNo: "RMA no.",
  returnsColPartner: "Customer",
  returnsColInvoice: "Invoice",
  returnsColStatus: "Status",
  returnsColDisposition: "Disposition",
  returnsColTotal: "Total",
  returnsColRequested: "Requested at",
  returnsColCompleted: "Completed at",
  returnsColLine: "Line",
  returnsColItem: "Item",
  returnsColQty: "Qty",
  returnsColUnitPrice: "Unit price",
  returnsColNet: "Net",
  returnsColTax: "Tax",
  returnsColNote: "Note",
  returnsStatusRequested: "Requested",
  returnsStatusApproved: "Approved",
  returnsStatusReceived: "Received",
  returnsStatusInspected: "Inspected",
  returnsStatusRestocked: "Restocked",
  returnsStatusScrapped: "Scrapped",
  returnsStatusRefunded: "Refunded",
  returnsStatusCancelled: "Cancelled",
  returnsDispositionRestock: "Restock",
  returnsDispositionScrap: "Scrap",
  returnsDispositionRefund: "Cash refund",
  returnsDispositionNone: "No disposition",
  returnsReasonDamaged: "Damaged",
  returnsReasonDefective: "Defective",
  returnsReasonWrongItem: "Wrong item",
  returnsReasonLateDelivery: "Late delivery",
  returnsReasonCustomerRemorse: "Customer remorse",
  returnsReasonOverShipment: "Over-shipment",
  returnsReasonExpired: "Expired",
  returnsReasonRecall: "Recall",
  returnsReasonOther: "Other",
  returnsFormInvoice: "Reference invoice",
  returnsFormPickInvoice: "Pick a POSTED invoice",
  returnsFormReasonCode: "Return reason",
  returnsFormReason: "Reason",
  returnsFormReasonAr: "Reason (Arabic)",
  returnsFormNote: "Note",
  returnsFormInvoiceLine: "Invoice line",
  returnsActionCreate: "New RMA",
  returnsActionView: "View",
  returnsActionApprove: "Approve",
  returnsActionReceive: "Receive",
  returnsActionInspect: "Inspect",
  returnsActionComplete: "Complete",
  returnsActionCancel: "Cancel",
  returnsActionVoid: "Void",
  returnsCreateTitle: "New return authorization",
  returnsDetailTitle: "RMA detail",
  returnsInspectTitle: "Inspect the return & record the disposition",
  returnsCompleteTitle: "Complete the return",
  returnsCancelReasonLabel: "Cancellation reason",
  returnsCashAccountLabel: "Refund cash account",
  returnsRefundHint:
    "A REFUND disposition requires the cash account the refund is paid from.",
  returnsInvoiceHint:
    "RMAs reference POSTED invoices inside the active return window.",
  returnsConfirmApprove: "Approve this return authorization?",
  returnsConfirmReceive: "Confirm receipt of the returned goods?",
  returnsConfirmComplete: "Complete the return and issue its documents? This cannot be undone.",
  returnsConfirmCancel: "Cancel this return authorization?",
  returnsToastCreated: "The return authorization was created.",
  returnsToastDone: "Done.",
  returnsRmasEmpty: "No return authorizations yet.",
  returnsInvoiceLinesEmpty: "This invoice carries no lines.",
  returnsColSerial: "Serial no.",
  returnsColStart: "Starts",
  returnsColEnd: "Ends",
  returnsColCoverage: "Coverage",
  returnsColDuration: "Duration",
  returnsColMileage: "Mileage cap",
  returnsWarrantyActive: "Active",
  returnsWarrantyExpired: "Expired",
  returnsWarrantyVoid: "Void",
  returnsCoverageRepair: "Repair",
  returnsCoverageReplace: "Replace",
  returnsCoverageRefund: "Refund",
  returnsCoverageLaborOnly: "Labor only",
  returnsCoveragePartsOnly: "Parts only",
  returnsBasisInvoiceDate: "Invoice date",
  returnsBasisDeliveryDate: "Delivery date",
  returnsDurationMonths: "{months} mo.",
  returnsMileageKm: "{km} km",
  returnsWarrantyCreateTitle: "Register a warranty",
  returnsFormSerial: "Serial no.",
  returnsFormStart: "Start date",
  returnsFormDuration: "Duration (months)",
  returnsFormCoverage: "Coverage",
  returnsFormBasis: "Basis",
  returnsFormMileageOptional: "Mileage cap (km)",
  returnsFormInvoiceOptional: "Invoice",
  returnsConfirmVoid: "Void this warranty? This cannot be undone.",
  returnsWarrantiesEmpty: "No warranties registered.",
  returnsErrState: "The current state does not permit this action.",
  returnsErrQtyExceeds: "The return qty exceeds the available balance on this line.",
  returnsErrDisposition: "The inspection disposition must be recorded before completion.",
  returnsErrScrapUnmapped:
    "The scrap-loss account is unmapped — map the sales.scrap_loss_account setting and retry.",
  returnsErrWarrantyTerms: "The warranty terms are invalid.",
  dunningColPartner: "Customer",
  dunningColInvoice: "Invoice",
  dunningColStep: "Step",
  dunningColDays: "Days overdue",
  dunningColChannel: "Channel",
  dunningColLetterDate: "Letter date",
  dunningColSent: "Sent at",
  dunningColSubject: "Subject",
  dunningColFee: "Fee",
  dunningColFeeInvoice: "Fee invoice",
  dunningColWaiver: "Waiver",
  dunningChannelEmail: "Email",
  dunningChannelWhatsapp: "WhatsApp",
  dunningChannelSms: "SMS",
  dunningLetterQueued: "Queued",
  dunningLetterSent: "Sent",
  dunningLetterFailed: "Failed",
  dunningFeeWaived: "Fee waived",
  dunningDaysValue: "{days} days",
  dunningActionRunSweep: "Run dunning sweep",
  dunningSweepHint:
    "The sweep scans overdue invoices and fires each one's next ladder step (one step per run).",
  dunningSweepAsOfLabel: "As of",
  dunningSweepResult: "{letters} letters fired · {escalated} escalated · {scanned} items scanned.",
  dunningActionChargeFee: "Charge late fee",
  dunningActionWaiveFee: "Waive fee",
  dunningWaiveTitle: "Waive the late fee",
  dunningWaiveReasonLabel: "Waiver reason",
  dunningConfirmCharge: "Charge the late fee on this letter's invoice?",
  dunningConfirmWaive: "Waive the fee? The fee invoice stays as accounting evidence.",
  dunningToastSweepDone: "The dunning sweep completed.",
  dunningPolicyDraft: "Draft",
  dunningPolicyActive: "Active",
  dunningPolicyArchived: "Archived",
  dunningFeeModeDisabled: "No fees",
  dunningFeeModeContractRate: "Contract rate",
  dunningFeeModeStatutoryCap: "Statutory cap",
  dunningDefaultBadge: "Default",
  dunningEscalateBadge: "Escalate",
  dunningReferAgencyBadge: "Refer to agency",
  dunningLadderTitle: "Step ladder",
  dunningLateFeeTitle: "Late fees",
  dunningLateFeeRateLabel: "{rate}% rate",
  dunningLateFeeGraceLabel: "{days}-day grace",
  dunningLateFeeMaxLabel: "capped at {amount}",
  dunningPolicyCreateTitle: "New dunning policy",
  dunningFormPolicyName: "Policy name",
  dunningFormPolicyNameAr: "Policy name (Arabic)",
  dunningFormIsDefault: "Default policy",
  dunningFormStepNo: "Step",
  dunningFormDaysOverdue: "Days overdue",
  dunningFormChannel: "Channel",
  dunningFormTemplateKey: "Template key",
  dunningFormEscalate: "Escalate",
  dunningFormReferToAgency: "Refer to agency",
  dunningAddStep: "Add step",
  dunningRemoveStep: "Remove step",
  dunningFormFeeMode: "Fee mode",
  dunningFormRatePct: "Rate (%)",
  dunningFormGraceDays: "Grace days",
  dunningFormMaxAmount: "Max fee",
  dunningFormFeeSource: "Statutory source",
  dunningActionCreatePolicy: "New policy",
  dunningActionActivate: "Activate",
  dunningActionArchive: "Archive",
  dunningConfirmActivate: "Activate this policy?",
  dunningConfirmArchive: "Archive this policy?",
  dunningActionTypeCall: "Call",
  dunningActionTypeEmail: "Email",
  dunningActionTypePromiseToPay: "Promise to pay",
  dunningActionTypeDispute: "Dispute",
  dunningActionTypeFieldVisit: "Field visit",
  dunningActionTypePaymentPlan: "Payment plan",
  dunningActionTypeWriteOffRequest: "Write-off request",
  dunningActionTypeAgencyReferral: "Agency referral",
  dunningActionTypeOther: "Other",
  dunningOutcomePending: "Pending",
  dunningOutcomePromised: "Promised",
  dunningOutcomeBroken: "Promise broken",
  dunningOutcomePaid: "Paid",
  dunningOutcomeEscalated: "Escalated",
  dunningOutcomeNoAnswer: "No answer",
  dunningOutcomeOther: "Other",
  dunningColActionType: "Action type",
  dunningColActionDate: "Date",
  dunningColOutcome: "Outcome",
  dunningColPromised: "Promised for",
  dunningColAmount: "Amount",
  dunningActionLogTitle: "Log a collection action",
  dunningFormActionType: "Action type",
  dunningFormActionDate: "Action date",
  dunningFormOutcome: "Outcome",
  dunningFormPromisedDate: "Promised payment date",
  dunningFormFollowUpDate: "Follow-up date",
  dunningFormAmount: "Amount",
  dunningFormNote: "Note",
  dunningPromiseDateHint: "A PROMISE_TO_PAY action requires its promised date.",
  dunningFormInvoiceOptional: "Invoice",
  dunningColCode: "Code",
  dunningColClass: "Class",
  dunningColNextReview: "Next review",
  dunningColLastReview: "Last review",
  dunningNoClass: "No class",
  dunningRecordReviewTitle: "Record a credit review",
  dunningFormScoreClass: "Credit score class",
  dunningFormNextReview: "Next review date",
  dunningFormReviewNote: "Review note",
  dunningAgencyActive: "Active",
  dunningAgencySuspended: "Suspended",
  dunningColAgency: "Agency",
  dunningColContact: "Contact",
  dunningColCommissionMode: "Commission",
  dunningColCommissionPct: "Rate",
  dunningColFlatFee: "Flat fee",
  dunningColTokenIssued: "Token issued",
  dunningColReferralDate: "Referral date",
  dunningColReferredAmount: "Referred amount",
  dunningColSettledAmount: "Settled amount",
  dunningColCommissionAmount: "Commission",
  dunningCommissionPctOfCollected: "% of collected",
  dunningCommissionFlatFee: "Flat fee",
  dunningAgencyCreateTitle: "Register a collection agency",
  dunningFormContactName: "Contact name",
  dunningFormEmail: "Email",
  dunningFormPhone: "Phone",
  dunningFormCommissionMode: "Commission mode",
  dunningActionIssueToken: "Issue token",
  dunningActionSuspend: "Suspend",
  dunningAgencyTokenTitle: "Agency portal token",
  dunningAgencyTokenOnce:
    "This token is shown ONCE and cannot be recovered — copy it now and hand it to the agency over a secure channel.",
  dunningConfirmIssueToken: "Issue a new token? Any previous token for this agency is revoked.",
  dunningConfirmSuspend: "Suspend this agency? It stops receiving referrals.",
  dunningReferralReferred: "Referred",
  dunningReferralAcknowledged: "Acknowledged",
  dunningReferralPartial: "Partial",
  dunningReferralSettled: "Settled",
  dunningReferralCommissionPosted: "Commission posted",
  dunningReferralClosed: "Closed",
  dunningReferralCancelled: "Cancelled",
  dunningReferralCreateTitle: "Refer to a collection agency",
  dunningSettleTitle: "Record a collected amount",
  dunningFormAgency: "Agency",
  dunningFormPartner: "Customer",
  dunningFormReferredAmount: "Referred amount",
  dunningFormReferralDate: "Referral date",
  dunningFormSettledAmount: "Settled amount",
  dunningActionRefer: "Refer",
  dunningActionSettle: "Record settlement",
  dunningActionPostCommission: "Post commission",
  dunningActionCloseReferral: "Close",
  dunningConfirmPostCommission: "Post the agency commission (G-39)?",
  dunningConfirmClose: "Close this referral?",
  dunningToastDone: "Done.",
  dunningLettersEmpty: "No dunning letters yet.",
  dunningPoliciesEmpty: "No dunning policies yet.",
  dunningActionsEmpty: "No collection actions logged.",
  dunningReviewsEmpty: "No credit reviews due.",
  dunningAgenciesEmpty: "No collection agencies registered.",
  dunningReferralsEmpty: "No referrals.",
  dunningErrSteps: "The step ladder is invalid — overdue days must increase starting at step 1.",
  dunningErrLateFee: "The late-fee configuration is incomplete.",
  dunningErrFeeAlreadyCharged: "This invoice already carries a late fee — one fee per invoice.",
  dunningErrFeeNotWaivable: "This fee cannot be waived (missing or already waived).",
  dunningErrReview: "The review payload is invalid.",
  dunningErrReferralState: "The referral's state does not permit this action.",
  dunningErrCommissionUnmapped:
    "The collection-commission account is unmapped — map the sales.collection_commission_account setting.",
  srmaColNo: "SRMA no.",
  srmaColSupplier: "Supplier",
  srmaColPo: "Purchase order",
  srmaColTotal: "Total",
  srmaColRequested: "Requested at",
  srmaColLine: "Line",
  srmaColItem: "Item",
  srmaColQty: "Qty",
  srmaColUnitCost: "Unit cost",
  srmaColNet: "Net",
  srmaStatusRequested: "Requested",
  srmaStatusApproved: "Approved",
  srmaStatusShipped: "Shipped",
  srmaStatusCredited: "Credited",
  srmaStatusCancelled: "Cancelled",
  srmaActionCreate: "New supplier RMA",
  srmaActionView: "View",
  srmaActionApprove: "Approve",
  srmaActionShip: "Ship",
  srmaActionCredit: "Issue credit",
  srmaActionCancel: "Cancel",
  srmaCreateTitle: "New supplier return authorization",
  srmaDetailTitle: "Supplier RMA detail",
  srmaShipTitle: "Ship the return to the supplier",
  srmaFormPo: "Purchase order",
  srmaFormPickPo: "Pick a purchase order",
  srmaFormPoLine: "PO line",
  srmaFormWarehouse: "Warehouse",
  srmaConfirmApprove: "Approve this return authorization?",
  srmaConfirmShip: "Ship the return? The chosen warehouse's stock is issued.",
  srmaConfirmCredit: "Issue the supplier credit (G-38)?",
  srmaConfirmCancel: "Cancel this return authorization?",
  srmaToastCreated: "The supplier return was created.",
  srmaToastDone: "Done.",
  srmaEmpty: "No supplier returns yet.",
  srmaLinesEmpty: "This order carries no lines.",
  srmaErrState: "The current state does not permit this action.",
  srmaErrQtyExceeds: "The return qty exceeds the available balance on this line.",
  srmaErrUnmapped:
    "The purchase-returns account is unmapped — map the purchasing.supplier_return_account setting.",
  // -- PHASE-041 (T-10): the communications hub -------------------------------
  commTitle: "Communications",
  commSubtitle:
    "Message templates, provider selection, and the default notification matrix — every send rides the channel port, and the default provider makes zero external calls until configured.",
  commTabTemplates: "Templates",
  commTabProviders: "Providers",
  commTabDefaults: "Notification defaults",
  commTemplatesHint:
    "Channel × locale × module templates with documented variables — edits create a tenant override; deleting restores the builtin. Previews fail with the exact send-time errors (fail-closed).",
  commTplColKey: "Key",
  commTplColChannel: "Channel",
  commTplColLocale: "Locale",
  commTplColModule: "Module",
  commTplColStatus: "Status",
  commTplColAction: "Actions",
  commTplChannelEmail: "Email",
  commTplChannelWhatsapp: "WhatsApp",
  commTplChannelSms: "SMS",
  commTplOverrideBadge: "Customized",
  commTplBuiltinBadge: "Builtin",
  commTplActive: "Active",
  commTplInactive: "Inactive",
  commTplEditBtn: "Edit",
  commTplPreviewBtn: "Preview",
  commTplDeleteBtn: "Delete override",
  commTplDeletedToast: "The builtin template is back.",
  commTplEditorNewTitle: "New template",
  commTplEditorEditTitle: "Edit template",
  commTplFormKey: "Key",
  commTplFormModule: "Module",
  commTplFormSubject: "Subject",
  commTplFormBody: "Body",
  commTplFormVars: "Variables",
  commTplFormActive: "Active",
  commTplSaveBtn: "Save",
  commTplSavedToast: "Template saved.",
  commTplCancelBtn: "Cancel",
  commTplPreviewTitle: "Preview",
  commTplPreviewVarsHint:
    "Enter sample values for the required variables — the preview renders the exact outgoing output.",
  commTplPreviewRunBtn: "Render",
  commTplPreviewSubject: "Subject",
  commTplPreviewBody: "Body",
  commTplPreviewWhatsappParams: "Ordered WhatsApp parameters",
  commTplErrInvalid: "Invalid template — check the required fields and variables.",
  commProvidersHint:
    "Per-channel provider selection with credentials (sealed at rest, never displayed after saving), per-market sender numbers, and the daily send cap. Until a fully-credentialed provider is set, every channel runs on the SANDBOX default with zero external calls.",
  commProvColProvider: "Provider",
  commProvColChannel: "Channel",
  commProvColStatus: "Status",
  commProvColAction: "Actions",
  commProvSelectLabel: "Serving provider",
  commProvSelectSandbox: "Sandbox (default — zero external calls)",
  commProvLiveBadge: "Live",
  commProvSandboxBadge: "Sandbox",
  commProvBlockedBadge: "Blocked on credentials",
  commProvRequiresVerification: "Requires provider verification",
  commProvCredsTitle: "Credentials",
  commProvCredsHint:
    "Secret fields are stored sealed and never returned for display — only whether they are configured. Leave a field empty to keep the stored value.",
  commProvCredsConfigured: "Configured",
  commProvCredsNotConfigured: "Not configured",
  commProvCredSaveBtn: "Save credentials",
  commProvCredsSavedToast: "Credentials saved (sealed).",
  commProvMarketsTitle: "Per-market senders",
  commProvMarketsHint:
    "Per market (two-letter ISO code): a WhatsApp phone id, an SMS sender name, or a from-address — sends use the market sender when present.",
  commProvMarketCodeLabel: "Market",
  commProvMarketWhatsappId: "WhatsApp phone id",
  commProvMarketSmsSender: "SMS sender name",
  commProvMarketEmailFrom: "Email from address",
  commProvMarketRemoveBtn: "Remove",
  commProvMarketAddBtn: "Add market",
  commProvCapTitle: "Daily send cap",
  commProvCapHint:
    "A hard per-tenant ceiling on outbound messages per day — protection against silently draining paid channels.",
  commProvCapLabel: "Max messages per day",
  commProvCapSavedToast: "Cap saved.",
  commDefaultsHint:
    "The tenant-default notification matrix (module × channel) — users inherit these rows until they set their own from the communications inbox.",
  commPrefColModule: "Module",
  commPrefChInApp: "In-app",
  commPrefChEmail: "Email",
  commPrefChSms: "SMS",
  commPrefChWhatsapp: "WhatsApp",
  commPrefSavedToast: "Notification preferences saved.",
  commInboxTitle: "Communications inbox",
  commInboxSubtitle:
    "Every message and call on one per-partner timeline — with kind, channel, and direction filters, plus manual call logging with outcome and duration.",
  commInboxTabTimeline: "Timeline",
  commInboxTabCall: "Log a call",
  commInboxTabPrefs: "My preferences",
  commInboxFilterKind: "Kind",
  commInboxFilterChannel: "Channel",
  commInboxFilterDirection: "Direction",
  commInboxFilterAll: "All",
  commInboxKindMessage: "Message",
  commInboxKindCall: "Call",
  commInboxDirInbound: "Inbound",
  commInboxDirOutbound: "Outbound",
  commInboxColAt: "When",
  commInboxColKind: "Kind",
  commInboxColChannel: "Channel",
  commInboxColCounterparty: "Counterparty",
  commInboxColSummary: "Summary",
  commInboxColOutcome: "Outcome",
  commInboxColDuration: "Duration",
  commInboxColUser: "User",
  commInboxEmpty: "No communications yet — sent messages and logged calls will appear here.",
  commInboxRefresh: "Refresh",
  commInboxDurationValue: "{minutes} min",
  commCallFormTitle: "Log a call",
  commCallFormHint:
    "An inbound or outbound call linked to a partner — the outcome, duration, and notes land on the unified timeline.",
  commCallPartnerLabel: "Partner",
  commCallDirectionLabel: "Direction",
  commCallOutcomeLabel: "Outcome",
  commCallSummaryLabel: "Summary",
  commCallBodyLabel: "Notes",
  commCallDurationLabel: "Duration (minutes)",
  commCallAtLabel: "Call time",
  commCallSubmitBtn: "Log",
  commCallLoggedToast: "Call logged.",
  commCallOutcomeCompleted: "Completed",
  commCallOutcomeNoAnswer: "No answer",
  commCallOutcomeBusy: "Busy",
  commCallOutcomeVoicemail: "Voicemail",
  commCallOutcomeFailed: "Failed",
  commCallOutcomeScheduled: "Scheduled",
  commCallErrInvalid: "Invalid call entry — check the partner, summary, and duration.",
  commMyPrefsTitle: "My notification preferences",
  commMyPrefsHint:
    "The module × channel matrix — opting out of a module×channel stops every send on it for you (dunning letters included). Paid channels default off.",
  commMyPrefsExplicitBadge: "Customized",
  commMyPrefsInheritNote: "Non-customized rows inherit the default",
  commMyPrefsSavedToast: "Your preferences are saved.",
  commPrefModuleLimits: "Usage limits",
  commPrefModuleSubscription: "Subscription",
  commPrefModuleReconciliation: "Reconciliations",
  commPrefModuleInvoiceOverdue: "Overdue invoices",
  commPrefModuleStock: "Stock",
  commPrefModuleTemplates: "Industry templates",
  commPrefModuleCrm: "CRM",
  commPrefModuleEinvoicing: "E-invoicing",
  commPrefModuleNotes: "Cheques & notes",
  commPrefModuleInstallments: "Installments",
  commPrefModuleBudgeting: "Budgeting",
  commPrefModulePurchasing: "Purchasing",
  commPrefModuleCollections: "Collections",
  commPrefModuleWarranties: "Warranties",
  commPrefModuleDigest: "Daily digest",
};

const dictionaries: Record<Locale, Dictionary> = { ar, en };

/**
 * Gregorian month names (index 0 = January) for the fiscal-start-month
 * select (P4-T12a onboarding + settings screens). Fiscal years stay
 * Gregorian by design (A-004) — these are display labels only.
 */
export const monthNames: Record<Locale, readonly string[]> = {
  ar: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

/**
 * Key-parity assertion: `Object.keys(ar) === Object.keys(en)`. TypeScript
 * already guarantees this through the `Dictionary` interface; the runtime
 * check keeps the parity contract green even if the dictionaries are ever
 * assembled dynamically. Executed at module load on first import.
 */
export function assertDictionaryParity(): void {
  const arKeys = Object.keys(dictionaries.ar).sort().join(",");
  const enKeys = Object.keys(dictionaries.en).sort().join(",");
  if (arKeys !== enKeys) {
    throw new Error(`dictionary key parity violation between "ar" and "en"`);
  }
}

assertDictionaryParity();

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

/** The "other" locale — locale switching is a 1:1 link swap. */
export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
