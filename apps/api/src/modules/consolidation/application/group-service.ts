import { Inject, Injectable } from "@nestjs/common";

import { compareExact } from "../../accounting/application/decimal-strings";
import { AuditService } from "../../audit/api/audit";
import { GroupNotActiveError, GroupNotFoundError, OwnershipPercentInvalidError } from "../domain/consolidation-errors";
import { FX_TRANSLATION_METHODS, type FxTranslationMethod } from "./fx-translation";
import {
  findGroupById,
  findGroupMember,
  insertGroup,
  insertGroupMember,
  listGroupMembers,
  listGroups,
  updateGroup,
  updateGroupMember,
  type GroupMemberRow,
  type GroupRow,
} from "../infrastructure/consolidation.store";

/**
 * PHASE-034 T4 · groups & membership service: consolidation groups are
 * CONFIGURATION in the owner tenant's plane (ADR-0018 §1 — a legal entity =
 * a tenant, unchanged; membership is not a tenancy change). The owner
 * maintains membership under `consolidation.groups.manage` (audited); the
 * owner is itself typically a member; include_from bounds a member's
 * consolidated periods; ownership_percent is recorded for disclosure and
 * minority-interest presentation ONLY (DR-006 — no waterfall automation
 * promised at PHASE-034).
 *
 * Foreign tenant refs are typed 404s (A7/S-04 — the owner-scoped queries
 * make unknown and foreign indistinguishable); maintenance is audited; a
 * member may be REMOVED (deactivation, not deletion — history keeps the
 * row, INV-015 posture).
 */
@Injectable()
export class GroupService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async createGroup(input: {
    name: string;
    nameAr: string;
    baseCurrency: string;
    fxTranslationMethod?: FxTranslationMethod;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<GroupRow> {
    const method: FxTranslationMethod =
      input.fxTranslationMethod === undefined
        ? "CLOSING_RATE"
        : (FX_TRANSLATION_METHODS as readonly string[]).includes(input.fxTranslationMethod)
          ? input.fxTranslationMethod
          : "CLOSING_RATE";
    const group = await insertGroup({
      name: input.name,
      nameAr: input.nameAr,
      baseCurrency: input.baseCurrency,
      fxTranslationMethod: method,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "consolidation.group.created",
      entityType: "consolidation_group",
      entityId: group.id,
      actorId: input.actorId ?? undefined,
      after: { name: group.name, baseCurrency: group.baseCurrency, fxTranslationMethod: method },
    });
    return group;
  }

  async getGroup(groupId: string): Promise<GroupRow> {
    const group = await findGroupById(groupId);
    if (group === undefined) {
      throw new GroupNotFoundError(groupId);
    }
    return group;
  }

  async listGroups(): Promise<GroupRow[]> {
    return listGroups();
  }

  async updateGroup(
    groupId: string,
    patch: {
      name?: string;
      nameAr?: string;
      fxTranslationMethod?: FxTranslationMethod;
      status?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<GroupRow> {
    const before = await this.getGroup(groupId);
    const updated = await updateGroup(groupId, patch);
    if (updated === undefined) {
      throw new GroupNotFoundError(groupId);
    }
    await this.audit.record({
      action: "consolidation.group.updated",
      entityType: "consolidation_group",
      entityId: groupId,
      actorId: actorId ?? undefined,
      before: { status: before.status, fxTranslationMethod: before.fxTranslationMethod },
      after: { status: updated.status, fxTranslationMethod: updated.fxTranslationMethod },
    });
    return updated;
  }

  /** Add (or re-activate) a member. Audited; ownership_percent ∈ (0, 100]. */
  async addMember(input: {
    groupId: string;
    memberTenantId: string;
    ownershipPercent: string;
    includeFrom?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<GroupMemberRow> {
    const group = await this.getGroup(input.groupId);
    if (group.status !== "ACTIVE") {
      throw new GroupNotActiveError({ groupId: input.groupId, status: group.status });
    }
    if (
      compareExact(input.ownershipPercent, "0") <= 0 ||
      compareExact(input.ownershipPercent, "100") > 0
    ) {
      throw new OwnershipPercentInvalidError(input.ownershipPercent);
    }
    const member = await insertGroupMember({
      groupId: input.groupId,
      memberTenantId: input.memberTenantId,
      ownershipPercent: input.ownershipPercent,
      includeFrom: input.includeFrom ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "consolidation.group.member_added",
      entityType: "group_entity",
      entityId: member.id,
      actorId: input.actorId ?? undefined,
      after: {
        groupId: input.groupId,
        memberTenantId: input.memberTenantId,
        ownershipPercent: input.ownershipPercent,
        includeFrom: input.includeFrom ?? null,
      },
    });
    return member;
  }

  async listMembers(groupId: string): Promise<GroupMemberRow[]> {
    await this.getGroup(groupId);
    return listGroupMembers(groupId);
  }

  /** Update membership (ownership %, include_from) or REMOVE (status). */
  async updateMember(
    groupId: string,
    memberTenantId: string,
    patch: {
      ownershipPercent?: string;
      includeFrom?: string | null;
      status?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<GroupMemberRow> {
    await this.getGroup(groupId);
    const existing = await findGroupMember(groupId, memberTenantId);
    if (existing === undefined) {
      // A7: a foreign member id inside a payload is a typed 404, zero
      // partial application (S-04).
      throw new GroupNotFoundError(groupId);
    }
    if (
      patch.ownershipPercent !== undefined &&
      (compareExact(patch.ownershipPercent, "0") <= 0 ||
        compareExact(patch.ownershipPercent, "100") > 0)
    ) {
      throw new OwnershipPercentInvalidError(patch.ownershipPercent);
    }
    const updated = await updateGroupMember(existing.id, patch);
    if (updated === undefined) {
      throw new GroupNotFoundError(groupId);
    }
    await this.audit.record({
      action: "consolidation.group.member_updated",
      entityType: "group_entity",
      entityId: existing.id,
      actorId: actorId ?? undefined,
      before: {
        ownershipPercent: existing.ownershipPercent,
        includeFrom: existing.includeFrom,
        status: existing.status,
      },
      after: {
        ownershipPercent: updated.ownershipPercent,
        includeFrom: updated.includeFrom,
        status: updated.status,
      },
    });
    return updated;
  }
}
