import { Inject, Injectable } from "@nestjs/common";
import QRCode from "qrcode";

import { AuditService } from "../../audit/api/audit";
import { keyMaterialForTokens } from "../../identity/infrastructure/reset-token-key";
import * as store from "../infrastructure/cmms.store";
import { buildTagCode, verifyTagCode } from "../domain/cmms-tag-code";
import {
  CmmsAssetNotOperableError,
  CmmsInputInvalidError,
  CmmsTagAlreadyPrintedError,
  CmmsTagCodeInvalidError,
  CmmsTagNotFoundError,
} from "../domain/cmms-errors";

/**
 * PHASE-049 (W-19 — T-11) THE SIGNED TAGS (D-09 — FA-F-06, the owner's
 * W-19 order: «البطاقات بسلالم CAS ورفض مُنمّط بالاسم وصفر حساب موازٍ»):
 *
 *   THE CODES (the capability-token precedent — the pure folds'
 *   `base64url(payload).base64url(hmac)`): 256-bit entropy payloads signed
 *   with the platform's key material (one identity secret, the reset-token
 *   derivation, one rotation story). The signature NEVER EXPIRES — the
 *   physical label's law; revocation is the register's act (the row dies,
 *   the scan 404s).
 *
 *   THE SCAN (the phase doc's mitigation, verbatim): «an unsigned/forged
 *   code refuses at the signature, never at a lookup» — verifyTagCode runs
 *   BEFORE any DB touch (TAG_CODE_INVALID); only a platform-signed code
 *   reaches the RLS-scoped lookup, where a foreign tenant's row is
 *   invisible (TAG_NOT_FOUND — the typed 404, never a cross-tenant
 *   oracle). The resolution returns THE ASSET CARD: the register brief +
 *   the four expiry chips + the maintenance context (the open orders, the
 *   active plans) + the odometer binding (R-10) — the card the W-21 plane
 *   renders.
 *
 *   THE CAS LADDER (سلالم CAS): the printed stamp is the
 *   single-consumption seal — ONE guarded UPDATE pinning printed_at IS
 *   NULL (the 0105 completion-stamp precedent's tags sibling); the
 *   already-printed tag refuses BY NAME carrying the standing stamp
 *   (TAG_ALREADY_PRINTED — the honest alternative: a NEW tag, a fresh
 *   code; the old label dies with its row).
 *
 *   ZERO PARALLEL ACCOUNTING (صفر حساب موازٍ): the asset_tags table IS
 *   the one register — no batch table, no printed-count column (the
 *   printed state derives from printed_at), no code registry beside the
 *   code column; the print sheet's batch is DERIVED from the rows (the
 *   unprinted tags for one asset), never a stored list.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One sheet's batch bound (the print plane's one-sheet-per-batch law —
 * a bounded create, never an unbounded loop). */
const MAX_BATCH = 50;
/** The structural-collision regeneration bound (a 2^-256 event — the
 * bounded loop is the honest non-event, never an infinite one). */
