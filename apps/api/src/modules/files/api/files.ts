/**
 * Public surface of the files module (DEPENDENCY_RULES §1 `api/`).
 */
export {
  ALLOWED_CONTENT_TYPES,
  CrossTenantObjectAccessError,
  FILES_STORE,
  FilesService,
  UploadRejectedError,
  sanitizeFilename,
  type FilesStore,
  type IssuedUpload,
  type UploadRequest,
} from "../application/files.service";
export {
  AttachmentsService,
  type AttachmentOwnerType,
  type AttachmentRow,
} from "../application/attachments-service";
