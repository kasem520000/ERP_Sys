import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { PartnerService } from "./application/partner-service";
import { CreditTermsService } from "./application/credit-terms-service";
import { CreditCheckService } from "./application/credit-check-service";
import { OpeningBalancesService } from "./application/opening-balances-service";
import { VehicleService } from "./vehicles/application/vehicle-service";
import { PartnersController } from "./presentation/partners.controller";
import { VehiclesController } from "./presentation/vehicles.controller";

/**
 * Partners module (PHASE-006 §2.1): the unified partner directory with
 * contacts/addresses, credit terms (BR-026), the BR-001 credit-check
 * interface (enforcement lands with sales approval, PHASE-012), and
 * opening-balance DRAFT capture (the G-16 subledger source — nothing posts
 * before PHASE-007). Consumes audit (interceptor + service) and the files
 * module's attachments service via their api surfaces. PHASE-017 §2 item 3
 * adds the per-partner vehicle registry (VehicleService + routes under
 * api/v1/partners/vehicles, `partners.vehicles.manage`).
 */
@Module({
  imports: [AuditModule, FilesModule],
  controllers: [PartnersController, VehiclesController],
  providers: [PartnerService, CreditTermsService, CreditCheckService, OpeningBalancesService, VehicleService],
  exports: [PartnerService, CreditTermsService, CreditCheckService, OpeningBalancesService],
})
export class PartnersModule {}
