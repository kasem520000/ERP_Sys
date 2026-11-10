import { Inject, Injectable } from "@nestjs/common";

import { env } from "../../../config/env";
import { AuditService } from "../../audit/api/audit";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import { EMAIL_SERVICE, type EmailService } from "../../notifications/notifications.module";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/crm.store";
import { TaskInputInvalidError, TaskNotFoundError, TaskStateError } from "../domain/crm-errors";
import { assertRelatedTarget, isRelatedType } from "./related-target";

/**
 * Task service (PHASE-019 T45; MASTER-PLAN §3): future work rows with the
 * reminder sweep. Lifecycle OPEN → DONE (complete) / CANCELLED (cancel);
 * the legal replays (complete-on-DONE, cancel-on-CANCELLED) return the
 * stored row (INV-013); cross-terminal transitions are typed TASK_STATE.
 * No ledger effects — tasks are operational rows only.
 *
 * The reminder sweep (the pg-boss queue `crm.task-reminders-sweep`, cron
 * 30 5 * * * — registered in crm.module.ts): per OPEN task with
 * remindAt <= now AND notifiedAt IS NULL → the owner-facing notification
 * (InboxService.notifyOwner — in-app row + email leg, prefs-aware) with
 * category "crm" and the `task_reminder` email template, then the
 * notifiedAt stamp. Idempotent twice over: the (notifiedAt IS NULL) scan
 * predicate + the dedupe key `crm-task-reminder:<taskId>:<remindAt>`
 * (uq_notifications_dedupe); a postponed remindAt re-arms via patchTask.
 */

