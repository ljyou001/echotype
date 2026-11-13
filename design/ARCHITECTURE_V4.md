# EchoType v4 架构大修

> 修订 2026-11-13：引擎改为原生二进制；模型按硬件拆分 variant；模型专属设置只在模型页；新增 CI 会话。

> 版本：本次重构即 EchoType v4（4.0.0）。v2.0.0 之后的 Python 后端版本记为 v3，已被本文的方案取代。

> 状态：已定稿，多会话并行实施中 · 2026-11-13
> 契约：`contracts/ENGINE_PROTOCOL.md` · `contracts/MODEL_MANIFEST.md` · `contracts/models.catalog.json` · `frontend/electron/ipc-contract.ts`

## 1. 现状诊断（为什么不好用）

### 1.1 控制回路有 4 跳，大脑长错了地方
当前一次听写的路径：
```
uiohook(main) → IPC → 渲染进程 App.tsx 状态机(窗口常隐藏) → WS:6016 → Python
→ sounddevice → asyncio 队列 → 单线程 worker → WS → ResultHandler(渲染进程) → IPC → robotjs 粘贴
```
- 录音状态机放在主窗口的 React 组件里。窗口隐藏时依然要它做决策。
- 轻按判定在 `hotkey-manager.ts`，开始/停止在 `App.tsx`。轻按会同时开一段录音并弹出 Quick Action。
- 热键回调每次按键都同步读一次 `settings.json`。

### 1.2 麦克风是"双脑"
- 界面的麦克风选择和电平条用浏览器 `getUserMedia`。真正录音的是 Python `sounddevice` 默认设备。**选麦克风不生效。**
- 电平条用频谱均值 `/128`，环境噪声即可打满（截图 2 的满格）。
- 麦克风 24 小时常开，48 kHz → 16 kHz 用 `data[::3]` 直接抽取，无抗混叠滤波，伤识别率。

### 1.3 延迟来自架构，不来自模型
- 单 FIFO worker：流式 partial 每次重解码整段缓冲（O(n²)），final 排在过期 partial 后面。
- 启动加载两次：后端先加载默认模型，前端再按 `lastActiveModelId` 切换。根因是 `_save_runtime_config` 引用了不存在的 `config.deployment_mode`，异常被吞，运行时配置从未保存。

### 1.4 体积失控
| 项 | 体积 |
|---|---|
| PyInstaller 后端（torch + transformers + qwen_asr + nagisa + jieba + funasr_onnx） | **5.1 GB** |
| 标点模型目录 `punc_ct-transformer_cn-en`（含 41 MB jieba 词典等） | **1.0 GB** |
| Paraformer int8 | 233 MB |

### 1.5 配置有 5 个真相源
`settings.json`（前端）· `backend_config.json`（从未写成功）· 写进模型目录的 `config.ini [user_settings]` · `models_catalog.json` · 散落各处的硬编码模型 id（`model-manager.ts`、`manager.list_models`、`paths.py`）。
新增一个模型要改 6 个文件，所以"支持更多模型"做不动。

### 1.6 标点是全局开关，不是模型属性
`enable_punctuation` 是后端 CLI 开关。Paraformer 走外挂 CT-Transformer，Qwen3 自带标点。用户在模型页无法按模型开关。

### 1.7 稳定性
固定端口 6016（会冲突）· 无心跳 · 后端崩溃不自动重启 · `except Exception` 吞错 · preload 暴露任意 channel 的 `send/on` · 录音永久写入 `~/.echotype/rec` · 历史记录只在内存。

### 1.8 前端
- `styles.css` 3138 行。`<960px` 时侧栏变顶栏并出现横向滚动条（截图 1，高 DPI 下默认窗口即触发）。
- 网格子项缺 `min-width:0`，`<select>` 撑破卡片（截图 2）。
- 死代码：`WebSocketService.ts`（353 行）、`audio/recorder.ts` + `RecordingManager`、`QuickActionModal` 与 `QuickActionWindow` 重复。
- `App.tsx` 在 hooks 之前提前 return，违反 Rules of Hooks。

## 2. 目标架构：三层，单向依赖

```
┌ UI 层 ── frontend/src (React) ─────────────────────────────┐
│ 纯视图。渲染 AppSnapshot，发送用户意图。                       │
│ 不碰麦克风，不碰引擎，不持有业务状态机。                        │
└───────────── typed IPC: frontend/electron/ipc-contract.ts ───┘
┌ Core 层 ── frontend/electron (Electron main) ──────────────┐
│ 大脑。DictationSession 状态机 · HotkeyService(轻按/长按判定)   │
│ OutputService(粘贴/剪贴板) · SettingsStore(唯一真相源)        │
│ ModelRegistry(目录/下载/校验/安装) · EngineSupervisor(拉起/   │
│ 握手/心跳/重启) · History · QuickAction 窗口                 │
└──── WS 127.0.0.1:随机端口 + token: ENGINE_PROTOCOL v3 ───────┘
┌ Engine 层 ── engine (独立原生进程) ─────────────────────────┐
│ 无状态推理服务。拥有麦克风 · Silero VAD 分段 · sherpa-onnx    │
│ / llama.cpp 识别 · 标点/ITN · 按模型分 variant。不落盘配置。  │
└────────────────────────────────────────────────────────────┘
```

依赖方向只能向下。UI 不知道引擎存在。引擎不知道 UI 存在。

### 2.1 新的听写路径（2 跳）
```
uiohook(Core) → HotkeyService 判定 → DictationSession → engine session.start
松键 → engine 只解码最后一句（停顿时已推测解码则直接复用）→ event final → Core 直接粘贴 → 推 snapshot 给 UI
```

