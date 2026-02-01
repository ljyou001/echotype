/**
 * Generate icon-white.png from icon.png (keep alpha, set RGB to white).
 * Run from frontend: node scripts/icon-to-white.cjs
 */
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const frontendDir = path.resolve(__dirname, "..");
const pngPath = path.join(frontendDir, "assets", "icon.png");
const whitePath = path.join(frontendDir, "assets", "icon-white.png");

if (!fs.existsSync(pngPath)) {
  console.error("Not found:", pngPath);
  process.exit(1);
}

(async () => {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }
  await sharp(data, { raw: { width, height, channels } })
    .png()
    .toFile(whitePath);
  console.log("Written:", whitePath);
})();
