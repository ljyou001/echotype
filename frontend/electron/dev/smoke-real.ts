/**
 * [INPUT]: 依赖 node:crypto/fs/os/path/stream；依赖 extract-zip；依赖 engine/engine-command 的 resolveEngineCommand；
 *          依赖 services/asset-sources 的 checkAssetDir、ASSET_MANIFEST；依赖 ./smoke-kit 与 ./asset-mirror
 * [OUTPUT]: 导出 realSmoke（SmokeFactory）
 * [POS]: `npm run smoke:real` 的执行体（开发专用）：真实 Electron + Core + 真实 Rust 引擎 + 真实模型下载。
 *        全新临时 ECHOTYPE_HOME；模型经 window.echotype.models.install 走真实安装（下载 → sha256 → 解压），
 *        默认从 GitHub 下载，ECHOTYPE_SMOKE_ASSETS=<目录> 时从本地镜像下载同名 zip。
 *        没有麦克风：引擎以 --fake-mic 播放 zh.wav、en.wav（经 ECHOTYPE_ENGINE_ARGS 传入）。样例目录缺省为
 *        <repo>/engine/target/test-wavs（engine/scripts/fetch-test-wavs.sh 的输出），ECHOTYPE_SMOKE_WAVS 覆盖；
 *        缺文件时一行报错并给出该跑的命令，Core 不替人下载。
 *        检查：hello → 全新目录引擎 ready（缺模型不是引擎错误）→ auto 选 CPU 版本 → 默认模型安装与加载 → 中文听写与历史 →
 *        英文半角标点 → 配套标点模型 → 杀引擎后自动恢复 → activeModel → 全程没有请求过任何引擎包的 URL。
 *        ECHOTYPE_SMOKE_PACK=<包 id>（如 cuda）追加一段：显式 provider → 下载已发布的引擎包（按 catalog 的真实 sha256 校验）→
 *        从包拉起引擎 → 下载并加载 GPU 版本 → 中文听写。
 *        ECHOTYPE_SMOKE_STEAM=1 时整轮跑 steam 渠道（注入目录副本：多一个带假 app_id 的 DLC；ECHOTYPE_STEAM_APP_DIR 指向临时目录；
 *        外链只记录不打开），并追加一段：把刚从 GitHub 下载的默认模型 zip 解压到 content/<asset_stem>/ 并写 .asset.json，
 *        删掉下载目录里的副本 → 不下载即显示已安装、引擎从 Steam 目录加载 → 听写与 GitHub 那份逐字相同、release_to_final_ms 不变差 →
 *        remove 被 STEAM_MANAGED 拒绝 → DLC 资产的 install 只打开 steam://store/<app id>，没有下载请求。
 *        文本按 EXPECT 比对：样例按 sha256 钉死，引擎整句解码 + ITN，结果确定。
 *        结尾打印每个模型的 load_ms 与 release_to_final_ms（取自 Core 日志）。输出关闭，不装全局键盘钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import extractZip from "extract-zip";
import { resolveEngineCommand } from "../engine/engine-command.js";
import type { HistoryEntry, ModelView } from "../ipc-contract.js";
import { ASSET_MANIFEST, checkAssetDir } from "../services/asset-sources.js";
import { AssetMirror } from "./asset-mirror.js";
import { Checks, openProbeWindow, readCoreLog, sleep, until, writeSmokeSettings, type LogEntry, type SmokeContext, type SmokeFactory } from "./smoke-kit.js";

interface CatalogVariant {
  id: string;
  target: string;
  providers: string[];
  requires_pack: string | null;
  files: Record<string, string>;
  asset: { name: string; release: string; sha256: string | null; size_bytes: number };
}
interface CatalogModel {
  id: string;
  kind: string;
  status?: string;
  requires?: string[];
  languages?: string[];
  punctuation?: { mode: string; companion_id?: string };
  variants: CatalogVariant[];
}
interface Catalog {
  default_model_id: string;
  models: CatalogModel[];
  engine_packs: Array<{ id: string; platforms: Record<string, { asset: { name: string; sha256: string | null; size_bytes: number } }> }>;
}

type ClipName = "zh" | "en";
interface Clip {
  name: ClipName;
  file: string;
  seconds: number;
}

/** 片段播完后再等这么久才松键（"停 0.3 s 松键"，与 design/BENCHMARKS.md 的第二列同一场景） */
const TAIL_MS = 300;
const FULL_WIDTH = /[，。？！、；：]/;
/** fetch-test-wavs.sh 的缺省输出目录（相对仓库根） */
const DEFAULT_WAVS = path.join("engine", "target", "test-wavs");
/** ECHOTYPE_SMOKE_STEAM 注入的 DLC 的假 app id：openUri 只记录，从不打开 */
const SMOKE_APP_ID = 3999990;

