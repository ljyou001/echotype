
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const index = line.indexOf('=');
        if (index > 0) {
            const name = line.substring(0, index).trim();
            const value = line.substring(index + 1).trim();
            process.env[name] = value;
        }
    });
}

console.log('--- Resolved AppX Config ---');
console.log('Identity Name:', process.env.APPX_IDENTITY_NAME);
console.log('Publisher:', process.env.WINDOWS_PUBLISHER_ID);
console.log('Publisher Display Name:', process.env.APPX_PUBLISHER_DISPLAY_NAME);
console.log('---------------------------');

module.exports = {
    appId: "com.echotype.app",
    productName: "EchoType",
    copyright: "Copyright © 2026 ljyou001",
    npmRebuild: false,
    directories: {
        output: "dist-package"
    },
    files: [
        "dist/**/*",
        "dist-electron/**/*",
        "assets/**/*"
    ],
    win: {
        target: [
            "zip",
            "appx"
        ],
        icon: "assets/icon.png",
        extraResources: [
            {
                from: "../dist/echotype-backend",
                to: "backend"
            },
            {
                from: "../backend/models_catalog.json",
                to: "backend/models_catalog.json"
            }
        ]
    },
    appx: {
        identityName: process.env.APPX_IDENTITY_NAME,
        publisher: process.env.WINDOWS_PUBLISHER_ID,
        publisherDisplayName: process.env.APPX_PUBLISHER_DISPLAY_NAME,
        applicationId: "EchoType",
        displayName: "EchoType",
        languages: ["en-US", "zh-CN"]
    },
    mac: {
        target: ["dmg"],
        icon: "assets/icon.png",
        extraResources: [
            {
                from: "../dist/echotype-backend",
                to: "backend"
            },
            {
                from: "../backend/models_catalog.json",
                to: "backend/models_catalog.json"
            }
        ]
    }
};
