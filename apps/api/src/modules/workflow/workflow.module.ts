import { Inject, Module, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { AuditModule } from "../audit/audit.module";
import { AuditService } from "../audit/application/audit.service";
import { requireTenantContext } from "../../infra/db/tenant-context";
import { childLogger } from "../../infra/observability/logger";
import { getBoss } from "../../infra/jobs/boss";
import { env } from "../../config/env";
import { EMAIL_SERVICE, NotificationsModule } from "../notifications/notifications.module";
import type { EmailService } from "../notifications/application/email-service";
import { InboxService } from "../notifications/application/inbox-service";
import { WorkflowEngine, type WorkflowEmailLeg } from "./application/workflow-engine";
import { WorkflowDeepLinkService } from "./application/deep-link-service";
import { WorkflowTaskLaneService } from "./application/task-lane-service";
import { WorkflowApprovalInboxService } from "./application/approval-inbox-service";
import { WorkflowDefinitionsService } from "./application/definitions-service";
import { WorkflowAlertAdapter } from "./application/rules-alerts";
import { EscalationService } from "./application/escalation-service";
import { PolicyBridgeService } from "./application/policy-bridge-service";
import { bindWorkflowEngine } from "./infrastructure/workflow-gateway";
import { registerWorkflowEscalationJob } from "./infrastructure/workflow-escalation-sweep.job";
import { WorkflowController } from "./presentation/workflow.controller";

/**
 * PHASE-052 (W-44 — T-03, dated 2026-11-27) THE WORKFLOW MODULE: binds
 * the engine into the gateway (the documented plain-function contract
 * the four exemplar surfaces consume — accounting/purchasing/crm/trade
 * import the gateway functions, never this module) + wires THE EMAIL
 * LEG of the assignee notifications (D-10's own bus-consumer shape:
 * the workflow.step.assigned consumer enqueues the 041-hub template
 * mail when the assignee's prefs carry email on — the consumer acts
 * inside the emitting request's envelope, the config-events law).
 *
 * PHASE-052 (W-45 — T-04, D-08): THE ESCALATION SWEEP registers its
 * daily queue on boot (the `workflow-escalation-sweep` at 05:45 UTC —
 * the SEVENTH standing isolate, the trade-expiry-sweep registration
 * shape: the named schedule is idempotent, the structural dedupe
 * makes raced passes converge, the per-tenant catch-and-continue
 * degrades the feature never the platform).
 *
 * PHASE-052 (W-46 — T-05, D-12): THE POLICY BRIDGE joins the module's
 * providers (the one-time launch-boundary conversion tool — the
 * approval_policies → workflow_definitions mapping with the
 * origin_policy_id back-reference; the specs drive it directly, the
 * admin surface is a later wave's own).
 *
 * PHASE-052 (W-47 — T-06, D-09): THE DEEP-LINK SERVICE + THE MODULE'S
 * FIRST CONTROLLER — the act surface (`POST /api/v1/workflow/act` on
 * `workflow.approve` + the SESSION_ROUTES preview): the signed one-time
 * links' own service (the decode/expire/actor floors + the engine's own
 * act path), and the email leg's tokens ride the step-assignment mail
 * (the approve/reject URLs rendered in the recipient's locale).
 *
 * PHASE-052 (W-47 — T-08 + T-07's rules half, D-11/UX-13): THE TASKS
 * LANE + THE RULES-ALERT CONSUMER — the tasks ARE the step instances
 * (no seventh table): the typed list (the caller's own PENDING TASK
 * steps) + the completion write-back (the step's own ACTED stamp
 * through the engine's act path); the RULES-ALERT ADAPTER subscribes
 * to the event bus at boot (the workflow.instance.started consumer —
 * the configurable threshold/condition rules evaluated against the
 * ENGINE'S OWN context assembly, the D-06 fold VERBATIM, the alerts
 * raised into the notifications inbox — never a parallel evaluation
 * path; the catch-and-continue: a failed alert never blocks the
 * chain).
 *
 * PHASE-052 (W-48 — T-10/T-11/T-12, dated 2026-11-28): THE WEB PLANE'S
 * OWN BACKEND SERVICES join the providers — the APPROVALS INBOX
 * (the PENDING work + the aging figures the DB's own clock computes +
 * the quick actions through the engine's own act path + the timeline
 * read PP-17 renders) and the DEFINITIONS SERVICE (the chain editor's
 * list/create/update — the validation fold first, the audit seal at
 * every write).
 */

const log = childLogger({ module: "workflow" });

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [WorkflowController],
  providers: [
    {
      provide: WorkflowEngine,
      useFactory: (audit: AuditService, inbox: InboxService, email: EmailService) =>
        new WorkflowEngine(audit, inbox, moduleEmailLeg(email)),
      inject: [AuditService, InboxService, EMAIL_SERVICE],
    },
    {
      provide: WorkflowDeepLinkService,
      useFactory: (engine: WorkflowEngine) => new WorkflowDeepLinkService(engine),
      inject: [WorkflowEngine],
    },
    {
      provide: WorkflowTaskLaneService,
      useFactory: (engine: WorkflowEngine, inbox: InboxService) =>
        new WorkflowTaskLaneService(engine, inbox),
      inject: [WorkflowEngine, InboxService],
    },
    {
      provide: WorkflowApprovalInboxService,
      useFactory: (engine: WorkflowEngine) => new WorkflowApprovalInboxService(engine),
      inject: [WorkflowEngine],
    },
    {
      provide: WorkflowDefinitionsService,
      useFactory: (audit: AuditService) => new WorkflowDefinitionsService(audit),
      inject: [AuditService],
    },
    {
      provide: WorkflowAlertAdapter,
      useFactory: (inbox: InboxService) => new WorkflowAlertAdapter(inbox),
      inject: [InboxService],
    },
    {
      provide: EscalationService,
      useFactory: (audit: AuditService, inbox: InboxService) =>
        new EscalationService(audit, inbox),
      inject: [AuditService, InboxService],
    },
    {
      provide: PolicyBridgeService,
      useFactory: (audit: AuditService) => new PolicyBridgeService(audit),
      inject: [AuditService],
    },
  ],
  exports: [WorkflowEngine, WorkflowDeepLinkService, WorkflowTaskLaneService, EscalationService, PolicyBridgeService],
})
export class WorkflowModule implements OnModuleInit {
  // THE EXPLICIT @Inject LAW (the platform's own convention — the
  // controllers' shape): vitest's esbuild transform does NOT emit
  // constructor design:paramtypes (tsc's emitDecoratorMetadata never
  // runs there), so a plain typed constructor resolves to undefined
  // under the app-booting specs — the W-46 honest catch (the W-44
  // latent wiring bug, never exercised until the bridge's affected-
  // folder run paired the projects spec's AppModule boot with the
  // golden spec's journal submits: bindWorkflowEngine(undefined) —
  // the gateway's null check passes (undefined !== null) and every
  // submit crashes on ENGINE.openChain). The explicit tokens are
  // metadata-free by construction — immune in BOTH worlds.
  constructor(
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
    @Inject(EscalationService) private readonly escalation: EscalationService,
    @Inject(WorkflowAlertAdapter) private readonly alertAdapter: WorkflowAlertAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    // THE GATEWAY BINDING — the documented contract goes live (unbound
    // means the legacy path; every gateway function degrades safely).
    bindWorkflowEngine(this.engine);
    // THE ESCALATION SWEEP'S DAILY QUEUE (W-45, D-08): registers on
    // boot — the named schedule is idempotent (NO DOUBLE LAUNCH); the
    // registration failure is the catch-and-continue (the platform
    // boots regardless — the sweep joins the standing isolate set
    // from this wave, the SEVENTH).
    await registerWorkflowEscalationJob(getBoss(), this.escalation).catch((error) => {
      log.warn({ err: error }, "workflow escalation sweep registration failed");
    });
    // THE RULES-ALERT CONSUMER (W-47 — UX-13, D-10's bus-consumer law):
    // the adapter subscribes to the event bus at boot — the
    // workflow.instance.started consumer evaluating the configured
    // threshold/condition rules (the settings key workflow.alert_rules)
    // against the engine's own context assembly and raising the alerts
    // into the notifications inbox. The consumer acts INSIDE the
    // emitting request's envelope (the config-events law); its own
    // catch-and-continue degrades the alerts never the chain.
    this.alertAdapter.subscribe();
  }
}

