
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, '../assets/icon-white.png');
const outputDir = path.join(__dirname, '../build/appx');

const sizes = [
    { name: 'StoreLogo.png', width: 50, height: 50 },
    { name: 'Square150x150Logo.png', width: 150, height: 150 },
    { name: 'Square44x44Logo.png', width: 44, height: 44 },
    { name: 'Wide310x150Logo.png', width: 310, height: 150 },
    { name: 'BadgeLogo.png', width: 24, height: 24 }
];

async function generate() {
    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const image = await Jimp.read(inputPath);
        console.log(`Loaded ${inputPath}`);

        for (const size of sizes) {
            const resized = image.clone();

            if (size.width !== size.height) {
                const wideImage = new Jimp(size.width, size.height, 0x00000000);
                const scale = Math.min(size.width, size.height) / Math.max(image.getWidth(), image.getHeight());
                const innerIcon = image.clone().scale(scale * 0.8);
                wideImage.composite(innerIcon, (size.width - innerIcon.getWidth()) / 2, (size.height - innerIcon.getHeight()) / 2);
                await wideImage.writeAsync(path.join(outputDir, size.name));
            } else {
                await resized.contain(size.width, size.height).writeAsync(path.join(outputDir, size.name));
            }

            console.log(`Generated ${size.name}`);
        }
        console.log('All icons generated successfully.');
    } catch (err) {
        console.error('Error generating icons:', err);
    }
}

generate();
