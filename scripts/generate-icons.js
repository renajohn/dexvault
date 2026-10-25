// Run from the repository root: node scripts/generate-icons.js
// The SVG is the source of truth; Sharp is an existing backend dependency.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');

async function main() {
  const directory = path.join(__dirname, '../frontend/public');
  const svg = await fs.readFile(path.join(directory, 'favicon.svg'), 'utf8');
  for (const size of [192, 512]) {
    await sharp(Buffer.from(svg)).resize(size, size).png()
      .toFile(path.join(directory, `logo${size}.png`));
  }
  const sizes = [16, 24, 32, 64];
  const images = [];
  for (const size of sizes) {
    // Rasterizers do not all evaluate SVG viewport media queries consistently.
    const source = size <= 64 ? svg.replace('class="media"', 'class="media" display="none"') : svg;
    images.push(await sharp(Buffer.from(source)).resize(size, size).png().toBuffer());
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
