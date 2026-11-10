/**
 * PHASE-013 · reporting-internal store feeds for the platform contracts
 * (report_runs history + the tenant's subscription/entitlement rows via
 * the tenancy module's authorized surface).
 */
export * as runStore from "../../infrastructure/reporting.store";
import {
  currentSubscription,
  listEntitlements,
} from "../../../tenancy/infrastructure/tenancy.store";

export const tenancyStore = { currentSubscription, listEntitlements };
