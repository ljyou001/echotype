/**
 * [INPUT]: 依赖 engine/dist/<os>-<arch>/（scripts/ci/build-engine.sh 产出）、contracts/models.catalog.json
 *          （资源本体与 channels 白名单）、scripts/ci/third-party-licenses.mjs（beforePack 生成许可清单）、
 *          scripts/ci/mac/entitlements.mac.plist；环境变量 ECHOTYPE_CHANNEL；可选读取仓库根 .env 的 APPX 身份
 * [OUTPUT]: electron-builder 配置对象。这是唯一配置源，package.json 不再有 build 字段
 * [POS]: 打包层配置。build.yml、make-appx.ps1 与本地 `npx electron-builder` 都读它（26.x 自动发现 .cjs）。
 *        资源布局与 Core 对齐：resources/engine/echotype-engine[.exe]（engine/engine-command.ts）、
 *        resources/contracts/models.catalog.json（core/paths.ts）、resources/licenses/third-party.json（LicensesView）。
 *        渠道写进打包后 package.json 的 echotype.channel，Core 读它决定模型来源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "contracts", "models.catalog.json");
const LICENSES_OUT = path.join(__dirname, "build", "licenses", "third-party.json");

// ---------------------------------------------------------------------------
// AppX 身份只来自环境变量：CI 用仓库变量（vars），本地用仓库根 .env。已存在的环境变量优先。
// ---------------------------------------------------------------------------
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
  }
}

/** mac 的主程序与全部嵌套二进制（含 resources/engine 下的引擎）共用一份 entitlements */
const MAC_ENTITLEMENTS = path.join(ROOT, "scripts", "ci", "mac", "entitlements.mac.plist");

// ---------------------------------------------------------------------------
// 渠道：构建时常量（MODEL_MANIFEST §6）。合法值只来自 catalog.channels，拼错即失败
// ---------------------------------------------------------------------------
const CHANNEL = process.env.ECHOTYPE_CHANNEL || "github";
const KNOWN_CHANNELS = Object.keys(JSON.parse(fs.readFileSync(CATALOG, "utf8")).channels).filter((k) => !k.startsWith("_"));
if (!KNOWN_CHANNELS.includes(CHANNEL)) {
  throw new Error(`ECHOTYPE_CHANNEL="${CHANNEL}" is not in contracts/models.catalog.json channels (${KNOWN_CHANNELS.join(", ")}).`);
}
// github 是默认渠道，产物名不带渠道；其余渠道插在版本号之后：EchoType-3.0.0-steam-win-x64.zip
const CHANNEL_TAG = CHANNEL === "github" ? "" : `-${CHANNEL}`;

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.echotype.app",
  productName: "EchoType",
  copyright: "Copyright © 2026 ljyou001",
  // linux 的 ${arch} 由 electron-builder 按格式惯例改写：AppImage 为 x86_64，deb 为 amd64
  artifactName: "${productName}-${version}" + CHANNEL_TAG + "-${os}-${arch}.${ext}",
  // uiohook-napi 与 robotjs 自带全部 6 个目标的 N-API 预编译，@electron/rebuild 识别不了，会误编译
  npmRebuild: false,
  // 不用 electron-updater：不生成 latest*.yml，CI 也不让 electron-builder 自行发布
  publish: null,
  // package.json 不归打包层，这里注入的字段只进打包后的 package.json（CI 另以 -c.extraMetadata.version 注入版本）
  extraMetadata: {
    homepage: "https://github.com/ljyou001/echotype", // deb 必需
    echotype: { channel: CHANNEL }, // Core 读取的发行渠道
  },
  directories: {
    output: "dist-package",
  },
  files: ["dist/**/*", "dist-electron/**/*", "assets/**/*", "!**/*.map"],

  // ${os}-${arch} 展开为 win-x64、mac-arm64、linux-arm64…，即 build-engine.sh 的 target-id
  extraResources: [
    { from: "../engine/dist/${os}-${arch}", to: "engine", filter: ["**/*"] },
    { from: "../contracts/models.catalog.json", to: "contracts/models.catalog.json" },
    { from: "build/licenses/third-party.json", to: "licenses/third-party.json" },
  ],

  // 每个 平台 × 架构 打包前生成许可清单：Rust 依赖随目标平台变化，所以不能共用一份
  beforePack: async (context) => {
    const { Arch } = require("electron-builder");
    const platform = context.electronPlatformName;
    if (platform === "win32" && CHANNEL === "msstore" && !process.env.WINDOWS_PUBLISHER_ID) {
      throw new Error("The msstore channel builds AppX and needs WINDOWS_PUBLISHER_ID, APPX_IDENTITY_NAME and APPX_PUBLISHER_DISPLAY_NAME.");
    }
    const { generateThirdPartyLicenses } = await import(pathToFileURL(path.join(ROOT, "scripts", "ci", "third-party-licenses.mjs")).href);
    const list = generateThirdPartyLicenses({ platform, arch: Arch[context.arch], out: LICENSES_OUT });
    console.log(`  • third-party licenses  components=${list.length} channel=${CHANNEL}`);
  },

  // ---- Windows -------------------------------------------------------------
  win: {
    // Microsoft Store 只收 AppX；其余渠道出 NSIS 安装包与 zip
    target: CHANNEL === "msstore" ? ["appx"] : ["nsis", "zip"],
    icon: "assets/icon.ico",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    // 用户数据在 ~/.echotype，由 Core 管理；卸载只删程序
    deleteAppDataOnUninstall: false,
  },
  appx: {
    identityName: process.env.APPX_IDENTITY_NAME,
    publisher: process.env.WINDOWS_PUBLISHER_ID,
    publisherDisplayName: process.env.APPX_PUBLISHER_DISPLAY_NAME,
    applicationId: "EchoType",
    displayName: "EchoType",
    languages: ["en-US", "zh-CN"],
  },

  // ---- macOS ---------------------------------------------------------------
  mac: {
    target: ["dmg", "zip"],
    icon: "resources/icon.png",
    category: "public.app-category.productivity",
    // ad-hoc 签名：arm64 必须有签名才能启动。用户首次打开走 隐私与安全性 → 仍要打开。公证另行接入
    identity: "-",
    notarize: false,
    hardenedRuntime: true,
    entitlements: MAC_ENTITLEMENTS,
    // 引擎是 Core 拉起的子进程，由它打开麦克风，所以它也需要 audio-input
    entitlementsInherit: MAC_ENTITLEMENTS,
    extendInfo: {
      NSMicrophoneUsageDescription:
        "EchoType uses your microphone while you hold the dictation hotkey. Speech is transcribed on this Mac.",
    },
  },

  // ---- Linux ---------------------------------------------------------------
  linux: {
    target: ["AppImage", "deb"],
    icon: "resources/icon.png",
    category: "Utility",
    executableName: "echotype",
    synopsis: "Hold a hotkey to dictate. Release to type.",
    // deb 必填。package.json 的 author 没有邮箱，这里给出维护者
    maintainer: "ljyou001 <https://github.com/ljyou001/echotype>",
  },
  deb: {
    // 写 depends 会替换默认列表，所以先列 electron-builder 26 的默认项，再加 XTest/Xt/XRandR（uiohook、robotjs）
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0",
      "libxt6",
      "libxrandr2",
    ],
  },
};
