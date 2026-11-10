/**
 * PHASE-022 · the typed AR/EN mobile dictionaries (MASTER-PLAN §5 / DR-P22-04
 * — i18n). Arabic-first (`defaultLocale = "ar"`, RTL_DESIGN_RULES §1): the
 * product is RTL-first and the English catalog is the generated mirror.
 *
 * 100% key parity between locales is enforced TWICE, exactly like the web
 * catalog (apps/web/i18n/dictionaries.ts — the catalog pattern this mirrors):
 *
 *   1. Statically — both literals are typed as `Dictionary`, so TypeScript
 *      rejects a missing or extra key on either side.
 *   2. At runtime — `assertMobileParity()` below executes at module load
 *      (every screen import pulls this module), and the root gate
 *      `pnpm check:mobile-i18n` (scripts/check-mobile-i18n-parity.ts) fails
 *      the build on key drift or empty values.
 *
 * Key-naming convention (handoff to 2-e/3-b): flat camelCase keys namespaced
 * by screen/area — `common*`, `tab*`, `syncState*`, `asOf*`, `reject*` (the
 * CONFLICT_RESOLUTION §3 codes), `action*` (the per-code action table),
 * `parked*`, `login*`, `deviceReg*`, `unlock*`, `home*`, `statements*`,
 * `invoice*`, `routes*`, `scanner*`, `vanSale*`, `collection*`, `vanLoad*`/
 * `vanUnload*`/`vanStock*`, `returns*`, `count*`, `personal*`,
 * `notifications*`, `settings*`, `err*`. Interpolation is `{param}` (the web
 * convention); pass PRE-FORMATTED values (digits.ts owns number/date shapes —
 * never let a screen format money itself).
 *
 * Digits policy inside strings (RTL_DESIGN_RULES §5/§8): numerals inside
 * Arabic sentences stay WESTERN (latn) — "4 منازل", never "٤". Identifiers
 * (doc numbers, IBANs, serials, phone numbers) are LTR runs that screens
 * wrap with the bidi.ts isolates; they are never mirrored.
 */
export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

export interface Dictionary {
  // -- app + shared chrome -----------------------------------------------
  appTitle: string;
  appTagline: string;
  commonOk: string;
  commonCancel: string;
  commonSave: string;
  commonConfirm: string;
  commonClose: string;
  commonBack: string;
  commonNext: string;
  commonDone: string;
  commonRetry: string;
  commonSearch: string;
  commonLoading: string;
  commonAdd: string;
  commonEdit: string;
  commonDelete: string;
  commonYes: string;
  commonNo: string;
  commonMore: string;
  commonAll: string;
  commonNone: string;
  commonOptional: string;
  commonUnknown: string;
  commonToday: string;
  commonTotal: string;
  commonSubtotal: string;
  commonDiscount: string;
  commonTax: string;
  commonAmount: string;
  commonQuantity: string;
  commonPrice: string;
  commonDate: string;
  commonTime: string;
  commonBalance: string;
  commonDueDate: string;
  commonReference: string;
  commonMethod: string;
  commonBatch: string;
  commonSerial: string;
  commonWarehouse: string;
  commonRoute: string;
  commonCustomer: string;
  commonItem: string;
  commonStatus: string;
  commonActions: string;
  commonEmpty: string;
  commonError: string;
  commonRequired: string;

  // -- tab bar (DR-P22-11: one app, per-class tab sets) --------------------
  tabHome: string;
  tabVisits: string;
  tabVanStock: string;
  tabNotifications: string;
  tabSettings: string;

  // -- post-sync states (OFFLINE_CAPABILITIES §2 header) + host UI --------
  syncStatePendingSync: string;
  syncStatePendingSyncHint: string;
  syncStatePosted: string;
  syncStatePostedHint: string;
  syncStateRejected: string;
  syncStateRejectedHint: string;
  syncStateDraftLocal: string;
  syncStateDraftLocalHint: string;
  syncStatusTitle: string;
  syncStatusOnline: string;
  syncStatusOffline: string;
  syncStatusSyncing: string;
  syncStatusIdle: string;
  syncNow: string;
  syncNowRunning: string;
  syncLastRun: string;
  syncNeverRun: string;
  syncPendingCount: string;
  syncCycleSummary: string;
  syncRetryIn: string;
  syncErrorNetwork: string;

  // -- as-of labels + offline/online-only affordances ----------------------
  asOfLabel: string;
  asOfStaleWarning: string;
  asOfNeverSynced: string;
  /** The LOCAL-VALID† banner markers (T-P22-2-e): the advisory lane's chip
   * label (warns, never blocks) and the structural lane's (blocks the save). */
  advisoryLabel: string;
  blockingLabel: string;
  offlineQueued: string;
  onlineOnlyTitle: string;
  onlineOnlyReason: string;
  approvalsOnlineOnly: string;
  postingOnlineOnly: string;
  readOnlyMode: string;
  readOnlyReasonWatermark: string;
  sessionExpiredTitle: string;
  sessionExpiredBody: string;

  // -- force update (release policy halt remedy, DR-P21-05 port) ----------
  forceUpdateTitle: string;
  forceUpdateBody: string;
  forceUpdateAction: string;

  // -- rejection reasons (CONFLICT_RESOLUTION §3 vocabulary) --------------
  rejectPeriodLocked: string;
  rejectPeriodLockedDetail: string;
  rejectPriceChanged: string;
  rejectPriceChangedDetail: string;
  rejectInsufficientStock: string;
  rejectInsufficientStockDetail: string;
  rejectCreditLimitExceeded: string;
  rejectCreditLimitExceededDetail: string;
  rejectStaleVersion: string;
  rejectStaleVersionDetail: string;
  rejectItemInactive: string;
  rejectItemInactiveDetail: string;
  rejectPartnerInactive: string;
  rejectPartnerInactiveDetail: string;
  rejectValidationError: string;
  rejectValidationErrorDetail: string;
  rejectDeviceRevoked: string;
  rejectDeviceRevokedDetail: string;
  rejectTenantSuspended: string;
  rejectTenantSuspendedDetail: string;

  // -- rejection action table (OFFLINE_CAPABILITIES §2 header) ------------
  actionEditAndResend: string;
  actionAcceptServerPrice: string;
  actionAcceptPartial: string;
  actionCancel: string;
  actionSubstituteAndResend: string;
  actionReviewAndMerge: string;
  actionDiscard: string;
  actionRequestApproval: string;
  actionAppliedToast: string;
  actionConfirmDiscard: string;

  // -- parked rejections screen -------------------------------------------
  parkedTitle: string;
  parkedIntro: string;
  parkedEmpty: string;
  parkedColDate: string;
  parkedColDoc: string;
  parkedColReason: string;
  parkedTraceId: string;
  parkedResendNote: string;
  parkedNoResubmitTitle: string;
  parkedNoResubmitBody: string;
  parkedAuditNote: string;

  // -- onboarding + login ---------------------------------------------------
  onboardingWelcomeTitle: string;
  onboardingWelcomeBody: string;
  onboardingStart: string;
  loginTitle: string;
  loginEmailLabel: string;
  loginPasswordLabel: string;
  loginSubmit: string;
  loginBiometricHint: string;
  loginErrorInvalid: string;
  loginErrorNetwork: string;
  loginErrorGeneric: string;

  // -- device registration + trust -----------------------------------------
  deviceRegTitle: string;
  deviceRegIntro: string;
  deviceRegNameLabel: string;
  deviceRegNamePlaceholder: string;
  deviceRegClassLabel: string;
  deviceRegClassField: string;
  deviceRegClassPersonal: string;
  deviceRegSubmit: string;
  deviceRegSubmitting: string;
  deviceRegSuccess: string;
  deviceRegPendingApproval: string;
  deviceRegErrorNetwork: string;
  deviceRegErrorGeneric: string;
  deviceTrustAtRisk: string;

  // -- unlock (biometric + PIN fallback, DR-P22-09) -------------------------
  unlockTitle: string;
  unlockBiometricButton: string;
  unlockBiometricUnavailable: string;
  unlockBiometricFailed: string;
  unlockUsePin: string;
  unlockUseBiometric: string;
  unlockPinPrompt: string;
  unlockPinIncorrect: string;
  unlockPinLockedOut: string;
  unlockNeededTitle: string;
  unlockNeededBody: string;
  unlockSetPinTitle: string;
  unlockSetPinBody: string;
  unlockPinMismatch: string;