// ============================================================
// 期望文本。zh 只比尾巴"早上9点至下午5点。"（ITN + 句号）：首词"开放/开饭"随模型而变，不断言；
// 配套标点模型的 zh 整句比对（逗号来自标点模型）；en 只有默认模型（多语种）听，比对句尾（半角、"boy" 后无逗号、ITN 数字、末词 gold）
// ============================================================
const EXPECT = {
  zhTail: "早上9点至下午5点。",
  zhCompanion: "开放时间，早上9点至下午5点。",
  enTail: "called for the boy and presented him with 50 pieces of gold.",
} as const;

export const realSmoke: SmokeFactory = (catalogFile, layout) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "echotype-smoke-real-"));
  process.env.ECHOTYPE_HOME = home;
  delete process.env.ECHOTYPE_ENGINE; // 永远拉起真实引擎
  writeSmokeSettings(home);
  const wavs = wavSource(layout.repoRoot);
  const clips = findClips(wavs.dir);
  if (clips) {
    // FakeBackend 每次 session.start 切到下一个文件：zh → en → zh …；引擎重启后从 zh 重新开始
    const fakeMic = clips.map((c) => `--fake-mic "${c.file}"`).join(" ");
    process.env.ECHOTYPE_ENGINE_ARGS = [fakeMic, process.env.ECHOTYPE_ENGINE_ARGS ?? ""].join(" ").trim();
  }
  const mirror = process.env.ECHOTYPE_SMOKE_ASSETS ? new AssetMirror(path.resolve(process.env.ECHOTYPE_SMOKE_ASSETS)) : null;
  const engine = resolveEngineCommand({ layout, env: process.env, execPath: process.execPath, pack: null }).command;
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as Catalog;
  const steam = process.env.ECHOTYPE_SMOKE_STEAM === "1" ? prepareSteam(home, catalogFile, catalog) : null;
  const requested: string[] = []; // Core 发出的每个下载 URL（镜像改写之前）
  return {
    home,
    budgetMs: 30 * 60_000, // 首次从 GitHub 下载约 300 MB；带引擎包再加约 2.6 GB
    catalogFile: steam?.catalogFile,
    openUri: steam ? async (uri: string) => void steam.opened.push(uri) : undefined,
    adaptFetch: (base) => {
      const inner = mirror ? mirror.adapt(base) : base;
      return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requested.push(url);
        const res = await inner(input, init);
        return steam ? steam.keepZip(url, res) : res;
      }) as typeof fetch;
    },
    run: (ctx) => runRealSmoke(ctx, { engine, wavs, clips, mirror, catalog, home, requested, pack: process.env.ECHOTYPE_SMOKE_PACK || null, steam }),
    finish: (code) => {
      mirror?.close();
      // 引擎已停，模型与引擎包（解压后数 GB）可以删；Chromium 在退出前仍占着 userData，所以目录本身留下
      if (code === 0) for (const dir of ["models", "engines", "steam-app", "steam-zips"]) fs.rmSync(path.join(home, dir), { recursive: true, force: true, maxRetries: 3 });
      process.stdout.write(`${code === 0 ? "logs" : "home kept for inspection"}: ${code === 0 ? path.join(home, "logs") : home}\n`);
    },
  };
};

interface RunOptions {
  engine: string;
  wavs: WavSource;
  clips: Clip[] | null;
  mirror: AssetMirror | null;
  catalog: Catalog;
  home: string;
  requested: string[];
  pack: string | null; // ECHOTYPE_SMOKE_PACK
  steam: SteamSetup | null; // ECHOTYPE_SMOKE_STEAM
}

