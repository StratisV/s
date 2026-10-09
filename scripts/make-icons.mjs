// Renders public/icons/icon.svg to the bitmap icons (npm run icons). Paths are in public/.
//
//   icons/icon-192.png, icons/icon-512.png
//       manifest "any": the rounded tile with transparent corners
//   icons/icon-maskable-512.png
//       manifest "maskable": full-bleed sky and grass, the scene shrunk into the safe zone
//       (a centred circle, 80% across)
//   icons/apple-touch-icon.png
//       180x180 full-bleed square with no alpha channel (iOS draws its own rounded mask)
//   favicon.ico
//       32x32 rounded tile, for browsers without SVG favicons (Safari before 26) and the
//       automatic /favicon.ico request
//
// Uses Playwright's Chromium, so the PNGs match how browsers draw the SVG.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

/**
 * How far the scene shrinks in the maskable icon. Everything that matters sits within
 * 245px of the centre of the 512 canvas; the safe zone is a 204.8px radius.
 */
const MASKABLE_SCALE = 0.8;

const OUTPUTS = [
  { file: 'icons/icon-192.png', size: 192, variant: 'rounded' },
  { file: 'icons/icon-512.png', size: 512, variant: 'rounded' },
  { file: 'icons/icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'icons/apple-touch-icon.png', size: 180, variant: 'square' },
  { file: 'favicon.ico', size: 32, variant: 'rounded' },
];

const svg = await readFile(path.join(publicDir, 'icons', 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const { file, size, variant } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
    );
    await page.evaluate(
      ({ size, variant, scale }) => {
        const el = document.querySelector('svg');
        if (!el) throw new Error('icon.svg has no <svg> root');
        el.setAttribute('width', String(size));
        el.setAttribute('height', String(size));
        if (variant === 'rounded') return;
        // Full bleed: drop the rounded tile clip.
        for (const node of el.querySelectorAll('[clip-path]')) node.removeAttribute('clip-path');
        if (variant === 'maskable') {
          const art = el.querySelector('#art');
          if (!art) throw new Error('icon.svg has no #art group');
          art.setAttribute('transform', `translate(256 256) scale(${scale}) translate(-256 -256)`);
        }
      },
      { size, variant, scale: MASKABLE_SCALE },
    );
    let data = await page.screenshot({ omitBackground: variant === 'rounded', type: 'png' });
    if (variant === 'square') data = dropAlpha(data);
    if (file.endsWith('.ico')) data = pngToIco(data, size);
    await writeFile(path.join(publicDir, file), data);
    await page.close();
    console.log(`public/${file} (${size}x${size}, ${data.length} bytes)`);
  }
} finally {
  await browser.close();
}

/** An ICO file holding one PNG image (supported everywhere since Windows Vista). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved.
  header.writeUInt16LE(1, 2); // Type: icon.
  header.writeUInt16LE(1, 4); // One image.
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // Width (0 means 256).
  entry[1] = size >= 256 ? 0 : size; // Height.
  entry.writeUInt16LE(1, 4); // Colour planes.
  entry.writeUInt16LE(32, 6); // Bits per pixel.
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12); // Offset of the PNG.
  return Buffer.concat([header, entry, png]);
}

// ── PNG: RGBA to RGB ───────────────────────────────────────────
// iOS fills transparent pixels of a Home Screen icon with black, and Chromium's screenshots
// are always RGBA, so the apple-touch-icon is re-encoded as a plain 8-bit RGB PNG.

function dropAlpha(buffer) {
  const SIGNATURE = buffer.subarray(0, 8);
  let offset = 8;
  let header;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    else if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (colorType === 2) return buffer; // Already RGB.
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`unexpected PNG format (bit depth ${bitDepth}, colour type ${colorType})`);
  }

  const rgba = unfilter(inflateSync(Buffer.concat(idat)), width, height, 4);
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // Filter: none.
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = y * stride + 1 + x * 3;
      // Composite on white, in case an edge pixel isn't fully opaque.
      const alpha = rgba[from + 3] / 255;
      for (let c = 0; c < 3; c++) raw[to + c] = Math.round(rgba[from + c] * alpha + 255 * (1 - alpha));
    }
  }

  const ihdr = Buffer.from(header);
  ihdr[9] = 2; // Colour type: truecolour, no alpha.
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reverses the per-row PNG filters, returning tightly packed pixels. */
function unfilter(data, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      let value = row[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      out[y * stride + i] = value & 0xff;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