const MAX_CODE_ATTEMPTS = 3;

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable()
export class AssetTagsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- the register (the batch create + the list) --------------------------

  /**
   * Create the batch (1…50 codes for one asset, ONE transaction): each
   * code is generated + signed + inserted through the structural unique
   * (uq_asset_tags_tenant_code); the bounded regeneration loop absorbs
   * the impossible collision. The asset must exist and be operable (a
   * disposed/written-off asset takes no new labels — D-01's guard).
   */
  async createTags(input: {
    assetId: string;
    quantity?: number;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.TagRow[]> {
    if (!UUID_RE.test(input.assetId)) {
      throw new CmmsInputInvalidError(`assetId must be a UUID: ${input.assetId}`);
    }
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCH) {
      throw new CmmsInputInvalidError(`quantity must be an integer 1…${MAX_BATCH}: ${quantity}`);
    }
    const asset = await store.findAssetStatus(input.assetId);
    if (asset === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    if (asset.status !== "ACTIVE") {
      throw new CmmsAssetNotOperableError({ assetId: input.assetId, status: asset.status });
    }

    const key = keyMaterialForTokens();
    const created: store.TagRow[] = [];
    for (let index = 0; index < quantity; index += 1) {
      let row: store.TagRow | undefined;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && row === undefined; attempt += 1) {
        const { code } = buildTagCode(key);
        row = await store.insertTag({
          assetId: input.assetId,
          code,
          note: input.note ?? null,
          noteAr: input.noteAr ?? null,
          createdBy: input.actorId,
        });
      }
      if (row === undefined) {
        throw new CmmsInputInvalidError(
          `tag code generation collided ${MAX_CODE_ATTEMPTS} times for asset ${input.assetId} — a 2^-256 event; retry the batch`,
        );
      }
      created.push(row);
    }

    await this.audit.record({
      action: "assets.asset_tags_created",
      entityType: "asset_tags",
      entityId: input.assetId,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: input.assetId,
        count: created.length,
        tagIds: created.map((tag) => tag.id),
      },
    });
    return created;
  }

  async listTags(filter: { assetId?: string }): Promise<store.TagRow[]> {
    if (filter.assetId !== undefined && !UUID_RE.test(filter.assetId)) {
      throw new CmmsInputInvalidError(`assetId must be a UUID: ${filter.assetId}`);
    }
    return store.listTags(filter);
  }

  // -- the printed stamp (the single-consumption CAS seal) ------------------

  /** Print ONE tag: the stamp lands through the guarded CAS; the
   * already-printed tag refuses BY NAME with the standing stamp (print a
   * NEW tag instead — the honest alternative). */
  async printTag(input: { tagId: string; actorId: string | null }): Promise<store.TagRow> {
    if (!UUID_RE.test(input.tagId)) {
      throw new CmmsInputInvalidError(`tagId must be a UUID: ${input.tagId}`);
    }
    const standing = await store.findTagById(input.tagId);
    if (standing === undefined) {
      throw new CmmsTagNotFoundError({ tagId: input.tagId });
    }
    const stamped = await store.stampTagPrinted({
      tagId: input.tagId,
      printedAt: nowIso(),
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      // The CAS lost: the standing row's stamp is the refusal's payload.
      const current = await store.findTagById(input.tagId);
      throw new CmmsTagAlreadyPrintedError({
        tagId: input.tagId,
        printedAt: current?.printedAt ?? standing.printedAt ?? nowIso(),
      });
    }
    await this.audit.record({
      action: "assets.asset_tag_printed",
      entityType: "asset_tag",
      entityId: input.tagId,
      actorId: input.actorId ?? undefined,
      before: { printedAt: standing.printedAt },
      after: { printedAt: stamped.printedAt },
    });
    return stamped;
  }

  /** The register-hygiene delete (a mistyped batch's cleanup or a retired
   * label): the code stops resolving the moment the row dies — the audit
   * carries the before (the printed state included). */
  async deleteTag(input: { tagId: string; actorId: string | null }): Promise<void> {
    if (!UUID_RE.test(input.tagId)) {
      throw new CmmsInputInvalidError(`tagId must be a UUID: ${input.tagId}`);
    }
    const standing = await store.findTagById(input.tagId);
    if (standing === undefined) {
      throw new CmmsTagNotFoundError({ tagId: input.tagId });
    }
    const deleted = await store.deleteTag(input.tagId);
    if (!deleted) {
      throw new CmmsTagNotFoundError({ tagId: input.tagId });
    }
    await this.audit.record({
      action: "assets.asset_tag_deleted",
      entityType: "asset_tag",
      entityId: input.tagId,
      actorId: input.actorId ?? undefined,
      before: { code: standing.code, printedAt: standing.printedAt },
    });
  }

  // -- the print sheet (the batch payload — the W-21 plane renders it) -----

  /** ONE SHEET PER TAG BATCH (D-09): the asset brief + its UNPRINTED tags,
   * each carrying its PRE-RENDERED QR data URI — the payload the print
   * plane renders deterministically with `bi()` (the W-13 law: the print
   * templates never compute a QR; the pixels are derived here, server-side,
   * exactly as the ZATCA renderer derives its images at print — same
   * qrcode options, deterministic for the same code string). ZERO PARALLEL
   * ACCOUNTING: the batch derives from the rows, never a stored list. */
  async printSheet(input: { assetId: string }): Promise<{
    asset: { id: string; code: string; name: string; nameAr: string };
    tags: (store.TagRow & { qrImageUri: string })[];
  }> {
    if (!UUID_RE.test(input.assetId)) {
      throw new CmmsInputInvalidError(`assetId must be a UUID: ${input.assetId}`);
    }
    const card = await store.findAssetCard(input.assetId);
    if (card === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    const tags = await store.listUnprintedTags(input.assetId);
    const withQr = await Promise.all(
      tags.map(async (tag) => ({
        ...tag,
        qrImageUri: await QRCode.toDataURL(tag.code, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 256,
        }),
      })),
    );
    return {
      asset: { id: card.id, code: card.code, name: card.name, nameAr: card.nameAr },
      tags: withQr,
    };
  }

  // -- the scan surface (the resolution — D-09's mitigation verbatim) ------

  /**
   * Resolve a scanned code to THE ASSET CARD. The order is the law: (1)
   * the signature — a malformed/forged code NEVER touches the database
   * (TAG_CODE_INVALID, never a lookup); (2) the RLS-scoped register read
   * — a foreign tenant's row is invisible (TAG_NOT_FOUND, the typed 404);
   * (3) the card's payload: the register brief + the four expiry chips +
   * the maintenance context + the odometer binding.
   */
  async scanCode(input: { code: string }): Promise<{
    tag: store.TagRow;
    asset: store.AssetCardRow;
    openWorkOrders: number;
    activePlans: number;
    odometer: {
      meterId: string;
      name: string;
      nameAr: string | null;
      unit: string;
      lastValue: string;
    } | null;
  }> {
    const verified = verifyTagCode(keyMaterialForTokens(), input.code);
    if (verified === null) {
      throw new CmmsTagCodeInvalidError();
    }
    const tag = await store.findTagByCode(input.code);
    if (tag === undefined) {
      throw new CmmsTagNotFoundError({ code: input.code });
    }
    const asset = await store.findAssetCard(tag.assetId);
    if (asset === undefined) {
      // The tag outlived its asset row — impossible under the FK's
      // RESTRICT, but the read is honest anyway (the typed 404).
      throw new CmmsTagNotFoundError({ code: input.code });
    }
    const summary = await store.assetMaintenanceSummary(tag.assetId);
    const odometer = await store.findAssetOdometer(tag.assetId);
    return {
      tag,
      asset,
      openWorkOrders: summary.openWorkOrders,
      activePlans: summary.activePlans,
      odometer: odometer ?? null,
    };
  }
}
