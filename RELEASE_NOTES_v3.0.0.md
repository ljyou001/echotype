# EchoType v3.0.0

Hold a key, speak, let go — your words appear where you type. v3 is a rebuild from the ground up: a native engine, on-demand models, and a cleaner app.

## Highlights

### ⚡ Native engine, instant text
- The Python backend is gone. A small native engine (Rust, built on sherpa-onnx and llama.cpp) does all speech recognition on your computer. No Python, no PyTorch.
- The Windows installer is about 165 MB, down from 3.3 GB in v2. Models download on demand from the Model Manager.
- With SenseVoice or Paraformer on CPU, text appears 0–10 ms after you release the key if you pause briefly first, and in under 100 ms if you release the instant you stop talking (measured on an i9-13980HX).
- Accuracy doesn't depend on timing. Dictation gives the same text as transcribing the whole recording, and numbers come out as digits ("9点", "50 pieces").

### 🧠 Models, your way
- A new **Model Manager** with 9 speech models: SenseVoice Small, Paraformer Small, Paraformer, Qwen3 ASR 0.6B and 1.7B, FireRedASR 2 AED, Parakeet TDT 0.6B v3, Moonshine v2 Base (English), and Whisper Large v3 Turbo. A punctuation model installs automatically when a model needs one.
- Every model runs on CPU out of the box. GPU acceleration is an optional one-time download: NVIDIA CUDA on Windows and Linux x64, and Vulkan on Windows and Linux. The Apple Silicon build includes Metal acceleration for Qwen3.
- Downloads are checksum-verified and resume where they left off.
- Punctuation and language settings now live with each model. Punctuation follows the language you speak: Chinese marks for Chinese and English marks for English, or you can pick one style.

### 🔌 Quick Action & Integrations
- Tap the hotkey to open Quick Action with your last text.
- **AI transforms**: clean up, translate, rewrite as an email or a chat message, make a bullet list, or ask AI. Works with OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Qwen, Kimi, Zhipu GLM and OpenRouter, or with local models via Ollama, LM Studio or a llama.cpp server.
- **Send** to Slack, Discord, Feishu/Lark, Todoist, Obsidian, a webhook, Claude Code or Codex CLI.
- **Open** in Google, Bing, Baidu, ChatGPT, Claude, Perplexity, Gemini, Qwen, Doubao, ERNIE Bot, Google Translate, DeepL, Youdao or any web page.
- API keys are encrypted with your system's secure storage.

### 🎨 A cleaner app
- A redesigned layout, light and dark themes, and six accent colors.
- The status bar shows the model and how it runs, e.g. "SenseVoice Small · CPU".
- Errors are written in plain language, and microphone and hotkey problems tell you what to do.
- If the engine crashes, it restarts and reloads your model by itself.
- Settings → About lists every open-source component and model license.

## Upgrading from v2
- v3 keeps its data in `~/.echotype-v3`. On first launch it imports your v2 settings and integrations, and it never changes the v2 folder `~/.echotype`.
- v2 models use a different format. Download the models you want again from the Model Manager.

## Downloads
| Platform | Files |
|---|---|
| Windows (x64, ARM64) | `EchoType-3.0.0-win-<arch>.exe` (installer) or `.zip` (portable) |
| macOS (Apple Silicon, Intel) | `EchoType-3.0.0-mac-<arch>.dmg` or `.zip` |
| Linux (x64, ARM64) | `.AppImage` or `.deb` |

`SHA256SUMS.txt` lists the checksum of every file.

## Known issues
- The installers aren't code-signed yet. On Windows, choose **More info → Run anyway**. On macOS, right-click the app and choose **Open** the first time.
- v3 has been tested on Windows x64. The macOS, Linux and ARM64 builds pass automated checks but haven't been tested on real hardware yet.
- On Linux with Wayland, global hotkeys are limited by the system; the app shows a notice when this applies.

---

# EchoType v3.0.0 更新日志

按住一个键说话，松开，文字就出现在你正在输入的地方。v3 从底层整个重写：原生引擎、模型按需下载、界面更清爽。

