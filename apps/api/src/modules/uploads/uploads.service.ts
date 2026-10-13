import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Upload } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { uploads } from '../../db/schema';
import { AppError } from '../../common/errors';
import { StorageService } from './storage.service';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'];
const FULL_PX = 1600;
const THUMB_PX = 400;

export type UploadRow = typeof uploads.$inferSelect;
export const toUploadDto = (u: UploadRow): Upload => ({ id: u.id, url: u.url, thumbUrl: u.thumbUrl, mime: u.mime, size: u.size });

@Injectable()
export class UploadsService {
  constructor(@InjectDb() private readonly db: Database, private readonly storage: StorageService) {}

  /** Normalises an image: EXIF auto-rotate, max 1600px webp (q80) + 400px webp thumb; stores both. */
  async uploadImage(userId: string, file: { buffer: Buffer; mimetype: string; size: number } | undefined): Promise<Upload> {
    if (!file?.buffer?.length) throw new AppError('FILE_REQUIRED', 'Multipart field "file" is required');
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError('FILE_TOO_LARGE', 'Max file size is 10MB', HttpStatus.PAYLOAD_TOO_LARGE);
    if (!ALLOWED_MIME.includes(file.mimetype)) throw new AppError('UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG, WEBP or HEIC images are allowed', HttpStatus.UNSUPPORTED_MEDIA_TYPE);

    let full: { data: Buffer; info: sharp.OutputInfo };
    let thumb: Buffer;
    try {
      const base = sharp(file.buffer, { failOn: 'error' }).rotate();
      full = await base.clone().resize({ width: FULL_PX, height: FULL_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      thumb = await base.clone().resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    } catch {
      throw new AppError('INVALID_IMAGE', 'File is not a valid or supported image', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const d = new Date();
    const id = randomUUID();
    const dir = `listings/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const key = `${dir}/${id}.webp`;
    const thumbKey = `${dir}/${id}_thumb.webp`;
    await this.storage.put(key, full.data, 'image/webp');
    await this.storage.put(thumbKey, thumb, 'image/webp');

    const [row] = await this.db
      .insert(uploads)
      .values({
        id, userId, key, thumbKey, url: this.storage.publicUrl(key), thumbUrl: this.storage.publicUrl(thumbKey),
        mime: 'image/webp', size: full.data.length, width: full.info.width, height: full.info.height,
      })
      .returning();
    return toUploadDto(row);
  }
}
