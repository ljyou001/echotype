#!/usr/bin/env bash
# ============================================================================
# [INPUT]: 依赖 node 读取 package.json 的 scripts；依赖 GITHUB_OUTPUT（Actions 提供）
# [OUTPUT]: 向 GITHUB_OUTPUT 写 run=true|false；缺件时输出 ::notice 注解
# [POS]: ci.yml 各任务的前置探针。v3 多会话并行期间 engine/ 与部分 npm script 尚未合入，
#        任务据此干净跳过，而不是报红或静默通过。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# ============================================================================
#
# 用法：probe.sh <label> <check>...
#   file:<path>             文件存在
#   dir:<path>              目录存在
#   npm:<pkg-dir>#<script>  <pkg-dir>/package.json 定义了该 script（script 名可含冒号）
# 全部满足 → run=true；任一缺失 → run=false，并在运行摘要中列出缺失项。
set -euo pipefail

label=${1:?usage: probe.sh <label> <check>...}
shift

missing=()
for check in "$@"; do
  kind=${check%%:*}
  value=${check#*:}
  case "$kind" in
    file) [ -f "$value" ] || missing+=("file $value") ;;
    dir)  [ -d "$value" ] || missing+=("directory $value") ;;
    npm)
      pkg_dir=${value%%#*}
      script=${value#*#}
      if [ ! -f "$pkg_dir/package.json" ] ||
        ! node -e 'const p=require(process.argv[1]); process.exit(p.scripts && p.scripts[process.argv[2]] ? 0 : 1)' \
          "$(cd "$pkg_dir" && pwd)/package.json" "$script"; then
        missing+=("npm script \"$script\" in $pkg_dir/package.json")
      fi
      ;;
    *) echo "probe.sh: unknown check '$check'" >&2; exit 2 ;;
  esac
done

out=${GITHUB_OUTPUT:-/dev/stdout}
if [ ${#missing[@]} -eq 0 ]; then
  echo "run=true" >> "$out"
else
  joined=$(printf '%s; ' "${missing[@]}")
  echo "::notice title=${label} skipped::Not in this commit yet: ${joined%; }"
  echo "run=false" >> "$out"
fi
