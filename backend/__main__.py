"""
[INPUT]: 依赖 backend.app.run
[OUTPUT]: 无导出；`python -m backend` 的入口
[POS]: 开发态入口。Core 在开发时用 .venv 的 python 以 `-m backend` 拉起引擎；打包后由 launcher.py 调同一个 main。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from .app import run

if __name__ == "__main__":
    run()
