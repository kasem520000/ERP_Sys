/**
 * PHASE-022 T-P22-2-e · CollectionScreen (MASTER-PLAN §8 — the field
 * collection; DR-P22-11 registry key "Collection"; OFFLINE_CAPABILITIES
 * row 9 OFFLINE-COMPLETE): the money-in receipt capture — amount, method,
 * reference, the oldest-first allocation PLAN (display — the statements
 * LITE projection carries no openItemId uuids; explicit allocations ride
 * the flow input), the open balance from the cached statement, and the
 * honest PENDING_SYNC badge on save (the RCV number exists only after the
 * server ACCEPTED).
 *
 * THIN by construction: the validation + save + the allocation plan are
 * the pure collection flow module. A FINANCIAL screen (2-b's
 * FINANCIAL_SCREENS).
 */
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { formatMoney, t, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Button, Card, Field, ListItem } from "../theme/primitives";
import { space, typeScale, colors } from "../theme/tokens";
import {
  planAllocationOldestFirst,
  saveFieldCollection,
  validateCollection,
  type CollectionMethod,
  type CollectionSaveResult,
} from "../fieldsales/collection";
import type { FieldFlowContext } from "../fieldsales/state-machine";
import { readStatement } from "../fieldsales/prevalidation";
import {
  AdvisoryBanner,
  AsOfLabel,
  BlockingBanner,
  SavedBanner,
  ScreenHeading,
  screenStyles,
} from "./chrome";

/** The Collection screen props. */
export interface CollectionScreenProps {
  locale: Locale;
  store: StorageAdapter;
  ctx: FieldFlowContext;
  /** The partner being collected from (the route visit's "collect here"). */
  partnerId: string;
  partnerName?: string | null;
  /** The initial method (defaults to CASH). */
  method?: CollectionMethod;
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

/** The Collection screen (DR-P22-11: "Collection"). */
export function CollectionScreen({
  locale,
  store,
  ctx,
  partnerId,
  partnerName,
  method,
}: CollectionScreenProps): ReactNode {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<CollectionMethod>(method ?? "CASH");
  const [saved, setSaved] = useState<CollectionSaveResult | null>(null);

  const statement = readStatement(store, partnerId);
  const plan = amount === "" ? null : planAllocationOldestFirst(store, partnerId, amount);
  // The live two-lane validation over the CURRENT input (advisories = the
  // BR-027 on-account warning; blocking refuses the save — the pure flow
  // module owns the logic).
  const liveValidation = validateCollection(store, ctx, {
    partnerId,
    method: selectedMethod,
    amount,
  });

  const save = (): void => {
    const result = saveFieldCollection(store, ctx, {
      partnerId,
      method: selectedMethod,
      amount,
      reference: selectedMethod === "TRANSFER" && reference !== "" ? reference : null,
    });
    setSaved(result);
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="collectionTitle" introKey="collectionIntro" />
      <View style={screenStyles.body}>
        <Card>
          <ListItem
            title={partnerName ?? statement?.customerName ?? partnerId}
            subtitle={
              statement?.closingBalance === null || statement?.closingBalance === undefined
                ? undefined
                : t(locale, "collectionOpenBalance", {
                    balance: formatMoney(locale, statement.closingBalance, statement.currencyCode ?? "SAR"),
                  })
            }
            accessibilityLabel={partnerName ?? partnerId}
            testID="collection-partner"
          />
          <AsOfLabel locale={locale} iso={statement?.asOf ?? null} />
        </Card>
        <Field label={t(locale, "collectionAmountLabel")}>
          <TextInput
            accessibilityLabel={t(locale, "collectionAmountLabel")}
            value={amount}
            onChangeText={setAmount}
            testID="collection-amount"
            style={inputStyle}
          />
        </Field>
        <Text style={screenStyles.metaText}>{t(locale, "collectionMethodLabel")}</Text>
        <View style={screenStyles.actionsRow}>
          <Button
            label={t(locale, "collectionMethodCash")}
            variant={selectedMethod === "CASH" ? "primary" : "secondary"}
            onPress={() => setSelectedMethod("CASH")}
            accessibilityLabel={t(locale, "collectionMethodCash")}
            testID="method-cash"
          />
          <Button
            label={t(locale, "collectionMethodTransfer")}
            variant={selectedMethod === "TRANSFER" ? "primary" : "secondary"}
            onPress={() => setSelectedMethod("TRANSFER")}
            accessibilityLabel={t(locale, "collectionMethodTransfer")}
            testID="method-transfer"
          />
        </View>
        {selectedMethod === "TRANSFER" ? (
          <Field label={t(locale, "collectionReferenceLabel")} hint={t(locale, "collectionReferencePlaceholder")}>
            <TextInput
              accessibilityLabel={t(locale, "collectionReferenceLabel")}
              value={reference}
              onChangeText={setReference}
              testID="collection-reference"
              style={inputStyle}
            />
          </Field>
        ) : null}
        {plan === null || plan.rows.length === 0 ? null : (
          <Card>
            <Text style={screenStyles.metaText}>{t(locale, "collectionAutoAllocate")}</Text>
            {plan.rows.map((row) => (
              <ListItem
                key={`${row.entryDate}-${row.docRef ?? ""}`}
                title={row.docRef ?? row.entryDate}
                subtitle={row.amount}
                accessibilityLabel={`${row.docRef ?? row.entryDate} ${row.amount}`}
                testID={`allocation-row-${row.docRef ?? row.entryDate}`}
              />
            ))}
            <Text style={screenStyles.metaText}>
              {t(locale, "collectionAllocated", { count: String(plan.rows.length), amount: plan.allocated })}
            </Text>
          </Card>
        )}
        <AdvisoryBanner locale={locale} issues={liveValidation.advisories} />
        <BlockingBanner locale={locale} issues={liveValidation.blocking} />
        <Button
          label={t(locale, "commonSave")}
          onPress={save}
          accessibilityLabel={t(locale, "commonSave")}
          testID="collection-save"
        />
        {saved === null ? null : saved.ok ? (
          <SavedBanner locale={locale} messageKey="collectionSavedLocal" state={saved.state ?? "PENDING_SYNC"} />
        ) : null}
      </View>
    </View>
  );
}
