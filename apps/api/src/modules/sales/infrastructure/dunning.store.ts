import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import {
  collectionActions,
  collectionAgencies,
  collectionReferrals,
  dunningLetters,
  dunningPolicies,
  partners,
} from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Dunning store (PHASE-039 0056/0057/0058): the ONLY writer of the dunning
 * engine's five tables (dunning_policies, dunning_letters,
 * collection_actions, collection_agencies, collection_referrals) and the
 * partner credit-risk block (0057's additive columns — the outcome stamp,
 * never a history table). Every statement runs in the caller's ambient
 * tenant UoW (the sourcing.store discipline over the drizzle schema
 * tables); grants are SELECT/INSERT/UPDATE only — the ladder and its
 * letters are compliance history, never deleted.
 *
 * BR-065's monotonic evidence is the letters table itself: UNIQUE
 * (tenant, invoice, step_no) — insertLetter surfaces that violation to the
 * service, which treats it as the re-fire guard (a step never fires twice).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("dunning access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Whole-UTC day difference (the aging() idiom — exact integer days). */
export function wholeDaysBetween(fromDate: string, toDate: string): number {
  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T00:00:00Z`).getTime();
  return ((toMs - fromMs) / (24 * 60 * 60 * 1000)) | 0;
}

// -- dunning_policies -----------------------------------------------------------------

export interface DunningPolicyRow {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  partnerTierIds: string[];
  isDefault: boolean;
  steps: Record<string, unknown>[];
  lateFeeMode: string;
  lateFeeRatePct: string | null;
  lateFeeGraceDays: number;
  lateFeeMaxAmount: string | null;
  lateFeeSource: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const POLICY_COLUMNS = {
  id: dunningPolicies.id,
  name: dunningPolicies.name,
  nameAr: dunningPolicies.nameAr,
  status: dunningPolicies.status,
  partnerTierIds: dunningPolicies.partnerTierIds,
  isDefault: dunningPolicies.isDefault,
  steps: dunningPolicies.steps,
  lateFeeMode: dunningPolicies.lateFeeMode,
  lateFeeRatePct: dunningPolicies.lateFeeRatePct,
  lateFeeGraceDays: dunningPolicies.lateFeeGraceDays,
  lateFeeMaxAmount: dunningPolicies.lateFeeMaxAmount,
  lateFeeSource: dunningPolicies.lateFeeSource,
  note: dunningPolicies.note,
  noteAr: dunningPolicies.noteAr,
  createdBy: dunningPolicies.createdBy,
  createdAt: dunningPolicies.createdAt,
  updatedAt: dunningPolicies.updatedAt,
  version: dunningPolicies.version,
} as const;

export interface PolicyInsertInput {
  name: string;
  nameAr: string | null;
  status: string;
  partnerTierIds: string[];
  isDefault: boolean;
  steps: Record<string, unknown>[];
  lateFeeMode: string;
  lateFeeRatePct: string | null;
  lateFeeGraceDays: number;
  lateFeeMaxAmount: string | null;
  lateFeeSource: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertPolicy(input: PolicyInsertInput): Promise<string> {
  const id = generateUuidV7();
  await tenantTx()
    .insert(dunningPolicies)
    .values({
      id,
      tenantId: sql`erp.current_tenant_id()`,
      createdBy: input.actorId,
      name: input.name,
      nameAr: input.nameAr,
      status: input.status,
      partnerTierIds: input.partnerTierIds,
      isDefault: input.isDefault,
      steps: input.steps,
      lateFeeMode: input.lateFeeMode,
      lateFeeRatePct: input.lateFeeRatePct,
      lateFeeGraceDays: input.lateFeeGraceDays,
      lateFeeMaxAmount: input.lateFeeMaxAmount,
      lateFeeSource: input.lateFeeSource,
      note: input.note,
      noteAr: input.noteAr,
    });
  return id;
}

export async function findPolicyById(id: string): Promise<DunningPolicyRow | undefined> {
  const rows = await tenantTx()
    .select(POLICY_COLUMNS)
    .from(dunningPolicies)
    .where(eq(dunningPolicies.id, id))
    .limit(1);
  return (rows as unknown as DunningPolicyRow[])[0];
}

export async function listPolicies(filter: { status?: string; limit: number }): Promise<DunningPolicyRow[]> {
  const conditions = [];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(eq(dunningPolicies.status, filter.status));
  }
  const rows = await tenantTx()
    .select(POLICY_COLUMNS)
    .from(dunningPolicies)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(dunningPolicies.createdAt))
    .limit(filter.limit);
  return rows as unknown as DunningPolicyRow[];
}

export async function listActivePolicies(limit: number): Promise<DunningPolicyRow[]> {
  const rows = await tenantTx()
    .select(POLICY_COLUMNS)
    .from(dunningPolicies)
    .where(eq(dunningPolicies.status, "ACTIVE"))
    .orderBy(desc(dunningPolicies.createdAt))
    .limit(limit);
  return rows as unknown as DunningPolicyRow[];
}

export interface PolicyPatch {
  name?: string;
  nameAr?: string | null;
  partnerTierIds?: string[];
  isDefault?: boolean;
  steps?: Record<string, unknown>[];
  lateFeeMode?: string;
  lateFeeRatePct?: string | null;
  lateFeeGraceDays?: number;
  lateFeeMaxAmount?: string | null;
  lateFeeSource?: string | null;
  note?: string | null;
  noteAr?: string | null;
}

export async function updatePolicy(id: string, patch: PolicyPatch): Promise<void> {
  await tenantTx()
    .update(dunningPolicies)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(dunningPolicies.id, id));
}

export async function setPolicyStatus(id: string, status: string): Promise<void> {
  await tenantTx()
    .update(dunningPolicies)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(dunningPolicies.id, id));
}

/** The ONE-ACTIVE-DEFAULT demotion: every OTHER default policy in the
 * tenant loses the flag (called in the same ambient UoW as the promote). */
export async function demoteOtherDefaults(keepPolicyId: string): Promise<void> {
  await tenantTx()
    .update(dunningPolicies)
    .set({ isDefault: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(dunningPolicies.isDefault, true),
        sql`${dunningPolicies.id} <> ${keepPolicyId}`,
      ),
    );
}

// -- dunning_letters --------------------------------------------------------------------

export interface DunningLetterRow {
  id: string;
  policyId: string;
  partnerId: string;
  invoiceId: string;
  stepNo: number;
  daysOverdue: number;
  letterDate: string;
  channel: string;
  templateKey: string;
  status: string;
  sentAt: string | null;
  emailTo: string | null;
  subject: string | null;
  bodySnapshot: string | null;
  error: string | null;
  feeAmount: string | null;
  feeInvoiceId: string | null;
  feeWaivedAt: string | null;
  feeWaivedBy: string | null;
  feeWaiverReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const LETTER_COLUMNS = {
  id: dunningLetters.id,
  policyId: dunningLetters.policyId,
  partnerId: dunningLetters.partnerId,
  invoiceId: dunningLetters.invoiceId,
  stepNo: dunningLetters.stepNo,
  daysOverdue: dunningLetters.daysOverdue,
  letterDate: dunningLetters.letterDate,
  channel: dunningLetters.channel,
  templateKey: dunningLetters.templateKey,
  status: dunningLetters.status,
  sentAt: dunningLetters.sentAt,
  emailTo: dunningLetters.emailTo,
  subject: dunningLetters.subject,
  bodySnapshot: dunningLetters.bodySnapshot,
  error: dunningLetters.error,
  feeAmount: dunningLetters.feeAmount,
  feeInvoiceId: dunningLetters.feeInvoiceId,
  feeWaivedAt: dunningLetters.feeWaivedAt,
  feeWaivedBy: dunningLetters.feeWaivedBy,
  feeWaiverReason: dunningLetters.feeWaiverReason,
  createdAt: dunningLetters.createdAt,
  updatedAt: dunningLetters.updatedAt,
  version: dunningLetters.version,
} as const;

export async function insertLetter(input: {
  policyId: string;
  partnerId: string;
  invoiceId: string;
  stepNo: number;
  daysOverdue: number;
  letterDate: string;
  channel: string;
  templateKey: string;
  emailTo: string | null;
  subject: string;
  bodySnapshot: string;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().insert(dunningLetters).values({
    id,
    tenantId: sql`erp.current_tenant_id()`,
    policyId: input.policyId,
    partnerId: input.partnerId,
    invoiceId: input.invoiceId,
    stepNo: input.stepNo,
    daysOverdue: input.daysOverdue,
    letterDate: input.letterDate,
    channel: input.channel,
    templateKey: input.templateKey,
    status: "QUEUED",
    emailTo: input.emailTo,
    subject: input.subject,
    bodySnapshot: input.bodySnapshot,
  });
  return id;
}

export async function findLetterById(id: string): Promise<DunningLetterRow | undefined> {
  const rows = await tenantTx()
    .select(LETTER_COLUMNS)
    .from(dunningLetters)
    .where(eq(dunningLetters.id, id))
    .limit(1);
  return (rows as unknown as DunningLetterRow[])[0];
}

export async function listLetters(filter: {
  partnerId?: string;
  invoiceId?: string;
  limit: number;
}): Promise<DunningLetterRow[]> {
  const conditions = [];
  if (filter.partnerId !== undefined && filter.partnerId !== "") {
    conditions.push(eq(dunningLetters.partnerId, filter.partnerId));
  }
  if (filter.invoiceId !== undefined && filter.invoiceId !== "") {
    conditions.push(eq(dunningLetters.invoiceId, filter.invoiceId));
  }
  const rows = await tenantTx()
    .select(LETTER_COLUMNS)
    .from(dunningLetters)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(dunningLetters.createdAt))
    .limit(filter.limit);
  return rows as unknown as DunningLetterRow[];
}

/** The BR-065 cursor: the highest step already fired for the invoice
 * (0 = no letter yet). Read with the letters the sweep is about to write. */
export async function maxLetterStepForInvoice(invoiceId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(MAX(step_no), 0)::int AS step
    FROM dunning_letters WHERE invoice_id = ${invoiceId}
  `);
  return (rows.rows as unknown as { step: number }[])[0]?.step ?? 0;
}

