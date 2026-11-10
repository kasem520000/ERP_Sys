/**
 * PHASE-022 T-P22-2-e · ReturnsScreen (MASTER-PLAN §8 — the van-return
 * credit-note draft; DR-P22-11 registry key "ReturnsDraft";
 * OFFLINE_CAPABILITIES row 27 OFFLINE-DRAFT): the DRAFT credit-note
 * capture against the ORIGINAL posted invoice — the invoice reference +
 * per-line {invoiceLineId, qty, returnToStock, batch/serial} + the reason
 * note. The machine is `DRAFT_LOCAL → DRAFT` (posting stays online); the
 * saved banner renders the honest PENDING_SYNC chip.
 *
 * The restock picker (van / warehouse / none) maps to the per-line
 * `returnToStock` BOOLEAN — the wire contract carries no destination field
 * (the W-3 re-entry destination is server-resolved at posting; the flow
 * module's header records the honesty note). THIN by construction: the
 * validation + save are the pure returns flow module. A FINANCIAL screen
 * (2-b's FINANCIAL_SCREENS).
 */
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { t, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Button, Card, EmptyState, Field } from "../theme/primitives";
import { space, typeScale, colors } from "../theme/tokens";
import {
  saveReturnDraft,
  type ReturnSaveResult,
} from "../fieldsales/returns";
import type { FieldFlowContext } from "../fieldsales/state-machine";
import {
  BlockingBanner,
  SavedBanner,
  ScreenHeading,
  screenStyles,
} from "./chrome";

/** One return line's editing state. */
interface ReturnLineState {
  readonly invoiceLineId: string;
  readonly qty: string;
  /** none | van | warehouse — van/warehouse map to returnToStock: true. */
  readonly restock: "none" | "van" | "warehouse";
  readonly serial: string;
  readonly batch: string;
}

/** The Returns screen props. */
export interface ReturnsScreenProps {
  locale: Locale;
  store: StorageAdapter;
  ctx: FieldFlowContext;
  /** The original invoice reference (pre-filled when navigated with one). */
  invoiceId?: string;
}

const inputStyle = {
  minHeight: 44,
  paddingStart: space[3],
  paddingEnd: space[3],
  paddingTop: space[2],
  paddingBottom: space[2],
  borderWidth: 1,
  fontSize: typeScale.base.fontSize,
  color: colors.gray[900],
} as const;

/** One return line editor. */
function ReturnLineEditor({ locale, index, line, onChange }: {
  locale: Locale;
  index: number;
  line: ReturnLineState;
  onChange: (line: ReturnLineState) => void;
}): ReactNode {
  return (
    <Card style={{ marginBottom: space[3] }} testID={`return-line-${index}`}>
      <Field label={t(locale, "commonItem")}>
        <TextInput
          accessibilityLabel={t(locale, "commonItem")}
          value={line.invoiceLineId}
          onChangeText={(invoiceLineId) => onChange({ ...line, invoiceLineId })}
          testID={`return-line-id-${index}`}
          style={inputStyle}
        />
      </Field>
      <Field label={t(locale, "commonQuantity")}>
        <TextInput
          accessibilityLabel={t(locale, "commonQuantity")}
          value={line.qty}
          onChangeText={(qty) => onChange({ ...line, qty })}
          testID={`return-qty-${index}`}
          style={inputStyle}
        />
      </Field>
      <Text style={screenStyles.metaText}>{t(locale, "returnsRestockLabel")}</Text>
      <View style={screenStyles.actionsRow}>
        <Button
          label={t(locale, "commonNone")}
          variant={line.restock === "none" ? "primary" : "secondary"}
          onPress={() => onChange({ ...line, restock: "none" })}
          accessibilityLabel={t(locale, "commonNone")}
          testID={`restock-none-${index}`}
        />
        <Button
          label={t(locale, "returnsRestockVan")}
          variant={line.restock === "van" ? "primary" : "secondary"}
          onPress={() => onChange({ ...line, restock: "van" })}
          accessibilityLabel={t(locale, "returnsRestockVan")}
          testID={`restock-van-${index}`}
        />
        <Button
          label={t(locale, "returnsRestockWarehouse")}
          variant={line.restock === "warehouse" ? "primary" : "secondary"}
          onPress={() => onChange({ ...line, restock: "warehouse" })}
          accessibilityLabel={t(locale, "returnsRestockWarehouse")}
          testID={`restock-warehouse-${index}`}
        />
      </View>
      <Field label={t(locale, "commonSerial")}>
        <TextInput
          accessibilityLabel={t(locale, "commonSerial")}
          value={line.serial}
          onChangeText={(serial) => onChange({ ...line, serial })}
          testID={`return-serial-${index}`}
          style={inputStyle}
        />
      </Field>
      <Field label={t(locale, "commonBatch")}>
        <TextInput
          accessibilityLabel={t(locale, "commonBatch")}
          value={line.batch}
          onChangeText={(batch) => onChange({ ...line, batch })}
          testID={`return-batch-${index}`}
          style={inputStyle}
        />
      </Field>
    </Card>
  );
}

