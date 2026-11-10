import { partnerCreatePayloadSchema } from "@erp/contracts";

import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-021 · DR-P21-08 · `partner:create` (MASTER-PLAN §6 table row 1;
 * OFFLINE_CAPABILITIES_MATRIX row 7 — SERVER_DECIDES): the 016 partner
 * create pattern over the partners module's PartnerService.create —
 * BR-025 auto-numbered codes, credit-terms/price-list existence checks
 * and the service's own audit event live there; sync adds transport,
 * never a second business-logic path.
 *
 * v2 only (the desktop OFFLINE-DRAFT capability class). Contact/address
 * child rows are NOT part of this intent — they ride 020's
 * `partner:contact_merge` (their owning surface).
 */
export const partnerCreateHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("partner:create is a v2-only intent");
  }
  const parsed = partnerCreatePayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("partner:create payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // PartnerService.create's actorId is the device's user (devices.user_id
  // is NOT NULL by DDL — the guard is fail-closed typing, never live).
  if (ctx.userId === null) {
    handlerValidationError("partner:create requires a device user (devices.user_id)");
  }

  // The partners module's create (BR-025 code rules + credit-terms/
  // price-list gates + the partner.created audit event live there).
  const created = await handlerServices().partners.create(ctx.userId, {
    kind: payload.kind,
    ...(payload.code !== undefined ? { code: payload.code } : {}),
    name: payload.name,
    nameAr: payload.nameAr ?? null,
    taxNumber: payload.taxNumber ?? null,
    creditLimit: payload.creditLimit ?? null,
    creditTermsId: payload.creditTermsId ?? null,
    priceListId: payload.priceListId ?? null,
  });

  // Device provenance: the service's audit row carries the actor only —
  // this event records the offline-create surface (the device identity).
  await handlerServices().audit.record({
    action: "partner.offline_created",
    entityType: "partner",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: { code: created.code, kind: created.kind, name: created.name },
  });

  return {
    status: "ACCEPTED",
    result: { partnerId: created.id, code: created.code, status: created.status },
    entity: { id: created.id, version: created.version },
    feedEntries: [
      {
        // partners IS a pulled feed entity (POS group) — the header-only
        // marker makes the new partner re-pullable in the same tx; the
        // catch-up writer projects the full row at pull time.
        entityType: "partners",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version: created.version },
      },
    ],
  };
};
