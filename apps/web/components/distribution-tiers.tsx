"use client";

/**
 * PHASE-017 T14 (9a-dist) — customer tiers + the compact free-goods list:
 *
 * - the tier registry (code, price list, discount cap %, visit frequency,
 *   status) with a create/edit dialog — the tier's SALE price list is the
 *   BR-003 pricing seam; discount cap and visit frequency stay optional;
 * - the FOC rules list (buy X get Y) with a create dialog (item + qty
 *   pairs, per-multiple, max-free cap, target tier, reason code — BR-008
 *   requires the reason — and a validity window). Rules never post; the
 *   sale-time application computes the zero-price lines.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  NumberInput,
  Select,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CustomerTierRow,
  FreeGoodsRuleRow,
  ItemRow,
  PriceListRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isPositiveDecimal } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedDistributionError,
  localizedStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const CODE_RE = /^[A-Za-z0-9._-]{2,30}$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;

function itemLabel(item: ItemRow, locale: Locale): string {
  return `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`;
}

export function DistributionTiers({
  locale,
  initialTiers,
  initialRules,
  priceLists,
  items,
}: {
  locale: Locale;
  initialTiers: readonly CustomerTierRow[];
  initialRules: readonly FreeGoodsRuleRow[];
  priceLists: readonly PriceListRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [tiers, setTiers] = useState<readonly CustomerTierRow[]>(initialTiers);
  const [rules, setRules] = useState<readonly FreeGoodsRuleRow[]>(initialRules);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Tier dialog state (create when editing === null).
  const [tierOpen, setTierOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerTierRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [discountCap, setDiscountCap] = useState("");
  const [visitFrequency, setVisitFrequency] = useState("");

  // FOC dialog state.
  const [focOpen, setFocOpen] = useState(false);
  const [focCode, setFocCode] = useState("");
  const [focName, setFocName] = useState("");
  const [focNameAr, setFocNameAr] = useState("");
  const [buyItemId, setBuyItemId] = useState("");
  const [buyQty, setBuyQty] = useState("");
  const [getItemId, setGetItemId] = useState("");
  const [getQty, setGetQty] = useState("");
  const [perMultiple, setPerMultiple] = useState(false);
  const [maxFree, setMaxFree] = useState("");
  const [tierId, setTierId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const tierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tier of tiers) {
      map.set(tier.id, localizedName(tier.name, tier.nameAr, locale));
    }
    return map;
  }, [tiers, locale]);

  const codeValid = CODE_RE.test(code.trim());
  const discountCapValid = discountCap === "" || (PCT_RE.test(discountCap) && Number(discountCap) <= 100);
  const frequencyValid =
    visitFrequency === "" || (Number.isInteger(Number(visitFrequency)) && Number(visitFrequency) >= 0 && Number(visitFrequency) <= 365);
  const tierReady =
    (editing !== null || codeValid) &&
    name.trim() !== "" &&
    discountCapValid &&
    frequencyValid;
  const windowSane = validFrom === "" || validTo === "" || validFrom <= validTo;
  const focCodeValid = CODE_RE.test(focCode.trim());
  const qtyValid = isPositiveDecimal(buyQty) && isPositiveDecimal(getQty);
  const maxFreeValid = maxFree === "" || /^\d+(\.\d{1,6})?$/.test(maxFree);
  const reasonValid = reasonCode.trim().length >= 1 && reasonCode.trim().length <= 30;
  const focReady =
    focCodeValid &&
    focName.trim() !== "" &&
    buyItemId !== "" &&
    getItemId !== "" &&
    qtyValid &&
    maxFreeValid &&
    reasonValid &&
    windowSane;

  // -- tiers ------------------------------------------------------------------------------

  function openCreateTier(): void {
    setEditing(null);
    setCode("");
    setName("");
    setNameAr("");
    setPriceListId("");
    setDiscountCap("");
    setVisitFrequency("");
    setTierOpen(true);
  }

  function openEditTier(row: CustomerTierRow): void {
    setEditing(row);
    setCode(row.code);
    setName(row.name);
    setNameAr(row.nameAr ?? "");
    setPriceListId(row.priceListId ?? "");
    setDiscountCap(row.discountCapPct ?? "");
    setVisitFrequency(row.visitFrequencyDays === null ? "" : String(row.visitFrequencyDays));
    setTierOpen(true);
  }

  async function saveTier(): Promise<void> {
    if (!tierReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("tier");
    setError(null);
    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() === "" ? null : nameAr.trim(),
      priceListId: priceListId === "" ? null : priceListId,
      discountCapPct: discountCap.trim() === "" ? null : discountCap.trim(),
      visitFrequencyDays:
        visitFrequency.trim() === "" ? null : Number(visitFrequency.trim()),
    };
    const result =
      editing === null
        ? await bffFetch<CustomerTierRow>("distribution/tiers", {
            method: "POST",
            body: { code: code.trim(), ...body },
          })
        : await bffFetch<CustomerTierRow>(`distribution/tiers/${editing.id}`, {
            method: "PUT",
            body: { ...body, status: undefined },
          });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTiers((current) =>
      editing === null
        ? [result.data, ...current]
        : current.map((row) => (row.id === editing.id ? result.data : row)),
    );
    setTierOpen(false);
    setNotice(formatMessage(d.distTiersSavedToast, { code: result.data.code }));
  }

  // -- free goods ---------------------------------------------------------------------------

  async function saveFoc(): Promise<void> {
    if (!focReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("foc");
    setError(null);
    const result = await bffFetch<FreeGoodsRuleRow>("distribution/free-goods-rules", {
      method: "POST",
      body: {
        code: focCode.trim(),
        name: focName.trim(),
        nameAr: focNameAr.trim() === "" ? null : focNameAr.trim(),
        buyItemId,
        buyQty,
        getItemId,
        getQty,
        perMultiple,
        maxFreePerOrder: maxFree.trim() === "" ? null : maxFree.trim(),
        tierId: tierId === "" ? null : tierId,
        reasonCode: reasonCode.trim(),
        validFrom: validFrom === "" ? null : validFrom,
        validTo: validTo === "" ? null : validTo,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRules((current) => [result.data, ...current]);
    setFocOpen(false);
    setFocCode("");
    setFocName("");
    setFocNameAr("");
    setBuyItemId("");
    setBuyQty("");
    setGetItemId("");
    setGetQty("");
    setPerMultiple(false);
    setMaxFree("");
    setTierId("");
    setReasonCode("");
    setValidFrom("");
    setValidTo("");
    setNotice(formatMessage(d.distFocSavedToast, { code: result.data.code }));
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.distributionTiersTitle}
        actions={
          <Button variant="primary" onClick={openCreateTier}>
            {d.distTiersCreate}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.distTiersCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.distTiersName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "list",
              header: activeLocaleHeader(d.distTiersPriceList),
              accessor: (row) => row.priceListName ?? "—",
            },
            {
              id: "cap",
              header: activeLocaleHeader(d.distTiersDiscountCap),
              accessor: (row) => row.discountCapPct ?? "—",
              numeric: true,
              render: (row) =>
                row.discountCapPct === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.discountCapPct}%
                  </span>
                ),
            },
            {
              id: "freq",
              header: activeLocaleHeader(d.distTiersVisitFrequency),
              accessor: (row) => String(row.visitFrequencyDays ?? ""),
              numeric: true,
              render: (row) =>
                row.visitFrequencyDays === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.visitFrequencyDays}
                  </span>
                ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                  {localizedStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...tiers]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "edit",
              label: d.distTiersEdit,
              onSelect: (row) => openEditTier(row),
            },
          ]}
          empty={{ title: d.distTiersEmpty }}
        />
      </Card>

      <Card
        title={d.distFocTitle}
        actions={
          <Button variant="primary" onClick={() => setFocOpen(true)}>
            {d.distFocCreate}
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "code",
              header: activeLocaleHeader(d.distFocCode),
              accessor: (row) => row.code,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.code}
                </span>
              ),
            },
            {
              id: "name",
              header: activeLocaleHeader(d.distFocName),
              accessor: (row) => localizedName(row.name, row.nameAr, locale),
            },
            {
              id: "buy",
              header: activeLocaleHeader(d.distFocBuy),
              accessor: (row) => `${row.buyItemSku ?? ""} × ${row.buyQty}`,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.buyItemSku ?? "—"} × {row.buyQty}
                </span>
              ),
            },
            {
              id: "get",
              header: activeLocaleHeader(d.distFocGet),
              accessor: (row) => `${row.getItemSku ?? ""} × ${row.getQty}`,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.getItemSku ?? "—"} × {row.getQty}
                </span>
              ),
            },
            {
              id: "multiple",
              header: activeLocaleHeader(d.distFocPerMultiple),
              accessor: (row) => (row.perMultiple ? "1" : "0"),
              render: (row) => (row.perMultiple ? <Badge tone="primary">{d.distFocPerMultiple}</Badge> : <span className="text-gray-500">—</span>),
            },
            {
              id: "maxFree",
              header: activeLocaleHeader(d.distFocMaxFree),
              accessor: (row) => row.maxFreePerOrder ?? "",
              numeric: true,
              render: (row) =>
                row.maxFreePerOrder === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono tabular-nums" dir="ltr">
                    {row.maxFreePerOrder}
                  </span>
                ),
            },
            {
              id: "tier",
              header: activeLocaleHeader(d.distFocTier),
              accessor: (row) => row.tierCode ?? "",
              render: (row) =>
                row.tierId === null ? (
                  <span className="text-gray-500">{d.distFocAnyTier}</span>
                ) : (
                  <span>{tierNameById.get(row.tierId) ?? row.tierCode}</span>
                ),
            },
            {
              id: "reason",
              header: activeLocaleHeader(d.distFocReason),
              accessor: (row) => row.reasonCode,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.reasonCode}
                </span>
              ),
            },
            {
              id: "window",
              header: activeLocaleHeader(`${d.distFocValidFrom} → ${d.distFocValidTo}`),
              accessor: (row) => `${row.validFrom ?? ""}..${row.validTo ?? ""}`,
              mono: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.validFrom ?? "—"} → {row.validTo ?? "—"}
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.accountingColStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                  {localizedStatus(d, row.status)}
                </Badge>
              ),
            },
          ]}
          rows={[...rules]}
          rowKey={(row) => row.id}
          empty={{ title: d.distFocEmpty }}
        />
      </Card>

      {/* -- tier create/edit dialog -------------------------------------------------- */}
      <Dialog
        open={tierOpen}
        onOpenChange={(open) => {
          if (!open) setTierOpen(false);
        }}
        title={editing === null ? d.distTiersCreate : d.distTiersEdit}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {editing === null ? (
            <Input
              label={d.distTiersCode}
              value={code}
              onValueChange={setCode}
              error={code !== "" && !codeValid ? d.errorsValidation : undefined}
              mono
              bidiIsolate
              required
            />
          ) : (
            <Input label={d.distTiersCode} value={code} readOnly mono bidiIsolate />
          )}
          <Input label={d.distTiersName} value={name} onValueChange={setName} required />
          <Input label={`${d.distTiersName} (AR)`} value={nameAr} onValueChange={setNameAr} />
          <Select
            label={d.distTiersPriceList}
            value={priceListId}
            onValueChange={setPriceListId}
            placeholder="—"
            options={priceLists.map((list) => ({
              value: list.id,
              label: `${localizedName(list.name, list.nameAr, locale)} · ${list.currencyCode}`,
            }))}
          />
          <Input
            label={d.distTiersDiscountCap}
            value={discountCap}
            onValueChange={setDiscountCap}
            hint={d.distTiersDiscountCapHint}
            error={discountCap !== "" && !discountCapValid ? d.errorsValidation : undefined}
            inputMode="decimal"
            mono
            bidiIsolate
          />
          <NumberInput
            label={d.distTiersVisitFrequency}
            value={visitFrequency}
            onValueChange={setVisitFrequency}
            hint={d.distTiersVisitFrequencyHint}
            error={visitFrequency !== "" && !frequencyValid ? d.errorsValidation : undefined}
            min={0}
            max={365}
            step={1}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTierOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "tier"}
            disabled={!tierReady}
            onClick={() => void saveTier()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- FOC create dialog -------------------------------------------------- */}
      <Dialog
        open={focOpen}
        onOpenChange={(open) => {
          if (!open) setFocOpen(false);
        }}
        title={d.distFocCreate}
        size="lg"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.distFocCode}
            value={focCode}
            onValueChange={setFocCode}
            error={focCode !== "" && !focCodeValid ? d.errorsValidation : undefined}
            mono
            bidiIsolate
            required
          />
          <Input label={d.distFocName} value={focName} onValueChange={setFocName} required />
          <Input label={`${d.distFocName} (AR)`} value={focNameAr} onValueChange={setFocNameAr} />
          <Input
            label={d.distFocReason}
            value={reasonCode}
            onValueChange={setReasonCode}
            hint={d.distFocReasonHint}
            error={reasonCode !== "" && !reasonValid ? d.errorsValidation : undefined}
            mono
            bidiIsolate
            required
          />
          <Select
            label={d.distFocBuy}
            value={buyItemId}
            onValueChange={setBuyItemId}
            placeholder="—"
            options={items.map((item) => ({ value: item.id, label: itemLabel(item, locale) }))}
            required
          />
          <Input
            label={d.distFocBuyQty}
            value={buyQty}
            onValueChange={setBuyQty}
            error={buyQty !== "" && !isPositiveDecimal(buyQty) ? d.errorsValidation : undefined}
            inputMode="decimal"
            mono
            bidiIsolate
            required
          />
          <Select
            label={d.distFocGet}
            value={getItemId}
            onValueChange={setGetItemId}
            placeholder="—"
            options={items.map((item) => ({ value: item.id, label: itemLabel(item, locale) }))}
            required
          />
          <Input
            label={d.distFocGetQty}
            value={getQty}
            onValueChange={setGetQty}
            error={getQty !== "" && !isPositiveDecimal(getQty) ? d.errorsValidation : undefined}
            inputMode="decimal"
            mono
            bidiIsolate
            required
          />
          <Input
            label={d.distFocMaxFree}
            value={maxFree}
            onValueChange={setMaxFree}
            hint={d.distFocMaxFreeHint}
            error={maxFree !== "" && !maxFreeValid ? d.errorsValidation : undefined}
            inputMode="decimal"
            mono
            bidiIsolate
          />
          <Select
            label={d.distFocTier}
            value={tierId}
            onValueChange={setTierId}
            placeholder={d.distFocAnyTier}
            options={tiers
              .filter((tier) => tier.status === "ACTIVE")
              .map((tier) => ({
                value: tier.id,
                label: `${tierNameById.get(tier.id) ?? tier.name} · ${tier.code}`,
              }))}
          />
          <DatePicker
            locale={locale}
            label={d.distFocValidFrom}
            value={validFrom}
            onSelect={setValidFrom}
          />
          <DatePicker
            locale={locale}
            label={d.distFocValidTo}
            value={validTo}
            onSelect={setValidTo}
            min={validFrom === "" ? undefined : validFrom}
            error={windowSane ? undefined : d.errorsValidation}
          />
        </div>
        <div className="mt-3">
          <Checkbox
            label={d.distFocPerMultiple}
            checked={perMultiple}
            onCheckedChange={(checked) => setPerMultiple(checked === true)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFocOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "foc"}
            disabled={!focReady}
            onClick={() => void saveFoc()}
          >
            {d.distFocCreate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
