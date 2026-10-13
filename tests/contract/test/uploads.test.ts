/** POST /uploads: multipart "file" (jpeg/png/webp ≤ 10MB) → resized webp (max 1600px) + 400px thumb. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { API_URL } from '../src/config';
import * as D from '../src/dto';
import { err, ok } from '../src/expect';
import { jpeg, newUser, upload } from '../src/fixtures';
import { anon } from '../src/http';

const fetchImage = async (url: string) => {
  const res = await fetch(new URL(url, API_URL));
  assert.equal(res.status, 200, `image ${url} must be downloadable`);
  return Buffer.from(await res.arrayBuffer());
};

describe('uploads', () => {
  test('JPEG 2400×1800 → Upload; full image ≤ 1600px webp, thumb ≤ 400px', async () => {
    const u = await newUser();
    const up = ok(await upload(u, { width: 2400, height: 1800 }), D.Upload);
    assert.equal(up.mime, 'image/webp');
    const full = await sharp(await fetchImage(up.url)).metadata();
    assert.equal(full.format, 'webp');
    assert.equal(Math.max(full.width!, full.height!), 1600, 'resized to max 1600px');
    assert.equal(Math.round((full.width! / full.height!) * 100), Math.round((4 / 3) * 100), 'aspect ratio kept');
    const thumbBuf = await fetchImage(up.thumbUrl);
    const thumb = await sharp(thumbBuf).metadata();
    assert.equal(thumb.format, 'webp');
    assert.ok(Math.max(thumb.width!, thumb.height!) <= 400, 'thumb ≤ 400px');
    assert.ok(up.size > 0);
  });

  test('small PNG is accepted and never enlarged', async () => {
    const u = await newUser();
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: '#ff000080' } }).png().toBuffer();
    const up = ok(await upload(u, { buffer: png, mime: 'image/png', filename: 'x.png' }), D.Upload);
    const meta = await sharp(await fetchImage(up.url)).metadata();
    assert.equal(meta.width, 300);
    assert.equal(meta.height, 200);
  });

  test('requires auth', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await jpeg(10, 10))], { type: 'image/jpeg' }), 'a.jpg');
    err(await anon().call('POST', '/uploads', { form }), 401, 'UNAUTHORIZED');
  });

  test('missing file → 400 FILE_REQUIRED', async () => {
    const u = await newUser();
    const form = new FormData();
    form.append('other', 'value');
    err(await u.call('POST', '/uploads', { form }), 400, 'FILE_REQUIRED');
  });

  test('non-image type → 415 UNSUPPORTED_FILE_TYPE', async () => {
    const u = await newUser();
    err(await upload(u, { buffer: Buffer.from('hello world'), mime: 'text/plain', filename: 'a.txt' }), 415, 'UNSUPPORTED_FILE_TYPE');
  });

  test('corrupt image bytes → 415 INVALID_IMAGE', async () => {
    const u = await newUser();
    err(await upload(u, { buffer: Buffer.from('definitely not a jpeg payload'), mime: 'image/jpeg' }), 415, 'INVALID_IMAGE');
  });

  test('file > 10MB → 413 FILE_TOO_LARGE', async () => {
    const u = await newUser();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 0xff);
    big[0] = 0xff;
    big[1] = 0xd8;
    err(await upload(u, { buffer: big, mime: 'image/jpeg' }), 413, 'FILE_TOO_LARGE');
  });
});