  // -- home dashboard (companion) ------------------------------------------
  homeTitle: string;
  homeGreeting: string;
  homeRouteToday: string;
  homeSectionToday: string;
  homeMetricSales: string;
  homeMetricCollections: string;
  homeMetricReturns: string;
  homeMetricCash: string;
  homeVanStock: string;
  homeQuickSale: string;
  homeQuickCollection: string;
  homeQuickVanLoad: string;
  homeQuickReturn: string;
  homeQuickCount: string;
  homeParkedTile: string;
  homeSyncTile: string;

  // -- statements (rows 13/14/29 READ-CACHED) ------------------------------
  statementsTitle: string;
  statementsIntro: string;
  statementsColDoc: string;
  statementsColDebit: string;
  statementsColCredit: string;
  statementsOpeningBalance: string;
  statementsClosingBalance: string;
  statementsRunningBalance: string;
  statementsStatementNo: string;
  statementsEmpty: string;
  statementsPeriodLabel: string;
  statementsGeneratedAt: string;

  // -- invoices (list + view) ----------------------------------------------
  invoicesTitle: string;
  invoicesSearchPlaceholder: string;
  invoicesColNumber: string;
  invoicesEmpty: string;
  invoicesEmptyPersonal: string;
  invoiceViewTitle: string;
  invoiceViewHeader: string;
  invoiceViewNumber: string;
  invoiceViewOfflineNumber: string;
  invoiceViewLines: string;
  invoiceViewPostedAt: string;
  invoiceViewDueDate: string;
  invoiceViewSerials: string;
  invoiceViewNotPostedYet: string;

  // -- route visits ---------------------------------------------------------
  routesTitle: string;
  routesIntro: string;
  routesEmpty: string;
  routesVisitPlanned: string;
  routesVisitDone: string;
  routesVisitSkipped: string;
  routesVisitBalance: string;
  routesVisitCreditLimit: string;
  routesVisitTierPricing: string;
  routesVisitNoTierPricing: string;
  routesVisitFreeGoods: string;
  routesVisitOpenInvoices: string;
  routesVisitCollectHere: string;
  routesVisitSellHere: string;

  // -- barcode scanner (codes never mirror — RTL §3.2) ----------------------
  scannerTitle: string;
  scannerHint: string;
  scannerPermissionNeeded: string;

  // -- van sale capture (LOCAL-VALID pre-validation) ------------------------
  vanSaleTitle: string;
  vanSaleCartTitle: string;
  vanSaleScanButton: string;
  vanSaleSearchPlaceholder: string;
  vanSaleEmptyCart: string;
  vanSaleCheckout: string;
  vanSaleTotalDue: string;
  vanSalePriceLabel: string;
  vanSaleLineTotal: string;
  vanSalePaymentLabel: string;
  vanSalePaymentCash: string;
  vanSalePaymentCredit: string;
  vanSaleCustomerRequired: string;
  vanSaleNoCustomerCashOnly: string;
  vanSaleCreditLimitAdvisory: string;
  vanSaleStockAdvisory: string;
  vanSalePriceAdvisory: string;
  vanSaleSerialCapture: string;
  vanSaleSerialPlaceholder: string;
  vanSaleBatchCapture: string;
  vanSaleBatchPlaceholder: string;
  vanSaleSavedLocal: string;
  vanSaleQtyInvalid: string;
  vanSaleQtyNeedsSerial: string;
  vanSaleConfirmTitle: string;
  vanSaleConfirmBody: string;

  // -- collection (row 9 field receipt) -------------------------------------
  collectionTitle: string;
  collectionIntro: string;
  collectionCustomerPlaceholder: string;
  collectionAmountLabel: string;
  collectionMethodLabel: string;
  collectionMethodCash: string;
  collectionMethodTransfer: string;
  collectionReferenceLabel: string;
  collectionReferencePlaceholder: string;
  collectionAllocateLabel: string;
  collectionAutoAllocate: string;
  collectionAllocated: string;
  collectionOpenBalance: string;
  collectionSavedLocal: string;
  collectionAmountInvalid: string;
  collectionExceedsOpenBalance: string;

  // -- van load / unload (row 12) + van stock view --------------------------
  vanLoadTitle: string;
  vanLoadIntro: string;
  vanLoadFromWarehouse: string;
  vanLoadAddLine: string;
  vanLoadEmpty: string;
  vanLoadConfirm: string;
  vanLoadSavedLocal: string;
  vanLoadAsOfSnapshot: string;
  vanUnloadTitle: string;
  vanUnloadIntro: string;
  vanUnloadReturnTo: string;
  vanUnloadQtyExceedsStock: string;
  vanUnloadConfirm: string;
  vanUnloadSavedLocal: string;
  vanStockTitle: string;
  vanStockEmpty: string;

  // -- returns (row 27 credit-note draft) ------------------------------------
  returnsTitle: string;
  returnsIntro: string;
  returnsPickInvoice: string;
  returnsOriginalRequired: string;
  returnsReasonLabel: string;
  returnsReasonPlaceholder: string;
  returnsRestockLabel: string;
  returnsRestockVan: string;
  returnsRestockWarehouse: string;
  returnsSavedLocal: string;

  // -- count lines (row 11 — facts only) ------------------------------------
  countTitle: string;
  countIntro: string;
  countQtyLabel: string;
  countBatchLabel: string;
  countAddLine: string;
  countEmpty: string;
  countUnknownBarcode: string;
  countSubmit: string;
  countSavedLocal: string;

  // -- personal account home (rows 13/14/29 READ-CACHED) --------------------
  personalTitle: string;
  personalWelcome: string;
  personalReadonlyNotice: string;
  personalBalanceLabel: string;
  personalBalanceDue: string;
  personalBalanceNone: string;
  personalStatementTile: string;
  personalInvoicesTile: string;
  personalReceiptsTile: string;
  personalNotificationsTile: string;
  personalDueSoon: string;
  personalReceiptsEmpty: string;
  personalReceiptViewTitle: string;
  personalReceiptMethod: string;
  personalBackgroundNote: string;
  personalLinkedPartner: string;

  // -- notifications (row 29 read state + FCM opt-in) ------------------------
  notificationsTitle: string;
  notificationsEmpty: string;
  notificationsUnreadCount: string;
  notificationsMarkRead: string;
  notificationsMarkAllRead: string;
  notificationsAsOf: string;
  notificationsOpenInvoice: string;
  notificationsChannelSync: string;
  notificationsOptIn: string;
  notificationsOptInNote: string;

  // -- settings ---------------------------------------------------------------
  settingsTitle: string;
  settingsDeviceSection: string;
  settingsDeviceId: string;
  settingsDeviceName: string;
  settingsDeviceClass: string;
  settingsDeviceStatus: string;
  settingsDeviceStatusActive: string;
  settingsDeviceStatusPendingApproval: string;
  settingsDeviceStatusRevoked: string;
  settingsSyncSection: string;
  settingsSecuritySection: string;
  settingsBiometricToggle: string;
  settingsBiometricUnavailable: string;
  settingsLanguageSection: string;
  settingsLanguageAr: string;
  settingsLanguageEn: string;
  settingsLanguageChangeNote: string;
  settingsAboutSection: string;
  settingsVersionLabel: string;
  settingsStorageUsed: string;
  settingsSignOut: string;
  settingsSignOutConfirm: string;

  // -- validation errors ------------------------------------------------------
  errNotFound: string;
  errPermissionDenied: string;
  errInvalidMoney: string;
  errInvalidQty: string;
  errInvalidDate: string;
  errInvalidPhone: string;
  // PHASE-022 T-P22-3-b · the companion/personal/rejection wave's keys
  // (aging buckets — the honest due-date structure the statements cache
  // carries; the dashboard approvals tile + master-data search; the §3
  // unknown-code support hint).
  agingNotDue: string;
  aging1To30: string;
  aging31To60: string;
  aging61To90: string;
  aging90Plus: string;
  dashboardIntro: string;
  homeApprovalsTile: string;
  masterSearchTitle: string;
  masterSearchEmpty: string;
  rejectionSupportHint: string;
}

