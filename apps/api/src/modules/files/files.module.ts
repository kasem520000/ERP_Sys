import { Module } from "@nestjs/common";

import { FilesService, FILES_STORE } from "./application/files.service";
import { AttachmentsService } from "./application/attachments-service";
import { S3FilesStore } from "./infrastructure/s3-files.store";

/**
 * Files module (PHASE-002 §2.7 + PHASE-006 §2.7 usage): S3 adapter +
 * signed URLs + upload constraints, plus the PHASE-006 attachments service
 * (owner linkage rows on `file_objects`, tombstone delete, A11 tenant-bound
 * downloads) consumed by the partners/items presentation layers.
 */
@Module({
  providers: [
    { provide: FILES_STORE, useClass: S3FilesStore },
    FilesService,
    AttachmentsService,
  ],
  exports: [FilesService, AttachmentsService],
})
export class FilesModule {}
