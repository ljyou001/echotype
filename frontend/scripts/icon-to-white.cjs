/**
 * Generate icon-white.png from icon.png (keep alpha, set RGB to white).
 * Run from frontend: node scripts/icon-to-white.cjs
 */
const path = require("path");
const fs = require("fs");
const Jimp = require("jimp");

const frontendDir = path.resolve(__dirname, "..");
const pngPath = path.join(frontendDir, "assets", "icon.png");
const whitePath = path.join(frontendDir, "assets", "icon-white.png");

if (!fs.existsSync(pngPath)) {
  console.error("Not found:", pngPath);
  process.exit(1);
}

Jimp.read(pngPath).then(image => {
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    // x, y - pixel position
    // idx - index of the red channel for this pixel
    this.bitmap.data[idx + 0] = 255;
    this.bitmap.data[idx + 1] = 255;
    this.bitmap.data[idx + 2] = 255;
    // index + 3 is alpha, which we preserve
  });
  return image.writeAsync(whitePath);
}).then(() => {
  console.log("Written:", whitePath);
}).catch(err => {
  console.error("Error:", err);
});