export interface CreateTaskInput {
  title: string;
  relatedType: string;
  relatedId: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  remindAt: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export interface TaskPatch {
  title?: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  note?: string | null;
  noteAr?: string | null;
}

@Injectable()
export class TaskService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  async create(input: CreateTaskInput): Promise<store.TaskRow> {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 200) {
      throw new TaskInputInvalidError("task title is required (1..200 characters)");
    }
    if (!isRelatedType(input.relatedType)) {
      throw new TaskInputInvalidError(
        `relatedType must be LEAD, PARTNER, CONTRACT or SERVICE_ORDER (got ${input.relatedType})`,
      );
    }
    if (input.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      throw new TaskInputInvalidError(`dueDate must be an ISO date (YYYY-MM-DD): ${input.dueDate}`);
    }
    if (input.remindAt !== null && Number.isNaN(Date.parse(input.remindAt))) {
      throw new TaskInputInvalidError(`remindAt must be an ISO timestamp: ${input.remindAt}`);
    }
    await assertRelatedTarget(input.relatedType, input.relatedId);
    const task = await store.insertTask({
      title,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      assigneeUserId: input.assigneeUserId,
      dueDate: input.dueDate,
      remindAt: input.remindAt,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "crm.task.created",
      entityType: "crm_task",
      entityId: task.id,
      actorId: input.actorId ?? undefined,
      after: {
        title: task.title,
        relatedType: task.relatedType,
        relatedId: task.relatedId,
        dueDate: task.dueDate,
        remindAt: task.remindAt,
      },
    });
    return task;
  }

  async list(filter: {
    status?: string;
    relatedType?: string;
    relatedId?: string;
    limit: number;
  }): Promise<store.TaskRow[]> {
    return store.listTasks(filter);
  }

  async find(id: string): Promise<store.TaskRow> {
    const task = await store.findTaskById(id);
    if (task === undefined) throw new TaskNotFoundError(id);
    return task;
  }

  /** Field edits while OPEN only (terminal tasks are frozen — the
   * documented history). Carrying remindAt re-arms the reminder sweep. */
  async update(id: string, patch: TaskPatch, actorId: string | null): Promise<store.TaskRow> {
    const before = await this.find(id);
    if (before.status !== "OPEN") {
      throw new TaskStateError(`task ${id} is ${before.status} — only OPEN tasks can be edited`, {
        taskId: id,
        status: before.status,
      });
    }
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length < 1 || title.length > 200) {
        throw new TaskInputInvalidError("task title is required (1..200 characters)");
      }
      patch = { ...patch, title };
    }
    await store.patchTask({ id, ...patch });
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.task.updated",
      entityType: "crm_task",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { title: before.title, dueDate: before.dueDate, remindAt: before.remindAt },
      after: { title: after.title, dueDate: after.dueDate, remindAt: after.remindAt },
    });
    return after;
  }

  /** OPEN → DONE; DONE replay returns the stored row (INV-013). */
  async complete(id: string, actorId: string | null): Promise<store.TaskRow> {
    const task = await this.find(id);
    if (task.status === "DONE") {
      return task;
    }
    if (task.status !== "OPEN") {
      throw new TaskStateError(`task ${id} is ${task.status} and cannot be completed`, {
        taskId: id,
        status: task.status,
      });
    }
    await store.completeTask(id);
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.task.completed",
      entityType: "crm_task",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: task.status },
      after: { status: after.status },
    });
    return after;
  }

  /** OPEN → CANCELLED; CANCELLED replay returns the stored row (INV-013). */
  async cancel(id: string, actorId: string | null): Promise<store.TaskRow> {
    const task = await this.find(id);
    if (task.status === "CANCELLED") {
      return task;
    }
    if (task.status !== "OPEN") {
      throw new TaskStateError(`task ${id} is ${task.status} and cannot be cancelled`, {
        taskId: id,
        status: task.status,
      });
    }
    await store.cancelTask(id);
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.task.cancelled",
      entityType: "crm_task",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: task.status },
      after: { status: after.status },
    });
    return after;
  }

  /**
   * The per-tenant reminder pass (MASTER-PLAN §3): every OPEN task with a
   * due, unnotified reminder → the owner-facing notification (in-app row +
   * email leg — prefs suppress per channel) + the notifiedAt stamp. The
   * email rides the `task_reminder` template whose variables contract is
   * {title, tenantName, dueDate, tasksUrl} (notifications templates.ts).
   */
  async sweepReminders(): Promise<{ notified: number }> {
    const due = await store.listDueTaskReminders(new Date());
    let notified = 0;
    for (const task of due) {
      const tenantName = await store.readTenantName();
      const dueDate = task.dueDate ?? task.remindAt?.slice(0, 10) ?? "—";
      await this.inbox.notifyOwner(this.email, {
        category: "crm",
        severity: "info",
        title: { ar: `تذكير بمهمة مستحقة: ${task.title}`, en: `Task reminder due: ${task.title}` },
        body: {
          ar: `المهمة «${task.title}» مستحقة بتاريخ ${dueDate}. راجعها من مركز مهام CRM.`,
          en: `The task "${task.title}" is due on ${dueDate}. Review it from the CRM tasks workspace.`,
        },
        actionLabel: { ar: "مراجعة المهام", en: "Review tasks" },
        actionUrl: "/crm/tasks",
        dedupeKey: `crm-task-reminder:${task.id}:${task.remindAt}`,
        emailTemplate: "task_reminder",
        emailVariables: {
          title: task.title,
          tenantName,
          dueDate,
          tasksUrl: `${env.WEB_BASE_URL}/crm/tasks`,
        },
      });
      await store.markTaskNotified(task.id);
      notified += 1;
    }
    if (notified > 0) {
      // entity_id is NOT NULL — anchor the sweep's audit on the first
      // notified task (the after payload carries the full list), the
      // inventory.reservations_swept pattern. System action: no actor.
      await this.audit.record({
        action: "crm.task_reminders_swept",
        entityType: "crm_task",
        entityId: due[0]!.id,
        after: { notified, taskIds: due.map((task) => task.id) },
      });
    }
    return { notified };
  }

  /**
   * The system sweep job (the pg-boss schedule `crm.task-reminders-sweep`
   * enqueues here — the inventory expireReservations pattern): notify every
   * ACTIVE tenant's due reminders — one UoW per tenant (ADR-0005) so the
   * notification + stamp commit atomically per tenant.
   */
  async sweepAllReminders(): Promise<{ tenants: number; notified: number }> {
    const tenantIds = await listActiveTenantIds();
    let notified = 0;
    for (const tenantId of tenantIds) {
      const swept = await withTenant(tenantId, () => this.sweepReminders());
      notified += swept.notified;
    }
    return { tenants: tenantIds.length, notified };
  }
}
