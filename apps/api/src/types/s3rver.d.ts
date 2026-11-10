/**
 * Ambient declaration for `s3rver` (v3 ships no bundled types) — the test-only
 * S3-compatible server used by the PHASE-002 files suite in place of the dev
 * MinIO container (docker-compose.yml).
 */
declare module "s3rver" {
  import type { Server } from "node:http";

  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    configureBuckets?: unknown[];
    indexDocument?: string;
    errorDocument?: string;
    removeBucket?: boolean;
    fs?: unknown;
    service?: string;
    serviceProtocol?: string;
    bare?: boolean;
  }

  interface S3rverRunResult {
    port: number;
    family: string;
    address: string;
    server: Server;
    bins: unknown[];
  }

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(
      callback: (error: Error | null, host: S3rverRunResult | null) => void,
    ): void;
    close(): Promise<void>;
    middleware(): unknown;
  }
}