### 2.2 轻按 / 长按（保留现有交互）
- 按下即 `session.start`（预录缓冲保证首字不丢）。
- 松开时按住时长 `< tapThresholdMs`（默认 200 ms）：`session.cancel`，不转写，打开 Quick Action 窗口（带上一次结果）。
- 否则：`session.stop` → `final` → 输出。
- toggle 模式：按下切换开始/停止；长按 500 ms 打开 Quick Action（与现状一致）。

### 2.3 毫秒级响应
延迟 KPI = 松键 → final（`release_to_final_ms`）。手段见 `ENGINE_PROTOCOL.md §8`：
VAD 按句（停顿 ≥ 0.6 s、最长 8 s）切出解码单元，边说边解码已闭合的句子；每个停顿推测解码当前句，松键时切片逐样本相同就复用，否则只整句解码最后一句；单飞解码，final 不排队；加载后预热；常驻麦克风预录 300 ms。
听写 final 必须与同一录音的 `transcribe.file` 逐字相同；延迟只在这个前提下优化。
目标：默认 instant 模型，CPU，10 s 语音，P50 ≤ 80 ms。

### 2.4 标点归模型
每个模型的清单声明 `punctuation.mode`：`native`（模型自带）/ `companion`（配套标点模型）/ `none`。
模型页对每个模型提供"标点"和"数字规整（ITN）"开关，保存在 `settings.models.perModel[id]`。

### 2.5 单一真相源
- 模型元数据：`contracts/models.catalog.json`，一个模型一个对象，新增模型 = 加一个对象。
- 用户设置：Core 的 `~/.echotype/settings.json`（schemaVersion 2，含 v1 迁移）。
- 引擎不持久化任何东西。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 引擎语言 | 原生二进制（Rust 优先），不再使用 Python | 用户要求；启动快、体积小、可为 6 个平台目标编译 |
| 推理运行时 | sherpa-onnx（C API）为主，llama.cpp（GGUF）用于 GPU 版本 | 全部为 C/C++ 核心，彻底去掉 torch |
| 按模型分别优化 | 每个模型按硬件拆成多个 variant，各自实测 | int8 ONNX 适合 CPU，GPU 用 fp16 ONNX 或 GGUF；只有实测更快才列出 |
| GPU 分发 | 基础安装包只含 CPU 引擎（macOS 含 Metal/CoreML）；CUDA 引擎包按需下载 | CUDA 运行库本身数百 MB，不该让所有用户承担 |
| 模型分发 | 统一 zip；资产只记 `{release, asset}`，URL 由 `sources` 模板生成，按渠道（github/steam/msstore）选源，可远程更新目录 | 换托管地址只改 sources，不改模型；Steam 等渠道可直接接入 |
| 每个模型三种硬件 | 每个模型都评估 CPU、NVIDIA、Apple Silicon，各自出 variant | 用户要求；只保留实测更快的 |
| GPU 引擎包 | 整套引擎 + sherpa CUDA + NVIDIA 运行库 + CUDA llama-server，在模型管理器里按需下载 | 体积大但可选，不进基础安装包 |
| 许可证 | 每个模型标注许可证；设置 → 关于 列出模型与组件许可证并附链接；各商店按 `allow_commercial` 过滤模型 | 尊重作者；商店策略后续再定 |
| 标点风格 | 新增模型设置 `punct_style`（auto 时每个标点按它前面最近的文字选中/英文标点） | CT-Transformer 对英文也只出中文全角标点 |
| 状态栏 | 左下角显示"模型 · 硬件 · 运行时"，回退 CPU 时明确标出 | 用户要一眼看出当前怎么运行 |
| 外壳 | 继续 Electron | 体积问题 95% 来自 Python/torch，换 Tauri 收益不抵重写成本 |
| 默认模型 | SenseVoice Small int8（2024-07-17 版，228 MB） | 非自回归，自带标点与 ITN；配合 VAD 分段可达毫秒级 |

## 4. 并行实施分工（互不踩踏）

| 会话 | 独占目录 | 不得修改 |
|---|---|---|
| engine | `engine/**`（新 Rust 工程）· 删除 `backend/**` `launcher.py` `echotype-backend.spec` `requirements-backend.txt` · catalog 的 `arch` `providers` `bench` `settings` 字段 | `frontend/**` · `.github/**` · `scripts/**` |
| models | `scripts/models/**`（模型重打包与上传清单）· catalog 的 `download` `files` 字段 | 其余所有目录 |
| core | `frontend/electron/**`（契约文件除外）· `frontend/package.json`（`build` 字段除外）· `frontend/tsconfig.*.json` | `frontend/src/**` · `engine/**` · `frontend/electron-builder.cjs` |
| integrations | 先只写 `design/INTEGRATIONS_V4.md`（调研与方案），ui 合并后再实现 | 其余所有目录 |
| ci | `.github/workflows/build.yml` `ci.yml` · `frontend/electron-builder.cjs` · `frontend/package.json` 的 `build` 字段 · `scripts/ci/**` · `scripts/windows/**`（清理旧流水线） | 其余所有目录 |
| ui | `frontend/src/**` · `frontend/index.html` · `frontend/vite.config.ts` | `frontend/electron/**` · `frontend/package.json` |
| orchestrator | `contracts/**` 结构 · `frontend/electron/ipc-contract.ts` · `CLAUDE.md` · 本文档 · 最终集成 | — |

契约需要改动时，会话向 orchestrator 提出，不自行修改。
