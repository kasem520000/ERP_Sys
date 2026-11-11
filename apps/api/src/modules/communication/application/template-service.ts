/**
 * PHASE-041 (T-04 · FD-30) — the tenant template service: channel × locale
 * × module CRUD with typed variables + the renderer. The effective
 * resolution: tenant row || builtin fallback (a tenant never faces an
 * empty template); tenant overrides validate against the SAME rules the
 * migration's CHECKs pin (EMAIL requires a subject; WHATSAPP/SMS are
 * body-only) plus the service-layer shape contract PostgreSQL's
 * no-subquery CHECK limitation moved here (the variables array's
 * per-element shape: name/required/description).
 *
 * Rendering is FAIL-CLOSED (the §3.5 discipline — resolve BEFORE the
 * port): a missing required variable throws (a message must NEVER go out
 * as "Hello {{customer_name}}"); the rendered output is byte-stable pure
 * text. WhatsApp templates render the BODY plus the ORDERED positional
 * parameters (declaration order = WhatsApp's parameter order).
 */

import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { OutboundChannel } from "../domain/channel-port";
import {
  TemplateNotFoundError,
  TemplateRenderError,
  TemplateShapeInvalidError,
} from "../domain/communication-errors";
import {
  BUILTIN_TEMPLATES,
  findBuiltinTemplate,
  type TemplateVariable,
} from "./template-catalog";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("template access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The tenant template row shape (message_templates). */
export interface TemplateRow {
  readonly id: string;
  readonly key: string;
  readonly channel: OutboundChannel;
  readonly locale: "ar" | "en";
  readonly module: string;
  readonly subject: string | null;
  readonly body: string;
  readonly variables: readonly TemplateVariable[];
  readonly isActive: boolean;
}

/** The effective template (tenant override || builtin fallback). */
export interface EffectiveTemplate extends TemplateRow {
  /** true when a tenant row backs the resolution (vs the builtin). */
  readonly overridden: boolean;
}

const TEMPLATE_COLUMNS = sql`id, key, channel, locale, module, subject, body,
  variables::jsonb AS "variables", is_active AS "isActive"`;

interface RawTemplateRow {
  id: string;
  key: string;
  channel: string;
  locale: string;
  module: string;
  subject: string | null;
  body: string;
  variables: unknown;
  isActive: boolean;
}

function coerceRow(raw: RawTemplateRow): TemplateRow {
  return {
    id: raw.id,
    key: raw.key,
    channel: raw.channel as OutboundChannel,
    locale: raw.locale === "en" ? "en" : "ar",
    module: raw.module,
    subject: raw.subject,
    body: raw.body,
    variables: Array.isArray(raw.variables)
      ? (raw.variables as TemplateVariable[])
      : [],
    isActive: raw.isActive,
  };
}

// -- validation -----------------------------------------------------------------

const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,40}$/;
const TEMPLATE_KEY = /^[a-z][a-z0-9_.]{2,80}$/;
const MODULE_SHAPE = /^[a-z][a-z0-9_]{1,40}$/;
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export interface TemplateUpsertInput {
  readonly key: string;
  readonly channel: OutboundChannel;
  readonly locale: "ar" | "en";
  readonly module: string;
  readonly subject?: string | null;
  readonly body: string;
  readonly variables: readonly TemplateVariable[];
  readonly isActive: boolean;
}

/**
 * The FULL service-layer validation (the migration's CHECKs pin the DB
 * floor; this is the write gate): key/module shapes, EMAIL↔subject
 * coherence, body bounds, the typed-variable shape (name/required/
 * description — the contract the no-subquery CHECK moved here), and the
 * body-placeholder closure (every {{placeholder}} must be declared).
 */
