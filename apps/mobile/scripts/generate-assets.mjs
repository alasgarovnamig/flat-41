/**
 * Generates placeholder app icon / splash / adaptive icon PNGs for EvTap
 * (brand teal #0E7C66 with a white "E" mark). Run: `pnpm --filter @evtap/mobile assets`.
 * Replace the output files with designer assets before a store release.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/images');
mkdirSync(out, { recursive: true });

const TEAL = '#0E7C66';
const TEAL_DARK = '#0A5C4C';

/** The "E" mark drawn as rectangles inside a viewBox of `size`. Roof-like chevron on top hints "ev" (= home). */
const mark = (size, color, scale = 1) => {
  const s = size * scale;
  const o = (size - s) / 2;
  const u = s / 10;
  const x = o + u * 3;
  const y = o + u * 2.6;
  return `
    <path d="M ${o + u * 2} ${o + u * 2.6} L ${o + s / 2} ${o + u * 0.9} L ${o + u * 8} ${o + u * 2.6}"
      fill="none" stroke="${color}" stroke-width="${u * 0.7}" stroke-linecap="round" stroke-linejoin="round" />
    <rect x="${x}" y="${y + u * 0.9}" width="${u * 1.2}" height="${u * 5.6}" rx="${u * 0.25}" fill="${color}" />
    <rect x="${x}" y="${y + u * 0.9}" width="${u * 4.2}" height="${u * 1.1}" rx="${u * 0.25}" fill="${color}" />
    <rect x="${x}" y="${y + u * 3.15}" width="${u * 3.4}" height="${u * 1.1}" rx="${u * 0.25}" fill="${color}" />
    <rect x="${x}" y="${y + u * 5.4}" width="${u * 4.2}" height="${u * 1.1}" rx="${u * 0.25}" fill="${color}" />`;
};

const svg = (size, { bg, fg, scale = 1, radius = 0 }) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}" />` : ''}
    ${bg ? `<circle cx="${size * 0.85}" cy="${size * 0.15}" r="${size * 0.5}" fill="${TEAL_DARK}" opacity="0.25" />` : ''}
    ${mark(size, fg, scale)}
  </svg>`);

const files = [
  ['icon.png', 1024, { bg: TEAL, fg: '#FFFFFF', scale: 0.78 }], // iOS icon must be opaque, no rounded corners
  ['adaptive-icon.png', 1024, { fg: '#FFFFFF', scale: 0.55 }], // Android foreground (bg colour set in app.config)
  ['monochrome-icon.png', 1024, { fg: '#000000', scale: 0.55 }], // Android 13 themed icon
  ['splash-icon.png', 512, { bg: TEAL, fg: '#FFFFFF', scale: 0.8, radius: 112 }],
  ['notification-icon.png', 96, { fg: '#FFFFFF', scale: 0.9 }], // Android status-bar icon: white on transparent
  ['favicon.png', 48, { bg: TEAL, fg: '#FFFFFF', scale: 0.85, radius: 10 }],
];

for (const [name, size, opts] of files) {
  await sharp(svg(size, opts)).png().toFile(path.join(out, name));
  console.log('✓', name);
}