/** THE EMAIL LEG (the 041 hub's template mail — the engine's own
 * notification surface): on every step assignment, when the assignee's
 * prefs carry email on (absent prefs mean email on — the 014 law),
 * enqueue the workflow_step_assigned template mail through the REAL
 * EmailService (the pg-boss jobId fingerprint's own dedupe makes a
 * re-assignment idempotent on the wire). The leg runs INSIDE the
 * emitting request's envelope (the config-events law); a failed
 * enqueue NEVER blocks the chain (the catch-and-continue — the inbox
 * leg already landed inside the emitting transaction). */
function moduleEmailLeg(email: EmailService): WorkflowEmailLeg {
  return {
    async enqueueStepAssignedMail(input): Promise<void> {
      try {
        const context = requireTenantContext();
        if (context.tx === undefined) {
          return;
        }
        const rows = await context.tx.execute(sql`
          SELECT u.email, COALESCE(u.locale, 'ar') AS locale
          FROM users u
          WHERE u.id = ${input.assigneeUserId}
          LIMIT 1
        `);
        const target = (rows.rows as unknown as { email: string; locale: string }[])[0];
        if (target === undefined) {
          return;
        }
        const prefRows = await context.tx.execute(sql`
          SELECT COALESCE(email, true) AS email
          FROM notification_prefs
          WHERE tenant_id = erp.current_tenant_id()
            AND user_id = ${input.assigneeUserId} AND category = 'workflow'
          LIMIT 1
        `);
        const pref = (prefRows.rows as unknown as { email: boolean }[])[0];
        if (pref !== undefined && !pref.email) {
          return;
        }
        await email.enqueue(context.tenantId, {
          template: "workflow_step_assigned",
          locale: target.locale === "en" ? "en" : "ar",
          recipient: target.email,
          variables: {
            docLabel: target.locale === "en" ? input.docLabelEn : input.docLabelAr,
            docNo: input.docNo,
            amount: input.amountBase,
            currency: input.currency,
            stepName: target.locale === "en" ? input.stepName : input.stepNameAr,
            docUrl: `${env.WEB_BASE_URL.replace(/\/$/, "")}${input.docUrl}`,
            // PHASE-052 (W-47 — D-09): THE DEEP-LINK URLS — the stateless
            // tokens rendered into the recipient's locale (the link shape
            // `${WEB_BASE_URL}/{locale}/workflow/act?token=…`; the single-use
            // + the deadline are the token's own claims — the mail renders
            // the deadline so the reader knows the window).
            approveUrl: `${env.WEB_BASE_URL.replace(/\/$/, "")}/${target.locale === "en" ? "en" : "ar"}/workflow/act?token=${input.approveToken}`,
            rejectUrl: `${env.WEB_BASE_URL.replace(/\/$/, "")}/${target.locale === "en" ? "en" : "ar"}/workflow/act?token=${input.rejectToken}`,
            deadline: input.tokenDeadline,
          },
        });
      } catch (error) {
        log.warn(
          { err: error, step: input.stepInstanceId },
          "workflow email leg failed (dropped — the inbox leg already landed)",
        );
      }
    },
  };
}
