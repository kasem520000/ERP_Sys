/**
 * PHASE-048 (W-13 — T-16) — the contracting print PAYLOAD BUILDERS
 * (the owner's clause 1: the AR/EN templates read from the i18n
 * dictionary EXCLUSIVELY — every label below is a dictionary string
 * read through `bi()`, never a literal; the declared delta lands in the
 * dictionary itself).
 *
 * THE LAWS (the owner's clauses 1–3, binding):
 *
 * - **ZERO PARALLEL COMPUTATION IN THE PRINT** (clause 2): every figure
 *   is the engine's own STRING, passed verbatim into the payload — the
 *   certificate's BR-092-derived retention/net pair, the billing
 *   engine's BR-093 ceiling figures, the retention ledger's balances.
 *   NO client-side summation anywhere (the retention statement renders
 *   the rows verbatim with NO totals block — a cross-kind total would
 *   be a parallel computation); NO rounding (stricter than the
 *   one-rounding-at-display allowance — the paper shows the exact
 *   engine strings).
 * - **DETERMINISM** (clause 3): NO wall-clock reads — docDate is the
 *   certificate's own date, the statement's asOf is the ledger's own
 *   max updatedAt (engine data), and the builders are pure functions of
 *   (dictionaries, locale, data). Two builds of the same inputs produce
 *   the same payload, and the templates' two renders are byte-identical
 *   (the golden determinism law).
 */

import type {
  CertificatePrintPayload,
  RetentionStatementPrintPayload,
} from "@erp/ui/print";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { localizedName } from "./messages";
import type {
  ContractingBillingState,
  ProgressCertificateRow,
  ProjectPoolRow,
  RetentionAccountRow,
  SubcontractAgreementRow,
  SubcontractCertificateRow,
} from "./api-types";

/** Both dictionaries (the bilingual labels' two sides — the print's
 * labels are GENUINELY bilingual, both sides from the dictionary). */
const AR = getDictionary("ar");
const EN = getDictionary("en");

/** The dictionary-exclusive bilingual label: BOTH sides from the i18n
 * dictionary (the owner's clause 1 — never a literal in this module). */
function bi(key: keyof Dictionary): { ar: string; en: string } {
  return { ar: AR[key], en: EN[key] };
}

/** The PRINT LOCALE's own side (inline composite lines — label: value —
 * follow the print's locale). */
function loc(locale: Locale): Dictionary {
  return getDictionary(locale);
}

/** The project's localized display line (the engine's own fields). */
function projectLines(project: ProjectPoolRow, locale: Locale): string[] {
  return [project.code, localizedName(project.name, project.nameAr, locale)];
}

/** The three signature blocks (the print convention). */
function signatures(): { label: { ar: string; en: string } }[] {
  return [
    { label: bi("projectsPrintSignaturePrepared") },
    { label: bi("projectsPrintSignatureAuthorized") },
    { label: bi("projectsPrintSignatureApproved") },
  ];
}

/** The engine-outputs note (the dictionary's own bilingual text). */
function note(): { ar: string; en: string } {
  return bi("projectsPrintNote");
}

/** The progress certificate's payload (مستخلص الأعمال): the certificate's
 * own figures + the ceiling context + the project's certificate history
 * (the long table the print paginates with a repeating thead). */
