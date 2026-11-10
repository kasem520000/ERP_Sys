/**
 * PHASE-022 T-P22-2-e · VanSaleCaptureScreen (MASTER-PLAN §8 — the van-sale
 * capture; DR-P22-11 registry key "VanSaleCapture"; OFFLINE_CAPABILITIES
 * row 6 LOCAL-VALID† + row 35 serial/batch capture): the cart + the
 * barcode-scan port (injected — device impl native, tests fake) + the
 * LOCAL-VALID† advisory banners + the honest PENDING_SYNC badge on save.
 *
 * THIN by construction: the cart machine (add/qty/serial/batch reducers,
 * totals) and the save are the pure van-sale flow module; this component
 * holds the editing state + renders. A FINANCIAL screen (2-b's
 * FINANCIAL_SCREENS — FLAG_SECURE applies via the native shell).
 */
import { useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";

import { t, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Button, Card, EmptyState, Field, ListItem, MoneyText } from "../theme/primitives";
import { space, typeScale, colors } from "../theme/tokens";
import {
  addCartLineSerial,
  addItemToCart,
  emptyVanSaleCart,
  removeCartLine,
  saveVanSale,
  setCartLineBatch,
  setCartLineQty,
  setCartPayment,
  validateVanSaleCart,
  vanSaleCartTotal,
  vanSaleLineNet,
  type VanSaleCart,
  type VanSaleSaveResult,
} from "../fieldsales/van-sale";
import type { FieldFlowContext } from "../fieldsales/state-machine";
import type { BarcodeScannerPort } from "../fieldsales/ports";
import {
  AdvisoryBanner,
  BlockingBanner,
  SavedBanner,
  ScreenHeading,
  screenStyles,
} from "./chrome";

/** The VanSaleCapture screen props. */
export interface VanSaleCaptureScreenProps {
  locale: Locale;
  store: StorageAdapter;
  ctx: FieldFlowContext;
  /** The barcode port (device: camera; tests: the scripted fake). */
  scanner: BarcodeScannerPort;
  /** The preselected customer (the route visit's "sell here"). */
  customerId?: string | null;
  customerName?: string | null;
  /** The initial payment posture (CASH walk-in / CREDIT on-account). */
  payment?: "CASH" | "CREDIT";
}

const inputStyles = {
  input: {
    minHeight: 44,
    paddingStart: space[3],
    paddingEnd: space[3],
    paddingTop: space[2],
    paddingBottom: space[2],
    borderWidth: 1,
    fontSize: typeScale.base.fontSize,
    color: colors.gray[900],
  },
} as const;

/** One cart line's editor row (qty + serial/batch capture when tracked). */
function CartLineEditor({ locale, line, onQty, onSerial, onBatch, onRemove }: {
  locale: Locale;
  line: VanSaleCart["lines"][number];
  onQty: (qty: string) => void;
  onSerial: (serial: string) => void;
  onBatch: (batch: string) => void;
  onRemove: () => void;
}): ReactNode {
  const subtitle =
    `${t(locale, "vanSalePriceLabel")}: ${line.unitPrice}` +
    (line.trackedSerial ? ` · ${t(locale, "commonSerial")}: ${String(line.serialIds.length)}` : "") +
    (line.trackedBatch ? ` · ${t(locale, "commonBatch")}: ${line.batchId ?? "—"}` : "");
  return (
    <View style={{ marginBottom: space[3] }} testID={`cart-line-${line.itemId}`}>
      <ListItem
        title={line.itemName}
        subtitle={subtitle}
        trailing={<MoneyText amount={vanSaleLineNet(line)} locale={locale} align="end" />}
        onPress={onRemove}
        accessibilityLabel={`${line.itemName} ${t(locale, "commonDelete")}`}
        testID={`cart-row-${line.itemId}`}
      />
      <Field label={t(locale, "commonQuantity")} hint={`${t(locale, "vanSaleLineTotal")}: ${vanSaleLineNet(line)}`}>
        <TextInput
          accessibilityLabel={t(locale, "commonQuantity")}
          value={line.qty}
          onChangeText={onQty}
          testID={`qty-input-${line.itemId}`}
          style={inputStyles.input}
        />
      </Field>
      {line.trackedSerial ? (
        <Field label={t(locale, "vanSaleSerialCapture")} hint={t(locale, "vanSaleSerialPlaceholder")}>
          <TextInput
            accessibilityLabel={t(locale, "vanSaleSerialCapture")}
            value={line.serialIds.join(", ")}
            onChangeText={onSerial}
            testID={`serial-input-${line.itemId}`}
            style={inputStyles.input}
          />
        </Field>
      ) : null}
      {line.trackedBatch ? (
        <Field label={t(locale, "vanSaleBatchCapture")} hint={t(locale, "vanSaleBatchPlaceholder")}>
          <TextInput
            accessibilityLabel={t(locale, "vanSaleBatchCapture")}
            value={line.batchId ?? ""}
            onChangeText={onBatch}
            testID={`batch-input-${line.itemId}`}
            style={inputStyles.input}
          />
        </Field>
      ) : null}
    </View>
  );
}

/** The VanSaleCapture screen (DR-P22-11: "VanSaleCapture"). */
export function VanSaleCaptureScreen({
  locale,
  store,
  ctx,
  scanner,
  customerId,
  customerName,
  payment,
}: VanSaleCaptureScreenProps): ReactNode {
  const [cart, setCart] = useState<VanSaleCart>(() => {
    const initial = emptyVanSaleCart(payment ?? "CASH");
    return customerId !== undefined && customerId !== null
      ? { ...initial, payment: "CREDIT", customerId, customerName: customerName ?? null }
      : initial;
  });
  const [saved, setSaved] = useState<VanSaleSaveResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // The live LOCAL-VALID† view over the CURRENT cart — recomputed per render
  // by the pure flow module (advisories render as warnings, never block;
  // structural blocking disables the checkout).
  const currentValidation = validateVanSaleCart(store, cart, ctx);

  const handleScan = (): void => {
    setScanError(null);
    void scanner
      .scan()
      .then((result) => {
        const next = addItemToCart(store, cart, { code: result.code });
        if (next === cart) {
          setScanError(t(locale, "countUnknownBarcode"));
        } else {
          setCart(next);
        }
      })
      .catch(() => {
        setScanError(t(locale, "scannerPermissionNeeded"));
      });
  };

  const checkout = (): void => {
    const result = saveVanSale(store, ctx, cart);
    setSaved(result);
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="vanSaleTitle" introKey="vanSaleCartTitle" />
      <View style={screenStyles.body}>
        <View style={screenStyles.actionsRow}>
          <Button
            label={t(locale, "vanSalePaymentCash")}
            variant={cart.payment === "CASH" ? "primary" : "secondary"}
            onPress={() => setCart(setCartPayment(cart, "CASH"))}
            accessibilityLabel={t(locale, "vanSalePaymentCash")}
            testID="payment-cash"
          />
          <Button
            label={t(locale, "vanSalePaymentCredit")}
            variant={cart.payment === "CREDIT" ? "primary" : "secondary"}
            onPress={() => setCart(setCartPayment(cart, "CREDIT"))}
            accessibilityLabel={t(locale, "vanSalePaymentCredit")}
            testID="payment-credit"
          />
        </View>
        <Text style={screenStyles.metaText} accessibilityLabel={customerLabel(locale, cart)}>
          {customerLabel(locale, cart)}
        </Text>
        <Button
          label={t(locale, "vanSaleScanButton")}
          onPress={handleScan}
          accessibilityLabel={t(locale, "vanSaleScanButton")}
          testID="scan-button"
        />
        {scanError === null ? null : (
          <Text style={screenStyles.bannerText} accessibilityLabel={scanError}>
            {scanError}
          </Text>
        )}
        {cart.lines.length === 0 ? (
          <EmptyState title={t(locale, "vanSaleEmptyCart")} />
        ) : (
          <Card>
            {cart.lines.map((line) => (
              <CartLineEditor
                key={line.itemId}
                locale={locale}
                line={line}
                onQty={(qty) => setCart(setCartLineQty(cart, line.itemId, qty))}
                onSerial={(serial) => setCart(addCartLineSerial(cart, line.itemId, serial))}
                onBatch={(batch) => setCart(setCartLineBatch(cart, line.itemId, batch))}
                onRemove={() => setCart(removeCartLine(cart, line.itemId))}
              />
            ))}
            <View style={screenStyles.row}>
              <Text style={screenStyles.bannerText}>{t(locale, "vanSaleTotalDue")}</Text>
              <MoneyText amount={vanSaleCartTotal(cart)} currency="SAR" locale={locale} size="md" align="end" />
            </View>
          </Card>
        )}
        <AdvisoryBanner locale={locale} issues={currentValidation.advisories} />
        <BlockingBanner locale={locale} issues={currentValidation.blocking} />
        <Button
          label={t(locale, "vanSaleCheckout")}
          onPress={checkout}
          disabled={cart.lines.length === 0 || currentValidation.blocking.length > 0}
          accessibilityLabel={t(locale, "vanSaleCheckout")}
          testID="checkout-button"
        />
        {saved === null ? null : saved.ok ? (
          <SavedBanner
            locale={locale}
            messageKey="vanSaleSavedLocal"
            params={{ number: saved.localRef ?? "" }}
            state={saved.state ?? "PENDING_SYNC"}
          />
        ) : (
          <BlockingBanner locale={locale} issues={saved.blocking} />
        )}
      </View>
    </View>
  );
}

/** The customer label line (the credit-sale requirement surfaced). */
function customerLabel(locale: Locale, cart: VanSaleCart): string {
  if (cart.payment === "CASH") return t(locale, "vanSaleNoCustomerCashOnly");
  return cart.customerName === null ? t(locale, "vanSaleCustomerRequired") : `${t(locale, "commonCustomer")}: ${cart.customerName}`;
}
