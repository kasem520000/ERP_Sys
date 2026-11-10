import { Inject, Injectable } from "@nestjs/common";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/distribution.store";
import {
  PlanningDataError,
  RouteCodeDuplicateError,
  RouteNotFoundError,
  VanNotFoundError,
} from "../domain/distribution-errors";

/**
 * Route service (PHASE-017 T7; §2 item 4; CAPABILITY_MATRIX §2.4): route
 * definitions with day patterns + assigned reps/vans, the ordered customer
 * composition, and PLANNED visit generation from that composition.
 *
 * PLANNING DATA ONLY — no operation here writes a journal, a stock move, or
 * any other economic row; routes and visits are the plan vs. actual
 * substrate that sales documents and explicit check-ins later record
 * against. Idempotency: planVisits skips (route, customer, date) triples
 * that already exist, so re-running a day is always safe.
 */

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const WEEKDAY_BY_INDEX: readonly Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** ISO-date → weekday (UTC — dates travel as YYYY-MM-DD everywhere). */
export function weekdayOf(date: string): Weekday {
  const index = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekday = WEEKDAY_BY_INDEX[index];
  if (weekday === undefined) throw new PlanningDataError(`date ${date} is not a valid ISO date`);
  return weekday;
}

function validateDayPattern(dayPattern: string[]): void {
  if (dayPattern.length === 0) {
    throw new PlanningDataError("day pattern must list at least one weekday");
  }
  const seen = new Set<string>();
  for (const day of dayPattern) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) {
      throw new PlanningDataError(`day pattern entry ${day} is not one of MON..SUN`);
    }
    if (seen.has(day)) {
      throw new PlanningDataError(`day pattern lists ${day} twice`);
    }
    seen.add(day);
  }
}

