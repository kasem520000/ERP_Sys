/**
 * PHASE-022 T-P22-2-e · VanLoadUnloadScreen (MASTER-PLAN §8 — the van
 * load/unload confirmations; DR-P22-11 registry key "VanLoadUnload";
 * OFFLINE_CAPABILITIES row 12 OFFLINE-COMPLETE "against van snapshot"):
 * ONE screen, two modes —
 *
 *   LOAD   confirm an IN_TRANSIT load transfer landed in the van (the
 *          transfer IS the load document — the rep scans/enters its
 *          reference); double-loads reject STALE_VERSION at sync.
 *   UNLOAD the end-of-day return: lines of {item, qty} picked from the
 *          CACHED van snapshot (qty beyond the snapshot warns — the
 *          server's INSUFFICIENT_STOCK with machine-readable availableQty
 *          decides; the advisory never blocks).
 *
 * The confirmation screens show SNAPSHOT AS-OF labels (vanLoadAsOfSnapshot
 * — the mirror's newest refreshedAt; never-synced is labeled as such).
 * THIN by construction: the snapshot view + the two saves are the pure
 * van-load flow module. A FINANCIAL screen (2-b's FINANCIAL_SCREENS).
 */
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { formatDate, t, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Button, Card, EmptyState, Field, ListItem } from "../theme/primitives";
import { space, typeScale, colors } from "../theme/tokens";
import {
  saveVanLoadConfirmation,
  saveVanUnloadConfirmation,
  vanSnapshot,
  validateVanUnload,
  type VanMovementSaveResult,
} from "../fieldsales/van-load";
import type { FieldFlowContext } from "../fieldsales/state-machine";
import {
  AdvisoryBanner,
  BlockingBanner,
  SavedBanner,
  ScreenHeading,
  screenStyles,
} from "./chrome";

/** The screen modes (one registry entry, two confirmations). */
export type VanLoadUnloadMode = "load" | "unload";

