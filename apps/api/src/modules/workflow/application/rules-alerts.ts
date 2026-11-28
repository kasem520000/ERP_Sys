import { requireTenantContext } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { childLogger } from "../../../infra/observability/logger";
import { InboxService } from "../../notifications/application/inbox-service";
import { normalizeAlertRules, type WorkflowAlertRule } from "../domain/alert-rules";
import { evaluateConditions } from "../domain/condition-evaluator";
import { assembleDocumentContext } from "./workflow-engine";
import { onWorkflowEvent, type WorkflowEvent } from "./workflow-events";

/**
 * PHASE-052 (W-47 — T-07's rules half, dated 2026-11-27) THE
 * RULES-ENGINE ALERT ADAPTER (UX-13 — the configurable threshold/
 * condition alerts raised into the notifications inbox). THE BUS
 * CONSUMER LAW (D-10's own wording): the adapters are BUS CONSUMERS —
 * threshold/condition rules raising configurable alerts into the
 * notifications inbox, NEVER a parallel evaluation path:
 *
 *   NEVER A PARALLEL EVALUATION PATH (the red line): the adapter
 *   reuses THE ENGINE'S OWN context assembly (assembleDocumentContext
 *   — the same readers the chain's entry conditions saw) and THE D-06
 *   FOLD VERBATIM (evaluateConditions — the one condition evaluator
 *   the platform carries for workflow conditions). The adapter owns NO
 *   reader, NO evaluator, NO second context shape — a rule sees
 *   exactly what the chain's own branch conditions see.
 *
 *   THE CONSUMER'S ENVELOPE (the config-events law): the consumers act
 *   INSIDE the emitting request's envelope — the subscription fires at
 *   the engine's `workflow.instance.started` emission, the ambient
 *   tenant context is the emitter's own, and the alert's reads/writes
 *   join the SAME transaction (the single ambient connection's own
 *   serialization: the alert's queries are issued in the emit's own
 *   chain, landing before the request's commit — the in-flight
 *   tracking below is the spec's own drain surface, the wiring never
 *   needs it).
 *
 *   THE CATCH-AND-CONTINUE (the email-leg precedent's own law): a
 *   failed alert NEVER blocks the chain — every failure is logged and
 *   dropped (degrade the feature, never the platform). The same law
 *   covers the garbage rule (the fail-closed fold drops it before the
 *   evaluator ever sees it) and the rogue emission (an ambient context
 *   absent or a tenant mismatch skips silently).
 *
 *   THE AUDIENCES (the declared interpretation — the alert-rules
 *   fold's own vocabulary): "owner" (the tenant owner — the escalation
 *   sweep's own audience precedent) | "creator" (the document's
 *   creator, the person waiting on the chain — the facts' own member).
 *
 *   THE DEDUPE (the inbox's own structural law): one alert per rule
 *   per INSTANCE (the dedupe key `workflow:alert:{ruleName}:{instanceId}`
 *   — a re-opened world never double-alerts; the key rides the inbox's
 *   ON CONFLICT DO NOTHING floor).
 *
 *   THE SETTINGS SURFACE: the rules read stored ∪ registry default
 *   through the platform's effective-setting reader (`workflow.alert_
 *   rules` — the typed key, registered at the SETTINGS_REGISTRY in the
 *   SAME increment; the documented fail-closed default []: a tenant
 *   who configures nothing gets no alerts — the plane is opt-in by
 *   configuration, never a default alert).
 */

const log = childLogger({ module: "workflow-alerts" });

const SETTING_KEY = "workflow.alert_rules";

export class WorkflowAlertAdapter {
  /** The in-flight alert evaluations (the spec's own drain surface —
   * the wiring never awaits them; the single-connection serialization
   * lands them inside the emitting transaction). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly inbox: InboxService) {}

  /** THE BUS SUBSCRIPTION (the module wires this at boot — the
   * unsubscribe handle rides the module's own lifecycle). */
  subscribe(): () => void {
    return onWorkflowEvent("workflow.instance.started", (event) => {
      this.handleInstanceStarted(event);
    });
  }

  /** The consumer's own entry: the chain-open event carries the
   * document's members — the adapter re-assembles the context through
   * the ENGINE'S OWN readers and evaluates the configured rules. */
  handleInstanceStarted(event: WorkflowEvent): void {
    if (event.type !== "workflow.instance.started") {
      return;
    }
    const run = this.evaluateInstanceStarted(event).then(
      () => undefined,
      (error) => {
        // THE CATCH-AND-CONTINUE: a failed alert never blocks the
        // chain (the email-leg precedent's own law — logged, dropped).
        log.warn(
          { err: error, instanceId: event.instanceId },
          "workflow alert adapter failed (dropped — the chain is unaffected)",
        );
      },
    );
    this.inFlight.add(run);
    void run.finally(() => {
      this.inFlight.delete(run);
    });
  }

