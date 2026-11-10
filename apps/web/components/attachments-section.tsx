"use client";

/**
 * P6-T11b — owner attachments section (partners + items share the shape):
 * server-fetched rows with per-request signed download URLs, plus the
 * PHASE-006 upload seam — issuing a slot (filename + content-type + size)
 * returns the presigned PUT URL the caller uploads to out-of-band. The
 * files module's full browser upload lands with a later phase; the issued
 * URL + key + expiry surface honestly (attachmentIssuedHint).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent, JSX } from "react";

import { Button, DataTable, Input, NumberInput, Select, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AttachmentIssuedUpload, AttachmentView } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedMasterDataError } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** The API upload allowlist (files module U-01); labels are dictionary keys. */
const CONTENT_TYPE_OPTIONS = [
  { value: "application/pdf", labelKey: "attachmentTypePdf" },
  { value: "image/png", labelKey: "attachmentTypePng" },
  { value: "image/jpeg", labelKey: "attachmentTypeJpeg" },
  { value: "image/webp", labelKey: "attachmentTypeWebp" },
  { value: "text/csv", labelKey: "attachmentTypeCsv" },
] as const;

/** Server filename contract: 1..200 chars of [A-Za-z0-9._-] (U-06). */
function sanitizeFilenameInput(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function AttachmentsSection({
  locale,
  issuePath,
  rows,
}: {
  locale: Locale;
  /** BFF path of the issue endpoint, e.g. `partners/partners/:id/attachments`. */
  issuePath: string;
  rows: readonly AttachmentView[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const [filename, setFilename] = useState("");
  const [contentType, setContentType] = useState<string>(CONTENT_TYPE_OPTIONS[0].value);
  const [sizeBytes, setSizeBytes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<AttachmentIssuedUpload | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const safeName = sanitizeFilenameInput(filename);
    const size = Number.parseInt(sizeBytes, 10);
    if (safeName === "" || !Number.isInteger(size) || size <= 0) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    const result = await bffFetch<AttachmentIssuedUpload>(issuePath, {
      method: "POST",
      body: { filename: safeName, contentType, sizeBytes: size },
    });
    setBusy(false);
    if (!result.ok) {
      setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setIssued(result.data);
    toast({ tone: "success", title: d.attachmentIssuedToast });
    setFilename("");
    setSizeBytes("");
    router.refresh(); // the slot row appears in the owner's list immediately
  }

  return (
    <Card title={d.attachmentsTitle} ariaLabel={d.attachmentsTitle}>
      <DataTable
        columns={[
          {
            id: "name",
            header: activeLocaleHeader(d.attachmentFilenameLabel),
            accessor: (row) => row.name,
            mono: true,
            render: (row) => (
              <a
                href={row.downloadUrl}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "contentType",
            header: activeLocaleHeader(d.attachmentContentTypeLabel),
            accessor: (row) => row.contentType,
            mono: true,
          },
          {
            id: "size",
            header: activeLocaleHeader(d.attachmentSizeLabel),
            accessor: (row) => String(row.sizeBytes),
            numeric: true,
            render: (row) => row.sizeBytes.toLocaleString(locale === "ar" ? "ar" : "en"),
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        empty={{ title: d.attachmentsEmpty }}
      />
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3 sm:grid-cols-3">
        <Input
          id="attachment-filename"
          label={d.attachmentFilenameLabel}
          value={filename}
          onValueChange={setFilename}
          mono
          bidiIsolate
          required
        />
        <Select
          id="attachment-content-type"
          label={d.attachmentContentTypeLabel}
          value={contentType}
          onValueChange={setContentType}
          options={CONTENT_TYPE_OPTIONS.map((option) => ({
            value: option.value,
            label: d[option.labelKey],
          }))}
          required
        />
        <NumberInput
          id="attachment-size"
          label={d.attachmentSizeLabel}
          value={sizeBytes}
          onValueChange={setSizeBytes}
          min={1}
          required
        />
        <div className="sm:col-span-3 flex items-center justify-end">
          <Button type="submit" variant="secondary" loading={busy}>
            {d.attachmentIssueButton}
          </Button>
        </div>
      </form>
      {issued !== null && (
        <div className="mt-3 rounded-md border border-subtle bg-surface-sunken p-3">
          <h3 className="text-sm font-semibold text-gray-900">{d.attachmentIssuedTitle}</h3>
          <DefList
            className="mt-2"
            items={[
              {
                term: d.attachmentFilenameLabel,
                children: <span className="font-mono">{issued.key.split("/").pop()}</span>,
              },
              {
                term: d.attachmentUrlLabel,
                children: (
                  <a
                    href={issued.uploadUrl}
                    className="break-all font-mono text-xs text-primary-700 underline decoration-primary-200"
                  >
                    {issued.uploadUrl}
                  </a>
                ),
              },
              {
                term: d.attachmentKeyLabel,
                children: <span className="break-all font-mono text-xs">{issued.key}</span>,
              },
              {
                term: d.attachmentExpiresLabel,
                children: <span className="font-mono">{issued.expiresInSeconds}</span>,
              },
            ]}
          />
          <p className="mt-2 text-xs text-gray-600">
            {formatMessage(d.attachmentIssuedHint, { seconds: issued.expiresInSeconds })}
          </p>
        </div>
      )}
      {error !== null && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
    </Card>
  );
}
