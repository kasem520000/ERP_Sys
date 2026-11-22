"use client";

/**
 * PHASE-049 (W-21 — T-14) — the scan surface (the /assets/scan resolver):
 * the signed tag code resolves to the asset card brief through the
 * signature gate, then tenant isolation (TAG_CODE_INVALID refuses at the
 * signature — never at a lookup; TAG_NOT_FOUND is the foreign-tenant
 * refusal). The board renders the engine's own resolution payload
 * VERBATIM — the register brief, the four expiry chips, the maintenance
 * context counts, and the odometer binding — zero client-side computation;
 * the counts are the engine's own, the dates the engine's own strings.
 *
 * THE TYPED-REFUSAL PANEL: a refused resolve renders the code + the
 * message + the FULL details payload — never a generic error.
 */
import Link from "next/link";
import { useState } from "react";
import type { JSX } from "react";

import { Badge, Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, AssetScanPayload } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedAssetStatus, localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** The semantic-tone chip (the fieldservice-board precedent). */
type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function monoCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

export function AssetsScanSurface({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);

  const [code, setCode] = useState("");
  const [resolving, setResolving] = useState(false);
  const [payload, setPayload] = useState<AssetScanPayload | null>(null);
  const [refusal, setRefusal] = useState<ApiErrorBody | null>(null);

  async function resolve(): Promise<void> {
    const trimmed = code.trim();
    if (trimmed === "") {
      setPayload(null);
      setRefusal(null);
      return;
    }
    setResolving(true);
    setPayload(null);
    setRefusal(null);
    const result = await bffFetch<AssetScanPayload>(`assets/scan/${encodeURIComponent(trimmed)}`);
    setResolving(false);
    if (!result.ok) {
      setRefusal(result.error);
      return;
    }
    setPayload(result.data);
  }

  /** One expiry chip: the engine's own date (or the honest dash). */
  function expiryChip(label: string, date: string | null): JSX.Element {
    return <Chip tone="neutral">{`${label}: ${date ?? "—"}`}</Chip>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={d.assetsScanTitle} description={d.assetsScanSubtitle}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:flex-1">
            <Input
              label={d.assetsScanInputLabel}
              value={code}
              onValueChange={(value) => {
                setCode(value);
                setPayload(null);
                setRefusal(null);
              }}
              mono
              bidiIsolate
              autoComplete="off"
            />
          </div>
          <Button
            variant="primary"
            loading={resolving}
            disabled={code.trim() === ""}
            onClick={() => void resolve()}
          >
            {d.assetsScanResolve}
          </Button>
        </div>
      </Card>

      {refusal !== null ? (
        <TypedRefusalPanel
          error={refusal}
          title={d.assetsMaintenanceRefusalTitle}
          detailsLabel={d.assetsMaintenanceRefusalDetails}
        />
      ) : null}

      {payload !== null ? (
        <Card
          title={d.assetsScanCardTitle}
          actions={
            <Link
              href={`/${locale}/fixed-assets/${payload.asset.id}`}
              className="text-sm font-medium text-primary-700 underline-offset-2 hover:underline"
            >
              {d.assetsScanOpenCard}
            </Link>
          }
        >
          <div className="flex flex-col gap-3">
            {/* the register brief — the resolution payload's own fields */}
            <DefList
              items={[
                {
                  term: d.assetsFleetColCode,
                  children: monoCell(payload.asset.code),
                },
                {
                  term: d.colName,
                  children: localizedName(payload.asset.name, payload.asset.nameAr, locale),
                },
                {
                  term: d.assetsFleetColCategory,
                  children: payload.asset.categoryName,
                },
                {
                  term: d.assetsFleetColBranch,
                  children: payload.asset.branchName,
                },
                {
                  term: d.colStatus,
                  children: (
                    <Badge tone={payload.asset.status === "ACTIVE" ? "primary" : "neutral"}>
                      {localizedAssetStatus(d, payload.asset.status)}
                    </Badge>
                  ),
                },
              ]}
            />

            {/* THE FOUR EXPIRY CHIPS — the engine's own dates (null → dash) */}
            <div className="flex flex-wrap gap-2">
              {expiryChip(d.faWarrantyExpiry, payload.asset.warrantyExpiry)}
              {expiryChip(d.faInsuranceExpiry, payload.asset.insuranceExpiry)}
              {expiryChip(d.faLicenseExpiry, payload.asset.licenseExpiry)}
              {expiryChip(d.faInspectionExpiry, payload.asset.inspectionExpiry)}
            </div>

            {/* THE MAINTENANCE CONTEXT — the engine's own counts, mono */}
            <DefList
              items={[
                {
                  term: d.assetsScanOpenWorkOrders,
                  children: monoCell(String(payload.openWorkOrders)),
                },
                {
                  term: d.assetsScanActivePlans,
                  children: monoCell(String(payload.activePlans)),
                },
              ]}
            />

            {/* THE ODOMETER BINDING — the engine's own snapshot when present */}
            {payload.odometer !== null ? (
              <DefList
                items={[
                  {
                    term: d.assetsScanOdometer,
                    children: (
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span>{localizedName(payload.odometer.name, payload.odometer.nameAr, locale)}</span>
                        {monoCell(payload.odometer.lastValue)}
                        <span className="text-xs text-gray-600">{payload.odometer.unit}</span>
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
