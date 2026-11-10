/**
 * /{locale}/inventory/items/[id] — item detail (generic-detail archetype):
 * the edit form (PATCH + version), the barcodes section, attachments and the
 * archive action. 404 → notFound; 401 → login; reference-list 403s degrade.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../../components/app-shell";
import { ArchiveAction } from "../../../../../components/archive-action";
import { AttachmentsSection } from "../../../../../components/attachments-section";
import { ErrorState } from "../../../../../components/client-ui";
import { ItemBarcodes } from "../../../../../components/item-barcodes";
import { ItemForm } from "../../../../../components/item-form";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  AttachmentView,
  BarcodeRow,
  ItemCategoryRow,
  ItemRow,
  UomRow,
} from "../../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const item = await fetchApi<ItemRow>(`items/items/${id}`);
  if (!item.ok && item.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!item.ok && item.status === 404) {
    notFound();
  }
  if (!item.ok) {
    const forbidden = item.status === 403 || item.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`inventory/items/${id}`} title={d.navItems}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, item.error, item.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const [uoms, categories, barcodes, attachments] = await Promise.all([
    fetchApi<readonly UomRow[]>("items/uoms"),
    fetchApi<readonly ItemCategoryRow[]>("items/item-categories"),
    fetchApi<readonly BarcodeRow[]>(`items/barcodes?itemId=${id}`),
    fetchApi<readonly AttachmentView[]>(`items/items/${id}/attachments`),
  ]);
  if (
    (!uoms.ok && uoms.status === 401) ||
    (!categories.ok && categories.status === 401) ||
    (!barcodes.ok && barcodes.status === 401) ||
    (!attachments.ok && attachments.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const detail = item.data;
  const archived = detail.status === "ARCHIVED";

  return (
    <AppShell
      locale={localeValue}
      pagePath={`inventory/items/${id}`}
      title={localizedName(detail.name, detail.nameAr, localeValue)}
    >
      <div className="flex flex-col gap-6">
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <ItemForm
            locale={localeValue}
            mode="edit"
            item={detail}
            uoms={uoms.ok ? uoms.data : []}
            categories={categories.ok ? categories.data : []}
          />
          <div className="flex flex-col gap-6">
            <ItemBarcodes
              locale={localeValue}
              itemId={id}
              defaultUomId={detail.uomId}
              uoms={uoms.ok ? uoms.data : []}
              rows={barcodes.ok ? barcodes.data : []}
            />
            <div className="flex items-center justify-end">
              <ArchiveAction
                locale={localeValue}
                archiveEndpoint={`items/items/${id}/archive`}
                redirectTo={`/${locale}/inventory/items`}
                disabled={archived}
                labels={{
                  button: d.itemArchiveButton,
                  confirmTitle: d.itemArchiveConfirmTitle,
                  confirmBody: d.itemArchiveConfirmBody,
                  successToast: d.itemArchivedToast,
                }}
              />
            </div>
          </div>
        </div>
        <AttachmentsSection
          locale={localeValue}
          issuePath={`items/items/${id}/attachments`}
          rows={attachments.ok ? attachments.data : []}
        />
      </div>
    </AppShell>
  );
}