  /** The spec's drain surface: await every in-flight evaluation (the
   * DB spec's assert phase — deterministic regardless of the
   * interleaving; the wiring never calls this). */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  private async evaluateInstanceStarted(event: Extract<WorkflowEvent, { type: "workflow.instance.started" }>): Promise<void> {
    // THE ENVELOPE LAW: the consumer acts inside the emitting
    // request's envelope — the ambient tenant IS the emitter's own; a
    // rogue emission (no ambient scope, or a foreign tenant) skips
    // silently (the catch-and-continue's own reading).
    const context = requireTenantContext();
    if (context.tx === undefined || context.tenantId !== event.tenantId) {
      return;
    }
    const stored = await readEffectiveSetting<unknown>(SETTING_KEY);
    const rules = normalizeAlertRules(stored);
    if (rules.length === 0) {
      return;
    }
    // THE ENGINE'S OWN ASSEMBLY (never a parallel path): the same
    // readers the chain's entry conditions saw — a rule sees exactly
    // what the chain saw.
    const { context: docContext, facts } = await assembleDocumentContext(
      event.triggerEntity as Parameters<typeof assembleDocumentContext>[0],
      event.triggerEntityId,
    );
    for (const rule of rules) {
      await this.evaluateRule(rule, event, docContext, facts.createdBy, facts.amountBase, facts.currency, facts.docNo);
    }
  }

  private async evaluateRule(
    rule: WorkflowAlertRule,
    event: Extract<WorkflowEvent, { type: "workflow.instance.started" }>,
    docContext: Parameters<typeof evaluateConditions>[1],
    documentCreatorId: string | null,
    amountBase: string,
    currency: string,
    docNo: string | null,
  ): Promise<void> {
    // THE D-06 FOLD VERBATIM (the one evaluator) — a malformed
    // condition group is a SKIPPED rule (the fail-closed direction for
    // a notification plane: no alert from garbage, never a crash of
    // the emitting request).
    let holds: boolean;
    try {
      holds = evaluateConditions(rule.conditions, docContext);
    } catch {
      return;
    }
    if (!holds) {
      return;
    }
    // THE AUDIENCE RESOLUTION (the fold's own vocabulary): the tenant
    // owner (the escalation precedent's audience) or the document's
    // creator (the person waiting — the facts' own member; a
    // system-seeded row with no creator reads as the owner).
    let targetUserId: string | null;
    if (rule.audience === "creator") {
      targetUserId = documentCreatorId;
      if (targetUserId === null) {
        const owner = await this.inbox.ownerTarget();
        targetUserId = owner?.userId ?? null;
      }
    } else {
      const owner = await this.inbox.ownerTarget();
      targetUserId = owner?.userId ?? null;
    }
    if (targetUserId === null) {
      return;
    }
    const docRef = docNo ?? event.triggerEntityId.slice(0, 8);
    await this.inbox.record({
      category: "workflow",
      severity: rule.severity,
      title: {
        en: `Workflow alert — ${rule.name}: ${event.triggerEntity} ${docRef}`,
        ar: `تنبيه سير عمل — ${rule.name}: ${event.triggerEntity} ${docRef}`,
      },
      body: {
        en: `The configured rule "${rule.name}" matched ${event.triggerEntity} ${docRef} (${amountBase} ${currency}) as it entered an approval chain. The rule's conditions held on the same document context the chain itself evaluated.`,
        ar: `القاعدة المُهيَّأة «${rule.name}» طابقت ${event.triggerEntity} ${docRef} (${amountBase} ${currency}) عند دخوله سلسلة موافقات. تحققت شروط القاعدة على سياق المستند نفسه الذي قيَّمت عليه السلسلة.`,
      },
      actionLabel: { ar: "مراجعة المستند", en: "Review document" },
      actionUrl: docDetailPath(event.triggerEntity, event.triggerEntityId),
      dedupeKey: `workflow:alert:${rule.name}:${event.instanceId}`,
      userId: targetUserId,
    });
  }
}

/** The doc detail path (the engine's own routing law — the local copy
 * keeps the adapter self-contained over the closed registry). */
function docDetailPath(triggerEntity: string, documentId: string): string {
  switch (triggerEntity) {
    case "manual_journal":
      return `/accounting/journals?doc=${documentId}`;
    case "purchase_order":
      return `/purchasing/orders?doc=${documentId}`;
    case "change_order":
      return `/projects/contracting?doc=${documentId}`;
    case "duty_drawback_claim":
      return `/trade/drawbacks?doc=${documentId}`;
    default:
      return `/`;
  }
}