/** The VanLoadUnload screen props. */
export interface VanLoadUnloadScreenProps {
  locale: Locale;
  store: StorageAdapter;
  ctx: FieldFlowContext;
  /** The initial mode (defaults to load). */
  mode?: VanLoadUnloadMode;
  /** The load transfer reference (pre-filled — e.g. scanned from the load sheet). */
  transferId?: string;
  /** The unload's return-to warehouse (the main warehouse uuid). */
  toWarehouseId?: string;
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

/** One unload line editor (qty against the cached snapshot row). */
function UnloadLineEditor({ locale, itemId, qty, snapshotQty, onQty }: {
  locale: Locale;
  itemId: string;
  qty: string;
  snapshotQty: string;
  onQty: (qty: string) => void;
}): ReactNode {
  return (
    <View style={{ marginBottom: space[3] }} testID={`unload-line-${itemId}`}>
      <ListItem
        title={itemId}
        subtitle={`${t(locale, "vanStockTitle")}: ${snapshotQty}`}
        accessibilityLabel={itemId}
        testID={`unload-row-${itemId}`}
      />
      <Field label={t(locale, "commonQuantity")}>
        <TextInput
          accessibilityLabel={t(locale, "commonQuantity")}
          value={qty}
          onChangeText={onQty}
          testID={`unload-qty-${itemId}`}
          style={inputStyle}
        />
      </Field>
    </View>
  );
}

/** The VanLoadUnload screen (DR-P22-11: "VanLoadUnload"). */
export function VanLoadUnloadScreen({
  locale,
  store,
  ctx,
  mode,
  transferId,
  toWarehouseId,
}: VanLoadUnloadScreenProps): ReactNode {
  const [activeMode, setActiveMode] = useState<VanLoadUnloadMode>(mode ?? "load");
  const [transferRef, setTransferRef] = useState(transferId ?? "");
  const [warehouseRef, setWarehouseRef] = useState(toWarehouseId ?? "");
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<VanMovementSaveResult | null>(null);

  const vanWarehouseId = ctx.vanWarehouseId ?? "";
  const snapshot = vanWarehouseId === "" ? null : vanSnapshot(store, vanWarehouseId);
  const asOfText =
    snapshot?.asOf === null || snapshot?.asOf === undefined
      ? t(locale, "asOfNeverSynced")
      : t(locale, "vanLoadAsOfSnapshot", { date: formatDate(locale, snapshot.asOf, "canonical") });

  const unloadLines = (snapshot?.lines ?? [])
    .map((line) => ({
      itemId: line.itemId,
      qty: qtyByItem[line.itemId] ?? line.qty,
      snapshotQty: line.qty,
    }))
    .filter((line) => line.qty !== "0" && line.qty !== "0.000000");
  const liveUnloadValidation =
    activeMode !== "unload" || vanWarehouseId === "" || warehouseRef === ""
      ? { advisories: [], blocking: [] }
      : validateVanUnload(store, {
          vanWarehouseId,
          toWarehouseId: warehouseRef,
          lines: unloadLines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        });

  const confirm = (): void => {
    if (activeMode === "load") {
      setSaved(saveVanLoadConfirmation(store, ctx, { transferId: transferRef }));
      return;
    }
    setSaved(
      saveVanUnloadConfirmation(store, ctx, {
        vanWarehouseId,
        toWarehouseId: warehouseRef,
        lines: unloadLines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
      }),
    );
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading
        locale={locale}
        titleKey={activeMode === "load" ? "vanLoadTitle" : "vanUnloadTitle"}
        introKey={activeMode === "load" ? "vanLoadIntro" : "vanUnloadIntro"}
      />
      <View style={screenStyles.body}>
        <View style={screenStyles.actionsRow}>
          <Button
            label={t(locale, "vanLoadTitle")}
            variant={activeMode === "load" ? "primary" : "secondary"}
            onPress={() => setActiveMode("load")}
            accessibilityLabel={t(locale, "vanLoadTitle")}
            testID="mode-load"
          />
          <Button
            label={t(locale, "vanUnloadTitle")}
            variant={activeMode === "unload" ? "primary" : "secondary"}
            onPress={() => setActiveMode("unload")}
            accessibilityLabel={t(locale, "vanUnloadTitle")}
            testID="mode-unload"
          />
        </View>
        <Text style={screenStyles.metaText} accessibilityLabel={asOfText}>
          {asOfText}
        </Text>
        {activeMode === "load" ? (
          <Field label={t(locale, "vanLoadFromWarehouse")} hint={t(locale, "vanLoadIntro")}>
            <TextInput
              accessibilityLabel={t(locale, "vanLoadFromWarehouse")}
              value={transferRef}
              onChangeText={setTransferRef}
              testID="load-transfer-input"
              style={inputStyle}
            />
          </Field>
        ) : (
          <>
            <Field label={t(locale, "vanUnloadReturnTo")}>
              <TextInput
                accessibilityLabel={t(locale, "vanUnloadReturnTo")}
                value={warehouseRef}
                onChangeText={setWarehouseRef}
                testID="unload-warehouse-input"
                style={inputStyle}
              />
            </Field>
            {snapshot === null || snapshot.lines.length === 0 ? (
              <EmptyState title={t(locale, "vanStockEmpty")} />
            ) : (
              <Card>
                {snapshot.lines.map((line) => (
                  <UnloadLineEditor
                    key={line.id}
                    locale={locale}
                    itemId={line.itemId}
                    qty={qtyByItem[line.itemId] ?? line.qty}
                    snapshotQty={line.qty}
                    onQty={(qty) => setQtyByItem({ ...qtyByItem, [line.itemId]: qty })}
                  />
                ))}
              </Card>
            )}
          </>
        )}
        <AdvisoryBanner locale={locale} issues={liveUnloadValidation.advisories} />
        <BlockingBanner locale={locale} issues={liveUnloadValidation.blocking} />
        <Button
          label={activeMode === "load" ? t(locale, "vanLoadConfirm") : t(locale, "vanUnloadConfirm")}
          onPress={confirm}
          accessibilityLabel={activeMode === "load" ? t(locale, "vanLoadConfirm") : t(locale, "vanUnloadConfirm")}
          testID="confirm-movement"
        />
        {saved === null ? null : saved.ok ? (
          <SavedBanner
            locale={locale}
            messageKey={activeMode === "load" ? "vanLoadSavedLocal" : "vanUnloadSavedLocal"}
            state={saved.state ?? "PENDING_SYNC"}
          />
        ) : (
          <BlockingBanner locale={locale} issues={saved.blocking} />
        )}
      </View>
    </View>
  );
}
