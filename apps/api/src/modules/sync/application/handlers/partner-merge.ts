import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { partnerContactMergeSchema } from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-020 · `partner:contact_merge` (MASTER-PLAN §7 FIELD_LEVEL_MERGE
 * row; CONFLICT_RESOLUTION §2 partner-contact row + §6.2 worked example;
 * SYNC_PROTOCOL §3/§6). v2 only — no legacy shape exists for it.
 *
 * DECISION (schema reality, recorded in T-P20-2b-push.md): the partners
 * TABLE has no contact columns (0009 DDL — name/kind/code/tax/credit/
 * terms/price-list/status only). The whitelisted contact fields live in
 * the partners module's CHILD tables: partner_contacts (name/phone/email/
 * role/is_primary) + partner_addresses (type/line1/line2/city). The merge
 * therefore upserts the partner's primary contact row (phone, email,
 * contactPerson→name) and its BILLING address row (addressLine1→line1,
 * addressLine2→line2, city→city) — the partners row itself gets only the
 * marker stamp (updated_at + version+1) so the catch-up writer re-projects
 * the partner feed row.
 *
 * `phone2` has NO server column home anywhere in the schema (checked
 * repo-wide) — a payload carrying it is rejected fail-closed
 * (VALIDATION_ERROR details.unsupportedFields) instead of silently
 * dropping an acknowledged edit.
 *
 * Constrained fields (CONFLICT_RESOLUTION §2: creditLimit, paymentTerms/
 * terms, taxNumber, priceListId, status) are checked on the RAW payload
 * object BEFORE the schema parse (the schema would also reject them, but
 * the raw check yields the typed details.constrainedFields the protocol
 * prescribes) — zero merge.
 */

/** The constrained partner fields (the actual 0009 partners columns:
 * credit_limit, credit_terms_id, tax_number, price_list_id, status — the
 * payload vocabulary is camelCase; `terms` is an accepted alias of
 * paymentTerms). */
const CONSTRAINED_KEYS = [
  "creditLimit",
  "paymentTerms",
  "terms",
  "taxNumber",
  "priceListId",
  "status",
] as const;

/** A field the payload carries (present, not undefined). */
type FieldDiff = { field: string; before: unknown; after: unknown };

function present<T extends Record<string, unknown>>(
  payload: T,
  key: string,
): boolean {
  return payload[key] !== undefined;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}
interface AddressRow {
  id: string;
  line1: string;
  line2: string | null;
  city: string | null;
  type: string;
}

/** The partner's primary contact row (is_primary first, else earliest). */
async function primaryContact(partnerId: string): Promise<ContactRow | null> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT id, name, phone, email, is_primary
    FROM partner_contacts
    WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${partnerId}::uuid
    ORDER BY is_primary DESC, created_at, id
    LIMIT 1
  `);
  return (rows.rows as unknown as ContactRow[])[0] ?? null;
}

/** The partner's billing address row (BILLING first, else earliest). */
async function billingAddress(partnerId: string): Promise<AddressRow | null> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT id, line1, line2, city, type
    FROM partner_addresses
    WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${partnerId}::uuid
    ORDER BY (type = 'BILLING') DESC, created_at, id
    LIMIT 1
  `);
  return (rows.rows as unknown as AddressRow[])[0] ?? null;
}