const ar: Dictionary = {
  // -- app + shared chrome ------------------------------------------------
  appTitle: "تطبيق الميدان",
  appTagline: "رفيق واحد لبيع الميدان والحساب الشخصي",
  commonOk: "موافق",
  commonCancel: "إلغاء",
  commonSave: "حفظ",
  commonConfirm: "تأكيد",
  commonClose: "إغلاق",
  commonBack: "رجوع",
  commonNext: "التالي",
  commonDone: "تم",
  commonRetry: "إعادة المحاولة",
  commonSearch: "بحث",
  commonLoading: "جارٍ التحميل...",
  commonAdd: "إضافة",
  commonEdit: "تعديل",
  commonDelete: "حذف",
  commonYes: "نعم",
  commonNo: "لا",
  commonMore: "المزيد",
  commonAll: "الكل",
  commonNone: "لا شيء",
  commonOptional: "اختياري",
  commonUnknown: "غير معروف",
  commonToday: "اليوم",
  commonTotal: "الإجمالي",
  commonSubtotal: "المجموع الجزئي",
  commonDiscount: "الخصم",
  commonTax: "الضريبة",
  commonAmount: "المبلغ",
  commonQuantity: "الكمية",
  commonPrice: "السعر",
  commonDate: "التاريخ",
  commonTime: "الوقت",
  commonBalance: "الرصيد",
  commonDueDate: "تاريخ الاستحقاق",
  commonReference: "المرجع",
  commonMethod: "الطريقة",
  commonBatch: "الدفعة",
  commonSerial: "المسلسل",
  commonWarehouse: "المستودع",
  commonRoute: "الخط",
  commonCustomer: "العميل",
  commonItem: "الصنف",
  commonStatus: "الحالة",
  commonActions: "إجراءات",
  commonEmpty: "لا توجد بيانات لعرضها بعد.",
  commonError: "حدث خطأ غير متوقع — حاول مرة أخرى.",
  commonRequired: "هذا الحقل مطلوب.",

  // -- tab bar -------------------------------------------------------------
  tabHome: "الرئيسية",
  tabVisits: "الزيارات",
  tabVanStock: "السيارة",
  tabNotifications: "التنبيهات",
  tabSettings: "الإعدادات",

  // -- post-sync states + host UI -------------------------------------------
  syncStatePendingSync: "بانتظار المزامنة",
  syncStatePendingSyncHint: "محفوظ محليًا وسيرفع في أول دورة مزامنة.",
  syncStatePosted: "تم الترحيل",
  syncStatePostedHint: "قبِله الخادم وأصبح رسميًا برقمه المعتمد.",
  syncStateRejected: "مرفوض (قابل للمعالجة)",
  syncStateRejectedHint: "رفضه الخادم؛ عالِجه من شاشة الرفوض المتوقفة.",
  syncStateDraftLocal: "مسودة محلية",
  syncStateDraftLocalHint: "مسودة على هذا الجهاز فقط ولم تُصف للمزامنة بعد.",
  syncStatusTitle: "حالة المزامنة",
  syncStatusOnline: "متصل",
  syncStatusOffline: "غير متصل — سيتم المزامنة",
  syncStatusSyncing: "جارٍ المزامنة...",
  syncStatusIdle: "خامل",
  syncNow: "زامن الآن",
  syncNowRunning: "جارٍ رفع التغييرات...",
  syncLastRun: "آخر مزامنة: {time}",
  syncNeverRun: "لم تتم أي مزامنة بعد",
  syncPendingCount: "مستندات بانتظار المزامنة: {count}",
  syncCycleSummary: "اكتملت الدورة: رفع {pushed} واستلام {pulled}",
  syncRetryIn: "إعادة المحاولة بعد {seconds} ثانية",
  syncErrorNetwork: "تعذّر الوصول إلى الخادم.",

  // -- as-of labels + offline/online-only affordances -------------------------
  asOfLabel: "كما في {date}",
  asOfStaleWarning: "هذه البيانات قديمة — تُعرض كما هي ولا يُخمَّن شيء.",
  asOfNeverSynced: "لم تُسحب هذه البيانات إلى الجهاز بعد.",
  advisoryLabel: "تنبيه",
  blockingLabel: "خطأ",
  offlineQueued: "إجراءات في قائمة الانتظار: {count}",
  onlineOnlyTitle: "يتطلب اتصالًا",
  onlineOnlyReason: "هذا الإجراء يحتاج اتصالًا مباشرًا بالخادم — ولا يُصف في قائمة انتظار أبدًا.",
  approvalsOnlineOnly: "الموافقات أونلاين فقط.",
  postingOnlineOnly: "الترحيل النهائي أونلاين فقط.",
  readOnlyMode: "وضع القراءة فقط",
  readOnlyReasonWatermark: "تجاوزت لقطة الصلاحيات مهلة السبعة أيام — يلزم اتصال لتحديثها.",
  sessionExpiredTitle: "انتهت الجلسة",
  sessionExpiredBody: "انتهت صلاحية الجلسة — سجّل الدخول من جديد للمتابعة.",

  // -- force update -----------------------------------------------------------
  forceUpdateTitle: "تحديث إلزامي",
  forceUpdateBody: "أُوقف هذا الإصدار لأسباب استقرار — حدّث التطبيق للمتابعة.",
  forceUpdateAction: "حدّث الآن",

  // -- rejection reasons -------------------------------------------------------
  rejectPeriodLocked: "الفترة مقفلة",
  rejectPeriodLockedDetail: "قُفل المركز المحاسبي للفترة قبل وصول المستند.",
  rejectPriceChanged: "تغيّر السعر",
  rejectPriceChangedDetail: "السعر عند الخادم {server} بينما المسودة تحمل {cached} خارج حد السماح.",
  rejectInsufficientStock: "مخزون غير كافٍ",
  rejectInsufficientStockDetail: "المتاح في السيارة {available} فقط من هذا الصنف.",
  rejectCreditLimitExceeded: "تجاوز الحد الائتماني",
  rejectCreditLimitExceededDetail: "حد العميل الائتماني {limit} ورصيده المستحق {due}.",
  rejectStaleVersion: "نسخة قديمة",
  rejectStaleVersionDetail: "تعديل الجهاز أقدم من لقطة الخادم — ادمج يدويًا.",
  rejectItemInactive: "الصنف غير نشط",
  rejectItemInactiveDetail: "أُوقف الصنف على الخادم فلم يعد قابلًا للبيع.",
  rejectPartnerInactive: "العميل غير نشط",
  rejectPartnerInactiveDetail: "أُوقف حساب العميل على الخادم.",
  rejectValidationError: "خطأ تحقق",
  rejectValidationErrorDetail: "فشل التحقق البنيوي على الخادم — راجع الحقول المطلوبة.",
  rejectDeviceRevoked: "الجهاز ملغى",
  rejectDeviceRevokedDetail: "سُحب تسجيل هذا الجهاز — لا إعادة إرسال؛ مسار إداري.",
  rejectTenantSuspended: "المنشأة موقوفة",
  rejectTenantSuspendedDetail: "حساب المنشأة موقوف مؤقتًا — مسار إداري لا إعادة إرسال.",

  // -- rejection action table ---------------------------------------------------
  actionEditAndResend: "تعديل وإعادة الإرسال",
  actionAcceptServerPrice: "اعتماد سعر الخادم",
  actionAcceptPartial: "قبول جزئي",
  actionCancel: "إلغاء المستند",
  actionSubstituteAndResend: "استبدال وإعادة إرسال",
  actionReviewAndMerge: "مراجعة ودمج",
  actionDiscard: "تجاهل",
  actionRequestApproval: "طلب موافقة",
  actionAppliedToast: "سُجّل اختيارك في سجل التدقيق.",
  actionConfirmDiscard: "لا يمكن التراجع عن التجاهل — أتود المتابعة؟",

  // -- parked rejections ---------------------------------------------------------
  parkedTitle: "الرفوض المتوقفة",
  parkedIntro: "كل مستند رفضه الخادم ينتظر قرارك هنا — لا شيء يُحل تلقائيًا أبدًا.",
  parkedEmpty: "لا توجد رفوض متوقفة.",
  parkedColDate: "التاريخ",
  parkedColDoc: "المستند",
  parkedColReason: "السبب",
  parkedTraceId: "مرجع التتبع: {traceId}",
  parkedResendNote: "إعادة الإرسال تُنشئ أمرًا جديدًا بنفس معرّف المستند؛ وعند تغيّر الحمولة يتولد مفتاح تكرار جديد.",
  parkedNoResubmitTitle: "مسار إداري",
  parkedNoResubmitBody: "هذا الرفض لا يُعالج من الجهاز — تواصل مع مدير منشأتك.",
  parkedAuditNote: "كل اختيار يُسجَّل في التدقيق مع مرجع الرفض نفسه.",

  // -- onboarding + login ----------------------------------------------------------
  onboardingWelcomeTitle: "أهلًا بك في تطبيق الميدان",
  onboardingWelcomeBody: "جهاز واحد بتجربتين: بيع الميدان أو الحساب الشخصي — اختر مسارك بعد تسجيل الجهاز.",
  onboardingStart: "ابدأ",
  loginTitle: "تسجيل الدخول",
  loginEmailLabel: "البريد الإلكتروني",
  loginPasswordLabel: "كلمة المرور",
  loginSubmit: "دخول",
  loginBiometricHint: "أو استخدم البصمة",
  loginErrorInvalid: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  loginErrorNetwork: "تعذّر الوصول إلى الخادم — تحقق من الاتصال.",
  loginErrorGeneric: "تعذّر تسجيل الدخول — حاول مرة أخرى.",

  // -- device registration + trust ----------------------------------------------------
  deviceRegTitle: "تسجيل الجهاز",
  deviceRegIntro: "يسجّل هذا الجهاز في منشأتك ويحدد تجربته: ميدان أو حساب شخصي.",
  deviceRegNameLabel: "اسم الجهاز",
  deviceRegNamePlaceholder: "مثال: جهاز خالد 01",
  deviceRegClassLabel: "نوع التجربة",
  deviceRegClassField: "مندوب ميدان (بيع متنقل)",
  deviceRegClassPersonal: "حساب شخصي (عرض فقط)",
  deviceRegSubmit: "تسجيل الجهاز",
  deviceRegSubmitting: "جارٍ التسجيل...",
  deviceRegSuccess: "سُجّل الجهاز وارتبط بمنشأتك.",
  deviceRegPendingApproval: "في انتظار موافقة الإدارة على الجهاز.",
  deviceRegErrorNetwork: "تعذّر التسجيل — تحقق من الاتصال وأعد المحاولة.",
  deviceRegErrorGeneric: "تعذّر تسجيل الجهاز — أعد المحاولة.",
  deviceTrustAtRisk: "ظهرت إشارات غير مطمئنة من هذا الجهاز — قد يُقيَّد بالاتصال المباشر حتى مراجعة الإدارة.",

  // -- unlock ---------------------------------------------------------------------------
  unlockTitle: "فتح التطبيق",
  unlockBiometricButton: "استخدم البصمة",
  unlockBiometricUnavailable: "البصمة غير متاحة على هذا الجهاز — استخدم الرمز السري.",
  unlockBiometricFailed: "لم يتعرّف الجهاز على البصمة — حاول مجددًا أو استخدم الرمز السري.",
  unlockUsePin: "استخدم الرمز السري بدلًا منها",
  unlockUseBiometric: "استخدم البصمة بدلًا منه",
  unlockPinPrompt: "أدخل الرمز السري",
  unlockPinIncorrect: "رمز غير صحيح — بقي {attempts} من المحاولات.",
  unlockPinLockedOut: "أُقفل الإدخال مؤقتًا — أعد المحاولة بعد {minutes} دقيقة.",
  unlockNeededTitle: "الجهاز مقفل",
  unlockNeededBody: "أدخل بصمتك أو رمزك السري للمتابعة.",
  unlockSetPinTitle: "عيّن رمزًا سريًا",
  unlockSetPinBody: "الرمز السري احتياط إلزامي للبصمة — ستة أرقام.",
  unlockPinMismatch: "الرمزان غير متطابقين.",

  // -- home dashboard ----------------------------------------------------------------------
  homeTitle: "الرئيسية",
  homeGreeting: "مرحبًا {name}",
  homeRouteToday: "خط اليوم: {route}",
  homeSectionToday: "ملخص اليوم",
  homeMetricSales: "مبيعات",
  homeMetricCollections: "تحصيلات",
  homeMetricReturns: "مرتجعات",
  homeMetricCash: "نقدة محصلة",
  homeVanStock: "رصيد السيارة",
  homeQuickSale: "بيع جديد",
  homeQuickCollection: "تحصيل جديد",
  homeQuickVanLoad: "تحميل / تفريغ",
  homeQuickReturn: "مرتجع",
  homeQuickCount: "جرد",
  homeParkedTile: "الرفوض المتوقفة: {count}",
  homeSyncTile: "المزامنة: {state}",

  // -- statements ---------------------------------------------------------------------------
  statementsTitle: "كشف الحساب",
  statementsIntro: "نسخة مخبأة للقراءة فقط بوسم «كما في» — القديم يُوسم ولا يُخمَّن.",
  statementsColDoc: "المستند",
  statementsColDebit: "مدين (عليه)",
  statementsColCredit: "دائن (له)",
  statementsOpeningBalance: "رصيد افتتاحي",
  statementsClosingBalance: "رصيد ختامي",
  statementsRunningBalance: "الرصيد الجاري",
  statementsStatementNo: "كشف رقم {number}",
  statementsEmpty: "لا حركات في هذه الفترة بعد.",
  statementsPeriodLabel: "الفترة",
  statementsGeneratedAt: "أُنشئ في {date}",

  // -- invoices --------------------------------------------------------------------------------
  invoicesTitle: "الفواتير",
  invoicesSearchPlaceholder: "ابحث برقم الفاتورة أو اسم العميل",
  invoicesColNumber: "رقم الفاتورة",
  invoicesEmpty: "لا فواتير في المخبأ المحلي.",
  invoicesEmptyPersonal: "لم تصدر لك أي فواتير بعد.",
  invoiceViewTitle: "فاتورة",
  invoiceViewHeader: "تفاصيل الفاتورة",
  invoiceViewNumber: "الرقم: {number}",
  invoiceViewOfflineNumber: "رقم محلي مؤقت: {number}",
  invoiceViewLines: "البنود",
  invoiceViewPostedAt: "رُحّلت في {time}",
  invoiceViewDueDate: "تاريخ الاستحقاق: {date}",
  invoiceViewSerials: "المسلسلات: {serials}",
  invoiceViewNotPostedYet: "لم تُرحّل بعد — بانتظار المزامنة.",

  // -- route visits ------------------------------------------------------------------------------
  routesTitle: "زيارات اليوم",
  routesIntro: "زيارات مرتّبة من المخبأ مع أرصدة العملاء وأسعار فئاتهم.",
  routesEmpty: "لا زيارات مجدولة اليوم.",
  routesVisitPlanned: "مخططة",
  routesVisitDone: "منجزة",
  routesVisitSkipped: "تخطٍّ",
  routesVisitBalance: "الرصيد: {balance}",
  routesVisitCreditLimit: "الحد الائتماني: {limit}",
  routesVisitTierPricing: "أسعار الفئة معتمدة من المخبأ.",
  routesVisitNoTierPricing: "لا أسعار فئة لهذا العميل في المخبأ.",
  routesVisitFreeGoods: "عروض مجانية مقترحة.",
  routesVisitOpenInvoices: "فواتير مفتوحة: {count}",
  routesVisitCollectHere: "حصّل هنا",
  routesVisitSellHere: "بِع هنا",

  // -- barcode scanner ----------------------------------------------------------------------------
  scannerTitle: "الماسح الضوئي",
  scannerHint: "وجّه الكاميرا نحو الباركود — الأكواد لا تُعكس أبدًا.",
  scannerPermissionNeeded: "يحتاج الماسح إذن الكاميرا — فعّله من إعدادات النظام.",

  // -- van sale capture ------------------------------------------------------------------------------
  vanSaleTitle: "بيع جديد",
  vanSaleCartTitle: "سلة البيع",
  vanSaleScanButton: "امسح الباركود",
  vanSaleSearchPlaceholder: "ابحث عن صنف بالاسم أو الباركود",
  vanSaleEmptyCart: "السلة فارغة — امسح صنفًا أو أضفه يدويًا.",
  vanSaleCheckout: "إتمام البيع",
  vanSaleTotalDue: "المستحق",
  vanSalePriceLabel: "سعر الوحدة",
  vanSaleLineTotal: "إجمالي السطر",
  vanSalePaymentLabel: "طريقة الدفع",
  vanSalePaymentCash: "نقدًا",
  vanSalePaymentCredit: "على الحساب (آجل)",
  vanSaleCustomerRequired: "اختر عميلًا للبيع الآجل.",
  vanSaleNoCustomerCashOnly: "البيع النقدي لا يحتاج عميلًا محددًا.",
  vanSaleCreditLimitAdvisory: "تحذير استشاري: حد العميل {limit} وقد استُخدم {used} — القرار النهائي للخادم.",
  vanSaleStockAdvisory: "تحذير استشاري: المتاح في السيارة {available} فقط من هذا الصنف.",
  vanSalePriceAdvisory: "تحذير استشاري: السعر المخزن {cached} والسعر عند الخادم {server}.",
  vanSaleSerialCapture: "مسلسل / IMEI",
  vanSaleSerialPlaceholder: "امسح المسلسل أو اكتبه",
  vanSaleBatchCapture: "دفعة",
  vanSaleBatchPlaceholder: "رقم الدفعة",
  vanSaleSavedLocal: "حُفظ محليًا — بانتظار المزامنة برقم مؤقت {number}.",
  vanSaleQtyInvalid: "أدخل كمية عشرية صحيحة.",
  vanSaleQtyNeedsSerial: "هذا الصنف يتتبع المسلسلات — أضف مسلسلًا لكل وحدة.",
  vanSaleConfirmTitle: "تأكيد البيع",
  vanSaleConfirmBody: "سيُحفظ المستند محليًا ويرفع في أول دورة مزامنة.",

  // -- collection ------------------------------------------------------------------------------------
  collectionTitle: "تحصيل جديد",
  collectionIntro: "إيصال ميداني يُقبل عند المزامنة وتُنسب قيمته للمندوب.",
  collectionCustomerPlaceholder: "اختر العميل من الزيارة",
  collectionAmountLabel: "المبلغ المحصل",
  collectionMethodLabel: "طريقة التحصيل",
  collectionMethodCash: "نقدًا",
  collectionMethodTransfer: "حوالة",
  collectionReferenceLabel: "مرجع الحوالة",
  collectionReferencePlaceholder: "رقم الحوالة من تطبيقك البنكي",
  collectionAllocateLabel: "تخصيص على الفواتير",
  collectionAutoAllocate: "تخصيص تلقائي — الأقدم أولًا",
  collectionAllocated: "مخصص على {count} فاتورة بقيمة {amount}.",
  collectionOpenBalance: "الرصيد المفتوح: {balance}",
  collectionSavedLocal: "حُفظ الإيصال محليًا — بانتظار المزامنة.",
  collectionAmountInvalid: "أدخل مبلغًا عشريًا موجبًا.",
  collectionExceedsOpenBalance: "المبلغ يتجاوز الرصيد المفتوح {balance}.",

  // -- van load / unload + van stock --------------------------------------------------------------------
  vanLoadTitle: "تحميل السيارة",
  vanLoadIntro: "تأكيد تحميل مقابل لقطة مخزون السيارة — يُقبل عند المزامنة.",
  vanLoadFromWarehouse: "من المستودع:",
  vanLoadAddLine: "أضف صنفًا",
  vanLoadEmpty: "لم تُضف أصناف بعد.",
  vanLoadConfirm: "تأكيد التحميل",
  vanLoadSavedLocal: "حُفظ التحميل محليًا — بانتظار المزامنة.",
  vanLoadAsOfSnapshot: "لقطة مخزون السيارة كما في {date}",
  vanUnloadTitle: "تفريغ السيارة",
  vanUnloadIntro: "إرجاع غير المُبع إلى المستودع مقابل اللقطة نفسها.",
  vanUnloadReturnTo: "إلى المستودع:",
  vanUnloadQtyExceedsStock: "الكمية المطلوبة {requested} تتجاوز رصيد السيارة {available}.",
  vanUnloadConfirm: "تأكيد التفريغ",
  vanUnloadSavedLocal: "حُفظ التفريغ محليًا — بانتظار المزامنة.",
  vanStockTitle: "رصيد السيارة",
  vanStockEmpty: "لا رصيد مخبأ لهذه السيارة بعد.",

  // -- returns --------------------------------------------------------------------------------------------
  returnsTitle: "مرتجع جديد",
  returnsIntro: "مسودة إشعار دائن من الجهاز — الترحيل عند المزامنة.",
  returnsPickInvoice: "اختر الفاتورة الأصلية",
  returnsOriginalRequired: "حدد الفاتورة الأصلية للمطابقة.",
  returnsReasonLabel: "سبب الإرجاع",
  returnsReasonPlaceholder: "مثال: عيب بالمصنع",
  returnsRestockLabel: "إعادة إلى المخزون",
  returnsRestockVan: "السيارة",
  returnsRestockWarehouse: "المستودع",
  returnsSavedLocal: "حُفظت المسودة محليًا — بانتظار المزامنة.",

  // -- count lines --------------------------------------------------------------------------------------------
  countTitle: "جرد أصناف",
  countIntro: "الأعداد وقائع فقط — حساب الفروق ومطابقتها على الخادم حصرًا.",
  countQtyLabel: "الكمية المعدودة",
  countBatchLabel: "الدفعة (إن وُجدت)",
  countAddLine: "أضف سطر جرد",
  countEmpty: "لم تُسجل سطور بعد.",
  countUnknownBarcode: "باركود غير معروف — أضف الصنف يدويًا أو راجع الإدارة.",
  countSubmit: "إرسال السطور",
  countSavedLocal: "حُفظت السطور محليًا — بانتظار المزامنة.",

  // -- personal account home -----------------------------------------------------------------------------------
  personalTitle: "حسابي",
  personalWelcome: "أهلًا {name}",
  personalReadonlyNotice: "عرض للقراءة فقط من سحب خفيف — لا مسار كتابة من هذه الشاشات إطلاقًا.",
  personalBalanceLabel: "رصيدك المستحق",
  personalBalanceDue: "عليك {amount}",
  personalBalanceNone: "لا مبالغ مستحقة حاليًا.",
  personalStatementTile: "كشف الحساب",
  personalInvoicesTile: "الفواتير",
  personalReceiptsTile: "الإيصالات",
  personalNotificationsTile: "التنبيهات",
  personalDueSoon: "استحقاق قريب: {date} بمبلغ {amount}",
  personalReceiptsEmpty: "لا إيصالات محفوظة بعد.",
  personalReceiptViewTitle: "إيصال",
  personalReceiptMethod: "الطريقة",
  personalBackgroundNote: "السحب الخلفي مقيّد بـ 256 كيلوبايت حفاظًا على البطارية.",
  personalLinkedPartner: "مرتبط بالعميل: {name}",

  // -- notifications ---------------------------------------------------------------------------------------------
  notificationsTitle: "التنبيهات",
  notificationsEmpty: "لا تنبيهات بعد.",
  notificationsUnreadCount: "غير المقروءة: {count}",
  notificationsMarkRead: "علّمه كمقروء",
  notificationsMarkAllRead: "علّم الكل كمقروء",
  notificationsAsOf: "مزامنة القراءة كما في {date}",
  notificationsOpenInvoice: "افتح الفاتورة",
  notificationsChannelSync: "قناة المزامنة",
  notificationsOptIn: "تفعيل التنبيهات على هذا الجهاز",
  notificationsOptInNote: "لا تُرسل بيانات مالية داخل التنبيهات أبدًا.",

  // -- settings -----------------------------------------------------------------------------------------------------
  settingsTitle: "الإعدادات",
  settingsDeviceSection: "الجهاز",
  settingsDeviceId: "معرّف الجهاز",
  settingsDeviceName: "اسم الجهاز",
  settingsDeviceClass: "نوع التجربة",
  settingsDeviceStatus: "حالة الجهاز",
  settingsDeviceStatusActive: "نشط",
  settingsDeviceStatusPendingApproval: "بانتظار الموافقة",
  settingsDeviceStatusRevoked: "ملغى — يلزم تسجيل جديد",
  settingsSyncSection: "المزامنة",
  settingsSecuritySection: "الأمان",
  settingsBiometricToggle: "الفتح بالبصمة",
  settingsBiometricUnavailable: "البصمة غير متاحة على هذا الجهاز.",
  settingsLanguageSection: "اللغة",
  // Endonyms in BOTH locales (the universal language-picker convention): an
  // English reader looking for العربية recognizes العربية, never "Arabic".
  settingsLanguageAr: "العربية",
  settingsLanguageEn: "English",
  settingsLanguageChangeNote: "تغيير اللغة يعيد تدفق الواجهة لضبط الاتجاه (RTL/LTR).",
  settingsAboutSection: "عن التطبيق",
  settingsVersionLabel: "الإصدار: {version}",
  settingsStorageUsed: "التخزين المستخدم: {used} من {budget}",
  settingsSignOut: "تسجيل الخروج",
  settingsSignOutConfirm: "ستُسقط الجلسة على هذا الجهاز — أتود المتابعة؟",

  // -- validation errors ----------------------------------------------------------------------------------------------
  errNotFound: "غير موجود على هذا الجهاز — اسحب أولًا.",
  errPermissionDenied: "ليست لديك صلاحية لهذا الإجراء.",
  errInvalidMoney: "أدخل رقمًا عشريًا بحد أقصى 4 منازل.",
  errInvalidQty: "أدخل كمية عشرية صحيحة بحد أقصى 6 منازل.",
  errInvalidDate: "أدخل تاريخًا بصيغة YYYY-MM-DD.",
  errInvalidPhone: "أدخل رقم هاتف صحيحًا.",
  // -- T-P22-3-b: companion/personal/rejection --------------------------------
  agingNotDue: "غير مستحق",
  aging1To30: "متأخر 1–30 يومًا",
  aging31To60: "متأخر 31–60 يومًا",
  aging61To90: "متأخر 61–90 يومًا",
  aging90Plus: "متأخر أكثر من 90 يومًا",
  dashboardIntro: "قراءة من المخبأ المحلي — البيانات القديمة تُوسم ولا تُخمَّن أبدًا.",
  homeApprovalsTile: "الموافقات",
  masterSearchTitle: "بحث البيانات الأساسية",
  masterSearchEmpty: "لا نتائج مطابقة في المخبأ المحلي.",
  rejectionSupportHint: "رمز رفض غير معروف — أبلغ الدعم مع مرجع التتبع.",
};

