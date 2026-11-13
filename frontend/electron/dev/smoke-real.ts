/**
 * [INPUT]: 依赖 node:fs/os/path；依赖 engine/engine-command 的 resolveEngineCommand；依赖 ./smoke-kit 与 ./asset-mirror
 * [OUTPUT]: 导出 realSmoke（SmokeFactory）
 * [POS]: `npm run smoke:real` 的执行体（开发专用）：真实 Electron + Core + 真实 Rust 引擎 + 真实模型下载。
 *        全新临时 ECHOTYPE_HOME；模型经 window.echotype.models.install 走真实安装（下载 → sha256 → 解压），
 *        默认从 GitHub 下载，ECHOTYPE_SMOKE_ASSETS=<目录> 时从本地镜像下载同名 zip。
 *        没有麦克风：引擎以 --fake-mic 播放 ECHOTYPE_SMOKE_WAVS 里的 zh.wav、en.wav（经 ECHOTYPE_ENGINE_ARGS 传入）。
 *        检查：hello → 默认模型安装与加载 → 中文听写与历史 → 英文半角标点 → 配套标点模型 → 杀引擎后自动恢复 → activeModel。
 *        结尾打印每个模型的 load_ms 与 release_to_final_ms（取自 Core 日志）。输出关闭，不装全局键盘钩子。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEngineCommand } from "../engine/engine-command.js";
import type { HistoryEntry } from "../ipc-contract.js";
import { AssetMirror } from "./asset-mirror.js";
import { Checks, openProbeWindow, readCoreLog, sleep, until, writeSmokeSettings, type LogEntry, type SmokeContext, type SmokeFactory } from "./smoke-kit.js";

interface CatalogVariant {
  id: string;
  target: string;
  asset: { name: string; sha256: string | null; size_bytes: number };
}
interface CatalogModel {
  id: string;
  kind: string;
  languages?: string[];
  punctuation?: { mode: string; companion_id?: string };
  variants: CatalogVariant[];
}
interface Catalog {
  default_model_id: string;
  models: CatalogModel[];
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
const HALF_WIDTH = /[.,?!;:]/;
const HAN = /\p{Script=Han}/u;

export const realSmoke: SmokeFactory = (catalogFile, layout) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "echotype-smoke-real-"));
  process.env.ECHOTYPE_HOME = home;
  delete process.env.ECHOTYPE_ENGINE; // 永远拉起真实引擎
  writeSmokeSettings(home);
  const clips = findClips(process.env.ECHOTYPE_SMOKE_WAVS);
  if (clips) {
    // FakeBackend 每次 session.start 切到下一个文件：zh → en → zh …；引擎重启后从 zh 重新开始
    const fakeMic = clips.map((c) => `--fake-mic "${c.file}"`).join(" ");
    process.env.ECHOTYPE_ENGINE_ARGS = [fakeMic, process.env.ECHOTYPE_ENGINE_ARGS ?? ""].join(" ").trim();
  }
  const mirror = process.env.ECHOTYPE_SMOKE_ASSETS ? new AssetMirror(path.resolve(process.env.ECHOTYPE_SMOKE_ASSETS)) : null;
  const engine = resolveEngineCommand({ layout, env: process.env, execPath: process.execPath, pack: null }).command;
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf-8")) as Catalog;
  return {
    home,
    budgetMs: 30 * 60_000, // 首次从 GitHub 下载约 300 MB
    adaptFetch: mirror ? (base) => mirror.adapt(base) : undefined,
    run: (ctx) => runRealSmoke(ctx, { engine, clips, mirror, catalog, home }),
    finish: (code) => {
      mirror?.close();
      // 引擎已停，模型（约 600 MB 解压后）可以删；Chromium 在退出前仍占着 userData，所以目录本身留下
      if (code === 0) fs.rmSync(path.join(home, "models"), { recursive: true, force: true, maxRetries: 3 });
      process.stdout.write(`${code === 0 ? "logs" : "home kept for inspection"}: ${code === 0 ? path.join(home, "logs") : home}\n`);
    },
  };
};

interface RunOptions {
  engine: string;
  clips: Clip[] | null;
  mirror: AssetMirror | null;
  catalog: Catalog;
  home: string;
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
  const dictate = async (expected: ClipName): Promise<string> => {
    const clip = o.clips![sessions % o.clips!.length];
    if (clip.name !== expected) throw new Error(`fake mic order: next clip is ${clip.name}.wav, expected ${expected}.wav`);
    sessions++;
    const before = core.dictation.state().lastFinal;
    await js(`window.echotype.dictation.start()`);
    await until(() => core.dictation.state().phase === "recording", 5_000, "recording");
    await sleep(clip.seconds * 1000 + TAIL_MS);
    await js(`window.echotype.dictation.stop()`);
    await until(() => core.dictation.state().phase === "idle", 15_000, `final for ${clip.name}.wav`);
    const final = core.dictation.state().lastFinal;
    if (!final || final === before) throw new Error(`${clip.name}.wav produced an empty final`);
    const line = await waitLog("final", (d) => d.id === final.sessionId, "Core final log line");
    report.dictations.push({
      model: core.snapshot().activeModel?.id ?? "?",
      clip: clip.name,
      engineMs: Number(line.engineReleaseToFinalMs),
      coreMs: line.coreReleaseToFinalMs === null ? null : Number(line.coreReleaseToFinalMs),
      audioMs: Number(line.audioMs),
      text: final.text,
    });
    return final.text;
  };

  try {
    checks.check("engine binary exists", fs.existsSync(o.engine), { engine: o.engine, fix: "cd engine && cargo build --release, or set ECHOTYPE_ENGINE_PATH" });
    checks.check("zh.wav and en.wav found", o.clips !== null, {
      ECHOTYPE_SMOKE_WAVS: process.env.ECHOTYPE_SMOKE_WAVS ?? null,
      fix: "point ECHOTYPE_SMOKE_WAVS at a folder with test_wavs/zh.wav and en.wav from sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
    });
    const plan = planModels(o.catalog);

    // ---------- 握手 ----------
    await until(() => core.supervisor.status().state === "running", 60_000, "engine hello");
    const hello = core.supervisor.status();
    report.hello = `engine ${hello.engineVersion} · providers ${hello.providers.join(",")} · runtimes ${Object.entries(hello.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")}`;
    checks.check("hello: runtimes and providers", "sherpa-onnx" in hello.runtimes && hello.providers.includes("cpu"), hello);
    await until(() => core.snapshot().engine.error?.code === "MODEL_NOT_INSTALLED", 15_000, "MODEL_NOT_INSTALLED");
    checks.check("fresh home reports MODEL_NOT_INSTALLED", true);

    // ---------- 默认模型：安装 → 加载 → 中文 → 历史 → 英文 ----------
    let before = readyLines();
    const firstVariant = await install(plan.first);
    await awaitLoaded(plan.first, before);
    const active = core.snapshot().activeModel;
    checks.check(`load ${plan.first.id}: activeModel variant / runtime / providerUsed`, active?.variantId === firstVariant.id && active.runtime === "sherpa-onnx" && active.providerUsed === "cpu" && active.fallback === false, active);

    const zh = await dictate("zh");
    checks.check(`dictation zh.wav → final (${plan.first.id})`, HAN.test(zh), zh);
    const history = await js<HistoryEntry[]>(`window.echotype.history.list()`);
    checks.check("final → history entry", history.length === 1 && history[0].text === zh, history);

    const en = await dictate("en");
    if (plan.first.languages?.includes("en")) {
      checks.check("English with punct_style auto → half-width punctuation", /[A-Za-z]/.test(en) && HALF_WIDTH.test(en) && !FULL_WIDTH.test(en), en);
    }

    // ---------- 配套标点：安装标点模型与 ASR → 激活 → 中文 ----------
    await install(plan.punct);
    await install(plan.companion);
    before = readyLines();
    await js(`window.echotype.models.activate(${JSON.stringify(plan.companion.id)})`);
    await awaitLoaded(plan.companion, before);
    const loading = await waitLog("loading model", (d) => d.id === plan.companion.id, "loading model log line");
    const zhCompanion = await dictate("zh");
    checks.check(
      `companion punctuation: ${plan.companion.id} + ${plan.punct.id}`,
      String(loading.companion).startsWith(`${plan.punct.id}/`) && HAN.test(zhCompanion) && FULL_WIDTH.test(zhCompanion),
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
    checks.check("engine killed → supervisor restarts it → model reloads → dictation works", HAN.test(afterRestart), afterRestart);

    const final = core.snapshot().activeModel;
    checks.check(
      "snapshot.activeModel after recovery: variant / runtime / providerUsed",
      final?.id === plan.companion.id && final.variantId === cpuVariant(plan.companion).id && final.runtime === "sherpa-onnx" && final.providerUsed === "cpu" && final.fallback === false,
      final,
    );
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

function cpuVariant(model: CatalogModel): CatalogVariant {
  const v = model.variants.find((x) => x.target === "cpu");
  if (!v) throw new Error(`${model.id} has no cpu variant`);
  return v;
}

function findClips(dir: string | undefined): Clip[] | null {
  if (!dir) return null;
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
class Report {
  hello = "";
  readonly installs: Array<{ model: string; mb: number; seconds: number; source: string }> = [];
  readonly loads: Array<{ model: string; provider: string; loadMs: number; warmupMs: number }> = [];
  readonly dictations: Array<{ model: string; clip: ClipName; engineMs: number; coreMs: number | null; audioMs: number; text: string }> = [];

  render(): string {
    const lines = [`  ${this.hello}`];
    for (const i of this.installs) lines.push(`  install  ${i.model.padEnd(36)} ${i.mb.toFixed(1).padStart(6)} MB ${i.seconds.toFixed(1).padStart(6)} s  ${i.source}`);
    for (const l of this.loads) lines.push(`  load     ${l.model.padEnd(36)} ${l.provider.padEnd(5)} load_ms ${String(l.loadMs).padStart(5)}  warmup_ms ${l.warmupMs}`);
    for (const d of this.dictations) {
      const core = d.coreMs === null ? "-" : String(d.coreMs);
      lines.push(`  dictate  ${d.model.padEnd(24)} ${d.clip}.wav  release_to_final_ms ${String(d.engineMs).padStart(4)} (Core ${core.padStart(4)})  audio ${d.audioMs} ms  "${d.text}"`);
    }
    return `${lines.join("\n")}\n`;
  }
}
