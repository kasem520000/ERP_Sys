"use client";

/**
 * T15-UI (PHASE-009) — jurisdiction packs viewer (settings archetype): the
 * seeded 10-pack registry (country bilingual, currency + minor units, VAT
 * status badge, pack version, verification badge — REQUIRES_VERIFICATION
 * amber / VERIFIED green, composed from the semantic tokens per
 * DESIGN_SYSTEM §4 since the frozen Badge ships only neutral/primary).
 * Selecting a pack loads its version view (GET packs/:country/versions):
 * the rate-window table + the tenant's pinned binding + the staged-apply
 * button (POST packs/:country/apply — pins the version, audited).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { JurisdictionPackRow, PackVersionsRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { cx } from "../lib/cx";
import {
  localizedName,
  localizedTaxError,
  localizedTaxTreatment,
  localizedVatStatus,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Rate strings travel as canonical decimals ("15.0000") — display trimmed + %. */
function percentLabel(rate: string): string {
  const trimmed = rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${trimmed === "" ? "0" : trimmed}%`;
}

/** Verification badge: VERIFIED green / REQUIRES_VERIFICATION amber (§4 tokens). */
function VerificationBadge({ verified, label }: { verified: boolean; label: string }): JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4",
        verified
          ? "border-success-border bg-success-bg text-success-text"
          : "border-warning-border bg-warning-bg text-warning-text",
      )}
    >
      {label}
    </span>
  );
}

export function TaxPacks({
  locale,
  initialPacks,
  canApply,
}: {
  locale: Locale;
  initialPacks: readonly JurisdictionPackRow[];
  canApply: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [versions, setVersions] = useState<PackVersionsRow | null>(null);

  const selected = useMemo(
    () => initialPacks.find((pack) => pack.countryCode === selectedCountry) ?? null,
    [initialPacks, selectedCountry],
  );

  async function selectPack(countryCode: string): Promise<void> {
    setSelectedCountry(countryCode);
    setVersions(null);
    setError(null);
    setNotice(null);
    setBusy("versions");
    const loaded = await bffFetch<PackVersionsRow>(`tax/packs/${countryCode}/versions`);
    setBusy(null);
    if (!loaded.ok) {
      setError(localizedTaxError(d, loaded.error, loaded.retryAfterSeconds));
      return;
    }
    setVersions(loaded.data);
  }

  async function applyPack(): Promise<void> {
    if (selected === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("apply");
    const applied = await bffFetch<unknown>(`tax/packs/${selected.countryCode}/apply`, {
      method: "POST",
      body: { packVersion: selected.packVersion },
    });
    setBusy(null);
    if (!applied.ok) {
      setError(localizedTaxError(d, applied.error, applied.retryAfterSeconds));
      return;
    }
    setNotice(d.taxPacksApplied);
    router.refresh();
    await selectPack(selected.countryCode);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.taxPacksTitle}>
        <DataTable
          columns={[
            {
              id: "country",
              header: activeLocaleHeader(d.taxPacksCountry),
              accessor: (row) =>
                `${row.countryCode} ${localizedName(row.countryName, row.countryNameAr, locale)}`,
              sortable: true,
              render: (row) => (
                <span>
                  <span className="font-mono text-sm" dir="ltr">
                    {row.countryCode}
                  </span>
                  {" · "}
                  {localizedName(row.countryName, row.countryNameAr, locale)}
                </span>
              ),
            },
            {
              id: "currency",
              header: activeLocaleHeader(d.treasuryDocCurrency),
              accessor: (row) => row.currencyCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.currencyCode} · {row.minorUnits}
                </span>
              ),
            },
            {
              id: "vatStatus",
              header: activeLocaleHeader(d.taxPacksVatStatus),
              accessor: (row) => row.vatStatus,
              render: (row) =>
                row.vatStatus === "VAT_IN_FORCE" ? (
                  <Badge tone="primary">{localizedVatStatus(d, row.vatStatus)}</Badge>
                ) : (
                  <Badge tone="neutral">{localizedVatStatus(d, row.vatStatus)}</Badge>
                ),
            },
            {
              id: "version",
              header: activeLocaleHeader(d.taxPacksVersion),
              accessor: (row) => row.packVersion,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.packVersion}
                </span>
              ),
            },
            {
              id: "verification",
              header: activeLocaleHeader(d.taxPacksVerification),
              accessor: (row) => row.verificationStatus,
              render: (row) => (
                <VerificationBadge
                  verified={row.verificationStatus === "VERIFIED"}
                  label={
                    row.verificationStatus === "VERIFIED"
                      ? d.taxPacksVerified
                      : d.taxPacksRequiresVerification
                  }
                />
              ),
            },
          ]}
          rows={[...initialPacks]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "select",
              label: d.taxPacksWindowsTitle,
              onSelect: (row: JurisdictionPackRow) => void selectPack(row.countryCode),
            },
          ]}
          empty={{ title: d.taxPacksEmpty }}
        />
      </Card>

      {selected !== null && (
        <Card
          title={`${d.taxPacksWindowsTitle} — ${localizedName(selected.countryName, selected.countryNameAr, locale)}`}
          description={d.taxPacksPreviewNote}
        >
          <div className="flex flex-col gap-3">
            <DefList
              items={[
                {
                  term: d.taxPacksVersion,
                  children: (
                    <span className="font-mono text-sm" dir="ltr">
                      {selected.packVersion}
                    </span>
                  ),
                },
                {
                  term: d.taxPacksBinding,
                  children:
                    versions?.tenantBinding != null ? (
                      <span className="font-mono text-sm" dir="ltr">
                        {versions.tenantBinding.packVersion}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600">{d.taxPacksBindingNone}</span>
                    ),
                },
                {
                  term: d.taxPacksVerification,
                  children: (
                    <VerificationBadge
                      verified={selected.verificationStatus === "VERIFIED"}
                      label={
                        selected.verificationStatus === "VERIFIED"
                          ? d.taxPacksVerified
                          : d.taxPacksRequiresVerification
                      }
                    />
                  ),
                },
              ]}
            />

            <DataTable
              columns={[
                {
                  id: "treatment",
                  header: activeLocaleHeader(d.taxCodesTreatment),
                  accessor: (row) => row.treatment,
                  render: (row) => (
                    <Badge tone="primary">{localizedTaxTreatment(d, row.treatment)}</Badge>
                  ),
                },
                {
                  id: "rate",
                  header: activeLocaleHeader(d.taxPacksRate),
                  accessor: (row) => row.rate,
                  numeric: true,
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono tabular-nums" dir="ltr">
                      {percentLabel(row.rate)}
                    </span>
                  ),
                },
                {
                  id: "effectiveFrom",
                  header: activeLocaleHeader(d.taxPacksEffectiveFrom),
                  accessor: (row) => row.effectiveFrom,
                  mono: true,
                  sortable: true,
                  render: (row) => (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.effectiveFrom}
                    </span>
                  ),
                },
                {
                  id: "effectiveTo",
                  header: activeLocaleHeader(d.taxPacksEffectiveTo),
                  accessor: (row) => row.effectiveTo ?? "",
                  mono: true,
                  render: (row) =>
                    row.effectiveTo === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.effectiveTo}
                      </span>
                    ),
                },
                {
                  id: "sourceRef",
                  header: activeLocaleHeader(d.taxPacksSource),
                  accessor: (row) => row.sourceRef,
                  mono: true,
                  render: (row) => (
                    <span className="max-w-[16rem] truncate font-mono text-xs" dir="ltr">
                      {row.sourceRef}
                    </span>
                  ),
                },
              ]}
              rows={versions !== null ? [...versions.windows] : []}
              rowKey={(row) => `${row.treatment}-${row.effectiveFrom}`}
              loading={busy === "versions"}
              empty={{ title: d.taxPacksNoRates }}
            />

            {selected.verificationStatus !== "VERIFIED" && (
              <InfoNotice>{d.taxPacksRequiresVerification}</InfoNotice>
            )}

            {canApply && (
              <Button
                variant="primary"
                onClick={() => void applyPack()}
                loading={busy === "apply"}
                className="self-start"
              >
                {d.taxPacksApply}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