/** Mark the letter SENT, stamping the contact email it was addressed to
 * (the register IS the delivery evidence — 0056's email_to column). */
export async function markLetterSent(id: string, emailTo: string): Promise<void> {
  await tenantTx()
    .update(dunningLetters)
    .set({ status: "SENT", sentAt: sql`now()`, emailTo, updatedAt: sql`now()` })
    .where(eq(dunningLetters.id, id));
}

export async function markLetterFailed(id: string, error: string): Promise<void> {
  await tenantTx()
    .update(dunningLetters)
    .set({ status: "FAILED", error, updatedAt: sql`now()` })
    .where(eq(dunningLetters.id, id));
}

/** The late-fee register: stamp the charging step's letter (L1-12). */
export async function stampLetterFee(
  id: string,
  stamp: { feeAmount: string; feeInvoiceId: string },
): Promise<void> {
  await tenantTx()
    .update(dunningLetters)
    .set({
      feeAmount: stamp.feeAmount,
      feeInvoiceId: stamp.feeInvoiceId,
      updatedAt: sql`now()`,
    })
    .where(eq(dunningLetters.id, id));
}

/** The waiver trio (the L1-12 waiver path marks, never posts). */
export async function waiveLetterFee(
  id: string,
  stamp: { waivedAt: string; waivedBy: string | null; reason: string },
): Promise<void> {
  await tenantTx()
    .update(dunningLetters)
    .set({
      feeWaivedAt: stamp.waivedAt,
      feeWaivedBy: stamp.waivedBy,
      feeWaiverReason: stamp.reason,
      updatedAt: sql`now()`,
    })
    .where(eq(dunningLetters.id, id));
}