export const partnerContactMergeHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    // No legacy shape exists for contact_merge (016 shipped pos_sale +
    // cashier_shift only) — a legacy command can never dispatch here.
    handlerValidationError("partner:contact_merge is a v2-only intent");
  }
  const raw = ctx.command.payload;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    handlerValidationError("partner:contact_merge payload must be an object");
  }
  const rawObject = raw as Record<string, unknown>;

  // 1. Constrained-field gate on the RAW payload (before the schema): the
  // typed details.constrainedFields the protocol prescribes.
  const constrained = CONSTRAINED_KEYS.filter((key) => present(rawObject, key));
  if (constrained.length > 0) {
    handlerValidationError(
      "partner:contact_merge cannot carry constrained partner fields — edit them online",
      { constrainedFields: constrained },
    );
  }

  // 2. Schema parse (whitelist + ≥1 whitelisted field present).
  const parsed = partnerContactMergeSchema.safeParse(raw);
  if (!parsed.success) {
    handlerValidationError(
      "partner:contact_merge payload rejected by the contract",
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  const payload = parsed.data;

  // 3. phone2 has no server column home — fail closed, never a silent drop.
  if (payload.phone2 !== undefined) {
    handlerValidationError(
      "field phone2 has no server-side column home in the partner schema — remove it and resend",
      { unsupportedFields: ["phone2"] },
    );
  }

  // 4. Load the partner (RLS tenant-scoped; identical error for
  // unknown-vs-foreign ids — no existence disclosure).
  const tx = requireTenantContext().tx!;
  const partnerRows = await tx.execute(sql`
    SELECT id, status, deleted_at, version FROM partners
    WHERE tenant_id = erp.current_tenant_id() AND id = ${payload.partnerId}::uuid
    LIMIT 1
  `);
  const partner = (partnerRows.rows as unknown as { id: string; status: string; deleted_at: string | null; version: number }[])[0];
  if (partner === undefined || partner.deleted_at !== null) {
    handlerValidationError(`partner ${payload.partnerId} does not exist in this tenant`);
  }

  // 5. Load the current rows (before values).
  const contact = await primaryContact(payload.partnerId);
  const address = await billingAddress(payload.partnerId);

  // 6. Validate every present field BEFORE any write (zero-residue — the
  // DB CHECKs mirror these; validating first keeps the ambient tx clean).
  if (payload.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
    handlerValidationError(`email ${payload.email} is not a valid email (partner_contacts shape)`);
  }
  if (payload.phone !== undefined && !/^\+?[0-9]{6,20}$/.test(payload.phone)) {
    handlerValidationError(`phone ${payload.phone} is not a valid phone (partner_contacts shape)`);
  }
  if (payload.contactPerson !== undefined) {
    const name = payload.contactPerson;
    if (name.length < 1 || name.length > 200) {
      handlerValidationError("contactPerson must be 1..200 characters (partner_contacts.name)");
    }
  }
  if (payload.addressLine1 !== undefined) {
    const line1 = payload.addressLine1;
    if (line1.length < 1 || line1.length > 300) {
      handlerValidationError("addressLine1 must be 1..300 characters (partner_addresses.line1)");
    }
  }
  const wantsAddress =
    payload.addressLine1 !== undefined ||
    payload.addressLine2 !== undefined ||
    payload.city !== undefined;
  if (address === null && wantsAddress && payload.addressLine1 === undefined) {
    handlerValidationError(
      "the partner has no billing address row and the payload carries no addressLine1 — a new row requires it (partner_addresses.line1 NOT NULL)",
    );
  }

  // 7. Build the diff (per-field before/after — CONFLICT_RESOLUTION §6.2).
  const merged: FieldDiff[] = [];
  if (payload.phone !== undefined) {
    merged.push({ field: "phone", before: contact?.phone ?? null, after: payload.phone });
  }
  if (payload.email !== undefined) {
    merged.push({ field: "email", before: contact?.email ?? null, after: payload.email });
  }
  if (payload.contactPerson !== undefined) {
    merged.push({ field: "contactPerson", before: contact?.name ?? null, after: payload.contactPerson });
  }
  if (payload.addressLine1 !== undefined) {
    merged.push({ field: "addressLine1", before: address?.line1 ?? null, after: payload.addressLine1 });
  }
  if (payload.addressLine2 !== undefined) {
    merged.push({ field: "addressLine2", before: address?.line2 ?? null, after: payload.addressLine2 });
  }
  if (payload.city !== undefined) {
    merged.push({ field: "city", before: address?.city ?? null, after: payload.city });
  }

  // 8. Apply (all validation above passed — the writes cannot fail on
  // shape): contact row upsert, address row upsert, partners marker stamp.
  if (contact !== null) {
    await tx.execute(sql`
      UPDATE partner_contacts SET
        phone = COALESCE(${payload.phone ?? null}, phone),
        email = COALESCE(${payload.email ?? null}, email),
        name = COALESCE(${payload.contactPerson ?? null}, name),
        version = version + 1, updated_at = now()
      WHERE tenant_id = erp.current_tenant_id() AND id = ${contact.id}::uuid
    `);
  } else if (payload.phone !== undefined || payload.email !== undefined || payload.contactPerson !== undefined) {
    await tx.execute(sql`
      INSERT INTO partner_contacts
        (id, tenant_id, partner_id, name, phone, email, role, is_primary, version)
      VALUES
        (${generateUuidV7()}, erp.current_tenant_id(), ${payload.partnerId}::uuid,
         ${payload.contactPerson ?? "Primary contact"}, ${payload.phone ?? null},
         ${payload.email ?? null}, null, true, 1)
    `);
  }
  if (address !== null) {
    await tx.execute(sql`
      UPDATE partner_addresses SET
        line1 = COALESCE(${payload.addressLine1 ?? null}, line1),
        line2 = COALESCE(${payload.addressLine2 ?? null}, line2),
        city = COALESCE(${payload.city ?? null}, city),
        version = version + 1, updated_at = now()
      WHERE tenant_id = erp.current_tenant_id() AND id = ${address.id}::uuid
    `);
  } else if (wantsAddress) {
    await tx.execute(sql`
      INSERT INTO partner_addresses
        (id, tenant_id, partner_id, type, line1, line2, city, country_code, version)
      VALUES
        (${generateUuidV7()}, erp.current_tenant_id(), ${payload.partnerId}::uuid,
         'BILLING', ${payload.addressLine1!}, ${payload.addressLine2 ?? null},
         ${payload.city ?? null}, null, 1)
    `);
  }

  // The marker stamp: moves updated_at (the catch-up writer's watermark
  // input — this is what makes the merge re-pullable) + bumps the partner
  // aggregate version (the feed marker's version).
  await tx.execute(sql`
    UPDATE partners SET updated_at = now(), version = version + 1
    WHERE tenant_id = erp.current_tenant_id() AND id = ${payload.partnerId}::uuid
  `);

  // 9. Audit (AuditEventInput carries before/after slots — the per-field
  // before/after list rides `after` as the protocol's details object).
  await handlerServices().audit.record({
    action: "partner.contact_field_merged",
    entityType: "partner",
    entityId: payload.partnerId,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: { partnerId: payload.partnerId, fields: merged },
  });

  const version = partner.version + 1;
  return {
    status: "ACCEPTED",
    result: { mergedFields: merged },
    entity: { id: payload.partnerId, version },
    feedEntries: [
      {
        entityType: "partners",
        entityId: payload.partnerId,
        op: "UPSERT" as const,
        payload: { id: payload.partnerId, version },
      },
    ],
  };
};