/** The Returns screen (DR-P22-11: "ReturnsDraft"). */
export function ReturnsScreen({ locale, store, ctx, invoiceId }: ReturnsScreenProps): ReactNode {
  const [invoiceRef, setInvoiceRef] = useState(invoiceId ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<ReturnLineState[]>([
    { invoiceLineId: "", qty: "", restock: "van", serial: "", batch: "" },
  ]);
  const [saved, setSaved] = useState<ReturnSaveResult | null>(null);

  const save = (): void => {
    const result = saveReturnDraft(store, ctx, {
      invoiceId: invoiceRef,
      note: reason === "" ? null : reason,
      lines: lines
        .filter((line) => line.invoiceLineId !== "")
        .map((line) => ({
          invoiceLineId: line.invoiceLineId,
          qty: line.qty === "" ? "0" : line.qty,
          returnToStock: line.restock !== "none",
          batchId: line.batch === "" ? null : line.batch,
          serialIds: line.serial === "" ? [] : line.serial.split(",").map((serial) => serial.trim()).filter((serial) => serial !== ""),
        })),
    });
    setSaved(result);
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="returnsTitle" introKey="returnsIntro" />
      <View style={screenStyles.body}>
        <Field label={t(locale, "returnsPickInvoice")} hint={t(locale, "returnsOriginalRequired")}>
          <TextInput
            accessibilityLabel={t(locale, "returnsPickInvoice")}
            value={invoiceRef}
            onChangeText={setInvoiceRef}
            testID="return-invoice-input"
            style={inputStyle}
          />
        </Field>
        <Field label={t(locale, "returnsReasonLabel")} hint={t(locale, "returnsReasonPlaceholder")}>
          <TextInput
            accessibilityLabel={t(locale, "returnsReasonLabel")}
            value={reason}
            onChangeText={setReason}
            testID="return-reason-input"
            style={inputStyle}
          />
        </Field>
        {lines.length === 0 ? (
          <EmptyState title={t(locale, "countEmpty")} />
        ) : (
          lines.map((line, index) => (
            <ReturnLineEditor
              key={index}
              locale={locale}
              index={index}
              line={line}
              onChange={(next) => setLines(lines.map((prior, i) => (i === index ? next : prior)))}
            />
          ))
        )}
        <Button
          label={t(locale, "commonAdd")}
          variant="secondary"
          onPress={() => setLines([...lines, { invoiceLineId: "", qty: "", restock: "van", serial: "", batch: "" }])}
          accessibilityLabel={t(locale, "commonAdd")}
          testID="return-add-line"
        />
        {saved === null ? null : saved.ok ? null : <BlockingBanner locale={locale} issues={saved.blocking} />}
        <Button
          label={t(locale, "commonSave")}
          onPress={save}
          accessibilityLabel={t(locale, "commonSave")}
          testID="return-save"
        />
        {saved === null ? null : saved.ok ? (
          <SavedBanner locale={locale} messageKey="returnsSavedLocal" state={saved.state ?? "PENDING_SYNC"} />
        ) : null}
      </View>
    </View>
  );
}