const en: Dictionary = {
  // -- app + shared chrome ------------------------------------------------
  appTitle: "ERP Field",
  appTagline: "One companion for field sales and the personal account",
  commonOk: "OK",
  commonCancel: "Cancel",
  commonSave: "Save",
  commonConfirm: "Confirm",
  commonClose: "Close",
  commonBack: "Back",
  commonNext: "Next",
  commonDone: "Done",
  commonRetry: "Retry",
  commonSearch: "Search",
  commonLoading: "Loading...",
  commonAdd: "Add",
  commonEdit: "Edit",
  commonDelete: "Delete",
  commonYes: "Yes",
  commonNo: "No",
  commonMore: "More",
  commonAll: "All",
  commonNone: "None",
  commonOptional: "Optional",
  commonUnknown: "Unknown",
  commonToday: "Today",
  commonTotal: "Total",
  commonSubtotal: "Subtotal",
  commonDiscount: "Discount",
  commonTax: "Tax",
  commonAmount: "Amount",
  commonQuantity: "Quantity",
  commonPrice: "Price",
  commonDate: "Date",
  commonTime: "Time",
  commonBalance: "Balance",
  commonDueDate: "Due date",
  commonReference: "Reference",
  commonMethod: "Method",
  commonBatch: "Batch",
  commonSerial: "Serial",
  commonWarehouse: "Warehouse",
  commonRoute: "Route",
  commonCustomer: "Customer",
  commonItem: "Item",
  commonStatus: "Status",
  commonActions: "Actions",
  commonEmpty: "Nothing to show yet.",
  commonError: "Something went wrong — try again.",
  commonRequired: "This field is required.",

  // -- tab bar -------------------------------------------------------------
  tabHome: "Home",
  tabVisits: "Visits",
  tabVanStock: "Van",
  tabNotifications: "Notifications",
  tabSettings: "Settings",

  // -- post-sync states + host UI -------------------------------------------
  syncStatePendingSync: "Pending sync",
  syncStatePendingSyncHint: "Saved locally; it rides the next sync cycle.",
  syncStatePosted: "Posted",
  syncStatePostedHint: "Accepted by the server with its official number.",
  syncStateRejected: "Rejected (editable)",
  syncStateRejectedHint: "The server rejected it; resolve it from Parked rejections.",
  syncStateDraftLocal: "Local draft",
  syncStateDraftLocalHint: "A draft on this device only; not queued yet.",
  syncStatusTitle: "Sync status",
  syncStatusOnline: "Online",
  syncStatusOffline: "Offline — will sync",
  syncStatusSyncing: "Syncing...",
  syncStatusIdle: "Idle",
  syncNow: "Sync now",
  syncNowRunning: "Pushing changes...",
  syncLastRun: "Last sync: {time}",
  syncNeverRun: "Never synced yet",
  syncPendingCount: "Documents pending sync: {count}",
  syncCycleSummary: "Cycle done: pushed {pushed}, pulled {pulled}",
  syncRetryIn: "Retrying in {seconds}s",
  syncErrorNetwork: "Could not reach the server.",

  // -- as-of labels + offline/online-only affordances -------------------------
  asOfLabel: "As of {date}",
  asOfStaleWarning: "This data is stale — shown as-is, never guessed.",
  asOfNeverSynced: "This data has never been pulled to the device.",
  advisoryLabel: "Advisory",
  blockingLabel: "Error",
  offlineQueued: "Queued actions: {count}",
  onlineOnlyTitle: "Requires connection",
  onlineOnlyReason: "This action needs a live server connection — it is never queued.",
  approvalsOnlineOnly: "Approvals are online-only.",
  postingOnlineOnly: "Final posting is online-only.",
  readOnlyMode: "Read-only mode",
  readOnlyReasonWatermark: "The permission snapshot passed the 7-day watermark — reconnect to refresh it.",
  sessionExpiredTitle: "Session expired",
  sessionExpiredBody: "Your session expired — sign in again to continue.",

  // -- force update -----------------------------------------------------------
  forceUpdateTitle: "Update required",
  forceUpdateBody: "This version was halted for stability — update the app to continue.",
  forceUpdateAction: "Update now",

  // -- rejection reasons -------------------------------------------------------
  rejectPeriodLocked: "Period locked",
  rejectPeriodLockedDetail: "The accounting period was locked before the document arrived.",
  rejectPriceChanged: "Price changed",
  rejectPriceChangedDetail: "The server price is {server} while the draft carried {cached} beyond tolerance.",
  rejectInsufficientStock: "Insufficient stock",
  rejectInsufficientStockDetail: "Only {available} of this item left in the van.",
  rejectCreditLimitExceeded: "Credit limit exceeded",
  rejectCreditLimitExceededDetail: "The customer's limit is {limit} with {due} already due.",
  rejectStaleVersion: "Stale version",
  rejectStaleVersionDetail: "The on-device edit is older than the server snapshot — merge manually.",
  rejectItemInactive: "Item inactive",
  rejectItemInactiveDetail: "The item was deactivated server-side and can no longer be sold.",
  rejectPartnerInactive: "Partner inactive",
  rejectPartnerInactiveDetail: "The partner account was deactivated server-side.",
  rejectValidationError: "Validation error",
  rejectValidationErrorDetail: "Server-side structural validation failed — check the required fields.",
  rejectDeviceRevoked: "Device revoked",
  rejectDeviceRevokedDetail: "This device's registration was revoked — no resubmission; an administrative path.",
  rejectTenantSuspended: "Tenant suspended",
  rejectTenantSuspendedDetail: "The tenant account is suspended — an administrative path, not a resubmission.",

  // -- rejection action table ---------------------------------------------------
  actionEditAndResend: "Edit and resend",
  actionAcceptServerPrice: "Accept server price",
  actionAcceptPartial: "Accept partial",
  actionCancel: "Cancel the document",
  actionSubstituteAndResend: "Substitute and resend",
  actionReviewAndMerge: "Review and merge",
  actionDiscard: "Discard",
  actionRequestApproval: "Request approval",
  actionAppliedToast: "Your choice was written to the audit log.",
  actionConfirmDiscard: "Discarding cannot be undone — continue?",

  // -- parked rejections ---------------------------------------------------------
  parkedTitle: "Parked rejections",
  parkedIntro: "Every server-rejected document waits here for your decision — nothing resolves silently.",
  parkedEmpty: "No parked rejections.",
  parkedColDate: "Date",
  parkedColDoc: "Document",
  parkedColReason: "Reason",
  parkedTraceId: "Trace ref: {traceId}",
  parkedResendNote: "A resend issues a new command with the same document id; a changed payload gets a fresh idempotency key.",
  parkedNoResubmitTitle: "Administrative path",
  parkedNoResubmitBody: "This rejection is not resolvable from the device — contact your tenant admin.",
  parkedAuditNote: "Every choice is audit-logged carrying the rejection's trace id.",

  // -- onboarding + login ----------------------------------------------------------
  onboardingWelcomeTitle: "Welcome to the field app",
  onboardingWelcomeBody: "One device, two experiences: field sales or the personal account — pick your path after registering the device.",
  onboardingStart: "Get started",
  loginTitle: "Sign in",
  loginEmailLabel: "Email",
  loginPasswordLabel: "Password",
  loginSubmit: "Sign in",
  loginBiometricHint: "Or use biometrics",
  loginErrorInvalid: "Incorrect email or password.",
  loginErrorNetwork: "Could not reach the server — check your connection.",
  loginErrorGeneric: "Could not sign you in — try again.",

  // -- device registration + trust ----------------------------------------------------
  deviceRegTitle: "Register this device",
  deviceRegIntro: "Registration binds this device to your tenant and picks its experience: field or personal.",
  deviceRegNameLabel: "Device name",
  deviceRegNamePlaceholder: "e.g. Khaled's unit 01",
  deviceRegClassLabel: "Experience",
  deviceRegClassField: "Field rep (van sales)",
  deviceRegClassPersonal: "Personal account (view-only)",
  deviceRegSubmit: "Register device",
  deviceRegSubmitting: "Registering...",
  deviceRegSuccess: "Device registered and bound to your tenant.",
  deviceRegPendingApproval: "Waiting for an admin to approve the device.",
  deviceRegErrorNetwork: "Registration failed — check your connection and retry.",
  deviceRegErrorGeneric: "Registration failed — try again.",
  deviceTrustAtRisk: "This device reported concerning trust signals — it may degrade to online-only until an admin reviews it.",

  // -- unlock ---------------------------------------------------------------------------
  unlockTitle: "Unlock",
  unlockBiometricButton: "Use biometrics",
  unlockBiometricUnavailable: "Biometrics unavailable on this device — use the PIN.",
  unlockBiometricFailed: "Biometrics not recognized — try again or use the PIN.",
  unlockUsePin: "Use the PIN instead",
  unlockUseBiometric: "Use biometrics instead",
  unlockPinPrompt: "Enter your PIN",
  unlockPinIncorrect: "Wrong PIN — {attempts} attempts left.",
  unlockPinLockedOut: "PIN entry locked — try again in {minutes} minute(s).",
  unlockNeededTitle: "Device locked",
  unlockNeededBody: "Enter your biometrics or PIN to continue.",
  unlockSetPinTitle: "Set a PIN",
  unlockSetPinBody: "The PIN is the mandatory biometric fallback — six digits.",
  unlockPinMismatch: "The PINs do not match.",

  // -- home dashboard ----------------------------------------------------------------------
  homeTitle: "Home",
  homeGreeting: "Welcome, {name}",
  homeRouteToday: "Today's route: {route}",
  homeSectionToday: "Today's summary",
  homeMetricSales: "Sales",
  homeMetricCollections: "Collections",
  homeMetricReturns: "Returns",
  homeMetricCash: "Cash collected",
  homeVanStock: "Van stock",
  homeQuickSale: "New sale",
  homeQuickCollection: "New collection",
  homeQuickVanLoad: "Load / unload",
  homeQuickReturn: "Return",
  homeQuickCount: "Count",
  homeParkedTile: "Parked rejections: {count}",
  homeSyncTile: "Sync: {state}",

  // -- statements ---------------------------------------------------------------------------
  statementsTitle: "Statement",
  statementsIntro: "A read-cached copy with an as-of label — stale is labeled, never guessed.",
  statementsColDoc: "Document",
  statementsColDebit: "Debit",
  statementsColCredit: "Credit",
  statementsOpeningBalance: "Opening balance",
  statementsClosingBalance: "Closing balance",
  statementsRunningBalance: "Running balance",
  statementsStatementNo: "Statement no. {number}",
  statementsEmpty: "No movements in this period yet.",
  statementsPeriodLabel: "Period",
  statementsGeneratedAt: "Generated on {date}",

  // -- invoices --------------------------------------------------------------------------------
  invoicesTitle: "Invoices",
  invoicesSearchPlaceholder: "Search by invoice number or customer",
  invoicesColNumber: "Invoice no.",
  invoicesEmpty: "No invoices in the local cache.",
  invoicesEmptyPersonal: "No invoices issued to you yet.",
  invoiceViewTitle: "Invoice",
  invoiceViewHeader: "Invoice details",
  invoiceViewNumber: "No.: {number}",
  invoiceViewOfflineNumber: "Provisional local number: {number}",
  invoiceViewLines: "Lines",
  invoiceViewPostedAt: "Posted at {time}",
  invoiceViewDueDate: "Due date: {date}",
  invoiceViewSerials: "Serials: {serials}",
  invoiceViewNotPostedYet: "Not posted yet — pending sync.",

  // -- route visits ------------------------------------------------------------------------------
  routesTitle: "Today's visits",
  routesIntro: "Visits ordered from the cache with customer balances and tier prices.",
  routesEmpty: "No visits scheduled today.",
  routesVisitPlanned: "Planned",
  routesVisitDone: "Done",
  routesVisitSkipped: "Skipped",
  routesVisitBalance: "Balance: {balance}",
  routesVisitCreditLimit: "Credit limit: {limit}",
  routesVisitTierPricing: "Tier pricing applied from the cache.",
  routesVisitNoTierPricing: "No tier pricing cached for this customer.",
  routesVisitFreeGoods: "Suggested free goods.",
  routesVisitOpenInvoices: "Open invoices: {count}",
  routesVisitCollectHere: "Collect here",
  routesVisitSellHere: "Sell here",

  // -- barcode scanner ----------------------------------------------------------------------------
  scannerTitle: "Scanner",
  scannerHint: "Point the camera at the code — codes never mirror.",
  scannerPermissionNeeded: "The scanner needs camera permission — enable it in system settings.",

  // -- van sale capture ------------------------------------------------------------------------------
  vanSaleTitle: "New sale",
  vanSaleCartTitle: "Cart",
  vanSaleScanButton: "Scan barcode",
  vanSaleSearchPlaceholder: "Search items by name or barcode",
  vanSaleEmptyCart: "The cart is empty — scan an item or add one manually.",
  vanSaleCheckout: "Checkout",
  vanSaleTotalDue: "Amount due",
  vanSalePriceLabel: "Unit price",
  vanSaleLineTotal: "Line total",
  vanSalePaymentLabel: "Payment method",
  vanSalePaymentCash: "Cash",
  vanSalePaymentCredit: "On account (credit)",
  vanSaleCustomerRequired: "Pick a customer for a credit sale.",
  vanSaleNoCustomerCashOnly: "Cash sales need no customer.",
  vanSaleCreditLimitAdvisory: "Advisory: the customer's limit is {limit} with {used} used — the server decides.",
  vanSaleStockAdvisory: "Advisory: only {available} of this item left in the van.",
  vanSalePriceAdvisory: "Advisory: cached price {cached}, server price {server}.",
  vanSaleSerialCapture: "Serial / IMEI",
  vanSaleSerialPlaceholder: "Scan or type the serial",
  vanSaleBatchCapture: "Batch",
  vanSaleBatchPlaceholder: "Batch number",
  vanSaleSavedLocal: "Saved locally — pending sync with provisional number {number}.",
  vanSaleQtyInvalid: "Enter a valid decimal quantity.",
  vanSaleQtyNeedsSerial: "This item tracks serials — add one serial per unit.",
  vanSaleConfirmTitle: "Confirm the sale",
  vanSaleConfirmBody: "The document is saved locally and rides the next sync cycle.",

  // -- collection ------------------------------------------------------------------------------------
  collectionTitle: "New collection",
  collectionIntro: "A field receipt accepted at sync and attributed to you.",
  collectionCustomerPlaceholder: "Pick the customer from the visit",
  collectionAmountLabel: "Amount collected",
  collectionMethodLabel: "Method",
  collectionMethodCash: "Cash",
  collectionMethodTransfer: "Transfer",
  collectionReferenceLabel: "Transfer reference",
  collectionReferencePlaceholder: "The reference from your banking app",
  collectionAllocateLabel: "Allocation to invoices",
  collectionAutoAllocate: "Auto-allocate, oldest first",
  collectionAllocated: "Allocated across {count} invoices totalling {amount}.",
  collectionOpenBalance: "Open balance: {balance}",
  collectionSavedLocal: "Receipt saved locally — pending sync.",
  collectionAmountInvalid: "Enter a positive decimal amount.",
  collectionExceedsOpenBalance: "The amount exceeds the open balance {balance}.",

  // -- van load / unload + van stock --------------------------------------------------------------------
  vanLoadTitle: "Van load",
  vanLoadIntro: "Confirm a load against the van stock snapshot — accepted at sync.",
  vanLoadFromWarehouse: "From warehouse:",
  vanLoadAddLine: "Add item",
  vanLoadEmpty: "No items added yet.",
  vanLoadConfirm: "Confirm load",
  vanLoadSavedLocal: "Load saved locally — pending sync.",
  vanLoadAsOfSnapshot: "Van stock snapshot as of {date}",
  vanUnloadTitle: "Van unload",
  vanUnloadIntro: "Return unsold stock to the warehouse against the same snapshot.",
  vanUnloadReturnTo: "To warehouse:",
  vanUnloadQtyExceedsStock: "Requested {requested} exceeds the van's {available}.",
  vanUnloadConfirm: "Confirm unload",
  vanUnloadSavedLocal: "Unload saved locally — pending sync.",
  vanStockTitle: "Van stock",
  vanStockEmpty: "No cached van stock yet.",

  // -- returns --------------------------------------------------------------------------------------------
  returnsTitle: "New return",
  returnsIntro: "A credit-note draft from the device — posting happens at sync.",
  returnsPickInvoice: "Pick the original invoice",
  returnsOriginalRequired: "Pick the original invoice to match against.",
  returnsReasonLabel: "Return reason",
  returnsReasonPlaceholder: "e.g. a manufacturing defect",
  returnsRestockLabel: "Restock to",
  returnsRestockVan: "The van",
  returnsRestockWarehouse: "The warehouse",
  returnsSavedLocal: "Draft saved locally — pending sync.",

  // -- count lines --------------------------------------------------------------------------------------------
  countTitle: "Count lines",
  countIntro: "Counts are facts only — variance and its posting are server-side.",
  countQtyLabel: "Counted qty",
  countBatchLabel: "Batch (if any)",
  countAddLine: "Add a count line",
  countEmpty: "No lines recorded yet.",
  countUnknownBarcode: "Unknown barcode — add the item manually or check with your admin.",
  countSubmit: "Submit lines",
  countSavedLocal: "Lines saved locally — pending sync.",

  // -- personal account home -----------------------------------------------------------------------------------
  personalTitle: "My account",
  personalWelcome: "Hello, {name}",
  personalReadonlyNotice: "View-only from light pulls — there is no write path from these screens.",
  personalBalanceLabel: "Your outstanding balance",
  personalBalanceDue: "You owe {amount}",
  personalBalanceNone: "Nothing due right now.",
  personalStatementTile: "Statement",
  personalInvoicesTile: "Invoices",
  personalReceiptsTile: "Receipts",
  personalNotificationsTile: "Notifications",
  personalDueSoon: "Due soon: {date} for {amount}",
  personalReceiptsEmpty: "No receipts cached yet.",
  personalReceiptViewTitle: "Receipt",
  personalReceiptMethod: "Method",
  personalBackgroundNote: "Background pulls are capped at 256 KB to protect your battery.",
  personalLinkedPartner: "Linked partner: {name}",

  // -- notifications ---------------------------------------------------------------------------------------------
  notificationsTitle: "Notifications",
  notificationsEmpty: "No notifications yet.",
  notificationsUnreadCount: "Unread: {count}",
  notificationsMarkRead: "Mark as read",
  notificationsMarkAllRead: "Mark all as read",
  notificationsAsOf: "Read-state synced as of {date}",
  notificationsOpenInvoice: "Open the invoice",
  notificationsChannelSync: "Sync channel",
  notificationsOptIn: "Enable notifications on this device",
  notificationsOptInNote: "No financial data ever rides a notification.",

  // -- settings -----------------------------------------------------------------------------------------------------
  settingsTitle: "Settings",
  settingsDeviceSection: "Device",
  settingsDeviceId: "Device id",
  settingsDeviceName: "Device name",
  settingsDeviceClass: "Experience",
  settingsDeviceStatus: "Device status",
  settingsDeviceStatusActive: "Active",
  settingsDeviceStatusPendingApproval: "Pending approval",
  settingsDeviceStatusRevoked: "Revoked — re-enrollment required",
  settingsSyncSection: "Sync",
  settingsSecuritySection: "Security",
  settingsBiometricToggle: "Unlock with biometrics",
  settingsBiometricUnavailable: "Biometrics unavailable on this device.",
  settingsLanguageSection: "Language",
  // Endonyms in BOTH locales (see the ar side note).
  settingsLanguageAr: "العربية",
  settingsLanguageEn: "English",
  settingsLanguageChangeNote: "Changing the language re-flows the UI to apply the direction (RTL/LTR).",
  settingsAboutSection: "About",
  settingsVersionLabel: "Version: {version}",
  settingsStorageUsed: "Storage used: {used} of {budget}",
  settingsSignOut: "Sign out",
  settingsSignOutConfirm: "This drops the session on this device — continue?",

  // -- validation errors ----------------------------------------------------------------------------------------------
  errNotFound: "Not on this device — pull first.",
  errPermissionDenied: "You lack permission for this action.",
  errInvalidMoney: "Enter a decimal with at most 4 dp.",
  errInvalidQty: "Enter a valid decimal quantity (at most 6 dp).",
  errInvalidDate: "Enter a date as YYYY-MM-DD.",
  errInvalidPhone: "Enter a valid phone number.",
  // -- T-P22-3-b: companion/personal/rejection --------------------------------
  agingNotDue: "Not due yet",
  aging1To30: "1–30 days overdue",
  aging31To60: "31–60 days overdue",
  aging61To90: "61–90 days overdue",
  aging90Plus: "Over 90 days overdue",
  dashboardIntro: "Read from the local cache — stale data is labeled, never guessed.",
  homeApprovalsTile: "Approvals",
  masterSearchTitle: "Master data search",
  masterSearchEmpty: "No matching results in the local cache.",
  rejectionSupportHint: "Unknown rejection code — contact support with the trace reference.",
};