@Injectable()
export class RouteService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async find(id: string) {
    const route = await store.findRouteById(id);
    if (route === undefined) throw new RouteNotFoundError(id);
    return route;
  }

  async list(filter: { status?: string; limit?: number } = {}) {
    return store.listRoutes({ status: filter.status, limit: filter.limit ?? 200 });
  }

  /** A rep on a route must exist + be ACTIVE; a van must be a VAN-type,
   * active warehouse. Planning references only — nothing binds economically. */
  private async validateReferences(input: { salesRepId?: string | null; vanWarehouseId?: string | null }) {
    if (input.salesRepId !== undefined && input.salesRepId !== null) {
      const rep = await store.findSalesRepRef(input.salesRepId);
      if (rep === undefined) {
        throw new PlanningDataError(`sales rep ${input.salesRepId} does not exist in this tenant`);
      }
      if (rep.status !== "ACTIVE") {
        throw new PlanningDataError(`sales rep ${rep.code} is ${rep.status} — routes need an ACTIVE rep`);
      }
    }
    if (input.vanWarehouseId !== undefined && input.vanWarehouseId !== null) {
      const van = await store.findVanByWarehouseId(input.vanWarehouseId);
      if (van === undefined || van.type !== "VAN") {
        throw new VanNotFoundError(input.vanWarehouseId);
      }
      if (!van.isActive) {
        throw new VanNotFoundError(`${input.vanWarehouseId} (inactive)`);
      }
    }
  }

  async create(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    salesRepId?: string | null;
    vanWarehouseId?: string | null;
    dayPattern?: string[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    const dayPattern = input.dayPattern ?? ["MON", "TUE", "WED", "THU", "FRI"];
    validateDayPattern(dayPattern);
    const duplicate = await store.findRouteByCode(input.code);
    if (duplicate !== undefined) throw new RouteCodeDuplicateError(input.code);
    await this.validateReferences(input);
    const created = await store.insertRoute({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr ?? null,
      salesRepId: input.salesRepId ?? null,
      vanWarehouseId: input.vanWarehouseId ?? null,
      dayPattern,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "distribution.route_created",
      entityType: "route",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        name: created.name,
        salesRepId: created.salesRepId,
        vanWarehouseId: created.vanWarehouseId,
        dayPattern: created.dayPattern,
      },
    });
    return created;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      salesRepId?: string | null;
      vanWarehouseId?: string | null;
      dayPattern?: string[];
      status?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ) {
    await this.find(id);
    if (patch.dayPattern !== undefined) validateDayPattern(patch.dayPattern);
    if (patch.status !== undefined && patch.status !== "ACTIVE" && patch.status !== "INACTIVE") {
      throw new PlanningDataError(`route status must be ACTIVE or INACTIVE — got ${patch.status}`);
    }
    await this.validateReferences(patch);
    const updated = await store.updateRoute(id, patch);
    await this.audit.record({
      action: "distribution.route_updated",
      entityType: "route",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patch,
    });
    return updated!;
  }

  /** Full-replace of the route's customer set; visitOrder defaults to the
   * array position. Customers must exist with kind CUSTOMER or BOTH. */
  async setCustomers(
    routeId: string,
    input: { customers: { customerId: string; visitOrder?: number; isPinned?: boolean }[]; actorId: string | null },
  ) {
    await this.find(routeId);
    const seen = new Set<string>();
    for (const entry of input.customers) {
      if (seen.has(entry.customerId)) {
        throw new PlanningDataError(`customer ${entry.customerId} is listed twice on the route`);
      }
      seen.add(entry.customerId);
      const customer = await store.findCustomerRef(entry.customerId);
      if (customer === undefined) {
        throw new PlanningDataError(`customer ${entry.customerId} does not exist in this tenant`);
      }
      if (customer.kind !== "CUSTOMER" && customer.kind !== "BOTH") {
        throw new PlanningDataError(
          `partner ${customer.code} is ${customer.kind} — routes carry CUSTOMER/BOTH partners only`,
        );
      }
    }
    await store.replaceRouteCustomers(
      routeId,
      input.customers.map((entry, index) => ({
        customerId: entry.customerId,
        visitOrder: entry.visitOrder ?? index + 1,
        isPinned: entry.isPinned ?? false,
      })),
      input.actorId,
    );
    const customers = await store.listRouteCustomers(routeId);
    await this.audit.record({
      action: "distribution.route_customers_set",
      entityType: "route",
      entityId: routeId,
      actorId: input.actorId ?? undefined,
      after: { count: customers.length, customers: customers.map((c) => c.customerId) },
    });
    return customers;
  }

  /**
   * Generate the PLANNED visits for a date from the route's composition.
   * The date's weekday must be in the route's day pattern (typed error
   * otherwise); (route, customer, date) triples that already exist are
   * skipped — planning is idempotent and NEVER posts anything (§2.4).
   */
  async planVisits(routeId: string, input: { date: string; actorId: string | null }) {
    const route = await this.find(routeId);
    const weekday = weekdayOf(input.date);
    if (!route.dayPattern.includes(weekday)) {
      throw new PlanningDataError(
        `${input.date} is a ${weekday} — route ${route.code} only plans ${route.dayPattern.join("/")}`,
        { date: input.date, weekday, dayPattern: route.dayPattern },
      );
    }
    const composition = await store.listRouteCustomers(routeId);
    const existing = await store.listVisits({ routeId, date: input.date, limit: 500 });
    const planned = new Set(existing.map((visit) => visit.customerId));
    const toInsert = composition
      .filter((entry) => !planned.has(entry.customerId))
      .map((entry) => ({
        id: generateUuidV7(),
        routeId,
        customerId: entry.customerId,
        plannedDate: input.date,
        salesRepId: route.salesRepId,
        createdBy: input.actorId,
      }));
    await store.insertVisits(toInsert);
    await this.audit.record({
      action: "distribution.route_visits_planned",
      entityType: "route",
      entityId: routeId,
      actorId: input.actorId ?? undefined,
      after: { date: input.date, planned: toInsert.length, skipped: composition.length - toInsert.length },
    });
    const visits = await store.listVisits({ routeId, date: input.date, limit: 500 });
    return { date: input.date, planned: toInsert.length, skipped: composition.length - toInsert.length, visits };
  }

  async visitsForRoute(routeId: string, date?: string) {
    await this.find(routeId);
    return store.listVisits({ routeId, date, limit: 500 });
  }
}
