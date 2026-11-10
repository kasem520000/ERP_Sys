"use client";
/**
 * PHASE-023 T10 — the e-invoicing status surface (client interactivity):
 * the registry table with per-row resubmit (REJECTED/FAILED rows only —
 * TROUBLESHOOTING §10: a NEW submission, history intact), the adapters
 * panel with the UNVERIFIED honesty note, and the certificate countdowns.
 * Authority truth is EXACTLY the registry rows (directive §12) — nothing
 * infers acceptance from local document state.
 */
import { useState, type JSX } from "react";

import type { Dictionary, Locale } from "../i18n/dictionaries";
import type {
  EInvoicingAdapterRow,
  EInvoicingCertificateRow,
  EInvoicingSubmissionRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";

const STATUS_KEY: Record<EInvoicingSubmissionRow["status"], keyof Dictionary> = {
  PENDING: "einvoicingStatusPending",
  GENERATED: "einvoicingStatusGenerated",
  SIGNED: "einvoicingStatusSigned",
  SUBMITTED: "einvoicingStatusSubmitted",
  ACCEPTED: "einvoicingStatusAccepted",
  REJECTED: "einvoicingStatusRejected",
  REPORTED: "einvoicingStatusReported",
  FAILED: "einvoicingStatusFailed",
};

const TERMINAL_BADGE = "rounded px-2 py-0.5 text-xs font-medium";

function statusClasses(status: EInvoicingSubmissionRow["status"]): string {
  if (status === "ACCEPTED" || status === "REPORTED") {
    return `${TERMINAL_BADGE} bg-emerald-100 text-emerald-800`;
  }
  if (status === "REJECTED" || status === "FAILED") {
    return `${TERMINAL_BADGE} bg-red-100 text-red-800`;
  }
  return `${TERMINAL_BADGE} bg-amber-100 text-amber-800`;
}

export function EInvoicingStatus({
  locale,
  d,
  initialSubmissions,
  adapters,
  certificates,
}: {
  locale: Locale;
  d: Dictionary;
  initialSubmissions: readonly EInvoicingSubmissionRow[];
  adapters: readonly EInvoicingAdapterRow[];
  certificates: readonly EInvoicingCertificateRow[];
}): JSX.Element {
  const [rows, setRows] = useState(initialSubmissions);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dir = locale === "ar" ? "rtl" : "ltr";

  async function resubmit(row: EInvoicingSubmissionRow): Promise<void> {
    setBusy(row.id);
    try {
      const outcome = await bffFetch<EInvoicingSubmissionRow>(
        `tax/einvoicing/submissions/${row.id}/resubmit`,
        { method: "POST", body: {} },
      );
      if (outcome.ok) {
        setRows((current) => [...current, outcome.data]);
        setToast(d.einvoicingResubmitDone);
      } else {
        setToast(locale === "ar" ? "تعذّرت إعادة الإرسال" : "Resubmission failed");
      }
    } catch {
      setToast(locale === "ar" ? "تعذّرت إعادة الإرسال" : "Resubmission failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div dir={dir} className="space-y-6">
      {toast !== null && (
        <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{toast}</p>
      )}

      <section aria-labelledby="einvoicing-adapters" className="rounded-lg border p-4">
        <h2 id="einvoicing-adapters" className="mb-3 text-base font-semibold">
          {d.einvoicingAdaptersTitle}
        </h2>
        <ul className="space-y-2">
          {adapters.map((adapter) => (
            <li key={adapter.id} className="flex flex-wrap items-center gap-2 text-sm">
              <code className="rounded bg-slate-100 px-1.5 py-0.5">{adapter.id}</code>
              <span className={adapter.regimeVerified ? "text-emerald-700" : "text-amber-700"}>
                {adapter.regimeVerified ? d.einvoicingRegimeVerified : d.einvoicingRegimeUnverified}
              </span>
              {!adapter.regimeVerified && (
                <span className="text-xs text-slate-500">{d.einvoicingAdaptersUnverifiedNote}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="einvoicing-certs" className="rounded-lg border p-4">
        <h2 id="einvoicing-certs" className="mb-3 text-base font-semibold">
          {d.einvoicingCertsTitle}
        </h2>
        {certificates.length === 0 ? (
          <p className="text-sm text-slate-500">{d.einvoicingCertsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {certificates.map((cert) => (
              <li key={cert.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{cert.label}</span>
                <span className="text-slate-500">
                  {d.einvoicingCertValidUntil}: {cert.notAfter.slice(0, 10)}
                </span>
                <span
                  className={
                    cert.status === "ACTIVE"
                      ? "text-emerald-700"
                      : cert.status === "EXPIRING_SOON"
                        ? "text-amber-700"
                        : "text-red-700"
                  }
                >
                  {cert.status}
                </span>
                <span className="text-slate-500">
                  {d.einvoicingCertSignCount}: {cert.signCount}
                </span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{cert.fingerprint}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="einvoicing-registry" className="rounded-lg border p-4">
        <h2 id="einvoicing-registry" className="mb-3 text-base font-semibold">
          {d.einvoicingRegistryTitle}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{d.einvoicingEmpty}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start text-xs text-slate-500">
                  <th className="p-2 text-start">{d.einvoicingStatus}</th>
                  <th className="p-2 text-start">{d.einvoicingDocument}</th>
                  <th className="p-2 text-start">{d.einvoicingAdapter}</th>
                  <th className="p-2 text-start">{d.einvoicingAttempts}</th>
                  <th className="p-2 text-start">{d.einvoicingAuthorityRef}</th>
                  <th className="p-2 text-start">{d.einvoicingLastError}</th>
                  <th className="p-2 text-start">{d.einvoicingSubmittedAt}</th>
                  <th className="p-2" aria-label={d.einvoicingResubmit} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-2">
                      <span className={statusClasses(row.status)}>
                        {d[STATUS_KEY[row.status]] as string}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-xs">
                      {row.sourceType}/{row.sourceId.slice(0, 8)}
                    </td>
                    <td className="p-2">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{row.adapterId}</code>
                    </td>
                    <td className="p-2">{row.attempts}</td>
                    <td className="p-2 font-mono text-xs">{row.authorityReference ?? "—"}</td>
                    <td className="p-2 text-xs">{row.lastErrorCode ?? "—"}</td>
                    <td className="p-2 text-xs">{row.submittedAt?.slice(0, 19).replace("T", " ") ?? "—"}</td>
                    <td className="p-2">
                      {(row.status === "REJECTED" || row.status === "FAILED") && (
                        <button
                          type="button"
                          onClick={() => void resubmit(row)}
                          disabled={busy === row.id}
                          className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy === row.id ? "…" : d.einvoicingResubmit}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
