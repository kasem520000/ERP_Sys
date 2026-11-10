/**
 * Public surface of the partners module (DEPENDENCY_RULES §1 `api/`): the
 * credit-check interface (BR-001) + the opening-balance item read that
 * PHASE-007+ accounting flows and future sales approval consume.
 */

export { CreditCheckService, type CreditCheckResult } from "../application/credit-check-service";
export { PartnerService } from "../application/partner-service";
export { OpeningBalancesService, type CreateOpeningBalanceInput, type OpeningBalanceKind } from "../application/opening-balances-service";
export {
  PartnerCodeTakenError,
  PartnerKindChangeForbiddenError,
  PartnerNotFoundError,
  SystemCreditTermsImmutableError,
} from "../domain/partner-errors";
