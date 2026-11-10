"use client";

/**
 * PHASE-027 (wave F) — note create form (PAGE_ARCHETYPES §3, the
 * treasury-doc-form pattern): the direction switch drives the receive-
 * against-invoice vs issue-against-supplier-invoice source picker (posted
 * CREDIT sales invoices vs posted supplier invoices — the exact document
 * sets the API's source validation accepts); picking a source locks the
 * partner + currency from the document. POST notes creates the note
 * IN_CUSTODY with its G-24/G-27 entry (the single-source default allocation
 * is the server's — the form never fabricates open-item splits). Money
 * inputs are canonical decimal strings (MoneyInput, ADR-0009).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Button, Input, MoneyInput, Select, formatMoneyDisplay, useToast } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PartnerRow, SalesInvoiceRow, SupplierInvoiceRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isPositiveDecimal } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedNoteDirection,
  localizedNoteKind,
  localizedNotesError,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";

export function NoteForm({
  locale,
  partners,
  salesInvoices,
  supplierInvoices,
  baseCurrency,
  today,
}: {
  locale: Locale;
  partners: readonly PartnerRow[];
  salesInvoices: readonly SalesInvoiceRow[];
  supplierInvoices: readonly SupplierInvoiceRow[];
  baseCurrency: string;
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const { toast } = useToast();
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [direction, setDirection] = useState<"RECEIVED" | "ISSUED">("RECEIVED");
  const [kind, setKind] = useState<"CHEQUE" | "PROMISSORY_NOTE">("CHEQUE");
  const [partnerId, setPartnerId] = useState("");
  const [number, setNumber] = useState("");
  const [issuingBank, setIssuingBank] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState(currency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");
  const [note, setNote] = useState("");
  const [noteAr, setNoteAr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const partnerOptions = useMemo(() => {
    const wanted = direction === "RECEIVED" ? ["CUSTOMER", "BOTH"] : ["SUPPLIER", "BOTH"];
    return partners
      .filter((partner) => wanted.includes(partner.kind))
      .map((partner) => ({
        value: partner.id,
        label:
          partner.code === ""
            ? localizedName(partner.name, partner.nameAr, locale)
            : `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`,
      }));
  }, [partners, direction, locale]);

  const sourceOptions = useMemo(() => {
    if (direction === "RECEIVED") {
      return salesInvoices.map((invoice) => ({
        value: invoice.id,
        label: `${invoice.invoiceNo ?? invoice.id} · ${formatMoneyDisplay(invoice.totalGross, 2)} ${invoice.currencyCode}`,
      }));
    }
    return supplierInvoices.map((invoice) => ({
      value: invoice.id,
      label: `${invoice.invoiceNo} · ${formatMoneyDisplay(invoice.totalGross, 2)} ${invoice.currencyCode}`,
    }));
  }, [direction, salesInvoices, supplierInvoices]);

  // Picking a source document locks the partner + currency (the server
  // rejects mismatches with NOTE_SOURCE_INVALID/NOTE_CURRENCY_MISMATCH —
  // the form simply prevents the obvious ones).
  function pickSource(value: string): void {
    setSourceInvoiceId(value);
    if (value === "") {
      return;
    }
    if (direction === "RECEIVED") {
      const invoice = salesInvoices.find((row) => row.id === value);
      if (invoice !== undefined) {
        setPartnerId(invoice.customerId);
        setCurrencyCode(invoice.currencyCode);
      }
    } else {
      const invoice = supplierInvoices.find((row) => row.id === value);
      if (invoice !== undefined) {
        setPartnerId(invoice.supplierId);
        setCurrencyCode(invoice.currencyCode);
      }
    }
  }

  const formReady =
    partnerId !== "" &&
    currencyCode.trim().length === 3 &&
    amount !== "" &&
    isPositiveDecimal(amount) &&
    maturityDate !== "";

  async function save(): Promise<void> {
    setError(null);
    if (!formReady) {
      setError(d.notesFormInvalid);
      return;
    }
    setBusy(true);
    const created = await bffFetch<{ note: { id: string } }>("notes", {
      method: "POST",
      body: {
        direction,
        kind,
        partnerId,
        number: number.trim() === "" ? null : number.trim(),
        issuingBank: issuingBank.trim() === "" ? null : issuingBank.trim(),
        amount,
        currency: currencyCode.trim().toUpperCase(),
        exchangeRate: exchangeRate.trim() === "" ? undefined : exchangeRate.trim(),
        issueDate: issueDate === "" ? undefined : issueDate,
        maturityDate,
        sourceInvoiceId: sourceInvoiceId === "" ? null : sourceInvoiceId,
        note: note.trim() === "" ? null : note.trim(),
        noteAr: noteAr.trim() === "" ? null : noteAr.trim(),
      },
    });
    setBusy(false);
    if (!created.ok) {
      setError(localizedNotesError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({
      tone: "success",
      title: formatMessage(d.notesFormCreatedToast, {
        number: number.trim() === "" ? created.data.note.id : number.trim(),
      }),
    });
    router.push(`/${locale}/notes/${created.data.note.id}`);
  }

  return (
    <Card title={d.notesNewTitle} description={d.notesFormDirectionHint}>
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            id="note-form-direction"
            label={d.notesFormDirection}
            value={direction}
            onValueChange={(value) => {
              setDirection(value === "ISSUED" ? "ISSUED" : "RECEIVED");
              setSourceInvoiceId("");
            }}
            options={[
              { value: "RECEIVED", label: localizedNoteDirection(d, "RECEIVED") },
              { value: "ISSUED", label: localizedNoteDirection(d, "ISSUED") },
            ]}
            required
          />
          <Select
            id="note-form-kind"
            label={d.notesFilterKind}
            value={kind}
            onValueChange={(value) => setKind(value === "PROMISSORY_NOTE" ? "PROMISSORY_NOTE" : "CHEQUE")}
            options={[
              { value: "CHEQUE", label: localizedNoteKind(d, "CHEQUE") },
              { value: "PROMISSORY_NOTE", label: localizedNoteKind(d, "PROMISSORY_NOTE") },
            ]}
            required
          />
          <Select
            id="note-form-partner"
            label={d.notesFormPartner}
            value={partnerId}
            onValueChange={setPartnerId}
            options={[{ value: "", label: d.kindFilterAll }, ...partnerOptions]}
            required
          />
          <Input
            id="note-form-number"
            label={d.notesFormNumber}
            value={number}
            onValueChange={setNumber}
            hint={d.notesFormNumberHint}
            mono
            bidiIsolate
          />
          <Input
            id="note-form-bank"
            label={d.notesFormBank}
            value={issuingBank}
            onValueChange={setIssuingBank}
            hint={d.notesFormBankHint}
          />
          <Input
            id="note-form-currency"
            label={d.notesFormCurrency}
            value={currencyCode}
            onValueChange={setCurrencyCode}
            placeholder={currency}
            hint={d.notesFormRateHint}
            mono
            bidiIsolate
            required
          />
          <MoneyInput
            id="note-form-amount"
            label={d.notesFormAmount}
            amount={amount}
            onAmountChange={setAmount}
            currency={currencyCode.trim() === "" ? currency : currencyCode.trim().toUpperCase()}
            required
          />
          <Input
            id="note-form-rate"
            label={d.notesFormRate}
            value={exchangeRate}
            onValueChange={setExchangeRate}
            hint={d.notesFormRateHint}
            mono
            bidiIsolate
          />
          <Input
            id="note-form-issue-date"
            label={d.notesFormIssueDate}
            value={issueDate}
            onValueChange={setIssueDate}
            placeholder="YYYY-MM-DD"
            mono
            bidiIsolate
          />
          <Input
            id="note-form-maturity"
            label={d.notesFormMaturityDate}
            value={maturityDate}
            onValueChange={setMaturityDate}
            placeholder={today}
            mono
            bidiIsolate
            required
          />
          <Select
            id="note-form-source"
            label={d.notesFormSourceInvoice}
            value={sourceInvoiceId}
            onValueChange={pickSource}
            options={[
              { value: "", label: d.notesFormSourceNone },
              ...sourceOptions,
            ]}
            hint={d.notesFormSourceInvoiceHint}
          />
          <Input
            id="note-form-note"
            label={d.notesFormNote}
            value={note}
            onValueChange={setNote}
          />
          <Input
            id="note-form-note-ar"
            label={d.notesFormNoteAr}
            value={noteAr}
            onValueChange={setNoteAr}
          />
        </div>
        {sourceOptions.length === 0 && (
          <InfoNotice>{d.pickerEmptyText}</InfoNotice>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {d.notesFormSubmit}
          </Button>
        </div>
      </div>
    </Card>
  );
}
