"use client";

/**
 * P6-T11b — export card (import/export page): kind + format → POST
 * `items/export-jobs` returns the signed download URL (15-minute expiry)
 * + row count; the link is rendered with the localized download label.
 */
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Button, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ExportJobResult } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedMasterDataError } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";

export function ExportCard({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const [kind, setKind] = useState<string>("PARTNERS");
  const [format, setFormat] = useState<string>("CSV");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportJobResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const exported = await bffFetch<ExportJobResult>("items/export-jobs", {
      method: "POST",
      body: { kind, format },
    });
    setBusy(false);
    if (!exported.ok) {
      setError(localizedMasterDataError(d, exported.error, exported.retryAfterSeconds));
      return;
    }
    setResult(exported.data);
    toast({ tone: "success", title: formatMessage(d.exportDone, { rows: exported.data.rowCount }) });
  }

  return (
    <Card title={d.exportTitle} description={d.exportHint} ariaLabel={d.exportTitle}>
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select
            id="export-kind"
            label={d.importDataKindLabel}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "PARTNERS", label: d.importKindPartners },
              { value: "ITEMS", label: d.importKindItems },
              { value: "OPENING_BALANCES", label: d.importKindOpeningBalances },
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            id="export-format"
            label={d.importFormatLabel}
            value={format}
            onValueChange={setFormat}
            options={[
              { value: "CSV", label: d.importFormatCsv },
              { value: "XLSX", label: d.importFormatXlsx },
            ]}
          />
        </div>
        <Button type="submit" variant="secondary" loading={busy}>
          {d.exportSubmit}
        </Button>
      </form>
      {result !== null && (
        <div className="mt-3">
          <DefList
            items={[
              {
                term: d.exportRows,
                children: <span className="font-mono">{result.rowCount}</span>,
              },
              {
                term: d.exportDownloadLabel,
                children: (
                  <a
                    href={result.downloadUrl}
                    className="font-mono text-xs text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                  >
                    {result.downloadUrl}
                  </a>
                ),
              },
              {
                term: d.attachmentExpiresLabel,
                children: (
                  <span className="font-mono">{result.expiresInSeconds}</span>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-gray-600">
            {formatMessage(d.exportExpiresNote, { seconds: result.expiresInSeconds })}
          </p>
        </div>
      )}
      {error !== null && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
    </Card>
  );
}