const dictionaries: Record<Locale, Dictionary> = { ar, en };

/**
 * Parity validation core — reusable by tests (they feed doctored pairs to
 * prove drift/empty rejection) and by assertMobileParity(). A violation is
 * one of:
 *   - `missing in en: <key>` / `missing in ar: <key>` — key-set drift;
 *   - `empty in ar: <key>` / `empty in en: <key>` — a present key whose value
 *     is missing or whitespace-only in that locale (a blank string is a
 *     release blocker, not a valid translation).
 */
export function collectMobileParityViolations(
  arCandidate: unknown,
  enCandidate: unknown,
): string[] {
  if (
    typeof arCandidate !== "object" ||
    arCandidate === null ||
    typeof enCandidate !== "object" ||
    enCandidate === null
  ) {
    return ["dictionary candidates must be non-null objects"];
  }
  const arRecord = arCandidate as Record<string, unknown>;
  const enRecord = enCandidate as Record<string, unknown>;
  const arKeys = Object.keys(arRecord).sort();
  const enKeys = Object.keys(enRecord).sort();
  const enSet = new Set(enKeys);
  const arSet = new Set(arKeys);
  const violations: string[] = [];
  for (const key of arKeys) {
    if (!enSet.has(key)) violations.push(`missing in en: ${key}`);
  }
  for (const key of enKeys) {
    if (!arSet.has(key)) violations.push(`missing in ar: ${key}`);
  }
  for (const key of arKeys) {
    if (!enSet.has(key)) continue;
    const value = arRecord[key];
    if (typeof value !== "string" || value.trim() === "") {
      violations.push(`empty in ar: ${key}`);
    }
  }
  for (const key of enKeys) {
    if (!arSet.has(key)) continue;
    const value = enRecord[key];
    if (typeof value !== "string" || value.trim() === "") {
      violations.push(`empty in en: ${key}`);
    }
  }
  return violations;
}

/**
 * Key-parity assertion (the web assertDictionaryParity pattern): the ar and
 * en catalogs must match key-for-key with no empty values. TypeScript already
 * guarantees this through the `Dictionary` interface; the runtime check keeps
 * the contract green even if the dictionaries are ever assembled dynamically.
 * Executed at module load on first import.
 */
export function assertMobileParity(): void {
  const violations = collectMobileParityViolations(dictionaries.ar, dictionaries.en);
  if (violations.length > 0) {
    throw new Error(
      `mobile dictionary parity violation between "ar" and "en" (DR-P22-04):\n  - ${violations.join("\n  - ")}`,
    );
  }
}

assertMobileParity();

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

/** The "other" locale — the settings language toggle is a 1:1 link swap. */
export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
