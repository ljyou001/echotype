#!/usr/bin/env node
/**
 * [INPUT]: 依赖 contracts/models.catalog.json 中已回写的 download.sha256/size_bytes；依赖 staging 目录 %USERPROFILE%/.echotype-staging/models-v3/ 里的 zip
 * [OUTPUT]: 写出 scripts/models/UPLOAD.md（zip 表、总大小、gh release 命令）
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

const rows = []
for (const m of catalog.models) {
  for (const v of m.variants) {
    const zip = join(OUT_DIR, `${m.id}--${v.id}.zip`)
    if (!v.download.sha256) continue
    if (!existsSync(zip) || statSync(zip).size !== v.download.size_bytes) throw new Error(`${zip} 与 catalog 不符，先重跑 package-models.mjs`)
    rows.push({ name: `${m.id}--${v.id}.zip`, path: zip, size: v.download.size_bytes, sha256: v.download.sha256 })
  }
}
const total = rows.reduce((s, r) => s + r.size, 0)
const table = rows.map((r) => `| \`${r.name}\` | ${mib(r.size)} | \`${r.sha256}\` |`).join('\n')
const quoted = rows.map((r) => `  "${r.path.replaceAll('\\', '/')}"`).join(' `\n')
const bash = rows.map((r) => `  "${r.path.replaceAll('\\', '/')}"`).join(' \\\n')

const doc = `# 上传 models-v3

> 由 \`scripts/models/write-upload-doc.mjs\` 生成，不要手改。重新打包后重跑即可。

共 ${rows.length} 个 zip，合计 **${gib(total)}**（${mib(total)}）。每个都小于 GitHub 单文件 2 GiB 上限。
zip 在 \`${OUT_DIR}\`。

| 文件 | 大小 | sha256 |
|---|---|---|
${table}

## 命令

先确认已登录：\`gh auth status\`。

**release 还不存在**（首次）:

\`\`\`bash
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages. Each zip is one model variant; files sit at the zip root. Checksums are in contracts/models.catalog.json." \\
${bash}
\`\`\`

**release 已存在**（补传或覆盖）:

\`\`\`bash
gh release upload models-v3 --repo ljyou001/echotype --clobber \\
${bash}
\`\`\`

PowerShell 版（反引号续行）:

\`\`\`powershell
gh release create models-v3 --repo ljyou001/echotype --title "Models v3" --notes "EchoType v3 model packages." \`
${quoted}
\`\`\`

## 上传后

- catalog 里的 \`download.url\` 指向 \`https://github.com/ljyou001/echotype/releases/download/models-v3/<文件名>\`。上传完成的那一刻这些链接才生效。
- 上传前，应用内下载会返回 404。先上传，再发布依赖这些 URL 的构建。
- 抽查一个: \`curl -sIL <url>\`，确认 200 且 content-length 与上表一致。
- 要换文件内容，必须重新打包并同步 catalog 的 sha256，否则 Core 校验失败。
`
writeFileSync(resolve(HERE, 'UPLOAD.md'), doc)
console.log(`UPLOAD.md 已写入：${rows.length} 个 zip，${gib(total)}`)
