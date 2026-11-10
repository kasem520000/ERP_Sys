"use client";
/**
 * PHASE-021 T2-b · the cached reads panel (DR-P21-06/§6; matrix rows
 * 4/5/13/14/33 — READ-CACHED, SAS/RO): items + partners search over the
 * pulled caches with the as-of label, and the cached sales-invoice list
 * with the REPRINT affordance (row 32 — OFFLINE-COMPLETE from cache,
 * never re-numbers). In browser mode the panel renders ONLINE-ONLY
 * states — the browser never queues or simulates.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { Button, Input } from "@erp/ui";

import { getDictionary, type Locale } from "../../i18n/dictionaries";
import { printHtmlDocument } from "../../lib/print-frame";
import type { DesktopBridge } from "../../lib/shell/bridge";
import {
  readAsOf,
  readCachedInvoice,
  readCachedItems,
  readCachedPartners,
  readSalesInvoices,
  type CachedInvoice,
  type CachedItem,
  type CachedPartner,
} from "../../lib/shell/store-client";
import { AsOfLabel } from "./as-of-label";
import { buildReprintHtml } from "./reprint-html";

export function CachedReads({
  locale,
  bridge,
  reloadKey,
  canPrint,
}: {
  locale: Locale;
  bridge: DesktopBridge | null;
  /** Bumped by the console on every mirror refresh. */
  reloadKey: number;
  canPrint: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const usable = bridge !== null && bridge.capabilities.sqlite === true;
  const [items, setItems] = useState<readonly CachedItem[]>([]);
  const [partners, setPartners] = useState<readonly CachedPartner[]>([]);
  const [invoices, setInvoices] = useState<readonly CachedInvoice[]>([]);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [itemsQuery, setItemsQuery] = useState("");
  const [partnersQuery, setPartnersQuery] = useState("");
  const [reprintNote, setReprintNote] = useState<string | null>(null);

  useEffect(() => {
    if (bridge === null || bridge.capabilities.sqlite !== true) return;
    let cancelled = false;
    void (async () => {
      const [nextItems, nextPartners, nextInvoices, stamp] = await Promise.all([
        readCachedItems(bridge),
        readCachedPartners(bridge),
        readSalesInvoices(bridge),
        readAsOf(bridge),
      ]);
      if (cancelled) return;
      setItems(nextItems);
      setPartners(nextPartners);
      setInvoices(nextInvoices);
      setAsOf(stamp);
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, reloadKey]);

  const needle = (value: string): string => value.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const q = needle(itemsQuery);
    if (q === "") return true;
    return (
      item.name.toLowerCase().includes(q) ||
      (item.nameAr ?? "").toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q)
    );
  });
  const filteredPartners = partners.filter((partner) => {
    const q = needle(partnersQuery);
    if (q === "") return true;
    return (
      partner.name.toLowerCase().includes(q) ||
      (partner.nameAr ?? "").toLowerCase().includes(q) ||
      partner.code.toLowerCase().includes(q)
    );
  });

  async function reprint(invoice: CachedInvoice): Promise<void> {
    if (bridge === null) return;
    if (invoice.status.toUpperCase() !== "POSTED") {
      setReprintNote(d.offlineReadsReprintNotPosted);
      return;
    }
    const fresh = await readCachedInvoice(bridge, invoice.id);
    if (fresh === null) {
      setReprintNote(d.offlineReadsReprintNotPosted);
      return;
    }
    const html = buildReprintHtml(fresh, new Date().toISOString());
    if (canPrint) {
      await bridge.print.printHtml(html);
    } else {
      printHtmlDocument(html);
    }
    setReprintNote(d.offlineReadsReprintSent);
  }

  return (
    <section lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-3">
      <h2 className="text-md font-semibold text-gray-900">{d.offlineReadsTitle}</h2>
      <p className="text-sm text-gray-600">{d.offlineReadsIntro}</p>
      {usable ? (
        <AsOfLabel locale={locale} asOf={asOf} />
      ) : (
        <span className="text-sm text-gray-500">{d.offlineReasonBrowser}</span>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-subtle bg-surface-card p-4">
          <Input
            label={d.offlineReadsSearchItems}
            value={itemsQuery}
            onValueChange={setItemsQuery}
            error={undefined}
          />
          {filteredItems.length === 0 ? (
            <p className="text-sm text-gray-500">{d.offlineReadsItemsEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filteredItems.slice(0, 50).map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline gap-2 text-sm text-gray-700">
                  <span dir="ltr" className="font-mono text-xs text-gray-500">
                    {item.sku}
                  </span>
                  <span>{locale === "ar" ? item.nameAr ?? item.name : item.name}</span>
                  {item.basePrice !== null && (
                    <span dir="ltr" className="font-mono text-xs tabular-nums text-gray-600">
                      {item.basePrice}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-subtle bg-surface-card p-4">
          <Input
            label={d.offlineReadsSearchPartners}
            value={partnersQuery}
            onValueChange={setPartnersQuery}
            error={undefined}
          />
          {filteredPartners.length === 0 ? (
            <p className="text-sm text-gray-500">{d.offlineReadsPartnersEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filteredPartners.slice(0, 50).map((partner) => (
                <li key={partner.id} className="flex flex-wrap items-baseline gap-2 text-sm text-gray-700">
                  <span dir="ltr" className="font-mono text-xs text-gray-500">
                    {partner.code}
                  </span>
                  <span>{locale === "ar" ? partner.nameAr ?? partner.name : partner.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-card p-4">
        <span className="text-sm font-semibold text-gray-900">{d.offlineReadsInvoicesTitle}</span>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-500">{d.offlineReadsInvoicesEmpty}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle text-start text-xs text-gray-600">
                  <th className="py-2 text-start">{d.offlineReadsColDocNo}</th>
                  <th className="py-2 text-start">{d.offlineReadsColStatus}</th>
                  <th className="py-2 text-start">{d.offlineReadsColDate}</th>
                  <th className="py-2 text-start">{d.offlineReadsColTotal}</th>
                  <th className="py-2 text-start">{d.offlineReadsColActions}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-subtle">
                    <td dir="ltr" className="py-2 font-mono text-xs text-gray-700">
                      {invoice.docNo ?? "—"}
                    </td>
                    <td className="py-2 text-xs text-gray-700">{invoice.status}</td>
                    <td dir="ltr" className="py-2 font-mono text-xs text-gray-700">
                      {invoice.issueDate ?? "—"}
                    </td>
                    <td dir="ltr" className="py-2 font-mono text-xs tabular-nums text-gray-900">
                      {invoice.totalGross ?? "—"}
                    </td>
                    <td className="py-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={invoice.status.toUpperCase() !== "POSTED"}
                        aria-label={
                          invoice.status.toUpperCase() !== "POSTED" ? d.offlineReadsReprintNotPosted : undefined
                        }
                        onClick={() => {
                          void reprint(invoice);
                        }}
                      >
                        {d.offlineReadsReprint}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {reprintNote !== null && (
          <p role="status" className="text-sm text-success-text">
            {reprintNote}
          </p>
        )}
      </div>
    </section>
  );
}
