# Electron 前端设计规格 V2

## 目标
打造一个高质感、低延迟的本地语音输入 UI。启动时拉起 Python 后端，使用本地 WebSocket 传输音频，一键开讲。

## 技术栈
- Electron + TypeScript
- Vite + React
- **Zustand**（全局状态管理）
- Electron-builder（打包）

## 状态管理架构

使用 **Zustand** 管理全局状态，确保以下状态在整个应用中保持一致：

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
- `models`: 模型列表
- `catalog`: 模型目录
- `history`: 历史记录

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

## 布局与导航

采用左右两栏固定布局：
- 左侧：固定宽度导航栏（220px），独立容器，不受右侧内容影响
- 右侧：内容区，独立容器，可滚动

**关键架构要求**：
- 使用 CSS Grid 实现左右分栏，确保左侧宽度固定
- 左右两侧为独立的 DOM 容器，互不影响布局
- 左侧导航栏内容垂直排列，使用 flexbox 管理间距

左侧导航从上到下：
1. Logo 区域（使用指定 icon.png + 应用名称）
2. 导航菜单项（每项带图标）：
   - 主页（Home icon）
   - 历史记录（History icon）
   - 模型（Models icon）
   - 整合（Integrations icon）
   - 设置（Settings icon）
3. 底部状态区（margin-top: auto）：
   - 状态指示器（Ready/Recording/Error 等）
   - 设备指示（CPU/GPU）

交互规范：
- 选中项使用 Primary 背景和白色文字
- Hover 使用 Secondary 渐变或高亮
- 每个菜单项左侧显示图标（使用 React Icons）

## 页面规格

### 主页（Home）

**启动流程（模型未加载）**：
1. 页面中央显示大型发光圆球动画（占据主要视觉空间，直径 200-240px）
2. 圆球持续脉冲动画，表示加载中
3. 圆球下方显示状态文字："Loading models..." 或进度信息
4. 此时不显示任何卡片或其他控制元素

**就绪状态（模型已加载）**：
1. 圆球动画向上移动到页面上方区域（transform: translateY(-60px)）
2. 圆球下方淡入显示一排功能卡片（4 个，水平排列）
3. 卡片内容：
   - **模型卡片**：显示当前模型名称，点击跳转到"模型"页
   - **快捷键卡片**：显示当前快捷键，点击打开快捷键设置弹窗
   - **模式卡片**：显示 Streaming/Offline，点击切换
   - **输入设备卡片**：显示当前音频输入设备，点击跳转到设置页

**错误流程**：
- 圆球变为"！"图标，颜色变为警告色（橙色渐变）
- 圆球下方显示错误标题和详细信息
- 提供"重启后端"按钮
- 不显示功能卡片

**录音状态**：
- 圆球动画变化（波纹效果或缩放动画）
- 下方显示实时识别文本（partial result，紫色文字）
- 录音结束后显示最终文本（final result，深色文字）

### 历史记录（History）

**布局风格**：参考 Microsoft To Do 的任务列表质感

**列表项结构**（每行一条记录）：
- 左侧：日期时间（小字体，灰色，固定宽度 150px）
- 中间：识别文本内容（主字体，2-3 行截断，line-clamp: 3）
- 右侧：操作按钮组（固定宽度 120px）
  - 播放按钮（播放录音）
  - 搜索按钮（在浏览器中搜索该文本）
  - 删除按钮

**交互**：
- 每行 hover 时显示浅色背景
- 点击行本身展开完整文本（可选）
- 操作按钮始终可见

**样式要求**：
- 卡片式设计，每条记录有轻微阴影和圆角（border-radius: 12px）
- 行间距适中（gap: 12px）
- 使用品牌色系的辅助色

### 模型（Models）

**布局**：大卡片列表，每个模型一张卡片，垂直排列

**卡片结构**：
- 顶部：模型名称（大字体，18px）+ 运行状态指示器（绿色圆点，仅当前运行的模型显示）
- 中间区域：模型信息列表
  - 性能/准确度：平衡型
  - 支持语言：中文、英文
  - 设备支持：CPU + GPU
  - 磁盘占用：~500MB
- 右下角：设置按钮（齿轮图标），点击展开该模型的特定设置

**详细说明**：
- 点击卡片本身切换到该模型
- 设置按钮打开模型特定配置（设备选择、Qwen3 backend 等）

**状态指示**：
- 当前运行的模型：右上角显示绿色圆点 + "正在运行"
- 已安装但未运行：显示"已安装"标签
- 未安装：显示"安装"按钮（当前禁用，显示 Coming soon）

### 整合（Integrations）

插件入口页（例如后续的 Clawbot）：
- 卡片栅格布局（grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))）
- 每张卡片包含：图标 / 简介 / 状态
- 支持 Install / Enable / Configure

### 设置（Settings）

**重要原则**：
- 仅包含全局设置，不包含模型特定设置
- 模型特定设置放在"模型"页面的各个模型卡片中

**全局设置项**：
1. **启动设置**
   - 开机自启动（toggle）
   - 启动时自动加载模型（toggle，默认开启）

2. **快捷键设置**
   - 当前快捷键显示
   - 点击打开快捷键配置弹窗
   - 支持用户直接输入或通过按键捕获
   - 提供精确按键选择（Ctrl、Shift、Alt、特殊键）
   - **平台差异**：Windows 显示 Ctrl，macOS 显示 ⌘

3. **音频设置**
   - 输入设备选择（下拉菜单）

4. **输出设置**
   - 输出方式：直接输入 / 粘贴到剪贴板
   - 标点符号处理（toggle）
   - 数字格式化（toggle）

**注意**：
- 移除不影响实际行为的设置项
- 设置项按功能分组，使用清晰的标题

## 颜色体系
- 主品牌色 Primary: `#5A2799`
- 辅助主色 Secondary: `#418BF3`
- 强调色 Accent: `#C844A9`
- 点缀色 Highlight: `#F19748`
- 背景装饰 Soft: `#B0A7EF`
- 页面底色 Base: `#FEFEFE`

## 组件结构

```
src/
  components/
    Sidebar.tsx          # 左侧导航栏
    HomePage.tsx         # 主页
    HistoryPage.tsx      # 历史记录
    ModelsPage.tsx       # 模型管理
    IntegrationsPage.tsx # 整合
    SettingsPage.tsx     # 设置
    OrbAnimation.tsx     # 圆球动画组件
    HotkeyModal.tsx      # 快捷键配置弹窗
  store/
    appStore.ts          # Zustand 状态管理
  services/
    websocket.ts         # WebSocket 管理
    audioEncoding.ts     # 音频编码
  audio/
    recorder.ts          # 录音器
    resampler.ts         # 重采样
    worklet.ts           # AudioWorklet
  App.tsx                # 主应用组件
  main.tsx               # 入口
  styles.css             # 全局样式
```

## 实施步骤

1. 安装 Zustand：`npm install zustand`
2. 安装 React Icons：`npm install react-icons`
3. 创建 Zustand store
4. 重构 App.tsx，拆分为独立组件
5. 更新样式，确保左右布局独立
6. 实现各个页面组件
7. 测试状态同步和 UI 响应

