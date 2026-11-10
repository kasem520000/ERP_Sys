/**
 * PHASE-022 T-P22-3-b · ParkedRejectionsScreen (docs/offline/
 * CONFLICT_RESOLUTION §3 — THE TABLE; DR-P22-11 registry key
 * "ParkedRejections"). THIN by construction: the per-code action set is
 * `actionsForRejectionCode` (the §3 map, exact) + `describeRejection`
 * (the typed lastError parse); the executors are the reconciliation
 * module's (audit-logged with the rejecting traceId).
 *
 * NOT a FINANCIAL screen (2-b's FINANCIAL_SCREENS keeps capture enabled
 * — "ParkedRejections' non-amount views"). The resends are the §3 rules:
 * NEW commandId, SAME entity id, fresh idempotencyKey when the payload
 * changed; REQUEST_APPROVAL_ONLINE is ONLINE-ONLY (disabled with the
 * honest reason offline — never queued); DEVICE_REVOKED/TENANT_SUSPENDED
 * render the administrative no-resubmission card.
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { rejectedCommands, type OutboxRow, type StorageAdapter } from "@erp/sync-core";

import { bidiDocNumber, formatMoney, formatQty, t, type Locale } from "../i18n";
import { Badge, Button, Card, EmptyState, ListItem } from "../theme/primitives";
import { screenStyles, ScreenHeading, StateChipRow } from "./chrome";
import {
  describeRejection,
  rejectionDetailKey,
  rejectionLabelKey,
  type RejectionSummary,
} from "../fieldsales/state-machine";
import {
  acceptPartial,
  acceptServerPrice,
  actionsForRejectionCode,
  cancelRejected,
  discardRejected,
  parkedActionLabelKey,
  requestApprovalOnline,
} from "../reconciliation";

/** The §3 detail text with PRE-FORMATTED numbers (the i18n handoff rule). */
function rejectionDetailText(locale: Locale, summary: RejectionSummary): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(summary.details ?? {})) {
    if (key === "available" || key === "requested" || key === "currentVersion") {
      params[key] = formatQty(locale, String(value));
    } else if (key === "limit" || key === "due" || key === "server" || key === "cached" || key === "balance") {
      params[key] = formatMoney(locale, String(value), "");
    }
  }
  return t(locale, rejectionDetailKey(summary.reason), params);
}

