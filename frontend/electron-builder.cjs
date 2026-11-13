
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
    // 所有平台共用：引擎在 resources/engine/（见 electron/engine/engine-command.ts 的 ENGINE_EXECUTABLE），
    // 模型目录在 resources/contracts/（见 electron/core/paths.ts 的 resolveCatalogPath）。
    extraResources: [
        {
            from: "../dist/echotype-engine",
            to: "engine"
        },
        {
            from: "../contracts/models.catalog.json",
            to: "contracts/models.catalog.json"
        },
        {
            from: "../contracts/integrations.catalog.json",
            to: "contracts/integrations.catalog.json"
        }
    ],
    win: {
        target: [
            "zip",
            "appx"
        ],
        icon: "assets/icon.png"
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
        icon: "assets/icon.png"
    }
};