export function validateTemplateUpsert(input: TemplateUpsertInput): void {
  if (!TEMPLATE_KEY.test(input.key)) {
    throw new TemplateShapeInvalidError(
      `key must match ${TEMPLATE_KEY} (got ${input.key})`,
    );
  }
  if (!MODULE_SHAPE.test(input.module)) {
    throw new TemplateShapeInvalidError(
      `module must match ${MODULE_SHAPE} (got ${input.module})`,
    );
  }
  if (input.channel === "EMAIL") {
    if (input.subject === undefined || input.subject === null || input.subject.length === 0) {
      throw new TemplateShapeInvalidError("EMAIL templates require a subject");
    }
    if (input.subject.length > 300) {
      throw new TemplateShapeInvalidError("subject must be ≤ 300 chars");
    }
  } else if (input.subject !== undefined && input.subject !== null) {
    throw new TemplateShapeInvalidError("WHATSAPP/SMS templates are body-only (no subject)");
  }
  if (input.body.length < 1 || input.body.length > 20_000) {
    throw new TemplateShapeInvalidError("body must be 1..20000 chars");
  }
  if (input.channel === "SMS" && input.body.length > 480) {
    // Advisory bound, not a hard one: SMS segments bill per 67–154 chars;
    // an accidental novel must be caught at save time.
    throw new TemplateShapeInvalidError("SMS bodies must be ≤ 480 chars (segment economics)");
  }
  const seen = new Set<string>();
  for (const variable of input.variables) {
    if (
      typeof variable?.name !== "string" ||
      !VARIABLE_NAME.test(variable.name) ||
      typeof variable?.required !== "boolean" ||
      (variable?.description !== undefined &&
        typeof variable.description !== "string")
    ) {
      throw new TemplateShapeInvalidError(
        `variables entries must be {name: [a-z][a-z0-9_]{0,40}, required: boolean, description?: string} — got ${JSON.stringify(variable)}`,
      );
    }
    if (seen.has(variable.name)) {
      throw new TemplateShapeInvalidError(`duplicate variable ${variable.name}`);
    }
    seen.add(variable.name);
  }
  // The placeholder closure: every {{placeholder}} in the body (and the
  // subject) must be a declared variable.
  const checkPlaceholders = (text: string, where: string): void => {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const name = match[1]!;
      if (!seen.has(name)) {
        throw new TemplateShapeInvalidError(
          `${where} references {{${name}}} but it is not declared in variables`,
        );
      }
    }
  };
  checkPlaceholders(input.body, "body");
  if (input.subject !== undefined && input.subject !== null) {
    checkPlaceholders(input.subject, "subject");
  }
}

// -- rendering ------------------------------------------------------------------

export interface RenderedTemplate {
  readonly subject: string | null;
  readonly body: string;
  /** WhatsApp only: the ordered positional parameters. */
  readonly whatsappParams: readonly string[] | null;
  readonly templateKey: string;
  readonly channel: OutboundChannel;
  readonly locale: "ar" | "en";
}

/** Pure render (unit-tested): fail-closed on missing required variables. */
export function renderTemplate(
  template: EffectiveTemplate,
  variables: Readonly<Record<string, string>>,
): RenderedTemplate {
  const declared = new Map(template.variables.map((v) => [v.name, v]));
  const resolve = (text: string): string =>
    text.replace(PLACEHOLDER, (_full, name: string) => {
      const spec = declared.get(name);
      if (spec === undefined) {
        throw new TemplateRenderError(
          `template ${template.key} references undeclared {{${name}}}`,
        );
      }
      const value = variables[name];
      if ((value === undefined || value === null) && spec.required) {
        throw new TemplateRenderError(
          `template ${template.key} requires variable ${name} (missing at render)`,
        );
      }
      return value ?? "";
    });
  const body = resolve(template.body);
  const subject = template.subject === null ? null : resolve(template.subject);
  const whatsappParams =
    template.channel === "WHATSAPP"
      ? template.variables.map(
          (spec) => variables[spec.name] ?? (spec.required ? "" : ""),
        )
      : null;
  return {
    subject,
    body,
    whatsappParams,
    templateKey: template.key,
    channel: template.channel,
    locale: template.locale,
  };
}

// -- the service ----------------------------------------------------------------

