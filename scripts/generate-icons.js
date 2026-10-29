// Run from the repository root: node scripts/generate-icons.js
// frontend/assets/dexvault-icon.png is the source of truth.
// Sharp is an existing backend dependency.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');

async function main() {
  const directory = path.join(__dirname, '../frontend/public');
  const source = await fs.readFile(path.join(__dirname, '../frontend/assets/dexvault-icon.png'));
  for (const [filename, size] of [
    ['apple-touch-icon.png', 180],
    ['logo192.png', 192],
    ['logo512.png', 512],
  ]) {
    await sharp(source).resize(size, size).png()
      .toFile(path.join(directory, filename));
  }
  // Keep the SVG favicon self-contained while using the selected raster artwork.
  const favicon = await sharp(source).resize(128, 128).png().toBuffer();
  await fs.writeFile(path.join(directory, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">\n` +
    `  <title>DexVault — Tonique</title>\n` +
    `  <image width="128" height="128" href="data:image/png;base64,${favicon.toString('base64')}"/>\n` +
    `</svg>\n`);
  const sizes = [16, 24, 32, 64];
  const images = [];
  for (const size of sizes) {
    images.push(await sharp(source).resize(size, size).png().toBuffer());
  }
  // ICO directory followed by one PNG payload per resolution.
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await fs.writeFile(path.join(directory, 'favicon.ico'), Buffer.concat([header, ...images]));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
