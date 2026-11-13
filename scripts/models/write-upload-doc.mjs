#!/usr/bin/env node
/**
 * [INPUT]: 依赖 contracts/models.catalog.json 中已回写的 variants[].asset 与 engine_packs；依赖 staging 目录 %USERPROFILE%/.echotype-staging/models-v3/ 里的 zip
 * [OUTPUT]: 写出 scripts/models/UPLOAD.md（按 release 分组的 zip 表、总大小、gh release 命令）
 * [POS]: package-models.mjs 的下游。只读 catalog 与磁盘，不改 catalog，不上传。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(resolve(HERE, '../../contracts/models.catalog.json'), 'utf8'))
const OUT_DIR = join(homedir(), '.echotype-staging', 'models-v3')
const gib = (n) => (n / 1024 ** 3).toFixed(2) + ' GiB'
const mib = (n) => (n / 1024 ** 2).toFixed(1) + ' MiB'
const fwd = (p) => p.replaceAll('\\', '/')
const BT = '`'

// models-v3：按资产名去重（GGUF 变体共享一个资产）
const rows = []
const seen = new Set()
for (const m of catalog.models) {
  for (const v of m.variants) {
    const a = v.asset
    if (!a.sha256 || seen.has(a.name)) continue
    seen.add(a.name)
    const zip = join(OUT_DIR, a.name)
    if (!existsSync(zip) || statSync(zip).size !== a.size_bytes) throw new Error(`${zip} 与 catalog 不符，先重跑 package-models.mjs`)
    rows.push({ name: a.name, path: zip, size: a.size_bytes, sha256: a.sha256 })
  }
}

// engine-packs-v3：由 engine / ci 会话产出；sha256 为空即 pending
const packs = []
for (const pk of catalog.engine_packs ?? []) {
  for (const { asset } of Object.values(pk.platforms)) packs.push(asset)
}

const total = rows.reduce((s, r) => s + r.size, 0)
const table = rows.map((r) => `| ${BT}${r.name}${BT} | ${mib(r.size)} | ${BT}${r.sha256}${BT} |`).join('\n')
const packTable = packs.map((a) => `| ${BT}${a.name}${BT} | ${a.sha256 ? mib(a.size_bytes) : 'pending'} | ${a.sha256 ? BT + a.sha256 + BT : 'pending'} |`).join('\n')
const files = rows.map((r) => `  "${fwd(r.path)}"`)
const bash = files.join(' \\\n')
const ps = files.join(` ${BT}\n`)

const doc = `# 上传 Release 资产

> 由 ${BT}scripts/models/write-upload-doc.mjs${BT} 生成，不要手改。重新打包后重跑即可。

先确认已登录：${BT}gh auth status${BT}。Core 按 catalog 的 ${BT}sources.url_template${BT} 用 ${BT}{release}/{asset}${BT} 拼下载地址，资产名和 release 名必须与下表一致。

## 1. release ${BT}models-v3${BT}（模型）

共 ${rows.length} 个 zip，合计 **${gib(total)}**（${mib(total)}）。每个都小于 GitHub 单文件 2 GiB 上限。zip 在 ${BT}${OUT_DIR}${BT}。
三个 GGUF 变体（cuda / apple-metal / vulkan）共用一个 ${BT}*--gguf-q8.zip${BT}，只传一次。

| 文件 | 大小 | sha256 |
|---|---|---|
${table}

**release 还不存在**（首次）:

${BT}${BT}${BT}bash
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages. Each zip is one model asset; files sit at the zip root. Checksums are in contracts/models.catalog.json." \\
${bash}
${BT}${BT}${BT}

**release 已存在**（补传或覆盖）:

${BT}${BT}${BT}bash
gh release upload models-v3 --repo ljyou001/echotype --clobber \\
${bash}
${BT}${BT}${BT}

PowerShell 版（反引号续行）:

${BT}${BT}${BT}powershell
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages." ${BT}
${ps}
${BT}${BT}${BT}

## 2. release ${BT}engine-packs-v3${BT}（引擎包）

由 engine / ci 会话产出。sha256 为 pending 表示文件还没有。文件齐了之后，他们填 catalog 并在这里追加命令。

| 文件 | 大小 | sha256 |
|---|---|---|
${packTable}

## 上传后

- 链接在上传完成的那一刻才生效。上传前应用内下载会 404，所以先上传，再发布依赖这些资产的构建。
- 抽查: ${BT}curl -sIL https://github.com/ljyou001/echotype/releases/download/models-v3/<文件名>${BT}，确认 200 且 content-length 与上表一致。
- 换文件内容必须重新打包并同步 catalog 的 sha256，否则 Core 校验失败。
`
writeFileSync(resolve(HERE, 'UPLOAD.md'), doc)
console.log(`UPLOAD.md 已写入：${rows.length} 个 zip，${gib(total)}`)
