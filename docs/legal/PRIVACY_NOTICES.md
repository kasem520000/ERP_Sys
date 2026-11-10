# Privacy Notices (DRAFT — AR+EN)

> **Status:** DRAFT — pending legal review per
> [DR-024-02](../decisions/DR-024-02-privacy-retention-oq009.md) (BLOCKED-EXTERNAL)
> · **Owner:** Platform security owner (role) · **Updated:** 2026-11-06

**This file is a preparation draft, not legal advice and not published tenant-facing
content.** It exists so that the client's legal counsel has both language versions of
every notice section to review against the launch markets (KSA/UAE first, A-001)
before GA. Per
[DATA_PROTECTION.md](../security/DATA_PROTECTION.md) ("this blueprint does NOT
assert legal compliance for any jurisdiction"), nothing below may be presented to a
tenant or in marketing material until counsel signs off and DR-024-02 is amended to
ACCEPTED. The retention numbers are the working assumption's placeholders
(90-day-then-hard-delete + 14-day read-only grace — DR-024-02); the contact address
is the documented deployment-time placeholder.

Sources for every claim (counsel review pointers): data inventory =
[DATA_PROTECTION.md](../security/DATA_PROTECTION.md) §1/§3; retention = §4/§5 +
DR-024-02; user rights (export/deletion) = §4 and
[USER_JOURNEYS.md](../product/USER_JOURNEYS.md) Journey H; device data = §6;
sub-processors = §7; disclosure contact =
[../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §12
(security@ + published disclosure policy — the PHASE-024 public page).

---

## English draft — Privacy notice (DRAFT — pending legal review)

### 1. Who we are

The platform is a multi-tenant business ERP service operated by the platform
operator (legal entity name and contact details: configured at deployment —
placeholder per OQ-001). This notice explains what personal and business data we
process for a tenant organization, how long we keep it, and the rights available.

### 2. What data we process

- **Tenant business data** — the books and records a tenant organization chooses to
  manage in the platform: financial documents (invoices, credit notes, receipts,
  payments, journal entries), partner/customer/supplier records, items and stock
  movements, and generated documents/exports. This data is processed to provide the
  service the tenant subscribed to.
- **User account data** — for each user a tenant admin invites: name, email (and
  phone where provided), hashed credentials, two-factor settings (TOTP seed and
  hashed recovery codes), and session records. Processed for authentication,
  security, and account administration.
- **Device data** — for registered offline/desktop/mobile devices: device
  identifier, registration/attestation metadata, sync cursors, and — only where the
  device user opts in — a push-notification token and preferred locale. Processed
  for device registration, synchronization, revocation, and (opt-in) notifications.
- **Audit events** — records of security-relevant actions (who did what, when, on
  which entity, with a correlation id) retained for security and forensics. After a
  tenant leaves, audit events are retained with tenant and user identifiers
  **hashed** (see retention below).

We do not sell tenant data. National/personal identity numbers are collected only
where a jurisdiction's verified e-invoicing requirements demand it
([E_INVOICING_ARCHITECTURE.md](../localization/E_INVOICING_ARCHITECTURE.md)).

### 3. Retention

- While a tenant subscription is active, data is retained for the lifetime of the
  tenant organization.
- **When a tenant leaves:** after the owner-confirmed offboarding and full data
  export, a **read-only grace period** (working assumption: 14 days — placeholder
  per DR-024-02) is followed by a **retention window** (working assumption: 90 days
  — placeholder per DR-024-02), then all tenant business data, user account data,
  device data, files, and cryptographic certificate material are **hard-deleted**
  by the documented purge job; a deletion certificate is recorded, and restore is
  impossible.
- **Audit events** survive the purge with identifiers hashed, for platform security
  and forensic obligations (retention period for the hashed archive: placeholder
  pending counsel — engineering default 7 years).
- Backups age out of all backup windows after the purge (see
  [DATA_PROTECTION.md](../security/DATA_PROTECTION.md) §5).

### 4. User rights

- **Access/export:** a tenant owner can request a full export of the tenant's data
  (structured JSON + CSV + documents, with a manifest and checksums for
  verification) — [USER_JOURNEYS.md](../product/USER_JOURNEYS.md) Journey H steps
  H2–H3.
- **Deletion:** the offboarding flow (Journey H) is the deletion mechanism:
  owner-confirmed, platform-executed, ending in the hard purge and a deletion
  certificate.
- **Requests:** data-subject requests from individual users (e.g., correcting their
  own account data) route through their tenant administrator, or through support
  with audit; individual users cannot export or delete tenant business data that
  belongs to the organization.

### 5. Security & sharing

Data is encrypted in transit and at rest; access within the platform operator is
permissioned, time-boxed, and audited (no standing access to tenant data). A
limited set of sub-processors (hosting/database, object storage, email delivery,
payment provider, tax-authority gateways where e-invoicing is enabled) process data
under contract — the current list is maintained per
[DATA_PROTECTION.md](../security/DATA_PROTECTION.md) §7 (published to tenants;
content pending the same legal review).

### 6. Contact

Questions about this notice or privacy requests: the platform operator's contact
configured at deployment (placeholder: `security@erp.example` — the same contact as
the vulnerability disclosure policy page, routed to the operator's triage path).
Security reports follow the published disclosure policy.

---

## مسودة عربية — إشعار الخصوصية (مسودة — بانتظار المراجعة القانونية)

> ترجمة عمل للمسودة الإنجليزية أعلاه؛ عند الاعتماد النهائي تُعتمد الصياغة
> القانونية العربية التي يقرّها المستشار القانوني.

### ١. من نحن

المنصة خدمة تخطيط موارد مؤسسية (ERP) متعددة المستأجرين يشغّلها مشغّل المنصة
(الاسم القانوني وبيانات التواصل: تُضبط عند النشر — قيمة مؤقتة وفق OQ-001).
يوضح هذا الإشعار البيانات الشخصية وتجارية الأعمال التي نعالجها لمؤسسة
المستأجر، ومدة الاحتفاظ بها، والحقوق المتاحة.

### ٢. البيانات التي نعالجها

- **بيانات أعمال المستأجر** — الدفاتر والسجلات التي تختار مؤسسة المستأجر
  إدارتها عبر المنصة: المستندات المالية (الفواتير، الإشعارات الدائنة،
  السندات، الدفعات، قيود اليومية)، وسجلات العملاء والموردين، والأصناف
  وحركات المخزون، والمستندات والتقارير المُنشأة. تُعالج لتقديم الخدمة
  المشترك بها.
- **بيانات حسابات المستخدمين** — لكل مستخدم تدعوه إدارة المستأجر: الاسم،
  والبريد الإلكتروني (والهاتف عند توفيره)، وبيانات الدخول المُعمّاة،
  وإعدادات التحقق بخطوتين (بذرة TOTP وأكواد الاستعادة المُعمّاة)، وسجلات
  الجلسات. تُعالج للمصادقة والأمن وإدارة الحسابات.
- **بيانات الأجهزة** — للأجهزة المسجلة (سطح المكتب/الجوال/نقاط البيع):
  معرّف الجهاز، وبيانات التسجيل والاعتماد، ومؤشرات المزامنة، وعند الموافقة
  الصريحة لمستخدم الجهاز: رمز الإشعارات واللغة المفضلة. تُعالج لتسجيل
  الأجهزة والمزامنة والإلغاء والإشعارات (بعد موافقة).
- **أحداث التدقيق** — سجلات الإجراءات ذات الصلة بالأمن (من فعل ماذا ومتى وعلى
  أي كيان مع معرّف الربط) تُحفظ لأغراض الأمن والتحقيق الجنائي. بعد مغادرة
  المستأجر تُحفظ أحداث التدقيق مع **تعمية** معرّفات المستأجر والمستخدمين
  (انظر الاحتفاظ أدناه).

لا نبيع بيانات المستأجرين. ولا تُجمع أرقام الهوية الوطنية/الشخصية إلا حيث
تتطلبها متطلبات الفوترة الإلكترونية الموثّقة في الولاية القضائية المعنية.

### ٣. مدة الاحتفاظ

- أثناء نشاط الاشتراك تُحفظ البيانات طوال عمر مؤسسة المستأجر.
- **عند مغادرة المستأجر:** بعد تأكيد المالك لعملية إنهاء الخدمة والتصدير
  الكامل للبيانات، تبدأ **فترة سماح للقراءة فقط** (الافتراض العملي: ١٤
  يومًا — قيمة مؤقتة وفق DR-024-02) تليها **نافذة احتفاظ** (الافتراض
  العملي: ٩٠ يومًا — قيمة مؤقتة وفق DR-024-02)، ثم يُحذف كل بيانات أعمال
  المستأجر وحسابات مستخدميه وأجهزته وملفاته ومواد شهاداته التشفيرية
  **حذفًا نهائيًا** عبر مهمة التنظيف الموثقة؛ ويُسجَّل شهادة حذف، ويستحيل
  الاسترجاع.
- **أحداث التدقيق** تبقى بعد الحذف مع تعمية المعرّفات، لأغراض أمن المنصة
  والالتزامات الجنائية (مدة الاحتفاظ بالأرشيف المُعمّى: قيمة مؤقتة بانتظار
  المستشار القانوني — الافتراض الهندسي ٧ سنوات).
- وتخرج النسخ الاحتياطية من جميع نوافذ الاحتفاظ بعد الحذف النهائي.

### ٤. حقوق المستخدمين

- **الوصول والتصدير:** يمكن لمالك المستأجر طلب تصدير كامل لبيانات المستأجر
  (JSON منظمة + CSV + المستندات، مع بيان تفصيلي وبصمات تحقق) — رحلة
  المستخدم H، الخطوتان H2–H3.
- **الحذف:** مسار إنهاء الخدمة (الرحلة H) هو آلية الحذف: يؤكده المالك وتنفذه
  المنصة، وينتهي بالحذف النهائي وشهادة حذف.
- **الطلبات:** طلبات الأفراد (مثل تصحيح بيانات حسابهم) تمر عبر مدير المستأجر
  أو عبر الدعم مع التدقيق؛ ولا يمكن للمستخدم الفرد تصدير بيانات أعمال
  المستأجر أو حذفها لأنها ملك المؤسسة.

### ٥. الأمن والمشاركة

تُشفَّر البيانات أثناء النقل وفي حالة السكون؛ والوصول داخل مشغّل المنصة
مقيّد بالأذونات ومحدد المدة ومُدقَّق (لا وصول دائم لبيانات المستأجرين). وتعالج
فئة محدودة من المعالجين الفرعيين (الاستضافة وقاعدة البيانات، والتخزين،
وإرسال البريد، ومزوّد الدفع، وبوابات الجهات الضريبية عند تفعيل الفوترة
الإلكترونية) البيانات بموجب عقود — وتُحدَّث القائمة الحالية وفق §7 من وثيقة
حماية البيانات (تُنشر للمستأجرين؛ ومحتواها بانتظار المراجعة القانونية
نفسها).

### ٦. التواصل

للاستفسارات عن هذا الإشعار أو طلبات الخصوصية: قناة تواصل مشغّل المنصة
المُضبوطة عند النشر (قيمة مؤقتة: `security@erp.example` — نفس قناة سياسة
الإفصاح عن الثغرات، وتُوجَّه إلى مسار الفحص لدى المشغّل). وتتبع بلاغات الأمن
سياسة الإفصاح المنشورة.

---

## Counsel review checklist (preparation aid)

| # | Question for counsel | Where the draft currently stands |
|---|----------------------|----------------------------------|
| 1 | Retention period after offboarding (working assumption 90 + 14) | DR-024-02 BLOCKED-EXTERNAL; constants are named placeholders in `purge-service.ts` |
| 2 | Hashed-audit-archive retention (engineering default 7 years) | DATA_PROTECTION §5; placeholder |
| 3 | National-ID collection gating per market | DATA_PROTECTION §3 + E_INVOICING_ARCHITECTURE (pack-controlled) |
| 4 | Sub-processor list publication wording | DATA_PROTECTION §7 (list pending same review) |
| 5 | Legal-entity name + contact (OQ-001) | Placeholders; deployment-time configuration |
| 6 | Data-subject-request handling wording (tenant admin vs platform) | §4 above; Journey H mechanism |
| 7 | Arabic legal wording (vs this working translation) | AR draft above is a working translation, flagged for legal drafting |