/** One parked rejection with its §3 action set. */
function ParkedRow({
  locale,
  store,
  row,
  online,
  serverPrices,
  availableQty,
  onEdit,
  onReview,
  onSubstitute,
  onRequestApproval,
}: {
  locale: Locale;
  store: StorageAdapter;
  row: OutboxRow;
  online: boolean;
  serverPrices: Readonly<Record<string, string>>;
  availableQty: Readonly<Record<string, string>>;
  onEdit?: (row: OutboxRow) => void;
  onReview?: (row: OutboxRow) => void;
  onSubstitute?: (row: OutboxRow) => void;
  onRequestApproval?: (row: OutboxRow) => void;
}): ReactNode {
  const summary = describeRejection(row);
  const code = row.rejectionReason ?? "VALIDATION_ERROR";
  const actionSet = actionsForRejectionCode(code);
  const reason = summary?.reason ?? "VALIDATION_ERROR";
  // The unknown-code fallback never reaches the reject* label map (an
  // unrecognized code has no catalog key — the fallback badge carries the
  // generic error label instead; "unknown reason" is not a UX state).
  const reasonLabel = actionSet.fallback
    ? t(locale, "commonError")
    : t(locale, rejectionLabelKey(reason));
  const docLabel = row.officialNo ?? row.localRef;
  const traceId =
    summary?.details !== null && summary?.details !== undefined
      ? typeof summary.details.traceId === "string"
        ? summary.details.traceId
        : null
      : null;

  return (
    <Card testID={`parked-card-${row.commandId}`}>
      <ListItem
        title={docLabel === null ? row.commandId.slice(0, 8) : bidiDocNumber(docLabel)}
        subtitle={row.clientCreatedAt.slice(0, 10)}
        leading={<Badge label={reasonLabel} tone="danger" accessibilityLabel={reasonLabel} testID={`parked-reason-${row.commandId}`} />}
        accessibilityLabel={`${reasonLabel} ${docLabel ?? ""}`}
        testID={`parked-row-${row.commandId}`}
      />
      <StateChipRow locale={locale} state="REJECTED" />
      {summary === null || actionSet.fallback ? null : (
        <Text style={screenStyles.bannerText} testID={`parked-detail-${row.commandId}`}>
          {rejectionDetailText(locale, summary)}
        </Text>
      )}
      {traceId === null ? null : (
        <Text style={screenStyles.metaText} testID={`parked-trace-${row.commandId}`}>
          {t(locale, "parkedTraceId", { traceId })}
        </Text>
      )}

      {/* §3's fallback: message + traceId + support hint (ERROR_MODEL §5). */}
      {actionSet.fallback ? (
        <View style={screenStyles.bannerRow} testID={`parked-fallback-${row.commandId}`}>
          <Text style={screenStyles.bannerText}>{summary?.message ?? t(locale, "commonError")}</Text>
          <Text style={screenStyles.metaText}>{t(locale, "rejectionSupportHint")}</Text>
        </View>
      ) : actionSet.administrative ? (
        /* §3's last row: no resubmission — the administrative surface. */
        <View style={screenStyles.bannerRow} testID={`parked-administrative-${row.commandId}`}>
          <Text style={screenStyles.bannerText}>{t(locale, "parkedNoResubmitTitle")}</Text>
          <Text style={screenStyles.metaText}>{t(locale, "parkedNoResubmitBody")}</Text>
        </View>
      ) : (
        <View>
          <Text style={screenStyles.metaText}>{t(locale, "parkedResendNote")}</Text>
          <View style={screenStyles.actionsRow} testID={`parked-actions-${row.commandId}`}>
            {actionSet.actions.map((action) => {
              const label = t(locale, parkedActionLabelKey(action));
              const testID = `parked-action-${action}-${row.commandId}`;
              // §6.6: request-approval is ONLINE-ONLY — disabled with the
              // honest reason offline (never queued).
              if (action === "REQUEST_APPROVAL_ONLINE" && !online) {
                return (
                  <View key={action} style={screenStyles.bannerRow}>
                    <Button
                      label={label}
                      disabled
                      accessibilityLabel={label}
                      accessibilityHint={t(locale, "onlineOnlyReason")}
                      testID={testID}
                    />
                    <Text style={screenStyles.metaText} testID={`${testID}-reason`}>
                      {t(locale, "onlineOnlyReason")}
                    </Text>
                  </View>
                );
              }
              return (
                <Button
                  key={action}
                  label={label}
                  variant={action === "CANCEL" || action === "DISCARD" ? "secondary" : "primary"}
                  onPress={() => {
                    switch (action) {
                      case "EDIT_AND_RESEND":
                        onEdit?.(row);
                        break;
                      case "ACCEPT_SERVER_PRICE":
                        acceptServerPrice(store, row, { serverPrices });
                        break;
                      case "ACCEPT_PARTIAL":
                        acceptPartial(store, row, { availableQty });
                        break;
                      case "CANCEL":
                        cancelRejected(store, row);
                        break;
                      case "SUBSTITUTE_AND_RESEND":
                        onSubstitute?.(row);
                        break;
                      case "REVIEW_AND_MERGE":
                        onReview?.(row);
                        break;
                      case "DISCARD":
                        discardRejected(store, row);
                        break;
                      case "REQUEST_APPROVAL_ONLINE":
                        if (requestApprovalOnline(store, row, online).ok) {
                          onRequestApproval?.(row);
                        }
                        break;
                    }
                  }}
                  accessibilityLabel={label}
                  testID={testID}
                />
              );
            })}
          </View>
        </View>
      )}
      <Text style={screenStyles.metaText}>{t(locale, "parkedAuditNote")}</Text>
    </Card>
  );
}

/** The ParkedRejections screen props (navigation glue supplies the store). */
export interface ParkedRejectionsScreenProps {
  locale: Locale;
  store: StorageAdapter;
  /** Connectivity (REQUEST_APPROVAL_ONLINE is ONLINE-ONLY). */
  online?: boolean;
  /** The server's prices keyed by itemId (accept-server-price input). */
  serverPrices?: Readonly<Record<string, string>>;
  /** The server's available quantities keyed by itemId (accept-partial). */
  availableQty?: Readonly<Record<string, string>>;
  /** Navigation glue: the edit screen (its save calls editAndResend). */
  onEdit?: (row: OutboxRow) => void;
  /** Navigation glue: the review-and-merge diff surface. */
  onReview?: (row: OutboxRow) => void;
  /** Navigation glue: the substitute picker. */
  onSubstitute?: (row: OutboxRow) => void;
  /** Navigation glue: the online approvals surface. */
  onRequestApproval?: (row: OutboxRow) => void;
}

/** The ParkedRejections screen (DR-P22-11: "ParkedRejections"). */
export function ParkedRejectionsScreen({
  locale,
  store,
  online = false,
  serverPrices = {},
  availableQty = {},
  onEdit,
  onReview,
  onSubstitute,
  onRequestApproval,
}: ParkedRejectionsScreenProps): ReactNode {
  const rows = rejectedCommands(store);
  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="parkedTitle" introKey="parkedIntro" />
      {rows.length === 0 ? (
        <EmptyState title={t(locale, "parkedEmpty")} />
      ) : (
        rows.map((row) => (
          <ParkedRow
            key={row.commandId}
            locale={locale}
            store={store}
            row={row}
            online={online}
            serverPrices={serverPrices}
            availableQty={availableQty}
            onEdit={onEdit}
            onReview={onReview}
            onSubstitute={onSubstitute}
            onRequestApproval={onRequestApproval}
          />
        ))
      )}
    </View>
  );
}