export class TemplateService {
  /** The tenant's effective templates (tenant rows + builtin fallbacks). */
  async listEffective(): Promise<readonly EffectiveTemplate[]> {
    const tx = tenantTx();
    const rows = await tx.execute(
      sql`SELECT ${TEMPLATE_COLUMNS} FROM message_templates
          WHERE is_active = true ORDER BY key, channel, locale`,
    );
    const tenantRows = (rows.rows as unknown as RawTemplateRow[]).map(coerceRow);
    const tenantIndex = new Map(
      tenantRows.map((row) => [`${row.key}|${row.channel}|${row.locale}`, row]),
    );
    const effective: EffectiveTemplate[] = tenantRows.map((row) => ({
      ...row,
      overridden: true,
    }));
    for (const builtin of BUILTIN_TEMPLATES) {
      const composite = `${builtin.key}|${builtin.channel}|${builtin.locale}`;
      if (!tenantIndex.has(composite)) {
        effective.push({
          id: `builtin:${composite}`,
          key: builtin.key,
          channel: builtin.channel,
          locale: builtin.locale,
          module: builtin.module,
          subject: builtin.subject ?? null,
          body: builtin.body,
          variables: builtin.variables,
          isActive: true,
          overridden: false,
        });
      }
    }
    return effective.sort((a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel));
  }

  /** The effective template for one resolution key (tenant || builtin). */
  async resolveEffective(
    key: string,
    channel: OutboundChannel,
    locale: "ar" | "en",
  ): Promise<EffectiveTemplate> {
    const tx = tenantTx();
    const rows = await tx.execute(
      sql`SELECT ${TEMPLATE_COLUMNS} FROM message_templates
          WHERE key = ${key} AND channel = ${channel} AND locale = ${locale}
            AND is_active = true LIMIT 1`,
    );
    const raw = (rows.rows as unknown as RawTemplateRow[])[0];
    if (raw !== undefined) {
      return { ...coerceRow(raw), overridden: true };
    }
    const builtin = findBuiltinTemplate(key, channel, locale);
    if (builtin !== undefined) {
      return {
        id: `builtin:${key}|${channel}|${locale}`,
        key: builtin.key,
        channel: builtin.channel,
        locale: builtin.locale,
        module: builtin.module,
        subject: builtin.subject ?? null,
        body: builtin.body,
        variables: builtin.variables,
        isActive: true,
        overridden: false,
      };
    }
    throw new TemplateNotFoundError(key, channel, locale);
  }

  /** Render through the effective resolution (fail-closed). */
  async render(
    key: string,
    channel: OutboundChannel,
    locale: "ar" | "en",
    variables: Readonly<Record<string, string>>,
  ): Promise<RenderedTemplate> {
    const template = await this.resolveEffective(key, channel, locale);
    return renderTemplate(template, variables);
  }

  /** Upsert a tenant override (validation door + row). */
  async upsert(actorId: string, input: TemplateUpsertInput): Promise<TemplateRow> {
    validateTemplateUpsert(input);
    const tx = tenantTx();
    const rows = await tx.execute(
      sql`INSERT INTO message_templates
            (id, tenant_id, key, channel, locale, module, subject, body, variables, is_active, created_by)
          VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.key}, ${input.channel},
                  ${input.locale}, ${input.module},
                  ${input.channel === "EMAIL" ? (input.subject ?? null) : null},
                  ${input.body}, ${JSON.stringify(input.variables)}::jsonb,
                  ${input.isActive}, ${actorId})
          ON CONFLICT (tenant_id, key, channel, locale) DO UPDATE
            SET subject = EXCLUDED.subject, body = EXCLUDED.body,
                module = EXCLUDED.module, variables = EXCLUDED.variables,
                is_active = EXCLUDED.is_active, updated_at = now(),
                version = message_templates.version + 1
          RETURNING ${TEMPLATE_COLUMNS}`,
    );
    const raw = (rows.rows as unknown as RawTemplateRow[])[0];
    if (raw === undefined) {
      throw new TemplateShapeInvalidError("the upsert returned no row");
    }
    return coerceRow(raw);
  }

  /** Delete a tenant override (the builtin fallback resumes). */
  async remove(key: string, channel: OutboundChannel, locale: "ar" | "en"): Promise<void> {
    const tx = tenantTx();
    await tx.execute(
      sql`DELETE FROM message_templates
          WHERE tenant_id = erp.current_tenant_id() AND key = ${key}
            AND channel = ${channel} AND locale = ${locale}`,
    );
  }
}