async function runRealSmoke(ctx: SmokeContext, o: RunOptions): Promise<number> {
  const { core, logger, logFile } = ctx;
  const checks = new Checks("SMOKE:REAL");
  const report = new Report();
  const { win, js } = await openProbeWindow(ctx);
  const logs = () => readCoreLog(logFile);
  const lastLog = (msg: string, match: (d: Record<string, unknown>) => boolean): LogEntry | undefined =>
    logs().filter((e) => e.msg === msg && e.data && match(e.data)).at(-1);
  const waitLog = async (msg: string, match: (d: Record<string, unknown>) => boolean, label: string): Promise<Record<string, unknown>> => {
    await until(() => lastLog(msg, match) !== undefined, 5_000, label);
    return lastLog(msg, match)!.data!;
  };

  // ============================================================
  // 动作：安装（真实下载）、等加载完成、听写一段假麦克风
  // ============================================================
  const install = async (model: CatalogModel): Promise<CatalogVariant> => {
    const variant = cpuVariant(model);
    const started = Date.now();
    await js(`window.echotype.models.install(${JSON.stringify(model.id)}, ${JSON.stringify(variant.id)})`);
    const marker = JSON.parse(fs.readFileSync(path.join(o.home, "models", model.id, variant.id, ".installed.json"), "utf-8")) as { sha256: string | null };
    const source = o.mirror?.served.includes(variant.asset.name) ? `mirror ${o.mirror.dir}` : "github";
    report.installs.push({ model: `${model.id}/${variant.id}`, mb: variant.asset.size_bytes / 1e6, seconds: (Date.now() - started) / 1000, source });
    checks.check(`install ${model.id}/${variant.id} from ${source}: download → sha256 → extract`, variant.asset.sha256 === null || marker.sha256 === variant.asset.sha256, marker);
    return variant;
  };

  const awaitLoaded = async (model: CatalogModel, readyLinesBefore: number): Promise<Record<string, unknown>> => {
    await until(() => core.snapshot().activeModel?.id === model.id && logs().filter((e) => e.msg === "model ready").length > readyLinesBefore, 120_000, `${model.id} loaded`);
    const ready = await waitLog("model ready", (d) => d.model_id === model.id, "model ready log line");
    report.loads.push({ model: `${model.id}/${String(ready.variant_id)}`, provider: String(ready.provider_used), loadMs: Number(ready.load_ms), warmupMs: Number(ready.warmup_ms) });
    return ready;
  };
  const readyLines = () => logs().filter((e) => e.msg === "model ready").length;

  let sessions = 0; // 本引擎进程里已开始的会话数，决定假麦克风播哪个文件
  let tag = ""; // 报告里标出这段听写用的是哪份模型（steam）
  const dictate = async (expected: ClipName): Promise<string> => {
    const clip = o.clips![sessions % o.clips!.length];
    if (clip.name !== expected) throw new Error(`fake mic order: next clip is ${clip.name}.wav, expected ${expected}.wav`);
    sessions++;
    const before = core.dictation.state().lastFinal;
    const startedAt = Date.now(); // 从发出 start 起算：假麦克风在引擎收到 session.start 时开播，轮询"recording"的延迟不算进尾巴
    await js(`window.echotype.dictation.start()`);
    await until(() => core.dictation.state().phase === "recording", 5_000, "recording");
    await sleep(Math.max(0, startedAt + clip.seconds * 1000 + TAIL_MS - Date.now()));
    await js(`window.echotype.dictation.stop()`);
    await until(() => core.dictation.state().phase === "idle", 15_000, `final for ${clip.name}.wav`);
    const final = core.dictation.state().lastFinal;
    if (!final || final === before) throw new Error(`${clip.name}.wav produced an empty final`);
    const line = await waitLog("final", (d) => d.id === final.sessionId, "Core final log line");
    report.dictations.push({
      model: core.snapshot().activeModel?.id ?? "?",
      tag,
      clip: clip.name,
      engineMs: Number(line.engineReleaseToFinalMs),
      coreMs: line.coreReleaseToFinalMs === null ? null : Number(line.coreReleaseToFinalMs),
      audioMs: Number(line.audioMs),
      text: final.text,
    });
    return final.text;
  };

  try {
    // 前置条件缺了就一行说清楚该跑什么
    if (!fs.existsSync(o.engine)) throw new Error(`engine binary not found at ${o.engine}. Run \`cd engine && cargo build --release\` or set ECHOTYPE_ENGINE_PATH`);
    checks.check("engine binary exists", true);
    if (!o.clips) throw new Error(`zh.wav and en.wav not found in ${o.wavs.dir}. Run \`${o.wavs.fetch}\``);
    checks.check(`zh.wav and en.wav found in ${o.wavs.dir}`, true);
    const plan = planModels(o.catalog);

    // ---------- 握手 ----------
    await until(() => core.supervisor.status().state === "running", 60_000, "engine hello");
    const hello = core.supervisor.status();
    report.hello = `engine ${hello.engineVersion} · providers ${hello.providers.join(",")} · runtimes ${Object.entries(hello.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")}`;
    checks.check("hello: runtimes and providers", "sherpa-onnx" in hello.runtimes && hello.providers.includes("cpu"), hello);
    await until(() => core.snapshot().engine.error?.code === "MODEL_NOT_INSTALLED", 15_000, "MODEL_NOT_INSTALLED");
    checks.check("fresh home: engine ready, engine.error MODEL_NOT_INSTALLED (a missing model is not an engine error)", core.snapshot().engine.state === "ready", core.snapshot().engine);
    const selected = core.models().find((m) => m.id === plan.first.id)?.selectedVariantId;
    checks.check(`auto selects ${plan.first.id}/${cpuVariant(plan.first).id} (never a variant whose pack is not installed)`, selected === cpuVariant(plan.first).id, selected);

    // ---------- 默认模型：安装 → 加载 → 中文 → 历史 → 英文 ----------
    let before = readyLines();
    const firstVariant = await install(plan.first);
    await awaitLoaded(plan.first, before);
    const active = core.snapshot().activeModel;
    checks.check(`load ${plan.first.id}: activeModel variant / runtime / providerUsed`, active?.variantId === firstVariant.id && active.runtime === "sherpa-onnx" && active.providerUsed === "cpu" && active.fallback === false, active);

    const zh = await dictate("zh");
    checks.check(`dictation zh.wav → final ends with "${EXPECT.zhTail}" (${plan.first.id})`, zh.endsWith(EXPECT.zhTail), zh);
    const history = await js<HistoryEntry[]>(`window.echotype.history.list()`);
    checks.check("final → history entry", history.length === 1 && history[0].text === zh, history);

    const en = await dictate("en");
    if (plan.first.languages?.includes("en")) {
      checks.check(`English with punct_style auto → half-width, ends with "${EXPECT.enTail}"`, en.endsWith(EXPECT.enTail) && !FULL_WIDTH.test(en), en);
    }
    const github = { zh: report.dictations[0], en: report.dictations[1] }; // steam 段的比对基准：同一模型从 GitHub 下载的那份

    // ---------- 配套标点：安装标点模型与 ASR → 激活 → 中文 ----------
    await install(plan.punct);
    await install(plan.companion);
    before = readyLines();
    await js(`window.echotype.models.activate(${JSON.stringify(plan.companion.id)})`);
    await awaitLoaded(plan.companion, before);
    const loading = await waitLog("loading model", (d) => d.id === plan.companion.id, "loading model log line");
    const zhCompanion = await dictate("zh");
    checks.check(
      `companion punctuation: ${plan.companion.id} + ${plan.punct.id} → "${EXPECT.zhCompanion}"`,
      String(loading.companion).startsWith(`${plan.punct.id}/`) && zhCompanion === EXPECT.zhCompanion,
      { companion: loading.companion, text: zhCompanion },
    );

    // ---------- 杀引擎：supervisor 重启 → 模型重载 → 再听写 ----------
    const pid = core.supervisor.status().pid!;
    before = readyLines();
    process.kill(pid);
    await until(() => {
      const s = core.supervisor.status();
      return s.state === "running" && s.pid !== null && s.pid !== pid;
    }, 30_000, "engine restart");
    sessions = 0;
    await awaitLoaded(plan.companion, before);
    const afterRestart = await dictate("zh");
    checks.check("engine killed → supervisor restarts it → model reloads → same text", afterRestart === EXPECT.zhCompanion, afterRestart);

    const final = core.snapshot().activeModel;
    checks.check(
      "snapshot.activeModel after recovery: variant / runtime / providerUsed",
      final?.id === plan.companion.id && final.variantId === cpuVariant(plan.companion).id && final.runtime === "sherpa-onnx" && final.providerUsed === "cpu" && final.fallback === false,
      final,
    );
    const packUrls = o.requested.filter((u) => o.catalog.engine_packs.some((p) => Object.values(p.platforms).some((x) => u.endsWith(`/${x.asset.name}`))));
    checks.check(`no engine pack URL requested (${o.requested.length} downloads, all models)`, packUrls.length === 0, packUrls);

    // ---------- ECHOTYPE_SMOKE_STEAM：默认模型改由 Steam 目录就地提供，与 GitHub 下载的那份逐字比对 ----------
    if (o.steam) {
      const s = o.steam;
      const id = plan.first.id;
      const v = s.base;
      if (!s.zipDone) throw new Error(`${v.asset.name} was not downloaded in this run, so there is no zip to stage`);
      await s.zipDone;
      const folder = path.join(s.appDir, "content", v.asset.name.replace(/\.zip$/, ""));
      const zipSha = await stageFromZip(s.zip, folder, v.asset.name);
      fs.rmSync(s.zip, { force: true });
      checks.check(`steam: the downloaded ${v.asset.name} (sha256 ${zipSha.slice(0, 12)}… = catalog) extracted to content/${path.basename(folder)}/ with ${ASSET_MANIFEST}`, zipSha === v.asset.sha256, zipSha);
      fs.rmSync(path.join(o.home, "models", id, v.id), { recursive: true, force: true }); // 只剩 Steam 目录里的那份
      const downloads = o.requested.length;
      core.rescanAssets(); // 与窗口获得焦点同一入口
      const view = async (m: string, variant: string) => (await js<ModelView[]>(`window.echotype.models.list()`)).find((x) => x.id === m)?.variants.find((x) => x.id === variant);
      const shown = await view(id, v.id);
      checks.check(
        `steam: ${id}/${v.id} shows installed without a download (delivery steam, base asset)`,
        shown?.install.status === "installed" && shown.delivery.kind === "steam" && shown.delivery.dlc === null && o.requested.length === downloads,
        shown,
      );

      before = readyLines();
      await js(`window.echotype.models.activate(${JSON.stringify(id)})`);
      await awaitLoaded(plan.first, before);
      const loadedFrom = (await waitLog("loading model", (d) => d.id === id, "loading model log line")).dir;
      checks.check(`steam: the engine loads ${id} from the Steam folder (model_dir)`, loadedFrom === folder, loadedFrom);

      tag = "steam";
      const steamRun: Partial<Record<ClipName, Dictation>> = {};
      for (let i = 0; i < o.clips.length; i++) {
        const name = o.clips[sessions % o.clips.length].name;
        await dictate(name);
        steamRun[name] = report.dictations.at(-1);
      }
      tag = "";
      const clipsBoth = ["zh", "en"] as const;
      const differ = clipsBoth.filter((n) => steamRun[n]?.text !== github[n].text);
      checks.check("steam: dictation text equals the GitHub-downloaded copy word for word (zh, en)", differ.length === 0, { steam: steamRun, github });
      const allowance = (ms: number) => Math.max(30, ms * 0.2);
      const worse = clipsBoth.filter((n) => steamRun[n]!.engineMs > github[n].engineMs + allowance(github[n].engineMs));
      const latency = clipsBoth.map((n) => `${n} ${steamRun[n]!.engineMs} vs ${github[n].engineMs} ms`).join(", ");
      checks.check(`steam: release_to_final_ms no worse than the GitHub copy (${latency}; noise allowance max(30 ms, 20 %))`, worse.length === 0, worse);

      const removal = await js<string>(`window.echotype.models.remove(${JSON.stringify(id)}, ${JSON.stringify(v.id)}).then(() => "resolved", (e) => e.code)`);
      const intact = checkAssetDir(folder, v.asset, Object.values(v.files));
      checks.check("steam: models.remove on a Steam-delivered version rejects with STEAM_MANAGED; the folder stays intact", removal === "STEAM_MANAGED" && intact.ok, { removal, intact });

      const dlc = s.dlc;
      const dlcDownloads = o.requested.length;
      await js(`window.echotype.models.install(${JSON.stringify(dlc.model.id)}, ${JSON.stringify(dlc.variant.id)})`);
      const dlcView = await view(dlc.model.id, dlc.variant.id);
      checks.check(
        `steam: models.install on ${dlc.variant.asset.name} (in a DLC with an app_id) only opens steam://store/${SMOKE_APP_ID}; no download request`,
        s.opened.join(" ") === `steam://store/${SMOKE_APP_ID}` &&
          o.requested.length === dlcDownloads &&
          dlcView?.install.status === "not_installed" &&
          dlcView.delivery.kind === "steam" &&
          dlcView.delivery.dlc?.appId === SMOKE_APP_ID,
        { opened: s.opened, downloads: o.requested.slice(dlcDownloads), view: dlcView },
      );
    }

    // ---------- ECHOTYPE_SMOKE_PACK：显式 provider → 已发布的引擎包（真实 sha256）→ 从包拉起引擎 → GPU 版本 ----------
    if (o.pack) {
      const gpu = gpuPlan(o.catalog, plan.first, o.pack);
      before = readyLines();
      await js(`window.echotype.models.activate(${JSON.stringify(plan.first.id)})`);
      await awaitLoaded(plan.first, before);
      await js(`window.echotype.models.updateSettings(${JSON.stringify(plan.first.id)}, { provider: ${JSON.stringify(gpu.provider)} })`);
      const chosen = core.models().find((m) => m.id === plan.first.id)?.selectedVariantId;
      checks.check(`explicit provider ${gpu.provider} selects ${plan.first.id}/${gpu.variant.id}`, chosen === gpu.variant.id, chosen);

      const started = Date.now();
      before = readyLines();
      await js(`window.echotype.models.install(${JSON.stringify(plan.first.id)})`); // 省略 variantId：所选版本，缺包先装包
      const packMarker = readMarker(path.join(o.home, "engines", o.pack));
      const modelMarker = readMarker(path.join(o.home, "models", plan.first.id, gpu.variant.id));
      const source = (name: string) => (o.mirror?.served.includes(name) ? `mirror ${o.mirror.dir}` : "github");
      const packDone = Date.parse(String(packMarker.installedAt));
      report.installs.push({ model: `engine-pack/${o.pack}`, mb: gpu.asset.size_bytes / 1e6, seconds: (packDone - started) / 1000, source: source(gpu.asset.name) });
      report.installs.push({
        model: `${plan.first.id}/${gpu.variant.id}`,
        mb: gpu.variant.asset.size_bytes / 1e6,
        seconds: (Date.parse(String(modelMarker.installedAt)) - packDone) / 1000,
        source: source(gpu.variant.asset.name),
      });
      checks.check(`${o.pack} pack from ${source(gpu.asset.name)}: download → sha256 ${gpu.asset.sha256!.slice(0, 12)}… (catalog) → extract`, packMarker.sha256 === gpu.asset.sha256, packMarker);
      checks.check(`${plan.first.id}/${gpu.variant.id}: download → sha256 → extract`, gpu.variant.asset.sha256 === null || modelMarker.sha256 === gpu.variant.asset.sha256, modelMarker);

      await awaitLoaded(plan.first, before);
      sessions = 0; // 换包重启了引擎：假麦克风从 zh 重新开始
      const s = core.supervisor.status();
      checks.check(`engine runs from the ${o.pack} pack (hello providers ${s.providers.join(",")})`, s.packId === o.pack && s.providers.includes(gpu.provider), { packId: s.packId, providers: s.providers, version: s.engineVersion });
      const onGpu = core.snapshot().activeModel;
      checks.check(`load ${plan.first.id}/${gpu.variant.id} on ${gpu.provider}, no fallback`, onGpu?.variantId === gpu.variant.id && onGpu.providerUsed === gpu.provider && !onGpu.fallback, onGpu);
      const zhGpu = await dictate("zh");
      checks.check(`dictation zh.wav on ${gpu.provider} → final ends with "${EXPECT.zhTail}"`, zhGpu.endsWith(EXPECT.zhTail), zhGpu);
    }
    return checks.pass(report.render());
  } catch (err) {
    return checks.fail(err, logger, report.render());
  } finally {
    win.destroy();
  }
}

