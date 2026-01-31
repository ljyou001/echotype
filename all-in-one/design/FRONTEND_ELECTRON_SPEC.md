# Electron 前端设计规格

## 目标
打造一个高质感、低延迟的本地语音输入 UI。启动时拉起 Python 后端，使用本地 WebSocket 传输音频，一键开讲。
必须支持：
- 一键 / 按住说话录音。
- 流式或离线识别（可切换）。
- 模型切换与能力元数据展示。
- 自启动与一键启动。
- 左侧导航 + 右侧内容布局。

## 非目标
- 远程或云端识别。
- 浏览器部署。
- 复杂多窗口流程。

## 品牌资产与图标
使用前端资产目录中的图标：
- `all-in-one/frontend/assets/icon.png`
必须使用无白底版本，作为窗口图标、托盘图标和应用识别资产。

## 颜色体系
以下色值为固定规范：
- 主品牌色 Primary: `#5A2799`（深邃紫，用于导航和重点文字）
- 辅助主色 Secondary: `#418BF3`（科技蓝，用于链接、图标和次级按钮）
- 强调色 Accent: `#C844A9`（活力玫红，用于焦点和渐变）
- 点缀色 Highlight: `#F19748`（日光橙，用于 CTA 和徽章）
- 背景装饰 Soft: `#B0A7EF`（柔光紫，用于卡片和装饰层）
- 页面底色 Base: `#FEFEFE`（纯净白）

使用建议：
- 页面主体背景为白色，搭配淡紫/淡蓝装饰渐变。
- 左侧导航为深紫主色，文字为白色。
- 强调色与点缀色只在关键区域使用，避免过度。
- 内容区保持轻盈、干净、高对比度。

## 总体架构
```
Electron Main
  |-- 应用生命周期、托盘、自启动
  |-- 拉起后端进程（Python）
  |-- 全局热键与窗口焦点控制
  |-- IPC 桥接（renderer <-> main）

Electron Renderer (UI)
  |-- 采集麦克风（Web Audio API）
  |-- 采样率转换 + 帧分包
  |-- WS 客户端（localhost）
  |-- 状态机 + 页面视图
  |-- 设置页 + 模型切换
```
后端为本地 Python WS 服务（见 `BACKEND_SPEC.md`）。

## 技术栈（定案）
- Electron + TypeScript
- Vite + React
- **Zustand**（全局状态管理，用于跨组件共享状态）
- Electron-builder（打包）

## 状态管理架构

**使用 Zustand 管理全局状态**，确保以下状态在整个应用中保持一致：

**核心状态**：
- `backendStatus`: 后端状态（loading/ready/recording/error/offline）
- `connectionState`: WebSocket 连接状态（connecting/open/closed）
- `capabilities`: 后端能力元数据
- `activeModelId`: 当前运行的模型 ID
- `devices`: 可用设备列表（CPU/GPU）
- `defaultDevice`: 当前使用的设备
- `isStreaming`: 流式/离线模式
- `isRecording`: 是否正在录音
- `errorDetail`: 错误详情

**状态更新来源**：
- WebSocket 消息（status、capabilities、result 等）
- 用户交互（切换模型、切换模式等）
- 主进程 IPC 消息（后端日志、热键事件等）

**状态消费**：
- 首页：显示状态圆球、卡片信息
- 模型页：显示当前运行的模型、设备信息
- 左侧导航：显示状态指示器、设备标签
- 所有页面：根据状态显示/隐藏元素

**实现要求**：
- 创建 `src/store/appStore.ts` 使用 Zustand
- 所有组件通过 store 读取和更新状态
- WebSocket 消息处理器直接更新 store
- 避免在组件内部使用 useState 管理全局状态

## 后端集成
### 启动
主进程启动后端：
1. 解析后端入口：
   - 开发态：`.venv\Scripts\python -m backend`
   - 生产态：打包后的后端可执行文件
2. 等待 WS 就绪（`ws://127.0.0.1:6016`）
3. 通知渲染进程连接并请求元数据

### 关闭
- 关闭 WS 连接。
- 结束后端进程（SIGTERM / taskkill）。

### 重连策略
- 渲染端断线自动重连（指数退避）。
- UI 显示“重连中…”。

## 音频采集与发送
### 采集
使用 `getUserMedia` 获取麦克风，AudioWorklet 捕获更低延迟。

### 采样率转换
后端期望 16kHz float32 mono：
- 采集端做重采样。
- 发送 20-50ms 帧（320-800 采样点）。

### WS 音频包
```
{
  "type": "audio",
  "task_id": "uuid",
  "seg_duration": 15,
  "seg_overlap": 2,
  "is_final": false,
  "time_start": 1738210000.12,
  "time_frame": 1738210000.37,
  "source": "mic",
  "data": "base64(float32 pcm)"
}
```
结束包：`is_final: true` 且 `data: ""`。

### 流式 / 离线切换
```
{ "type": "set_streaming", "enabled": true|false }
```

