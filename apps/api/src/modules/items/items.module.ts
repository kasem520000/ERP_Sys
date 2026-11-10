import { Inject, Module, OnModuleInit } from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { getBoss } from "../../infra/jobs/boss";
import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { UomService } from "./application/uom-service";
import { ItemService } from "./application/item-service";
import { PriceListService } from "./application/price-list-service";
import { CompositeService } from "./application/composite-service";
import { ImportService, IMPORT_QUEUE, type ImportJobPayload } from "./application/import-service";
import { ExportService } from "./application/export-service";
import { ItemsController } from "./presentation/items.controller";
import { ImportController } from "./presentation/import.controller";

/**
 * Items module (PHASE-006 §2.2–§2.6): the item master (categories, UoM
 * registry + exact conversions, barcodes, tracking flags), price lists +
 * the BR-003 pricing-resolution service, and the preview-gated
 * import/export engine. PHASE-015 T9 adds the composite-product
 * definitions (`items.composite_products`): component lists on
 * COMPOSITE-kind items + the explosion contract the sales posting seam
 * consumes. The import commit runs as a bounded tenant-scoped
 * pg-boss job (ADR-0008) — the handler registers on both the API and
 * worker processes, exactly like the email queue.
 */
@Module({
  imports: [InfrastructureModule, AuditModule, FilesModule],
  controllers: [ItemsController, ImportController],
  providers: [UomService, ItemService, PriceListService, CompositeService, ImportService, ExportService],
  exports: [UomService, ItemService, PriceListService, CompositeService, ImportService, ExportService],
})
export class ItemsModule implements OnModuleInit {
  constructor(@Inject(ImportService) private readonly imports: ImportService) {}

  async onModuleInit(): Promise<void> {
    const boss = getBoss();
    await boss.work<ImportJobPayload>(IMPORT_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await this.imports.runCommit(job.data);
      }
    });
  }
}