// ============================================================
// 选模型：全部来自 catalog，不写死 id
// 默认模型 + 体积最小、带 cpu 版本、用配套标点的 ASR 模型及其标点模型
// ============================================================
function planModels(catalog: Catalog): { first: CatalogModel; companion: CatalogModel; punct: CatalogModel } {
  const byId = new Map(catalog.models.map((m) => [m.id, m]));
  const first = byId.get(catalog.default_model_id);
  if (!first) throw new Error(`default model ${catalog.default_model_id} is not in the catalog`);
  const companion = catalog.models
    .filter((m) => m.kind === "asr" && m.punctuation?.mode === "companion" && m.punctuation.companion_id && byId.has(m.punctuation.companion_id))
    .filter((m) => m.variants.some((v) => v.target === "cpu"))
    .sort((a, b) => cpuVariant(a).asset.size_bytes - cpuVariant(b).asset.size_bytes)[0];
  if (!companion) throw new Error("the catalog has no ASR model with a companion punctuation model");
  return { first, companion, punct: byId.get(companion.punctuation!.companion_id!)! };
}

/** ECHOTYPE_SMOKE_PACK 的计划：默认模型里需要该包的版本、它的 provider、本平台的包资产（必须已发布） */
function gpuPlan(catalog: Catalog, model: CatalogModel, packId: string) {
  const variant = model.variants.find((v) => v.requires_pack === packId);
  if (!variant) throw new Error(`${model.id} has no variant that needs the ${packId} pack`);
  const platform = `${process.platform}-${process.arch}`;
  const asset = catalog.engine_packs.find((p) => p.id === packId)?.platforms[platform]?.asset;
  if (!asset?.sha256) throw new Error(`the ${packId} pack is not published for ${platform}`);
  return { variant, provider: variant.providers[0], asset };
}

