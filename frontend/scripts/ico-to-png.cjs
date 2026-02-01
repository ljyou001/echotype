/**
 * Convert assets/icon.ico to assets/icon.png (transparent PNG).
 * Run from frontend: node scripts/ico-to-png.cjs
 */
const path = require("path");
const fs = require("fs");
const ico = require("sharp-ico");

const frontendDir = path.resolve(__dirname, "..");
const icoPath = path.join(frontendDir, "assets", "icon.ico");
const pngPath = path.join(frontendDir, "assets", "icon.png");

if (!fs.existsSync(icoPath)) {
  console.error("Not found:", icoPath);
  process.exit(1);
}

const icons = ico.sharpsFromIco(icoPath);
if (!icons || icons.length === 0) {
  console.error("No images in ICO:", icoPath);
  process.exit(1);
}

(async () => {
  let best = icons[0];
  let bestPx = 0;
  for (const img of icons) {
    const meta = await img.metadata();
    const px = (meta.width || 0) * (meta.height || 0);
    if (px > bestPx) {
      bestPx = px;
      best = img;
    }
  }
  // Preserve transparency like ICO: ensure alpha channel and output PNG
  await best.ensureAlpha().png().toFile(pngPath);
  console.log("Written:", pngPath);
})();