## UI 状态机
- `loading`: 后端启动 / 模型加载中
- `ready`: 空闲可用
- `recording`: 录音中
- `transcribing`: 等待最终结果
- `error`: 后端错误
- `offline`: 后端不可达

状态由 `status` / `progress` / `result` 驱动。

错误要求：
- 首页加载动画在发生后端错误时切换为“！”提示。
- 显示明确错误原因（例如：模型缺失 / 模型加载失败 / 设备不支持 / 性能不足 / 依赖缺失 / WS 连接失败）。
- 当处于 `error` 或 `offline` 时，首页提供“重启后端”按钮。
- 重启逻辑由主进程执行（终止旧进程 -> 重新启动 -> 等待 WS 就绪）。

## 布局与导航
采用左右两栏：
- 左侧：导航栏
- 右侧：内容区

左侧导航从上到下：
1. Logo（使用指定 icon）
2. 菜单项：主页 / 历史记录 / 模型 / 整合 / 设置

交互规范：
- 选中项使用 Primary 背景和白色文字。
- Hover 使用 Secondary 渐变或高亮。
- 导航默认宽度约 220px，可选折叠。

## 页面规格
### 主页（Home）
启动流程：
1. 后端启动时显示加载动画。
2. 中央为发光圆球，持续脉冲。
3. 模型准备好后圆球上移，下方出现一排卡片。

错误流程：
- 如果后端报告 `error` 或 WS 断开：圆球变为“！”状态，并展示错误原因。
- 页面提供“重启后端”按钮，触发主进程重启后端并重新连接。

卡片内容（可点击）：
- 模型：当前模型名称，点击跳转“模型”页
- 快捷键：显示当前快捷键，点击修改
- 模式：Streaming/Offline，点击切换
- 音频输入设备：显示当前输入设备，点击切换或者小icon跳设置详细设置音频输入设备section

风格参考：VPN 类应用的中心节点和状态视觉。

### 历史记录（History）
列表展示每条识别结果：
- 时间戳
- 识别文本（2-3 行截断）
- 小图标：播放音频 / 搜索文本

交互：
- 播放图标回听音频
- 搜索图标打开系统默认搜索

### 模型（Models）
模型列表 + 详情卡片：
- 名称与家族
- 支持语言
- 性能档位（快 / 平衡 / 高精度）
- 体积（磁盘占用）
- 设备支持（CPU / GPU）

操作：
- 选择并切换模型
- 若未安装显示“安装”按钮

### 整合（Integrations）
插件入口页（例如后续的 Clawbot）：
- 卡片栅格布局
- 每张卡片包含：图标 / 简介 / 状态
- 支持 Install / Enable / Configure

设计必须可扩展，新增插件不改整体布局。

### 设置（Settings）
参考现有 Echotype 设置：
- 热键模式与快捷键
- 输出方式（输入/粘贴）
- 标点与格式化开关
- 音频设备 / 输入音量
- 语言默认值

按模块分组，标题清晰。

## 视觉方向
- 主背景为白色，搭配淡紫/淡蓝渐变纹理。
- 左侧导航深紫，内容区清爽。
- 主页使用中心球形动画代替传统麦克风按钮。
- 使用圆角卡片与胶囊按钮。
- 字体使用现代感无衬线（建议本地内嵌）。
- 强对比，优先可读性与可访问性。

## 窗口与托盘
### 窗口
- 小型无边框窗口，具有“dock”感。
- 记忆位置与大小。
- 最小化时自动隐藏到托盘。

### 托盘
- 单击：切换窗口显示
- 右键：快捷菜单（开始/停止、设置、退出）

## 自启动
- Windows：注册表 / Squirrel
- macOS：Login Items

## 安全
- `contextIsolation: true`
- `nodeIntegration: false`
- preload 只暴露必要 IPC
- WS 仅限 `127.0.0.1`

## 打包
打包策略为“前端 + 后端 + 默认模型”统一分发，并支持后续下载扩展模型。

目标架构：
- Windows x64
- macOS Intel (x64) + Apple Silicon (arm64)

包体策略：
- 默认内置 Paraformer（保证最小可用）
- Qwen3-ASR-0.6B 后续通过下载补齐（URL 由后续提供）

产物格式：
- Windows：NSIS + ZIP
- macOS：DMG + ZIP

实施要点：
- 生产模式使用打包后的后端可执行文件（Windows 为 `.exe`，macOS 为无后缀可执行文件）
- Electron 主进程启动后端二进制并等待 WS 就绪
- 模型资源放置在应用可写目录或用户目录，并与后台模型目录规则对齐
- 打包需要在对应平台构建（Windows 和 macOS 分别构建，或使用 CI）

## 里程碑
1. 连接后端 WS 显示状态
2. 采集麦克风 + 发送音频
3. 热键控制录音 + 结果展示
4. 模型列表 + 切换 + 设备状态
5. 完整 UI 与托盘、自动启动