// ============================================================
// ECHOTYPE_SMOKE_STEAM：steam 渠道的准备与 content/ 目录的布置
// ============================================================
interface RawCatalog {
  channels: { steam: { steam: { base_assets: string[]; dlc: Array<{ id: string; name: string; app_id: number | null; assets?: string[]; packs?: string[] }> } } };
}

interface SteamSetup {
  appDir: string; // ECHOTYPE_STEAM_APP_DIR
  catalogFile: string; // 注入的目录副本
  base: CatalogVariant; // 默认模型的 cpu 版本：Steam 基础资产
  dlc: { model: CatalogModel; variant: CatalogVariant }; // 放进带假 app_id 的 DLC 的资产
  zip: string; // 下载 base 资产时顺手留下的 zip
  zipDone: Promise<void> | null;
  opened: string[]; // Core 打开过的外链
  keepZip(url: string, res: Response): Response;
}

/** 整轮跑 steam 渠道：Steam 安装目录是临时目录；目录副本里加一个带假 app_id 的 DLC，装着一个本轮用不到的模型 */
function prepareSteam(home: string, catalogFile: string, catalog: Catalog): SteamSetup {
  const plan = planModels(catalog);
  const base = cpuVariant(plan.first);
  const used = new Set([plan.first.id, plan.companion.id, plan.punct.id]);
  const spare = catalog.models.find((m) => m.kind === "asr" && !used.has(m.id) && m.status !== "hidden" && !m.requires?.length && m.variants.some((v) => v.target === "cpu"));
  if (!spare) throw new Error("the catalog has no spare ASR model for the DLC check");
  const dlcVariant = cpuVariant(spare);

  const raw = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as RawCatalog;
  const table = raw.channels.steam.steam;
  if (!table.base_assets.includes(base.asset.name)) throw new Error(`${base.asset.name} is not a Steam base asset in the catalog`);
  for (const d of table.dlc) d.assets = (d.assets ?? []).filter((a) => a !== dlcVariant.asset.name); // 一个资产只出现一次
  table.dlc.push({ id: "smoke-dlc", name: "Smoke Test DLC", app_id: SMOKE_APP_ID, assets: [dlcVariant.asset.name] });
  const catalogDir = path.join(home, "smoke-catalog");
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, "models.catalog.json"), JSON.stringify(raw));
  fs.copyFileSync(path.join(path.dirname(catalogFile), "integrations.catalog.json"), path.join(catalogDir, "integrations.catalog.json"));

  const appDir = path.join(home, "steam-app");
  fs.mkdirSync(path.join(appDir, "content"), { recursive: true });
  process.env.ECHOTYPE_CHANNEL = "steam";
  process.env.ECHOTYPE_STEAM_APP_DIR = appDir;
  const zip = path.join(home, "steam-zips", base.asset.name);
  fs.mkdirSync(path.dirname(zip), { recursive: true });

  const setup: SteamSetup = {
    appDir,
    catalogFile: path.join(catalogDir, "models.catalog.json"),
    base,
    dlc: { model: spare, variant: dlcVariant },
    zip,
    zipDone: null,
    opened: [],
    // Core 下载 base 资产时把响应分一路写进 zip：之后像 scripts/steam 那样解压它
    keepZip: (url, res) => {
      if (!url.endsWith(`/${base.asset.name}`) || res.status !== 200 || !res.body) return res;
      const [forCore, forZip] = res.body.tee();
      const done = pipeline(Readable.fromWeb(forZip as import("node:stream/web").ReadableStream), fs.createWriteStream(zip));
      done.catch(() => undefined); // 在 steam 段里 await 时再报错
      setup.zipDone = done;
      return new Response(forCore, { status: res.status, statusText: res.statusText, headers: res.headers });
    },
  };
  return setup;
}

