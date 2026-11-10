import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/accounting.store";
import {
  AccountArchivedError,
  AccountCodeTakenError,
  AccountCycleError,
  AccountHasChildrenError,
  AccountHasPostingsError,
  AccountMappedToPurposeError,
  AccountNotFoundError,
  AccountTypeLockedError,
  AccountTypeMismatchError,
  PurposeAlreadyMappedError,
} from "../domain/accounting-errors";

/**
 * CoA readiness service (PHASE-007 T3; CHART_OF_ACCOUNTS.md): tree rules
 * V1–V6, purpose resolution (1 active mapping per purpose — V1), and the
 * INV-015 archive/delete guards. The engine consumes `findActivePurpose`
 * directly; this service is the user-facing management surface.
 */

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

@Injectable()
export class CoaService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter?: { type?: string; status?: string; q?: string }) {
    return store.listAccounts(filter);
  }

  async get(id: string): Promise<store.AccountRow> {
    const account = await store.findAccountById(id);
    if (account === undefined) throw new AccountNotFoundError(id);
    return account;
  }

  async listPurposes() {
    return store.listPurposes();
  }

  /**
   * Create an account (V3 homogeneous tree, V5 postable = leaf ∧ not group).
   * A new account with no children is a postable leaf unless declared a
   * group node explicitly (`isGroup`).
   */
  async create(
    actorId: string,
    input: {
      code: string;
      name: string;
      nameAr: string | null;
      type: string;
      parentId: string | null;
      currencyCode: string | null;
      isGroup: boolean;
    },
  ): Promise<store.AccountRow> {
    if (!ACCOUNT_TYPES.includes(input.type as AccountType)) {
      throw new AccountTypeMismatchError(input.type, "ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE");
    }
    const taken = await store.findAccountByCode(input.code);
    if (taken !== undefined) throw new AccountCodeTakenError(input.code);
    let parent: store.AccountRow | undefined;
    if (input.parentId !== null) {
      parent = await store.findAccountById(input.parentId);
      if (parent === undefined) throw new AccountNotFoundError(input.parentId);
      // V3: parent/child type must match (tree stays homogeneous).
      if (parent.type !== input.type) {
        throw new AccountTypeMismatchError(parent.type, input.type);
      }
      // A group parent cannot itself be a postable leaf.
      if (parent.isPostable) {
        throw new AccountTypeMismatchError("postable-leaf", "group-parent");
      }
    }
    const created = await store.insertAccount({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      type: input.type,
      parentId: input.parentId,
      currencyCode: input.currencyCode,
      // V5: postable = leaf ∧ not group.
      isPostable: !input.isGroup,
    });
    await this.audit.record({
      action: "accounting.account_created",
      entityType: "account",
      entityId: created.id,
      actorId,
      after: { code: created.code, type: created.type, parentId: created.parentId },
    });
    return created;
  }

  /**
   * Update an account. V2: the type cannot change once postings exist.
   * Re-parenting re-runs the cycle + homogeneity checks. Code renumbering
   * is allowed only before the first posting (INV-021-adjacent stability).
   */
  async update(
    actorId: string,
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      parentId?: string | null;
      currencyCode?: string | null;
      code?: string;
      version?: number;
    },
  ): Promise<store.AccountRow> {
    const before = await store.findAccountById(id);
    if (before === undefined) throw new AccountNotFoundError(id);
    if (patch.code !== undefined && patch.code !== before.code) {
      const postings = await store.countAccountLines(id);
      if (postings > 0) {
        throw new AccountTypeLockedError(id); // codes frozen after first posting
      }
      const taken = await store.findAccountByCode(patch.code);
      if (taken !== undefined) throw new AccountCodeTakenError(patch.code);
    }
    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === id) throw new AccountCycleError();
      const ancestors = await store.pathOfParents(patch.parentId);
      if (ancestors.includes(id)) throw new AccountCycleError();
      const parent = await store.findAccountById(patch.parentId);
      if (parent === undefined) throw new AccountNotFoundError(patch.parentId);
      if (parent.type !== before.type) throw new AccountTypeMismatchError(parent.type, before.type);
    }
    const updated = await store.updateAccount(id, patch);
    if (updated === undefined) throw new AccountNotFoundError(id);
    await this.audit.record({
      action: "accounting.account_updated",
      entityType: "account",
      entityId: id,
      actorId,
      before: { code: before.code, name: before.name, parentId: before.parentId },
      after: { code: updated.code, name: updated.name, parentId: updated.parentId },
    });
    return updated;
  }

  /**
   * INV-015 guards: an account with postings or children cannot be deleted;
   * archive is blocked while the account is the active mapping of a purpose.
   */
  async archive(actorId: string, id: string): Promise<store.AccountRow> {
    const account = await store.findAccountById(id);
    if (account === undefined) throw new AccountNotFoundError(id);
    if (await store.accountHasActivePurpose(id)) {
      throw new AccountMappedToPurposeError(id);
    }
    const archived = await store.setAccountStatus(id, "ARCHIVED");
    if (archived === undefined) throw new AccountNotFoundError(id);
    await this.audit.record({
      action: "accounting.account_archived",
      entityType: "account",
      entityId: id,
      actorId,
      before: { status: "ACTIVE" },
      after: { status: "ARCHIVED" },
    });
    return archived;
  }

  /** INV-015: delete is refused for accounts with postings or children. */
  async assertDeletable(id: string): Promise<void> {
    const account = await store.findAccountById(id);
    if (account === undefined) throw new AccountNotFoundError(id);
    const children = await store.countChildAccounts(id);
    if (children > 0) throw new AccountHasChildrenError(id);
    const postings = await store.countAccountLines(id);
    if (postings > 0) throw new AccountHasPostingsError(id);
    if (await store.accountHasActivePurpose(id)) throw new AccountMappedToPurposeError(id);
  }

  /**
   * Map a purpose (V1): exactly ONE active mapping per purpose per tenant —
   * supersede-then-map, history preserved for report-time resolution.
   */
  async mapPurpose(
    actorId: string,
    input: { purposeKey: string; accountId: string; activeFrom: string },
  ): Promise<store.PurposeRow> {
    const account = await store.findAccountById(input.accountId);
    if (account === undefined) throw new AccountNotFoundError(input.accountId);
    if (account.status === "ARCHIVED") throw new AccountArchivedError(input.accountId);
    if (!account.isPostable) {
      // A purpose must map to a postable leaf (INV-004 at resolution time).
      throw new AccountHasChildrenError(input.accountId);
    }
    const existing = await store.findActivePurpose(input.purposeKey);
    if (existing !== undefined && existing.accountId !== input.accountId) {
      throw new PurposeAlreadyMappedError(input.purposeKey);
    }
    const mapped = await store.mapPurpose(input);
    await this.audit.record({
      action: "accounting.purpose_mapped",
      entityType: "account_purpose",
      entityId: mapped.id,
      actorId,
      after: { purposeKey: input.purposeKey, accountId: input.accountId, code: account.code },
    });
    return mapped;
  }

  /** Supersede (close) an active mapping — the engine then fails closed. */
  async supersedePurpose(
    actorId: string,
    purposeKey: string,
    activeTo: string,
  ): Promise<void> {
    const existing = await store.findActivePurpose(purposeKey);
    if (existing === undefined) return;
    await store.supersedePurpose(existing.id, activeTo);
    await this.audit.record({
      action: "accounting.purpose_superseded",
      entityType: "account_purpose",
      entityId: existing.id,
      actorId,
      before: { purposeKey, active: true },
      after: { purposeKey, activeTo },
    });
  }
}