// -- collection_actions ------------------------------------------------------------------

export interface CollectionActionRow {
  id: string;
  partnerId: string;
  invoiceId: string | null;
  policyId: string | null;
  actionType: string;
  actionDate: string;
  outcome: string;
  promisedDate: string | null;
  followUpDate: string | null;
  amount: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ACTION_COLUMNS = {
  id: collectionActions.id,
  partnerId: collectionActions.partnerId,
  invoiceId: collectionActions.invoiceId,
  policyId: collectionActions.policyId,
  actionType: collectionActions.actionType,
  actionDate: collectionActions.actionDate,
  outcome: collectionActions.outcome,
  promisedDate: collectionActions.promisedDate,
  followUpDate: collectionActions.followUpDate,
  amount: collectionActions.amount,
  note: collectionActions.note,
  noteAr: collectionActions.noteAr,
  createdBy: collectionActions.createdBy,
  createdAt: collectionActions.createdAt,
  updatedAt: collectionActions.updatedAt,
  version: collectionActions.version,
} as const;

export async function insertAction(input: {
  partnerId: string;
  invoiceId: string | null;
  policyId: string | null;
  actionType: string;
  actionDate: string;
  outcome: string;
  promisedDate: string | null;
  followUpDate: string | null;
  amount: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().insert(collectionActions).values({
    id,
    tenantId: sql`erp.current_tenant_id()`,
    createdBy: input.actorId,
    partnerId: input.partnerId,
    invoiceId: input.invoiceId,
    policyId: input.policyId,
    actionType: input.actionType,
    actionDate: input.actionDate,
    outcome: input.outcome,
    promisedDate: input.promisedDate,
    followUpDate: input.followUpDate,
    amount: input.amount,
    note: input.note,
    noteAr: input.noteAr,
  });
  return id;
}

export async function findActionById(id: string): Promise<CollectionActionRow | undefined> {
  const rows = await tenantTx()
    .select(ACTION_COLUMNS)
    .from(collectionActions)
    .where(eq(collectionActions.id, id))
    .limit(1);
  return (rows as unknown as CollectionActionRow[])[0];
}

export async function listActions(filter: {
  partnerId?: string;
  invoiceId?: string;
  limit: number;
}): Promise<CollectionActionRow[]> {
  const conditions = [];
  if (filter.partnerId !== undefined && filter.partnerId !== "") {
    conditions.push(eq(collectionActions.partnerId, filter.partnerId));
  }
  if (filter.invoiceId !== undefined && filter.invoiceId !== "") {
    conditions.push(eq(collectionActions.invoiceId, filter.invoiceId));
  }
  const rows = await tenantTx()
    .select(ACTION_COLUMNS)
    .from(collectionActions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(collectionActions.createdAt))
    .limit(filter.limit);
  return rows as unknown as CollectionActionRow[];
}

// -- collection_agencies -------------------------------------------------------------------

export interface CollectionAgencyRow {
  id: string;
  partnerId: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  commissionMode: string;
  commissionPct: string | null;
  flatFee: string | null;
  status: string;
  portalTokenHash: string | null;
  tokenIssuedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const AGENCY_COLUMNS = {
  id: collectionAgencies.id,
  partnerId: collectionAgencies.partnerId,
  contactName: collectionAgencies.contactName,
  email: collectionAgencies.email,
  phone: collectionAgencies.phone,
  commissionMode: collectionAgencies.commissionMode,
  commissionPct: collectionAgencies.commissionPct,
  flatFee: collectionAgencies.flatFee,
  status: collectionAgencies.status,
  portalTokenHash: collectionAgencies.portalTokenHash,
  tokenIssuedAt: collectionAgencies.tokenIssuedAt,
  note: collectionAgencies.note,
  noteAr: collectionAgencies.noteAr,
  createdBy: collectionAgencies.createdBy,
  createdAt: collectionAgencies.createdAt,
  updatedAt: collectionAgencies.updatedAt,
  version: collectionAgencies.version,
} as const;

export async function insertAgency(input: {
  partnerId: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  commissionMode: string;
  commissionPct: string | null;
  flatFee: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().insert(collectionAgencies).values({
    id,
    tenantId: sql`erp.current_tenant_id()`,
    createdBy: input.actorId,
    partnerId: input.partnerId,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    commissionMode: input.commissionMode,
    commissionPct: input.commissionPct,
    flatFee: input.flatFee,
    status: "ACTIVE",
    note: input.note,
    noteAr: input.noteAr,
  });
  return id;
}

export async function findAgencyById(id: string): Promise<CollectionAgencyRow | undefined> {
  const rows = await tenantTx()
    .select(AGENCY_COLUMNS)
    .from(collectionAgencies)
    .where(eq(collectionAgencies.id, id))
    .limit(1);
  return (rows as unknown as CollectionAgencyRow[])[0];
}

export async function listAgencies(filter: {
  status?: string;
  limit: number;
}): Promise<CollectionAgencyRow[]> {
  const conditions = [];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(eq(collectionAgencies.status, filter.status));
  }
  const rows = await tenantTx()
    .select(AGENCY_COLUMNS)
    .from(collectionAgencies)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(collectionAgencies.createdAt))
    .limit(filter.limit);
  return rows as unknown as CollectionAgencyRow[];
}

export async function setAgencyStatus(id: string, status: string): Promise<void> {
  await tenantTx()
    .update(collectionAgencies)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(collectionAgencies.id, id));
}

/** Token issuance (the 038 portal pattern): sha256(token) at rest + the
 * issued-at stamp; the raw token is shown ONCE, never stored. */
export async function setAgencyToken(
  id: string,
  tokenHash: string,
): Promise<void> {
  await tenantTx()
    .update(collectionAgencies)
    .set({ portalTokenHash: tokenHash, tokenIssuedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(collectionAgencies.id, id));
}

/** The withTenant re-validation arm of the callback: the hash resolves to
 * exactly one ACTIVE agency under RLS (the pre-GUC projection already
 * resolved the tenant; this read re-proves it inside the tenant scope). */
export async function findAgencyByTokenHash(tokenHash: string): Promise<CollectionAgencyRow | undefined> {
  const rows = await tenantTx()
    .select(AGENCY_COLUMNS)
    .from(collectionAgencies)
    .where(and(eq(collectionAgencies.portalTokenHash, tokenHash), eq(collectionAgencies.status, "ACTIVE")))
    .limit(1);
  return (rows as unknown as CollectionAgencyRow[])[0];
}

// -- collection_referrals ---------------------------------------------------------------------

export interface CollectionReferralRow {
  id: string;
  agencyId: string;
  partnerId: string;
  invoiceId: string | null;
  actionId: string | null;
  currencyCode: string;
  referralDate: string;
  referredAmount: string;
  commissionMode: string;
  commissionPct: string | null;
  flatFee: string | null;
  status: string;
  settledAmount: string;
  settledAt: string | null;
  commissionAmount: string | null;
  commissionJournalId: string | null;
  commissionEntryNo: string | null;
  closedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const REFERRAL_COLUMNS = {
  id: collectionReferrals.id,
  agencyId: collectionReferrals.agencyId,
  partnerId: collectionReferrals.partnerId,
  invoiceId: collectionReferrals.invoiceId,
  actionId: collectionReferrals.actionId,
  currencyCode: collectionReferrals.currencyCode,
  referralDate: collectionReferrals.referralDate,
  referredAmount: collectionReferrals.referredAmount,
  commissionMode: collectionReferrals.commissionMode,
  commissionPct: collectionReferrals.commissionPct,
  flatFee: collectionReferrals.flatFee,
  status: collectionReferrals.status,
  settledAmount: collectionReferrals.settledAmount,
  settledAt: collectionReferrals.settledAt,
  commissionAmount: collectionReferrals.commissionAmount,
  commissionJournalId: collectionReferrals.commissionJournalId,
  commissionEntryNo: collectionReferrals.commissionEntryNo,
  closedAt: collectionReferrals.closedAt,
  note: collectionReferrals.note,
  noteAr: collectionReferrals.noteAr,
  createdBy: collectionReferrals.createdBy,
  createdAt: collectionReferrals.createdAt,
  updatedAt: collectionReferrals.updatedAt,
  version: collectionReferrals.version,
} as const;

export async function insertReferral(input: {
  agencyId: string;
  partnerId: string;
  invoiceId: string | null;
  actionId: string | null;
  currencyCode: string;
  referralDate: string;
  referredAmount: string;
  commissionMode: string;
  commissionPct: string | null;
  flatFee: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().insert(collectionReferrals).values({
    id,
    tenantId: sql`erp.current_tenant_id()`,
    createdBy: input.actorId,
    agencyId: input.agencyId,
    partnerId: input.partnerId,
    invoiceId: input.invoiceId,
    actionId: input.actionId,
    currencyCode: input.currencyCode,
    referralDate: input.referralDate,
    referredAmount: input.referredAmount,
    commissionMode: input.commissionMode,
    commissionPct: input.commissionPct,
    flatFee: input.flatFee,
    status: "REFERRED",
    note: input.note,
    noteAr: input.noteAr,
  });
  return id;
}

export async function findReferralById(id: string): Promise<CollectionReferralRow | undefined> {
  const rows = await tenantTx()
    .select(REFERRAL_COLUMNS)
    .from(collectionReferrals)
    .where(eq(collectionReferrals.id, id))
    .limit(1);
  return (rows as unknown as CollectionReferralRow[])[0];
}

export async function listReferrals(filter: {
  agencyId?: string;
  partnerId?: string;
  limit: number;
}): Promise<CollectionReferralRow[]> {
  const conditions = [];
  if (filter.agencyId !== undefined && filter.agencyId !== "") {
    conditions.push(eq(collectionReferrals.agencyId, filter.agencyId));
  }
  if (filter.partnerId !== undefined && filter.partnerId !== "") {
    conditions.push(eq(collectionReferrals.partnerId, filter.partnerId));
  }
  const rows = await tenantTx()
    .select(REFERRAL_COLUMNS)
    .from(collectionReferrals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(collectionReferrals.createdAt))
    .limit(filter.limit);
  return rows as unknown as CollectionReferralRow[];
}

export interface ReferralPatch {
  status?: string;
  settledAmount?: string;
  settledAt?: string | null;
  commissionAmount?: string;
  commissionJournalId?: string;
  commissionEntryNo?: string | null;
  closedAt?: string | null;
}

export async function setReferralStatus(id: string, patch: ReferralPatch): Promise<void> {
  await tenantTx()
    .update(collectionReferrals)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(collectionReferrals.id, id));
}

// -- partner credit risk (0057; L1-10) --------------------------------------------------------

export interface PartnerCreditRiskRow {
  partnerId: string;
  code: string;
  name: string;
  nameAr: string | null;
  customerTierId: string | null;
  creditScoreClass: string | null;
  creditReviewFrequencyDays: number | null;
  nextCreditReviewAt: string | null;
  lastCreditReviewAt: string | null;
  lastCreditReviewBy: string | null;
  creditReviewNote: string | null;
}

const CREDIT_RISK_COLUMNS = {
  partnerId: partners.id,
  code: partners.code,
  name: partners.name,
  nameAr: partners.nameAr,
  customerTierId: partners.customerTierId,
  creditScoreClass: partners.creditScoreClass,
  creditReviewFrequencyDays: partners.creditReviewFrequencyDays,
  nextCreditReviewAt: partners.nextCreditReviewAt,
  lastCreditReviewAt: partners.lastCreditReviewAt,
  lastCreditReviewBy: partners.lastCreditReviewBy,
  creditReviewNote: partners.creditReviewNote,
} as const;

export async function findPartnerCreditRisk(partnerId: string): Promise<PartnerCreditRiskRow | undefined> {
  const rows = await tenantTx()
    .select(CREDIT_RISK_COLUMNS)
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);
  return (rows as unknown as PartnerCreditRiskRow[])[0];
}

/** The review-due sweep workset: partners whose next_credit_review_at has
 * arrived (the 0057 partial index's exact shape). */
export async function partnersDueForReview(input: {
  asOf: string;
  limit: number;
}): Promise<PartnerCreditRiskRow[]> {
  const rows = await tenantTx()
    .select(CREDIT_RISK_COLUMNS)
    .from(partners)
    .where(
      and(
        sql`${partners.nextCreditReviewAt} IS NOT NULL`,
        sql`${partners.nextCreditReviewAt} <= ${input.asOf}`,
      ),
    )
    .orderBy(partners.nextCreditReviewAt)
    .limit(input.limit);
  return rows as unknown as PartnerCreditRiskRow[];
}

/** The credit-risk register: partners carrying ANY credit-risk data (a
 * class or a review clock) — the GET credit-reviews surface. */
export async function partnersWithCreditProfile(limit: number): Promise<PartnerCreditRiskRow[]> {
  const rows = await tenantTx()
    .select(CREDIT_RISK_COLUMNS)
    .from(partners)
    .where(
      sql`${partners.creditScoreClass} IS NOT NULL OR ${partners.nextCreditReviewAt} IS NOT NULL`,
    )
    .orderBy(partners.code)
    .limit(limit);
  return rows as unknown as PartnerCreditRiskRow[];
}

export async function setPartnerCreditRisk(
  partnerId: string,
  patch: {
    /** null = the review CLEARS the class (A→unset — the DB CHECK allows it). */
    creditScoreClass?: string | null;
    creditReviewFrequencyDays?: number;
    nextCreditReviewAt?: string | null;
    lastCreditReviewAt?: string;
    lastCreditReviewBy?: string | null;
    creditReviewNote?: string | null;
  },
): Promise<void> {
  await tenantTx()
    .update(partners)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(partners.id, partnerId));
}

// -- the sweep worksets -------------------------------------------------------------------------

export interface OverdueArItemRow {
  invoiceId: string;
  invoiceNo: string | null;
  partnerId: string;
  dueDate: string;
  outstanding: string;
  currencyCode: string;
  exchangeRate: string;
}

/**
 * The dunning sweep's workset: OPEN POSTED credit invoices past due with
 * outstanding AR (the arOpenItemsAsOf shape, folded to one row per
 * invoice — the letter's unit). Outstanding mirrors the receipts
 * allocation fold verbatim (POSTED receipts/payments + note-owned).
 */
export async function overdueArItems(input: { asOf: string; limit: number }): Promise<OverdueArItemRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT i.id AS "invoiceId", i.invoice_no AS "invoiceNo", i.customer_id AS "partnerId",
           i.due_date::text AS "dueDate", o.outstanding, i.currency_code AS "currencyCode",
           COALESCE(i.exchange_rate, 1)::text AS "exchangeRate"
    FROM sales_invoices i
    JOIN LATERAL (
      SELECT (s.amount - COALESCE((
        SELECT SUM(a.amount) FROM treasury_allocations a
        WHERE a.open_item_id = s.id
          AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                   WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
            OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                   WHERE p.id = a.payment_id AND p.status = 'POSTED'))
            OR (a.note_id IS NOT NULL))), 0))::numeric(19,4) AS outstanding
      FROM partner_subledger_entries s
      WHERE s.source_type = 'sales_invoice' AND s.source_id = i.id AND s.direction = 'DEBIT'
    ) o ON o.outstanding > 0
    WHERE i.status = 'POSTED' AND i.kind = 'CREDIT' AND i.due_date < ${input.asOf}
    ORDER BY i.due_date, i.id
    LIMIT ${input.limit}
  `);
  return rows.rows as unknown as OverdueArItemRow[];
}

/** The current AR outstanding of ONE invoice (the late-fee base, L1-12) —
 * the same allocation fold as overdueArItems, single-row. */
export async function invoiceArOutstanding(invoiceId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT (s.amount - COALESCE((
      SELECT SUM(a.amount) FROM treasury_allocations a
      WHERE a.open_item_id = s.id
        AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                 WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
          OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                 WHERE p.id = a.payment_id AND p.status = 'POSTED'))
          OR (a.note_id IS NOT NULL))), 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    WHERE s.source_type = 'sales_invoice' AND s.source_id = ${invoiceId} AND s.direction = 'DEBIT'
    ORDER BY s.created_at
    LIMIT 1
  `);
  return (rows.rows as unknown as { outstanding: string }[])[0]?.outstanding ?? "0.0000";
}

/** The aging report's dunning column: max step fired per partner. */
export async function maxLetterStepByPartner(partnerIds: readonly string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (partnerIds.length === 0) return map;
  const rows = await tenantTx()
    .select({
      partnerId: dunningLetters.partnerId,
      step: sql<number>`COALESCE(MAX(${dunningLetters.stepNo}), 0)::int`,
    })
    .from(dunningLetters)
    .where(inArray(dunningLetters.partnerId, [...partnerIds]))
    .groupBy(dunningLetters.partnerId);
  for (const row of rows as unknown as { partnerId: string; step: number }[]) {
    map.set(row.partnerId, row.step);
  }
  return map;
}

/** The letter's contact email: the partner's primary contact with an
 * email, else the first contact carrying one (null = no email on file). */
export async function findPartnerContactEmail(partnerId: string): Promise<string | null> {
  const rows = await tenantTx().execute(sql`
    SELECT email FROM partner_contacts
    WHERE partner_id = ${partnerId} AND email IS NOT NULL
    ORDER BY is_primary DESC, created_at
    LIMIT 1
  `);
  return (rows.rows as unknown as { email: string }[])[0]?.email ?? null;
}
