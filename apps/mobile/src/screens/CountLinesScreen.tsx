/**
 * PHASE-022 T-P22-2-e · CountLinesScreen (MASTER-PLAN §8 — the stock-count
 * line entry; DR-P22-11 registry key "CountLines"; OFFLINE_CAPABILITIES
 * row 11 OFFLINE-DRAFT): the counted FACTS against an existing count
 * session — scan-to-count (the injected barcode port), per-line counted
 * qty + optional batch ref. NO variance math (server-only — the intro
 * string carries the honesty note); a counted zero is a legitimate loss.
 * The machine is `DRAFT_LOCAL → DRAFT`; the saved banner renders the
 * honest PENDING_SYNC chip.
 *
 * THIN by construction: the scan resolution, the structural gate and the
 * save are the pure count-lines flow module. NOT a financial screen (2-b's
 * FINANCIAL_SCREENS list).
 */
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { t, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Button, Card, EmptyState, Field, ListItem } from "../theme/primitives";
import { space, typeScale, colors } from "../theme/tokens";
import {
  saveCountLines,
  scanCountItem,
  type CountSaveResult,
} from "../fieldsales/count-lines";
import type { FieldFlowContext } from "../fieldsales/state-machine";
import type { BarcodeScannerPort } from "../fieldsales/ports";
import {
  BlockingBanner,
  SavedBanner,
  ScreenHeading,
  screenStyles,
} from "./chrome";

/** One counted line's editing state. */
interface CountLineState {
  readonly itemId: string;
  readonly itemName: string;
  readonly countedQty: string;
  readonly batchRef: string;
}

/** The CountLines screen props. */
export interface CountLinesScreenProps {
  locale: Locale;
  store: StorageAdapter;
  ctx: FieldFlowContext;
  /** The barcode port (device: camera; tests: the scripted fake). */
  scanner?: BarcodeScannerPort;
  /** The count session reference (pre-filled when navigated with one). */
  countId?: string;
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

/** One counted-line editor. */
function CountLineEditor({ locale, index, line, onChange }: {
  locale: Locale;
  index: number;
  line: CountLineState;
  onChange: (line: CountLineState) => void;
}): ReactNode {
  return (
    <View style={{ marginBottom: space[3] }} testID={`count-line-${index}`}>
      <ListItem
        title={line.itemName === "" ? line.itemId : line.itemName}
        subtitle={line.itemId}
        accessibilityLabel={line.itemName === "" ? line.itemId : line.itemName}
        testID={`count-row-${index}`}
      />
      <Field label={t(locale, "countQtyLabel")}>
        <TextInput
          accessibilityLabel={t(locale, "countQtyLabel")}
          value={line.countedQty}
          onChangeText={(countedQty) => onChange({ ...line, countedQty })}
          testID={`count-qty-${index}`}
          style={inputStyle}
        />
      </Field>
      <Field label={t(locale, "countBatchLabel")}>
        <TextInput
          accessibilityLabel={t(locale, "countBatchLabel")}
          value={line.batchRef}
          onChangeText={(batchRef) => onChange({ ...line, batchRef })}
          testID={`count-batch-${index}`}
          style={inputStyle}
        />
      </Field>
    </View>
  );
}

/** The CountLines screen (DR-P22-11: "CountLines"). */
export function CountLinesScreen({ locale, store, ctx, scanner, countId }: CountLinesScreenProps): ReactNode {
  const [sessionRef, setSessionRef] = useState(countId ?? "");
  const [lines, setLines] = useState<CountLineState[]>([]);
  const [saved, setSaved] = useState<CountSaveResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScan = (): void => {
    if (scanner === undefined) {
      setScanError(t(locale, "scannerPermissionNeeded"));
      return;
    }
    setScanError(null);
    void scanner
      .scan()
      .then((result) => {
        const item = scanCountItem(store, result.code);
        if (item === undefined) {
          setScanError(t(locale, "countUnknownBarcode"));
          return;
        }
        setLines((prior) => {
          if (prior.some((line) => line.itemId === item.id)) return prior;
          return [...prior, { itemId: item.id, itemName: item.name, countedQty: "", batchRef: "" }];
        });
      })
      .catch(() => {
        setScanError(t(locale, "scannerPermissionNeeded"));
      });
  };

  const submit = (): void => {
    const result = saveCountLines(store, ctx, {
      countId: sessionRef,
      lines: lines
        .filter((line) => line.itemId !== "")
        .map((line) => ({
          itemId: line.itemId,
          countedQty: line.countedQty === "" ? "0" : line.countedQty,
          batchRef: line.batchRef === "" ? null : line.batchRef,
        })),
    });
    setSaved(result);
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="countTitle" introKey="countIntro" />
      <View style={screenStyles.body}>
        <Field label={t(locale, "commonStatus")} hint={t(locale, "countIntro")}>
          <TextInput
            accessibilityLabel={t(locale, "commonStatus")}
            value={sessionRef}
            onChangeText={setSessionRef}
            testID="count-session-input"
            style={inputStyle}
          />
        </Field>
        <Button
          label={t(locale, "vanSaleScanButton")}
          onPress={handleScan}
          accessibilityLabel={t(locale, "vanSaleScanButton")}
          testID="count-scan-button"
        />
        {scanError === null ? null : (
          <Text style={screenStyles.bannerText} accessibilityLabel={scanError}>
            {scanError}
          </Text>
        )}
        {lines.length === 0 ? (
          <EmptyState title={t(locale, "countEmpty")} />
        ) : (
          <Card>
            {lines.map((line, index) => (
              <CountLineEditor
                key={line.itemId}
                locale={locale}
                index={index}
                line={line}
                onChange={(next) => setLines(lines.map((prior, i) => (i === index ? next : prior)))}
              />
            ))}
          </Card>
        )}
        <Button
          label={t(locale, "countAddLine")}
          variant="secondary"
          onPress={() => setLines([...lines, { itemId: "", itemName: "", countedQty: "", batchRef: "" }])}
          accessibilityLabel={t(locale, "countAddLine")}
          testID="count-add-line"
        />
        {saved === null ? null : saved.ok ? null : <BlockingBanner locale={locale} issues={saved.blocking} />}
        <Button
          label={t(locale, "countSubmit")}
          onPress={submit}
          disabled={lines.length === 0}
          accessibilityLabel={t(locale, "countSubmit")}
          testID="count-submit"
        />
        {saved === null ? null : saved.ok ? (
          <SavedBanner locale={locale} messageKey="countSavedLocal" state={saved.state ?? "PENDING_SYNC"} />
        ) : null}
      </View>
    </View>
  );
}
