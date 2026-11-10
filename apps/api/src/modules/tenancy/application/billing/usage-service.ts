import { Inject, Injectable } from "@nestjs/common";

import { EMAIL_SERVICE, type EmailService } from "../../../notifications/notifications.module";
import { InboxService } from "../../../notifications/application/inbox-service";
import { requireTenantContext, withTenant } from "../../../../infra/db/tenant-context";
import { onLedgerEvent } from "../../../accounting/application/ledger-events";
import { childLogger } from "../../../../infra/observability/logger";
import { env } from "../../../../config/env";
import * as store from "../../infrastructure/billing.store";
import { getOwnTenant } from "../../infrastructure/tenancy.store";
import { currentMonthPeriod, limitOf, WARN_THRESHOLDS } from "./billing-config";

const log = childLogger({ module: "billing-usage" });

/**
 * PHASE-014 usage counters + limit behaviors (PHASE-014 §2.4/§5 T6;
 * SUBSCRIPTION §6 — the binding matrix):
 *
 * - documents/month: a read-model counter bumped OUTSIDE the posting
 *   transaction (the ledger-event subscriber opens its own UoW; a broken
 *   counter never breaks posting — INV-022 by construction), reconciled
 *   from journal_entries (the durable truth) by the daily pass. NEVER a
 *   hard block: posting continues at any usage level (the binding product
 *   principle — billing pressure uses notifications, not ledger locks).
 * - users / branches / warehouses: hard blocks on CREATION actions only
 *   (the @RequireLimit guard + this service's snapshot); existing records
 *   keep working — people are never locked out.
 * - soft warnings at 80% and 100% (in-app + owner email + dashboard
 *   banner), deduped once per (counter, period, threshold) through the
 *   notifications dedupe key.
 */

export interface UsageCounterView {
  key: string;
  label: { ar: string; en: string };
  usage: number;
  limit: number | "unlimited";
  period: string | null;
  warn80: boolean;
  warn100: boolean;
  note: { ar: string; en: string } | null;
}

export interface UsageSnapshotView {
  plan: {
    key: string;
    name: string;
    nameAr: string;
    positioning: { ar: string; en: string } | null;
    priceAmount: string;
    annualPriceAmount: string;
    currencyCode: string;
    placeholderPrice: boolean;
  } | null;
  subscription: {
    id: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    pendingPlanKey: string | null;
    readOnly: boolean;
  } | null;
  counters: UsageCounterView[];
}

const COUNTER_LABELS: Record<string, { ar: string; en: string }> = {
  users: { ar: "المستخدمون", en: "Users" },
  branches: { ar: "الفروع", en: "Branches" },
  warehouses: { ar: "المستودعات", en: "Warehouses" },
  documents_per_month: { ar: "المستندات شهريًا", en: "Documents / month" },
  pos_terminals: { ar: "أجهزة نقاط البيع", en: "POS terminals" },
  offline_devices: { ar: "أجهزة المزامنة", en: "Offline devices" },
  industry_addons: { ar: "إضافات القطاعات", en: "Industry add-ons" },
};

