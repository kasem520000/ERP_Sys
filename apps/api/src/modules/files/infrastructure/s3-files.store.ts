import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../../config/env";
import { childLogger } from "../../../infra/observability/logger";
import { FilesStore } from "../application/files.service";

/**
 * S3-compatible adapter (PHASE-002 §2.7): AWS SDK v3 client against the
 * configured endpoint — MinIO in the dev compose stack, s3rver in the test
 * suite, real S3-compatible storage in production. Path-style addressing is
 * forced so local stacks resolve buckets correctly.
 */
const log = childLogger({ module: "files" });

export class S3FilesStore extends FilesStore {
  private client(): S3Client {
    return new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials:
        env.S3_ACCESS_KEY !== undefined && env.S3_SECRET_KEY !== undefined
          ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
          : undefined,
      forcePathStyle: true,
    });
  }

  async presignPut(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const url = await getSignedUrl(
      this.client(),
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
    log.debug({ action: "presign-put", key }, "upload URL issued");
    return url;
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    const url = await getSignedUrl(
      this.client(),
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      { expiresIn: expiresInSeconds },
    );
    log.debug({ action: "presign-get", key }, "download URL issued");
    return url;
  }

  /** PHASE-006 usage: server-side read for the import/export engine. */
  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const result = await this.client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (bytes === undefined) {
      throw new Error(`object ${key} has no body`);
    }
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType ?? "application/octet-stream",
    };
  }

  /** PHASE-006 usage: server-side write for generated export files. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    log.debug({ action: "put-object", key }, "export object stored");
  }
  /** PHASE-024 T11: prefix listing (the purge inventory) — paginated. */
async listPrefix(prefix: string): Promise<string[]> {
  const client = this.client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of result.Contents ?? []) {
      if (object.Key !== undefined) {
        keys.push(object.Key);
      }
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token !== undefined);
  return keys;
}

/** PHASE-024 T11: bulk delete (the purge's storage wipe) — 1000/key batch. */
async deleteObjects(keys: string[]): Promise<void> {
  const client = this.client();
  for (let index = 0; index < keys.length; index += 1000) {
    const batch = keys.slice(index, index + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: batch.map((key) => ({ Key: key })) },
      }),
    );
  }
  log.warn({ action: "delete-objects", count: keys.length }, "storage objects deleted (purge)");
}
}