/** scripts/steam 的做法：zip 解压到 content/<asset_stem>/，写 .asset.json（资产名、zip 的 sha256、每个文件的字节数）。返回 zip 的 sha256 */
async function stageFromZip(zip: string, folder: string, asset: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(zip), hash);
  const sha256 = hash.digest("hex");
  await extractZip(zip, { dir: path.resolve(folder) });
  const files: Record<string, number> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files[path.relative(folder, p).split(path.sep).join("/")] = fs.statSync(p).size;
    }
  };
  walk(folder);
  fs.writeFileSync(path.join(folder, ASSET_MANIFEST), `${JSON.stringify({ asset, sha256, files }, null, 2)}\n`);
  return sha256;
}

function readMarker(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".installed.json"), "utf-8")) as Record<string, unknown>;
}

function cpuVariant(model: CatalogModel): CatalogVariant {
  const v = model.variants.find((x) => x.target === "cpu");
  if (!v) throw new Error(`${model.id} has no cpu variant`);
  return v;
}

// ============================================================
// 样例：ECHOTYPE_SMOKE_WAVS，缺省 fetch-test-wavs.sh 的输出目录。fetch 是缺文件时提示的命令
// ============================================================
interface WavSource {
  dir: string;
  fetch: string;
}

function wavSource(repoRoot: string): WavSource {
  const override = process.env.ECHOTYPE_SMOKE_WAVS;
  const script = "bash engine/scripts/fetch-test-wavs.sh";
  if (override) return { dir: path.resolve(override), fetch: `${script} "${override}"` };
  return { dir: path.join(repoRoot, DEFAULT_WAVS), fetch: script };
}

