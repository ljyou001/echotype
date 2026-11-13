#!/usr/bin/env node
/**
 * [INPUT]: 依赖 contracts/models.catalog.json 的 models[].variants[]；依赖系统 curl 与 tar（bsdtar，解 .tar.bz2 并打 zip）；依赖 GitHub/HF 公共 API 校验上游哈希
 * [OUTPUT]: 产出 %USERPROFILE%/.echotype-staging/models-v3/<model>--<variant>.zip，并回写 variants[].download.{url,sha256,size_bytes,upstream_url} 与 variants[].files；导出 SOURCES 表
 * [POS]: 模型打包流水线的唯一入口。上游来源与保留清单只写在本文件的 SOURCES 表，catalog 只接收结果字段。UPLOAD.md 由 write-upload-doc.mjs 读 catalog 生成。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 用法:
 *   node scripts/models/package-models.mjs                    打包全部变体
 *   node scripts/models/package-models.mjs --only <model id>  只打包一个模型
 *   node scripts/models/package-models.mjs --list <model id>  解开上游压缩包并列出文件，不打包
 *   node scripts/models/package-models.mjs --force            忽略已有 zip，重新打包
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, copyFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ───────────────────────── 常量 ─────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG = resolve(HERE, '../../contracts/models.catalog.json')
const STAGING = join(homedir(), '.echotype-staging')
const UPSTREAM_DIR = join(STAGING, 'upstream')
const OUT_DIR = join(STAGING, 'models-v3')
const WORK_DIR = join(STAGING, 'work')
const MAX_ZIP_BYTES = 2 * 1024 ** 3 // GitHub Release 单文件上限 2 GiB
const TAR = existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar'

const SHERPA_ASR = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'
const SHERPA_PUNCT = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/'
const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`

// ───────────────────────── 来源表 ─────────────────────────
// kind 'tar'  : 单个 .tar.bz2。keep = [[压缩包内路径(去顶层目录), zip 内路径], ...]
// kind 'hf'   : HuggingFace 直链文件。repo + items = [[HF 文件名, zip 内文件名], ...]
// files       : 回写 catalog variants[].files 的 键 → zip 内路径
const onnxPair = { model: 'model.int8.onnx', tokens: 'tokens.txt' }
const keepPair = [['model.int8.onnx', 'model.int8.onnx'], ['tokens.txt', 'tokens.txt']]
const same = (names) => names.map((n) => [n, n])

export const SOURCES = {
  'sensevoice-small/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    keep: keepPair,
    files: onnxPair,
  },
  'paraformer-zh-small/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2',
    keep: keepPair,
    files: onnxPair,
  },
  'paraformer-zh/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-paraformer-zh-2024-03-09.tar.bz2',
    keep: keepPair,
    files: onnxPair,
  },
  'punct-ct-transformer-zh-en/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_PUNCT + 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2',
    keep: [['model.int8.onnx', 'model.int8.onnx']],
    files: { model: 'model.int8.onnx' },
  },
  'parakeet-tdt-0.6b-v3/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    keep: same(['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']),
    files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', joiner: 'joiner.int8.onnx', tokens: 'tokens.txt' },
  },
  'whisper-large-v3-turbo/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-whisper-turbo.tar.bz2',
    keep: same(['turbo-encoder.int8.onnx', 'turbo-decoder.int8.onnx', 'turbo-tokens.txt']),
    files: { encoder: 'turbo-encoder.int8.onnx', decoder: 'turbo-decoder.int8.onnx', tokens: 'turbo-tokens.txt' },
  },
  'qwen3-asr-0.6b/gpu-gguf-q8': {
    kind: 'hf',
    repo: 'ggml-org/Qwen3-ASR-0.6B-GGUF',
    items: [['Qwen3-ASR-0.6B-Q8_0.gguf', 'Qwen3-ASR-0.6B-Q8_0.gguf'], ['mmproj-Qwen3-ASR-0.6B-Q8_0.gguf', 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf']],
    files: { model: 'Qwen3-ASR-0.6B-Q8_0.gguf', mmproj: 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf' },
  },
  'qwen3-asr-0.6b/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
    keep: same(['conv_frontend.onnx', 'encoder.int8.onnx', 'decoder.int8.onnx', 'tokenizer/merges.txt', 'tokenizer/tokenizer_config.json', 'tokenizer/vocab.json']),
    files: { conv_frontend: 'conv_frontend.onnx', encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', tokenizer: 'tokenizer' },
  },
  'fire-red-asr2-aed/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2',
    keep: same(['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']),
    files: { encoder: 'encoder.int8.onnx', decoder: 'decoder.int8.onnx', tokens: 'tokens.txt' },
  },
  // Moonshine v2(2026-02-27 系列，.ort 格式)。旧的 moonshine-base-en-int8 是 v1，不用。
  'moonshine-v2-base-en/cpu-int8': {
    kind: 'tar',
    archive: SHERPA_ASR + 'sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2',
    keep: same(['encoder_model.ort', 'decoder_model_merged.ort', 'tokens.txt']),
    files: { encoder: 'encoder_model.ort', decoder: 'decoder_model_merged.ort', tokens: 'tokens.txt' },
  },
  // 1.7B: ggml-org 只发 Q8_0(2.17 GB，加 mmproj 超 2 GiB 上限)与 bf16。
  // 改用 mradermacher 的 Q6_K(1.67 GB) + 同架构 mmproj-Q8_0(356 MB)，合计约 2.03 GB。
  'qwen3-asr-1.7b/gpu-gguf-q8': {
    kind: 'hf',
    repo: 'mradermacher/Qwen3-ASR-1.7B-GGUF',
    items: [['Qwen3-ASR-1.7B.Q6_K.gguf', 'Qwen3-ASR-1.7B-Q6_K.gguf'], ['Qwen3-ASR-1.7B.mmproj-Q8_0.gguf', 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf']],
    files: { model: 'Qwen3-ASR-1.7B-Q6_K.gguf', mmproj: 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf' },
  },
}

// ───────────────────────── 工具 ─────────────────────────
const log = (...a) => console.log(...a)
const fail = (msg) => { console.error('ERROR: ' + msg); process.exit(1) }
const mb = (n) => (n / 1e6).toFixed(1) + ' MB'

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? 'pipe' : 'inherit', maxBuffer: 1 << 28, ...opts })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} 退出码 ${r.status}\n${r.stderr?.toString() ?? ''}`)
  return r.stdout?.toString() ?? ''
}

function sha256File(path) {
  return new Promise((ok, bad) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad)
  })
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'echotype-package-models' } })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

// 上游期望值：GitHub 资产 {size, sha256?}；HF LFS {size, sha256}
const releaseCache = new Map()
async function expectedForGithub(url) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/(.+)$/)
  if (!m) return {}
  const key = `${m[1]}@${m[2]}`
  if (!releaseCache.has(key)) releaseCache.set(key, await getJson(`https://api.github.com/repos/${m[1]}/releases/tags/${m[2]}`).catch(() => null))
  const asset = releaseCache.get(key)?.assets?.find((a) => a.name === m[3])
  return { size: asset?.size, sha256: asset?.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined }
}
const hfCache = new Map()
async function expectedForHf(repo, file) {
  if (!hfCache.has(repo)) hfCache.set(repo, await getJson(`https://huggingface.co/api/models/${repo}/tree/main`))
  const f = hfCache.get(repo).find((x) => x.path === file)
  if (!f) fail(`HF 仓库 ${repo} 没有文件 ${file}`)
  return { size: f.size, sha256: f.lfs?.oid }
}

// 下载到 upstream 缓存：已完整则跳过；否则 curl -C - 续传到 .part，完成后改名
async function download(url, name, expected) {
  mkdirSync(UPSTREAM_DIR, { recursive: true })
  const dest = join(UPSTREAM_DIR, name)
  const complete = () => existsSync(dest) && (!expected.size || statSync(dest).size === expected.size)
  if (!complete()) {
    log(`  下载 ${name}${expected.size ? ' (' + mb(expected.size) + ')' : ''}`)
    const part = dest + '.part'
    if (existsSync(dest)) rmSync(dest) // 大小不符的旧文件作废
    run('curl', ['-fL', '--retry', '5', '--retry-delay', '3', '-C', '-', '-o', part, url])
    renameSync(part, dest)
  } else log(`  缓存命中 ${name}`)
  if (expected.sha256) {
    const got = await sha256File(dest)
    if (got !== expected.sha256) { rmSync(dest); fail(`${name} 上游 sha256 不符: ${got} != ${expected.sha256}`) }
  }
  return dest
}

function listTree(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) listTree(p, base, out)
    else out.push({ rel: p.slice(base.length + 1).replaceAll('\\', '/'), size: statSync(p).size })
  }
  return out
}

function extractTar(archivePath, name) {
  const dir = join(WORK_DIR, 'x-' + name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  log(`  解压 ${name}`)
  run(TAR, ['-xjf', archivePath, '-C', dir])
  const tops = readdirSync(dir)
  return tops.length === 1 && statSync(join(dir, tops[0])).isDirectory() ? join(dir, tops[0]) : dir
}

// ───────────────────────── 打包 ─────────────────────────
// 返回 { stage: 临时目录(含最终文件), upstream_url, files }
async function prepareStage(key, src) {
  const stage = join(WORK_DIR, 'stage-' + key.replace('/', '--'))
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const put = (from, rel, move) => {
    const to = join(stage, rel)
    mkdirSync(dirname(to), { recursive: true })
    move ? renameSync(from, to) : copyFileSync(from, to)
  }
  if (src.kind === 'tar') {
    const name = src.archive.split('/').pop()
    const exp = await expectedForGithub(src.archive)
    const archive = await download(src.archive, name, exp)
    const root = extractTar(archive, name)
    for (const [from, to] of src.keep) {
      const p = join(root, from)
      if (!existsSync(p)) fail(`${key}: 上游压缩包里没有 ${from}`)
      put(p, to, true)
    }
    rmSync(dirname(root) === WORK_DIR ? root : dirname(root), { recursive: true, force: true })
    return { stage, upstream_url: src.archive }
  }
  for (const [from, to] of src.items) {
    const exp = await expectedForHf(src.repo, from)
    const p = await download(hf(src.repo, from), `${src.repo.replace('/', '__')}__${from}`, exp)
    put(p, to, false)
  }
  return { stage, upstream_url: `https://huggingface.co/${src.repo}` }
}

function buildZip(stage, zipPath) {
  rmSync(zipPath, { force: true })
  const names = listTree(stage).map((f) => f.rel)
  run(TAR, ['--format', 'zip', '-cf', zipPath, '-C', stage, ...names])
}

// 校验: zip 能解开、文件集合与 files 完全一致、大小 < 2 GiB
function verifyZip(key, zipPath, src) {
  const files = src.files
  const dir = join(WORK_DIR, 'verify-' + key.replace('/', '--'))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  run(TAR, ['-xf', zipPath, '-C', dir])
  const got = listTree(dir).map((f) => f.rel).sort()
  const want = (src.kind === 'tar' ? src.keep : src.items).map((k) => k[1]).sort()
  const dangling = Object.entries(files).filter(([, p]) => !want.some((w) => w === p || w.startsWith(p + '/')))
  if (dangling.length) fail(`${key}: files 指向 zip 里不存在的路径 ${JSON.stringify(dangling)}`)
  rmSync(dir, { recursive: true, force: true })
  const extra = got.filter((x) => !want.includes(x))
  const missing = want.filter((x) => !got.includes(x))
  if (extra.length || missing.length) fail(`${key}: zip 内容与 files 不一致。多出 [${extra}] 缺少 [${missing}]`)
  const size = statSync(zipPath).size
  if (size >= MAX_ZIP_BYTES) fail(`${key}: zip ${size} 字节，超过 2 GiB 上限`)
}

// ───────────────────────── 主流程 ─────────────────────────
function writeCatalog(catalog, raw) {
  const trailingNewline = raw.endsWith('\n')
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + (trailingNewline ? '\n' : ''))
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (n) => args.includes(n)
  const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null)
  const only = val('--only')
  const listId = val('--list')
  const force = flag('--force')

  const raw = readFileSync(CATALOG, 'utf8')
  const catalog = JSON.parse(raw)
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(WORK_DIR, { recursive: true })

  if (listId) {
    for (const [key, url] of Object.entries(Object.fromEntries(Object.entries(SOURCES).filter(([, s]) => s.kind === 'tar').map(([k, s]) => [k, s.archive])))) {
      if (!key.startsWith(listId + '/')) continue
      const name = url.split('/').pop()
      const archive = await download(url, name, await expectedForGithub(url))
      const root = extractTar(archive, name)
      log(`\n== ${key}  (${name})`)
      for (const f of listTree(root)) log(`  ${String(f.size).padStart(12)}  ${f.rel}`)
    }
    return
  }

  const rows = []
  let skipped = 0
  for (const model of catalog.models) {
    if (only && model.id !== only) continue
    for (const v of model.variants) {
      const key = `${model.id}/${v.id}`
      const src = SOURCES[key]
      if (!src) { log(`跳过 ${key}: SOURCES 里还没有保留清单`); skipped++; continue }
      log(`\n▶ ${key}`)
      const zipPath = join(OUT_DIR, `${model.id}--${v.id}.zip`)
      if (force || !existsSync(zipPath)) {
        const { stage } = await prepareStage(key, src)
        buildZip(stage, zipPath)
        rmSync(stage, { recursive: true, force: true })
      } else log(`  zip 已存在，跳过构建`)
      verifyZip(key, zipPath, src)
      const sha256 = await sha256File(zipPath)
      const size = statSync(zipPath).size
      v.files = src.files
      v.download.url = `${catalog.release_base_url}${model.id}--${v.id}.zip`
      v.download.sha256 = sha256
      v.download.size_bytes = size
      v.download.upstream_url = src.kind === 'tar' ? src.archive : `https://huggingface.co/${src.repo}`
      rows.push({ key, size, sha256 })
      log(`  ✓ ${mb(size)}  ${sha256}`)
      writeCatalog(catalog, raw) // 每个变体完成就落盘，中途失败不丢进度
    }
  }
  log(`\n完成 ${rows.length} 个 zip，跳过 ${skipped} 个。`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