export function progressCertificatePayload(
  locale: Locale,
  certificate: ProgressCertificateRow,
  history: readonly ProgressCertificateRow[],
  billing: ContractingBillingState | null,
  project: ProjectPoolRow,
  tenantName: string,
): CertificatePrintPayload {
  const L = loc(locale);
  return {
    template: "a4-progress-certificate",
    locale,
    title: bi("projectsPrintCertificateTitle"),
    docNo: certificate.certificateNo ?? certificate.id,
    docDate: certificate.certificateDate,
    branding: { tenantName },
    parties: [
      { label: bi("projectsContractingProjectLabel"), lines: projectLines(project, locale) },
      ...(billing !== null && billing.register !== null
        ? [
            {
              label: bi("projectsPrintRegisterBlock"),
              lines: [
                `${L.projectsContractingRetColContractValue}: ${billing.register.contractValue ?? "—"} ${billing.register.currencyCode ?? ""}`.trim(),
                `${L.projectsContractingRetColHoldPercent}: ${billing.register.holdPercent ?? "—"}%`,
              ],
            },
          ]
        : []),
    ],
    figures: [
      { label: bi("projectsContractingCertColKind"), value: certificate.kind },
      { label: bi("projectsContractingCertColCumulative"), value: `${certificate.cumulativePercent}%` },
      { label: bi("projectsContractingCertColGross"), value: certificate.grossValue },
      { label: bi("projectsContractingCertColRetention"), value: certificate.retentionAmount },
      { label: bi("projectsContractingCertColNet"), value: certificate.netValue },
      { label: bi("projectsPrintAdvanceApplied"), value: certificate.advanceAppliedAmount },
      { label: bi("projectsContractingCertColCurrency"), value: certificate.currencyCode },
      { label: bi("projectsContractingCertColStatus"), value: certificate.status },
    ],
    columns: [
      { label: bi("projectsContractingCertColNo") },
      { label: bi("projectsContractingCertColDate") },
      { label: bi("projectsContractingCertColKind") },
      { label: bi("projectsContractingCertColCumulative"), numeric: true },
      { label: bi("projectsContractingCertColGross"), numeric: true },
      { label: bi("projectsContractingCertColRetention"), numeric: true },
      { label: bi("projectsContractingCertColNet"), numeric: true },
      { label: bi("projectsContractingCertColStatus") },
    ],
    rows: history.map((row) => [
      row.certificateNo ?? row.id,
      row.certificateDate,
      row.kind,
      `${row.cumulativePercent}%`,
      row.grossValue,
      row.retentionAmount,
      row.netValue,
      row.status,
    ]),
    totals:
      billing === null
        ? []
        : [
            { label: bi("projectsPrintCumulativeBilling"), amount: billing.cumulativeGross },
            {
              label: bi("projectsContractingCeilingEffective"),
              amount: billing.effectiveContractValue ?? "—",
            },
            {
              label: bi("projectsContractingCeilingRemaining"),
              amount: billing.remaining ?? "—",
              isCheck: true,
            },
          ],
    signatures: signatures(),
    note: note(),
  };
}

/** The subcontractor certificate's payload (مستخلص الباطن): the sub
 * certificate's own figures + the agreement's context + the sub history. */
export function subCertificatePayload(
  locale: Locale,
  certificate: SubcontractCertificateRow,
  history: readonly SubcontractCertificateRow[],
  agreement: SubcontractAgreementRow,
  project: ProjectPoolRow,
  tenantName: string,
): CertificatePrintPayload {
  const L = loc(locale);
  return {
    template: "a4-sub-certificate",
    locale,
    title: bi("projectsPrintSubCertificateTitle"),
    docNo: certificate.certificateNo ?? certificate.id,
    docDate: certificate.certificateDate,
    branding: { tenantName },
    parties: [
      { label: bi("projectsContractingProjectLabel"), lines: projectLines(project, locale) },
      {
        label: bi("projectsPrintAgreementBlock"),
        lines: [
          `${agreement.agreementNo} — ${localizedName(agreement.title, agreement.titleAr, locale)}`,
          `${L.projectsContractingSubColValue}: ${agreement.agreementValue} ${agreement.currencyCode}`,
          `${L.projectsContractingSubColRetention}: ${agreement.retentionPercent}%`,
        ],
      },
    ],
    figures: [
      { label: bi("projectsContractingSubCertColPercent"), value: `${certificate.progressPercent}%` },
      { label: bi("projectsContractingSubCertColGross"), value: certificate.grossValue },
      { label: bi("projectsContractingSubCertColWithheld"), value: certificate.retentionWithheld },
      { label: bi("projectsContractingSubCertColNet"), value: certificate.netPayable },
      { label: bi("projectsContractingSubCertColStatus"), value: certificate.status },
    ],
    columns: [
      { label: bi("projectsContractingSubCertColNo") },
      { label: bi("projectsContractingSubCertColDate") },
      { label: bi("projectsContractingSubCertColPercent"), numeric: true },
      { label: bi("projectsContractingSubCertColGross"), numeric: true },
      { label: bi("projectsContractingSubCertColWithheld"), numeric: true },
      { label: bi("projectsContractingSubCertColNet"), numeric: true },
      { label: bi("projectsContractingSubCertColStatus") },
    ],
    rows: history.map((row) => [
      row.certificateNo ?? row.id,
      row.certificateDate,
      `${row.progressPercent}%`,
      row.grossValue,
      row.retentionWithheld,
      row.netPayable,
      row.status,
    ]),
    totals: [],
    signatures: signatures(),
    note: note(),
  };
}