function findClips(dir: string): Clip[] | null {
  const clips: Clip[] = [];
  for (const name of ["zh", "en"] as const) {
    const file = path.resolve(dir, `${name}.wav`);
    if (!fs.existsSync(file)) return null;
    clips.push({ name, file, seconds: wavSeconds(file) });
  }
  return clips;
}

/** RIFF：fmt 块的 byte rate 与 data 块的长度 */
function wavSeconds(file: string): number {
  const buf = fs.readFileSync(file);
  let byteRate = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(at + 16);
    if (id === "data" && byteRate > 0) return size / byteRate;
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file} is not a PCM wav`);
}

// ============================================================
// 报告：安装耗时、加载耗时、每段听写的松键到出字
// ============================================================
type Dictation = { model: string; tag: string; clip: ClipName; engineMs: number; coreMs: number | null; audioMs: number; text: string };

class Report {
  hello = "";
  readonly installs: Array<{ model: string; mb: number; seconds: number; source: string }> = [];
  readonly loads: Array<{ model: string; provider: string; loadMs: number; warmupMs: number }> = [];
  readonly dictations: Dictation[] = [];

  render(): string {
    const lines = [`  ${this.hello}`];
    for (const i of this.installs) lines.push(`  install  ${i.model.padEnd(36)} ${i.mb.toFixed(1).padStart(6)} MB ${i.seconds.toFixed(1).padStart(6)} s  ${i.source}`);
    for (const l of this.loads) lines.push(`  load     ${l.model.padEnd(36)} ${l.provider.padEnd(5)} load_ms ${String(l.loadMs).padStart(5)}  warmup_ms ${l.warmupMs}`);
    for (const d of this.dictations) {
      const core = d.coreMs === null ? "-" : String(d.coreMs);
      lines.push(`  dictate  ${`${d.model}${d.tag ? ` [${d.tag}]` : ""}`.padEnd(24)} ${d.clip}.wav  release_to_final_ms ${String(d.engineMs).padStart(4)} (Core ${core.padStart(4)})  audio ${d.audioMs} ms  "${d.text}"`);
    }
    return `${lines.join("\n")}\n`;
  }
}
