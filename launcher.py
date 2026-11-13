"""
[INPUT]: 依赖 backend.app.run
[OUTPUT]: 无导出；PyInstaller 打包入口（echotype-backend.spec 的 Analysis 起点）
[POS]: 冻结态引擎 echotype-engine.exe 的 main。开发态用 `python -m backend`（backend/__main__.py），两者调用同一个 run()。
       v2 时期这里有 nagisa/torch 的 sys.path 补丁与依赖自检，v3 引擎只依赖 sherpa-onnx/numpy/sounddevice/websockets，全部删除。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from backend.app import run

if __name__ == "__main__":
    run()