/** The retention statement's payload (كشف المحتجيات): the ledger rows
 * VERBATIM — NO totals block (a cross-kind total would be a client-side
 * sum: the zero-parallel-computation law); the register's own figures
 * are the statement's figures; asOf is the ledger's own max updatedAt
 * (engine data — never a clock read). */
export function retentionStatementPayload(
  locale: Locale,
  ledger: readonly RetentionAccountRow[],
  project: ProjectPoolRow,
  tenantName: string,
): RetentionStatementPrintPayload {
  const L = loc(locale);
  const register = ledger.find((row) => row.kind === "CUSTOMER") ?? null;
  // asOf: the ledger's own newest updatedAt (engine data, deterministic
  // per data — no wall-clock read in the print path).
  const asOf = ledger.reduce(
    (max, row) => (row.updatedAt > max ? row.updatedAt : max),
    ledger[0]?.updatedAt ?? "",
  );
  return {
    template: "a4-retention-statement",
    locale,
    title: bi("projectsPrintRetentionStatementTitle"),
    asOf,
    branding: { tenantName },
    parties: [
      { label: bi("projectsContractingProjectLabel"), lines: projectLines(project, locale) },
      ...(register !== null
        ? [
            {
              label: bi("projectsPrintRegisterBlock"),
              lines: [
                `${L.projectsContractingRetColContractValue}: ${register.contractValue ?? "—"} ${register.currencyCode ?? ""}`.trim(),
                `${L.projectsContractingRetColHoldPercent}: ${register.holdPercent ?? "—"}%`,
              ],
            },
          ]
        : []),
    ],
    figures:
      register === null
        ? []
        : [
            { label: bi("projectsContractingRetColAccrued"), value: register.accruedBalance },
            { label: bi("projectsContractingRetColReleased"), value: register.releasedAmount },
            { label: bi("projectsContractingRetColTakingOver"), value: register.takingOverDate ?? "—" },
            { label: bi("projectsContractingRetColDefectLiability"), value: register.defectLiabilityDate ?? "—" },
          ],
    columns: [
      { label: bi("projectsContractingRetColKind") },
      { label: bi("projectsContractingRetColContractValue"), numeric: true },
      { label: bi("projectsContractingRetColHoldPercent"), numeric: true },
      { label: bi("projectsContractingRetColAccrued"), numeric: true },
      { label: bi("projectsContractingRetColReleased"), numeric: true },
      { label: bi("projectsContractingRetColTakingOver") },
      { label: bi("projectsContractingRetColDefectLiability") },
      { label: bi("projectsContractingRetColStatus") },
    ],
    rows: ledger.map((row) => [
      row.kind === "SUBCONTRACTOR"
        ? L.projectsContractingRetKindSubcontractor
        : L.projectsContractingRetKindCustomer,
      row.contractValue ?? "—",
      row.holdPercent === null ? "—" : `${row.holdPercent}%`,
      row.accruedBalance,
      row.releasedAmount,
      row.takingOverDate ?? "—",
      row.defectLiabilityDate ?? "—",
      row.status,
    ]),
    signatures: signatures(),
    note: note(),
  };
}