## 主要变化

### ⚡ 原生引擎，松键即出字
- 去掉了 Python 后端。语音识别全部由一个小巧的原生引擎在本机完成，引擎用 Rust 编写，基于 sherpa-onnx 和 llama.cpp。不再需要 Python，也不再需要 PyTorch。
- Windows 安装包约 165 MB，v2 是 3.3 GB。模型在模型管理器里按需下载。
- 用 CPU 跑 SenseVoice 或 Paraformer：说完稍停一下再松键，0–10 ms 出字；话音刚落就松键，也不到 100 ms（i9-13980HX 实测）。
- 识别准确率不受松键时机影响：按住说话的结果和整段录音转写的结果一致，数字也会自动写成阿拉伯数字（"9点"、"50 pieces"）。

### 🧠 模型随你选
- 全新的**模型管理器**，提供 9 个语音模型：SenseVoice Small、Paraformer Small、Paraformer、Qwen3 ASR 0.6B 和 1.7B、FireRedASR 2 AED、Parakeet TDT 0.6B v3、Moonshine v2 Base（英文）、Whisper Large v3 Turbo。需要标点模型的会自动装上。
- 所有模型装好就能用 CPU 跑。GPU 加速是可选的一次性下载：Windows 和 Linux x64 支持 NVIDIA CUDA，Windows 和 Linux 支持 Vulkan。Apple Silicon 版内置 Qwen3 的 Metal 加速。
- 下载会校验文件完整性，中断后可以接着下。
- 标点和语言设置改到了各个模型里。标点跟着你说的语言走：说中文用中文标点，说英文用英文标点，也可以手动固定一种。

### 🔌 快捷操作与集成
- 轻按一下热键，打开快捷操作窗口，里面是你刚才说的话。
- **AI 改写**：整理、翻译、改写成邮件或聊天消息、整理成要点，或者直接问 AI。支持 OpenAI、Anthropic Claude、Google Gemini、DeepSeek、通义千问、Kimi、智谱 GLM、OpenRouter，也支持通过 Ollama、LM Studio 或 llama.cpp server 运行的本地模型。
- **发送**到 Slack、Discord、飞书、Todoist、Obsidian、Webhook、Claude Code 或 Codex CLI。
- **打开**：Google、必应、百度、ChatGPT、Claude、Perplexity、Gemini、通义千问、豆包、文心一言、Google 翻译、DeepL、有道翻译，或任意网页。
- API key 用系统的安全存储加密保存。

### 🎨 更清爽的界面
- 重新设计的布局，支持亮色和暗色主题，提供 6 种强调色。
- 状态栏显示当前模型和运行方式，例如"SenseVoice Small · CPU"。
- 报错用的是说人话的文案。麦克风或热键出问题时，会告诉你该怎么处理。
- 引擎崩溃后会自动重启，并重新加载你的模型。
- 设置 → 关于里列出了所有开源组件和模型的许可证。

## 从 v2 升级
- v3 的数据放在 `~/.echotype-v3`。第一次启动时会导入你 v2 的设置和集成，但从不修改 v2 的目录 `~/.echotype`。
- v2 的模型格式不同，请在模型管理器里重新下载需要的模型。

## 下载
| 平台 | 文件 |
|---|---|
| Windows（x64、ARM64） | `EchoType-3.0.0-win-<arch>.exe`（安装包）或 `.zip`（免安装） |
| macOS（Apple Silicon、Intel） | `EchoType-3.0.0-mac-<arch>.dmg` 或 `.zip` |
| Linux（x64、ARM64） | `.AppImage` 或 `.deb` |

每个文件的校验值见 `SHA256SUMS.txt`。

## 已知问题
- 安装包还没有代码签名。Windows 上点**更多信息 → 仍要运行**；macOS 上第一次打开时，右键点应用，选**打开**。
- v3 目前只在 Windows x64 上实测过。macOS、Linux 和 ARM64 版本通过了自动检查，但还没有在真机上测试。
- Linux 的 Wayland 环境下，系统会限制全局热键，遇到时应用会给出提示。
