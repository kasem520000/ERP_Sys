/**
 * /{locale}/pos/floor — the table-service floor plan (PHASE-016 T6): zone
 * sections with FREE/OCCUPIED table cards, the open-check dialog, and the
 * check editor (lines, kitchen tickets, transfer, split, guest check, Pay
 * hand-off, cancel). The floor of the first active branch is the primary
 * resource (403 renders the forbidden state); items/terminals degrade.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { PosFloor } from "../../../../components/pos-floor";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PosCheckRow,
  PosFloorZone,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PosFloorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [branches, items] = await Promise.all([
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
  ]);
  if (!branches.ok && branches.status === 401) {
    redirect(`/${locale}/login`);
  }

  const activeBranches = branches.ok ? branches.data.filter((branch) => branch.isActive) : [];
  const initialBranchId = activeBranches[0]?.id ?? "";

  const [zones, checks] =
    initialBranchId === ""
      ? [
          { ok: true as const, data: [] as readonly PosFloorZone[] },
          { ok: true as const, data: [] as readonly PosCheckRow[] },
        ]
      : await Promise.all([
          fetchApi<readonly PosFloorZone[]>(`pos/floor?branchId=${initialBranchId}`),
          fetchApi<readonly PosCheckRow[]>(`pos/checks?branchId=${initialBranchId}&status=OPEN`),
        ]);

  let content: JSX.Element;
  if (!branches.ok) {
    const forbidden = branches.status === 403 || branches.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, branches.error, branches.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else if (!zones.ok) {
    const forbidden = zones.status === 403 || zones.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, zones.error, zones.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PosFloor
        locale={localeValue}
        branches={branches.data}
        initialBranchId={initialBranchId}
        initialZones={zones.data}
        initialChecks={checks.ok ? checks.data : []}
        items={items.ok ? items.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="pos/floor" title={d.posFloorTitle}>
      {content}
    </AppShell>
  );
}
