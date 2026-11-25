import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { CertificateService } from "../application/certificate-service";

/**
 * PHASE-051 (W-39 — T-14, 2026-11-25) the trade certificate routes
 * (matrix §3.29, the keys-seed-first discipline's SIXTH trade binding
 * wave — the keys landed at W-33 (0122 §5), the routes bind as the
 * service waves ship, every change dated at the ROUTE_PERMISSIONS
 * block): the certificates bind trade.view over the reads (the
 * register + the find — the frozen snapshot rides the row) and
 * trade.shipments.manage over THE ISSUE (the transport-documents
 * cluster's own manage key — the 0120 family: the B/L, the packing
 * lists and the certificates are one cluster, the BL/PL precedent's
 * own key; no new key minted, the 357 discipline standing). The
 * routes are feature-gated at the controller on the whole-module unit
 * `trade` (D-04 — the certificates carry no own flag). Foreign/
 * unknown ids are 404-shaped (A7 — RLS makes them indistinguishable).
 * The issue's response is the stored row — the frozen snapshot IS the
 * certificate (the W-39 print surface renders it VERBATIM, D-13).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const NOTE = z.string().max(2000).nullable().optional();
const PARTY = z.string().min(1).max(300);
const HS_CODE = z.string().regex(/^[0-9]{2,10}$/, "2…10 digits (the harmonized system's own shape)");
const ORIGIN = z.string().regex(/^[A-Z]{2}$/, "an ISO-3166 alpha-2 code");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "a non-negative decimal (≤ 6dp)");

const goodsLineSchema = z.object({
  description: z.string().min(1).max(200),
  originCountry: ORIGIN,
  hsCode: HS_CODE.nullable().optional(),
  quantity: QTY.nullable().optional(),
  uom: z.string().min(1).max(20).nullable().optional(),
});

const issueCertificateSchema = z.object({
  certType: z.enum(["ORIGIN", "CONFORMITY"]),
  exporterName: PARTY,
  consigneeName: PARTY,
  billOfLadingId: UUID.nullable().optional(),
  declarationId: UUID.nullable().optional(),
  goods: z.array(goodsLineSchema).min(1).max(200),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/trade/certificates")
export class TradeCertificatesController {
  constructor(@Inject(CertificateService) private readonly certificates: CertificateService) {}

  // ── the register reads (the frozen snapshots ride the rows) ─────────

  @Get()
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  listCertificates(@Query("certType") certType?: string) {
    return envelope(
      this.certificates.list({
        certType: certType === undefined || certType === "" ? undefined : certType,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  async findCertificate(@Param("id") id: string) {
    return envelope(await this.certificates.find(id));
  }

  // ── the issue (the frozen snapshot's own door — D-13's anchor) ───────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.shipments.manage")
  @RequireFeature("trade")
  async issueCertificate(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = issueCertificateSchema.parse(body);
    return envelope(
      await this.certificates.issue({
        certType: input.certType,
        exporterName: input.exporterName,
        consigneeName: input.consigneeName,
        billOfLadingId: input.billOfLadingId ?? null,
        declarationId: input.declarationId ?? null,
        goods: input.goods,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
