// Generates square favicon assets from the wide wordmark logo.
// The brand ships only a landscape wordmark (logo-dark.svg, light-gray ink) and
// there is no square mark, so we composite the wordmark centered on a dark
// branded square (matching the site background). Run: node scripts/gen-favicons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const LOGO = 'src/assets/branding/logo-dark.svg'; // light-gray ink, for dark bg
const BG = { r: 0x0b, g: 0x0b, b: 0x12, alpha: 1 }; // #0b0b12 — site dark slate
const OUT_DIR = 'src/assets/branding';

async function square(size) {
  // Render the wordmark to ~78% of the tile width, preserve aspect ratio.
  const logoW = Math.round(size * 0.78);
  const logo = await sharp(readFileSync(LOGO), { density: 384 })
    .resize({ width: logoW, fit: 'inside' })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
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

const apple = await square(180);
writeFileSync(`${OUT_DIR}/apple-touch-icon.png`, apple);
writeFileSync(`${OUT_DIR}/favicon-32.png`, await square(32));
writeFileSync(`${OUT_DIR}/favicon-16.png`, await square(16));
writeFileSync('src/favicon.ico', pngToIco(await square(32), 32));
console.log('Generated: apple-touch-icon.png (180), favicon-32.png, favicon-16.png, favicon.ico');
