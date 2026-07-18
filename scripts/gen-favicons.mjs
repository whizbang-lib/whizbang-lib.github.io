// Generates square favicon assets from the Whizbang "W!" brand mark.
// Source is the transparent-background mark (logo-mark.png). The "!" is dark, so
// the mark is composited on a white tile to stay visible on dark browser chrome.
// Run: node scripts/gen-favicons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const MARK = 'src/assets/branding/logo-mark.png';
const BG = { r: 255, g: 255, b: 255, alpha: 1 }; // white tile (mark's "!" is dark)
const OUT_DIR = 'src/assets/branding';

async function square(size) {
  // Fit the mark to ~86% of the tile, preserving aspect ratio.
  const inner = Math.round(size * 0.86);
  const mark = await sharp(readFileSync(MARK))
    .resize({ width: inner, height: inner, fit: 'inside' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}

// Minimal ICO container wrapping a single PNG entry (ICO supports PNG payloads).
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const dir = Buffer.alloc(16);
  dir.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
  dir.writeUInt8(0, 2); // palette
  dir.writeUInt8(0, 3); // reserved
  dir.writeUInt16LE(1, 4); // color planes
  dir.writeUInt16LE(32, 6); // bpp
  dir.writeUInt32LE(png.length, 8); // data size
  dir.writeUInt32LE(header.length + dir.length, 12); // data offset
  return Buffer.concat([header, dir, png]);
}

writeFileSync(`${OUT_DIR}/apple-touch-icon.png`, await square(180));
writeFileSync(`${OUT_DIR}/favicon-32.png`, await square(32));
writeFileSync(`${OUT_DIR}/favicon-16.png`, await square(16));
writeFileSync('src/favicon.ico', pngToIco(await square(32), 32));
console.log('Generated from W! mark: apple-touch-icon.png (180), favicon-32.png, favicon-16.png, favicon.ico');
