import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { WorkflowDeepLinkService } from "../application/deep-link-service";
import { WorkflowTaskLaneService } from "../application/task-lane-service";
import {
  WorkflowApprovalInboxService,
  isWorkflowTriggerEntity,
} from "../application/approval-inbox-service";
import {
  WorkflowDefinitionsService,
  type DefinitionInput,
} from "../application/definitions-service";
import { WorkflowInputInvalidError } from "../domain/workflow-errors";

/**
 * PHASE-052 (W-47 — T-06, dated 2026-11-27) THE WORKFLOW ACT SURFACE —
 * the module's FIRST routes (the engine core was service-layer, W-44;
 * the routes land here per the plan's own sequencing). THE DEEP-LINK
 * LAW (D-09 — the acceptance #6 spine):
 *
 *   `GET /api/v1/workflow/act` — the LINK PREVIEW: the act page's own
 *   read (the step's rendering facts for a USABLE token — the same
 *   decode/expire/actor floors as the act; the W-48 web plane renders
 *   this, never the claims parsed client-side). Session-authenticated
 *   (SESSION_ROUTES — the notifications self-plane pattern: the link's
 *   user is the reader; the actor-mismatch floor still compares the
 *   session against the token's bound user).
 *
 *   `POST /api/v1/workflow/act` — THE ACT through the signed one-time
 *   token: session-authenticated (never an unauthenticated action
 *   surface — the risk §7 law), permission-guarded on `workflow.
 *   approve` (matrix §3.30 — the approve/reject act key), feature-
 *   gated on `workflow.engine` (D-04 — the base unit), Idempotency-
 *   Key'd by the global POST guard, and single-use by the step's own
 *   CAS stamp (the acted_at stamp is the ledger — NO token table).
 *
 * The typed refusals (the D-09 family, registered in error.filter.ts's
 * domainStatus chain in THIS increment — the PHASE-045 T-03 lesson):
 * WORKFLOW_TOKEN_EXPIRED (the claim's own deadline) ·
 * WORKFLOW_TOKEN_ACTOR_MISMATCH (the link's bound user vs the session)
 * · WORKFLOW_STEP_ALREADY_ACTED (the replay — the CAS single-use) ·
 * WORKFLOW_INPUT_INVALID (the tamper/shape class) ·
 * WORKFLOW_STEP_INSTANCE_NOT_FOUND (the A7 404 parity).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const actSchema = z.object({
  token: z.string().min(1).max(4_096),
  comment: z.string().max(2_000).nullable().optional(),
});

const taskCompleteSchema = z.object({
  comment: z.string().max(2_000).nullable().optional(),
});

// PHASE-052 (W-48 — T-10/T-11/T-12, dated 2026-11-28): the web plane's
// own zod vocabularies — the definitions' editor body (the steps'
// conditions VERBATIM — the D-06 fold is the ONE validator, never a
// parallel zod schema), the inbox act body, and the timeline's query
// floors.
const stepInputSchema = z.object({
  stepType: z.string(),
  assigneeRule: z.string(),
  assigneeValue: z.string(),
  conditions: z.unknown(),
  slaHours: z.number().int().nullable(),
  name: z.string(),
  nameAr: z.string(),
});

const definitionInputSchema = z.object({
  name: z.string(),
  nameAr: z.string(),
  triggerEntity: z.string(),
  active: z.boolean(),
  conditions: z.unknown(),
  steps: z.array(stepInputSchema).min(1).max(20),
});

const approvalActSchema = z.object({
  verdict: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().max(2_000).nullable().optional(),
});

const UUID = z.string().uuid();

@Controller("api/v1/workflow")
export class WorkflowController {
  constructor(
    @Inject(WorkflowDeepLinkService) private readonly deepLinks: WorkflowDeepLinkService,
    @Inject(WorkflowTaskLaneService) private readonly taskLane: WorkflowTaskLaneService,
    @Inject(WorkflowApprovalInboxService)
    private readonly approvalInbox: WorkflowApprovalInboxService,
    @Inject(WorkflowDefinitionsService)
    private readonly definitions: WorkflowDefinitionsService,
  ) {}

  /** The link preview — the act page's own read (SESSION_ROUTES: the
   * notifications self-plane pattern; the token's floors still run —
   * a dead link previews as the typed refusal, never a stale form). */
  @Get("act")
  async preview(@Req() request: Request, @Query("token") token?: string): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsed = actSchema.pick({ token: true }).parse({ token });
    return envelope(
      await this.deepLinks.previewToken({ token: parsed.token, actorId: identity.userId }),
    );
  }

  /** THE ACT through the signed one-time deep link (D-09): the approve
   * or reject lands through the engine's own act path — the G-67 floor,
   * the delegation resolution, the actor law, the CAS single-use stamp,
   * the pointer walk, the notifications, the bus. The comment captures
   * with the act (the acceptance #6's own record). */
  @Post("act")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("workflow.approve")
  @RequireFeature("workflow.engine")
  async act(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsed = actSchema.parse(body);
    return envelope(
      await this.deepLinks.actThroughToken({
        token: parsed.token,
        actorId: identity.userId,
        comment: parsed.comment ?? null,
      }),
    );
  }

  // ── PHASE-052 (W-47 — T-08, D-11): THE TASKS LANE — the document-
  // linked tasks' own self plane (SESSION_ROUTES: every authenticated
  // user works their own lane — the notifications self-plane pattern;
  // the actor law is the engine's own floor, not a role key). The
  // tasks ARE the workflow_step_instances (type TASK — no seventh
  // table); the list is the PENDING TASK steps on ACTIVE chains
  // assigned to the caller; the completion write-back is the step's
  // own ACTED stamp (the engine's act path VERBATIM). Feature-gated on
  // `workflow.tasks` (D-04 — the composable unit).

  /** The caller's own task lane (the typed list — the W-48 inbox's
   * tasks lane renders this shape). */
  @Get("tasks")
  @RequireFeature("workflow.tasks")
  async tasks(@Req() request: Request, @Query("limit") rawLimit?: string): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 100;
    return envelope(await this.taskLane.listMyTasks({ userId: identity.userId, limit }));
  }

  /** THE COMPLETION WRITE-BACK: the task's completion is the step's
   * own ACTED stamp (single-use — the acted_at stamp is the ledger);
   * the pointer advances, the chain completes when the task was the
   * last step. The comment captures with the act. */
  @Post("tasks/:id/complete")
  @HttpCode(HttpStatus.OK)
  @RequireFeature("workflow.tasks")
  async completeTask(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const taskId = UUID.parse(id);
    const parsed = taskCompleteSchema.parse(body ?? {});
    return envelope(
      await this.taskLane.completeTask({
        taskStepId: taskId,
        actorId: identity.userId,
        comment: parsed.comment ?? null,
      }),
    );
  }

  // ── PHASE-052 (W-48 — T-10/T-11/T-12, dated 2026-11-28): THE WEB
  // PLANE'S OWN BACKEND — the approvals inbox (the PENDING work with
  // the aging figures the DB's own clock computes + the quick actions
  // through the engine's own act path), the timeline read (PP-17's
  // full step history on the bound detail pages), and the chain
  // editor's definitions CRUD (the form-first editor's backend — the
  // validation fold FIRST, the audit seal at every write, deactivation
  // the path — definitions are never deleted). The keys are the
  // 0130-seeded matrix §3.30 rows; the flags the 0130 §5 composable
  // units (workflow.definitions the editor plane, workflow.engine the
  // inbox + the timeline).

  /** THE APPROVALS INBOX — the caller's PENDING work: the current
   * APPROVAL steps assigned to them + the delegation lane (the absent
   * assignees' steps routed to them as the resolution terminal). The
   * aging figures (ageHours · overdue) are the DB's own clock's,
   * rendered VERBATIM. Permission-gated on `workflow.inbox.act`, the
   * flag on `workflow.engine`. */
  @Get("approvals")
  @RequirePermissions("workflow.inbox.act")
  @RequireFeature("workflow.engine")
  async approvals(@Req() request: Request, @Query("limit") rawLimit?: string): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 100;
    return envelope(await this.approvalInbox.listMyApprovals({ userId: identity.userId, limit }));
  }

  /** THE QUICK ACTION — approve/reject with the comment: the engine's
   * own act path VERBATIM (every floor the deep-link act rides — the
   * G-67 floor, the delegation resolution, the actor law, the CAS
   * single-use stamp). Permission-gated on `workflow.approve` (the
   * act key — the same key the deep-link act carries), the flag on
   * `workflow.engine`. */
  @Post("approvals/:id/act")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("workflow.approve")
  @RequireFeature("workflow.engine")
  async actOnApproval(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const stepInstanceId = UUID.parse(id);
    const parsed = approvalActSchema.parse(body);
    return envelope(
      await this.approvalInbox.actOnStep({
        stepInstanceId,
        actorId: identity.userId,
        verdict: parsed.verdict,
        comment: parsed.comment ?? null,
      }),
    );
  }

  /** THE TIMELINE READ (PP-17): the document's chain — the full step
   * history (state, assignee, delegated_to, acted_at, comment) + the
   * document's own rendering facts. A document with no chain is the
   * honest instance-null read (the detail page's own "no chain"
   * state). Permission-gated on `workflow.history.view`, the flag on
   * `workflow.engine`. */
  @Get("timeline")
  @RequirePermissions("workflow.history.view")
  @RequireFeature("workflow.engine")
  async timeline(
    @Query("entity") entity?: string,
    @Query("documentId") documentId?: string,
  ): Promise<unknown> {
    if (entity === undefined || !isWorkflowTriggerEntity(entity)) {
      throw new WorkflowInputInvalidError({
        field: "entity",
        reason:
          "the timeline's entity must be one of the bound registry (manual_journal · purchase_order · change_order · duty_drawback_claim)",
      });
    }
    const document = UUID.parse(documentId ?? "");
    return envelope(
      await this.approvalInbox.readTimeline({ triggerEntity: entity, documentId: document }),
    );
  }

  /** THE EDITOR'S LIST — every definition with its ordered steps (the
   * form-first editor's register). Permission-gated on
   * `workflow.definitions.manage`, the flag on `workflow.definitions`. */
  @Get("definitions")
  @RequirePermissions("workflow.definitions.manage")
  @RequireFeature("workflow.definitions")
  async listDefinitions(): Promise<unknown> {
    return envelope(await this.definitions.list());
  }

  /** THE EDITOR'S CREATE — the validation fold FIRST (the typed
   * refusals naming the field/condition BY PATH), the trigger event
   * DERIVED (the mapping law — the editor never sends it). */
  @Post("definitions")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("workflow.definitions.manage")
  @RequireFeature("workflow.definitions")
  async createDefinition(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = definitionInputSchema.parse(body) as DefinitionInput;
    return envelope(await this.definitions.create({ actorId: identity.userId, body: input }));
  }

  /** THE EDITOR'S UPDATE — the steps REPLACED in one transaction; the
   * trigger binding IMMUTABLE (a re-bind is a new definition); an edit
   * never touches a live instance (the snapshots are frozen). */
  @Put("definitions/:id")
  @RequirePermissions("workflow.definitions.manage")
  @RequireFeature("workflow.definitions")
  async updateDefinition(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const definitionId = UUID.parse(id);
    const input = definitionInputSchema.parse(body) as DefinitionInput;
    return envelope(
      await this.definitions.update({
        actorId: identity.userId,
        definitionId,
        body: input,
      }),
    );
  }
}
