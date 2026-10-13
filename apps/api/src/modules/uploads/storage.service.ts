import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config';

/**
 * Object storage abstraction. Drivers:
 *  - `local` (default): files under `config.storage.uploadDir`, served by main.ts at `${apiPublicUrl}/uploads/<key>`.
 *  - `s3`: any S3-compatible bucket (AWS, MinIO, Cloudflare R2). Requires `@aws-sdk/client-s3` to be installed
 *    (`pnpm --filter @evtap/api add @aws-sdk/client-s3`) and S3_* env vars; public URL = `${S3_PUBLIC_URL}/<key>`.
 */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

class LocalStorageDriver implements StorageDriver {
  private readonly root = path.resolve(config.storage.uploadDir);
  async put(key: string, body: Buffer) {
    const file = path.join(this.root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  async delete(key: string) {
    await unlink(path.join(this.root, key)).catch(() => undefined);
  }
  publicUrl(key: string) {
    return `${config.apiPublicUrl.replace(/\/$/, '')}/uploads/${key}`;
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
class S3StorageDriver implements StorageDriver {
  private client: any;
  private sdk: any;
  constructor() {
    try {
      this.sdk = require('@aws-sdk/client-s3');
    } catch {
      throw new Error('STORAGE_DRIVER=s3 requires @aws-sdk/client-s3 (pnpm --filter @evtap/api add @aws-sdk/client-s3)');
    }
    const s3 = config.storage.s3;
    if (!s3.bucket || !s3.publicUrl) throw new Error('S3_BUCKET and S3_PUBLIC_URL are required for STORAGE_DRIVER=s3');
    this.client = new this.sdk.S3Client({
      region: s3.region,
      endpoint: s3.endpoint || undefined,
      forcePathStyle: !!s3.endpoint,
      credentials: s3.accessKey && s3.secretKey ? { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey } : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new this.sdk.PutObjectCommand({ Bucket: config.storage.s3.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
  }
  async delete(key: string) {
    await this.client.send(new this.sdk.DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
  }
  publicUrl(key: string) {
    return `${config.storage.s3.publicUrl!.replace(/\/$/, '')}/${key}`;
  }
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver;
  constructor() {
    this.driver = config.storage.driver === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
    new Logger('Storage').log(`driver: ${config.storage.driver}`);
  }
  put(key: string, body: Buffer, contentType: string) {
    return this.driver.put(key, body, contentType);
  }
  delete(key: string) {
    return this.driver.delete(key);
  }
  publicUrl(key: string) {
    return this.driver.publicUrl(key);
  }
}
