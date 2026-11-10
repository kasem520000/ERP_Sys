import { createHash } from "node:crypto";

/**
 * PHASE-023 T1 — the compliance payload builder (E_INVOICING §1: POSTED
 * document → payload builder → adapter port → submission registry).
 *
 * NO-FABRICATION boundary (§4 rule 1 + phase §2.3): this builder emits the
 * PLATFORM-NEUTRAL compliance archive — the document's own data plus the
 * INV-012 tax-document summary the posting engine already produced, with
 * bilingual labels resolved from the jurisdiction pack. It encodes NO
 * authority wire format, NO QR TLV layout, NO authority field list: those
 * are ADAPTER concerns gated on verified official specifications
 * (E_INVOICING §3). Every archive carries `authoritative: false` — a
 * compliance-ready export labeled NON-AUTHORITATIVE per §5 (the honest
 * export for regimes without e-invoicing mandates) until an adapter's
 * ACCEPTED registry row says otherwise (directive §12).
 */

/** The built compliance archive (adapter-neutral, frozen shape). */
export interface ComplianceArchive {
  readonly kind: "erp.compliance-archive.v1";
  readonly authoritative: false;
  readonly generatedAt: string;
  readonly jurisdiction: {
    readonly countryCode: string;
    readonly packVersion: string;
    readonly vatStatus: string;
    readonly verificationStatus: string;
  };
  readonly document: {
    readonly sourceType: string;
    readonly sourceId: string;
    readonly officialNumber: string | null;
    readonly issuedOn: string | null;
    readonly partyName: string | null;
    readonly currencyCode: string | null;
    readonly totals: Readonly<Record<string, string>> | null;
  };
  /** The INV-012 append-only summary groups (posting-time truth). */
  readonly taxSummary: readonly {
    readonly direction: string;
    readonly treatment: string;
    readonly rate: string;
    readonly taxableBase: string;
    readonly taxAmount: string;
  }[];
  /** Bilingual labels the print/export artifacts render (pack-driven). */
  readonly labels: { readonly ar: Readonly<Record<string, string>>; readonly en: Readonly<Record<string, string>> };
}

export interface BuildArchiveInput {
  readonly countryCode: string;
  readonly packVersion: string;
  readonly vatStatus: string;
  readonly verificationStatus: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly document: {
    readonly officialNumber: string | null;
    readonly issuedOn: string | null;
    readonly partyName: string | null;
    readonly currencyCode: string | null;
    readonly totals: Readonly<Record<string, string>> | null;
  };
  readonly taxSummary: readonly ComplianceArchive["taxSummary"][number][];
  readonly now?: Date;
}

/** Deterministic digest of the archive (the registry's payload_digest). */
export function archiveDigest(archive: ComplianceArchive): string {
  const stable = JSON.stringify(archive, ["kind", "jurisdiction", "document", "taxSummary", "labels"]);
  return `sha256-${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

/** The bilingual label set (pack-scoped; AR is the primary launch locale). */
function labels(): { ar: Record<string, string>; en: Record<string, string> } {
  return {
    ar: {
      title: "أرشيف امتثال — غير رسمي",
      note: "هذا الأرشيف مُعد للتصدير ولا يمثل قبولًا من أي جهة ضريبية",
      documentNumber: "رقم المستند",
      issueDate: "تاريخ الإصدار",
      party: "الطرف",
      currency: "العملة",
      totals: "الإجماليات",
      taxSummary: "ملخص الضريبة",
      taxableBase: "الوعاء الضريبي",
      taxAmount: "مبلغ الضريبة",
      rate: "النسبة",
      treatment: "المعالجة",
    },
    en: {
      title: "Compliance archive — non-authoritative",
      note: "This archive is export-ready and does not represent acceptance by any tax authority",
      documentNumber: "Document number",
      issueDate: "Issue date",
      party: "Party",
      currency: "Currency",
      totals: "Totals",
      taxSummary: "Tax summary",
      taxableBase: "Taxable base",
      taxAmount: "Tax amount",
      rate: "Rate",
      treatment: "Treatment",
    },
  };
}

/** Build the compliance archive for a posted document (pure; no I/O). */
export function buildComplianceArchive(input: BuildArchiveInput): ComplianceArchive {
  return {
    kind: "erp.compliance-archive.v1",
    authoritative: false,
    generatedAt: (input.now ?? new Date()).toISOString(),
    jurisdiction: {
      countryCode: input.countryCode,
      packVersion: input.packVersion,
      vatStatus: input.vatStatus,
      verificationStatus: input.verificationStatus,
    },
    document: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      officialNumber: input.document.officialNumber,
      issuedOn: input.document.issuedOn,
      partyName: input.document.partyName,
      currencyCode: input.document.currencyCode,
      totals: input.document.totals,
    },
    taxSummary: [...input.taxSummary].map((group) => ({ ...group })),
    labels: labels(),
  };
}