@Injectable()
export class UsageService {
  constructor(
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  /**
   * The owner-facing usage snapshot (GET /tenancy/usage): plan, lifecycle
   * state (readOnly flag included), and every counter with its ceiling +
   * warning flags. Documents counter comes from the read model; structural
   * counters are live counts (their tables are the durable truth).
   */
  async snapshotForOwner(): Promise<UsageSnapshotView> {
    const context = requireTenantContext();
    const snapshot = await store.billingSnapshot(context.tenantId);
    const current = await store.currentSubscriptionRow().catch(() => undefined);
    const planRow =
      snapshot.plan === null
        ? undefined
        : await store.findBillingPlanByKey(snapshot.plan.key);
    const month = currentMonthPeriod();
    const documents = await store.readUsageCounter("documents_per_month", month).catch(() => 0);
    const usageNow = snapshot.usage;
    const counters: UsageCounterView[] = [];
    const pushCounter = (
      key: string,
      usage: number,
      limit: number | "unlimited",
      period: string | null,
      hardBlockNote: { ar: string; en: string } | null,
    ) => {
      // ceil(limit*0.8) in integer form ((4n+4)/5|0 — verified for n≥1);
      // not money math (ADR-0009 targets money), the |0 mirrors the
      // rate-limiter convention.
      const warn80 = limit !== "unlimited" && usage >= ((limit * 4 + 4) / 5 | 0) && usage < limit;
      const warn100 = limit !== "unlimited" && usage >= limit;
      counters.push({
        key,
        label: COUNTER_LABELS[key] ?? { ar: key, en: key },
        usage,
        limit,
        period,
        warn80,
        warn100,
        note: hardBlockNote,
      });
    };
    pushCounter("users", usageNow.users, limitOf(snapshot.plan?.limits ?? {}, "users"), null, {
      ar: "الدعوات الجديدة تتوقف عند الحد؛ المستخدمون الحاليون يواصلون العمل",
      en: "New invitations stop at the limit; existing users keep working",
    });
    pushCounter("branches", usageNow.branches, limitOf(snapshot.plan?.limits ?? {}, "branches"), null, {
      ar: "إنشاء الفروع الجديدة يتوقف عند الحد",
      en: "New branch creation stops at the limit",
    });
    pushCounter("warehouses", usageNow.warehouses, limitOf(snapshot.plan?.limits ?? {}, "warehouses"), null, {
      ar: "إنشاء المستودعات الجديدة يتوقف عند الحد",
      en: "New warehouse creation stops at the limit",
    });
    pushCounter(
      "documents_per_month",
      documents,
      limitOf(snapshot.plan?.limits ?? {}, "documents_per_month"),
      month,
      {
        ar: "لا يوجد حجب إطلاقًا — الترحيل يستمر أبدًا (INV-022)",
        en: "Never blocked — posting always continues (INV-022)",
      },
    );
    pushCounter("pos_terminals", 0, limitOf(snapshot.plan?.limits ?? {}, "pos_terminals"), null, {
      ar: "التنشيط يتوقف عند الحد (إدارة الأجهزة تصل في مرحلة نقاط البيع)",
      en: "Activation stops at the limit (device management lands with POS)",
    });
    pushCounter("offline_devices", 0, limitOf(snapshot.plan?.limits ?? {}, "offline_devices"), null, {
      ar: "التنشيط يتوقف عند الحد (إدارة الأجهزة تصل في مرحلة المزامنة)",
      en: "Activation stops at the limit (device management lands with sync)",
    });
    return {
      plan:
        planRow === undefined
          ? null
          : {
              key: planRow.key,
              name: planRow.name,
              nameAr: planRow.nameAr,
              positioning: planRow.positioning,
              priceAmount: planRow.priceAmount,
              annualPriceAmount: planRow.annualPriceAmount,
              currencyCode: planRow.currencyCode,
              placeholderPrice: planRow.priceAmount === "0.0000",
            },
      subscription:
        current === undefined
          ? null
          : {
              id: current.id,
              status: current.status,
              periodStart: current.periodStart,
              periodEnd: current.periodEnd,
              trialEndsAt: current.trialEndsAt,
              graceEndsAt: current.graceEndsAt,
              pendingPlanKey: null,
              readOnly: current.status === "GRACE_READ_ONLY",
            },
      counters,
    };
  }

  /**
   * The §6 soft-warning evaluation (80% + 100%): in-app row + owner email,
   * once per (counter, period, threshold) via the notifications dedupe key.
   * Called from the daily pass, after gated creations, and on usage reads.
   */
  async evaluateLimitWarnings(): Promise<{ warned: number }> {
    const context = requireTenantContext();
    const snapshot = await store.billingSnapshot(context.tenantId);
    if (snapshot.plan === null) {
      return { warned: 0 };
    }
    const month = currentMonthPeriod();
    const documents = await store.readUsageCounter("documents_per_month", month).catch(() => 0);
    const tenant = await getOwnTenant();
    const usageUrl = `${env.WEB_BASE_URL}/billing`;
    let warned = 0;
    const evaluate = async (
      key: string,
      label: { ar: string; en: string },
      usage: number,
      limitValue: number | "unlimited",
      period: string,
      note: { ar: string; en: string },
    ) => {
      if (limitValue === "unlimited") {
        return;
      }
      for (const threshold of WARN_THRESHOLDS) {
        // Integer ceil for the 0.8 threshold (100% is exact); not money.
        const thresholdValue = threshold === 0.8 ? ((limitValue * 4 + 4) / 5 | 0) : limitValue;
        const atThreshold = usage >= thresholdValue;
        if (!atThreshold) {
          continue;
        }
        // Already at 100%? the 80% warning is redundant (skip when both).
        if (threshold === 0.8 && usage >= limitValue) {
          continue;
        }
        const level = threshold === 0.8 ? "80%" : "100%";
        const outcome = await this.inbox.notifyOwner(this.email, {
          category: "limits",
          severity: threshold === 0.8 ? "warning" : "critical",
          title: {
            ar: `${label.ar}: ${level} من الخطة`,
            en: `${label.en}: ${level} of plan`,
          },
          body: {
            ar: `الاستخدام الحالي ${usage} من ${limitValue}. ${note.ar}`,
            en: `Current usage ${usage} of ${limitValue}. ${note.en}`,
          },
          actionLabel: { ar: "مراجعة الاستخدام", en: "Review usage" },
          actionUrl: "/billing",
          dedupeKey: `limit:${key}:${period}:${threshold}`,
          emailTemplate: "limit_warning",
          emailVariables: {
            counter: label.en,
            usage: String(usage),
            limit: String(limitValue),
            level,
            note: note.en,
            usageUrl,
            tenantName: tenant.name,
          },
        });
        if (outcome.inbox || outcome.email) {
          warned += 1;
        }
      }
    };
    const notes = {
      users: {
        ar: "الدعوات الجديدة تتوقف عند الحد؛ المستخدمون الحاليون يواصلون.",
        en: "New invitations stop at the limit; existing users keep working.",
      },
      branches: {
        ar: "إنشاء الفروع الجديدة يتوقف عند الحد.",
        en: "New branch creation stops at the limit.",
      },
      warehouses: {
        ar: "إنشاء المستودعات الجديدة يتوقف عند الحد.",
        en: "New warehouse creation stops at the limit.",
      },
      documents: {
        ar: "لا يوجد حجب للمستندات — الترحيل يستمر دائمًا (INV-022).",
        en: "Documents are never blocked — posting always continues (INV-022).",
      },
    } as const;
    await evaluate("users", COUNTER_LABELS.users!, snapshot.usage.users, limitOf(snapshot.plan.limits, "users"), "CURRENT", notes.users);
    await evaluate("branches", COUNTER_LABELS.branches!, snapshot.usage.branches, limitOf(snapshot.plan.limits, "branches"), "CURRENT", notes.branches);
    await evaluate("warehouses", COUNTER_LABELS.warehouses!, snapshot.usage.warehouses, limitOf(snapshot.plan.limits, "warehouses"), "CURRENT", notes.warehouses);
    await evaluate(
      "documents_per_month",
      COUNTER_LABELS.documents_per_month!,
      documents,
      limitOf(snapshot.plan.limits, "documents_per_month"),
      month,
      notes.documents,
    );
    return { warned };
  }

  /**
   * Reconcile the documents counter from journal_entries (the durable
   * truth) — run by the daily pass; the event-driven bump stays the
   * fast path, this is the repair.
   */
  async reconcileDocumentsCounter(): Promise<{ period: string; value: number }> {
    const period = currentMonthPeriod();
    const value = await store.countJournalEntriesForPeriod(period);
    await store.upsertUsageCounter({ counterKey: "documents_per_month", period, value });
    return { period, value };
  }

  /**
   * The ledger-event consumer: bump the documents counter inside its OWN
   * UoW — a separate transaction from the posting flow, so a counter
   * failure can never roll back or block a post (INV-022 by construction;
   * the subscriber is fail-safe in publishLedgerEvent and here).
   */
  async bumpDocumentCounter(tenantId: string): Promise<void> {
    const period = currentMonthPeriod();
    await withTenant(tenantId, async () => {
      const current = await store.readUsageCounter("documents_per_month", period).catch(() => 0);
      await store.upsertUsageCounter({
        counterKey: "documents_per_month",
        period,
        value: current + 1,
      });
    });
  }
}

/**
 * The fail-safe subscription to ledger events (registered once per process
 * by the tenancy module). The synchronous part never throws; the async
 * work is isolated in its own transaction and swallows + logs its own
 * errors — posting is never affected (INV-022).
 */
export function registerDocumentCounterSubscriber(usage: UsageService): () => void {
  return onLedgerEvent((event) => {
    if (event.type !== "journal.posted") {
      return;
    }
    if (event.tenantId === undefined) {
      return;
    }
    void usage
      .bumpDocumentCounter(event.tenantId)
      .catch((error: unknown) => {
        log.warn({ err: String(error) }, "document counter bump failed (repair rides the daily pass)");
      });
  });
}
