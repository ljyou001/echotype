# 录音模式说明

## 概述

Echotype 支持两种录音模式，用户可以在设置页面自由切换：

1. **对讲机模式（Push-to-Talk）** - 默认模式
2. **开关模式（Toggle）**

## 对讲机模式（Push-to-Talk）

### 行为
- 按住快捷键：开始录音
- 松开快捷键：停止录音

### 特点
- 类似对讲机的使用方式
- 录音时长完全由用户控制
- 适合短句、快速输入
- 不会误触发长时间录音

### 使用场景
- 快速语音输入
- 需要精确控制录音时长
- 避免误录制环境噪音

## 开关模式（Toggle）

### 行为
- 第一次按下快捷键：开始录音
- 第二次按下快捷键：停止录音

### 特点
- 类似开关的使用方式
- 适合长句、长时间录音
- 录音期间双手可以自由活动

### 使用场景
- 长段落输入
- 需要边说边做其他操作
- 不方便一直按住键盘

## 技术实现

### 前端实现

**状态管理** (`frontend/src/store/appStore.ts`)
```typescript
recordingMode: "push-to-talk" | "toggle"  // 默认 "push-to-talk"
```

**录音逻辑** (`frontend/src/App.tsx`)
```typescript
const hotkeyHandler = (payload: { action: string; keyDown?: boolean }) => {
  if (payload.action === "toggle") {
    if (recordingMode === "push-to-talk") {
      // 对讲机模式：按下开始，松开停止
      if (payload.keyDown === true) {
        void startRecording();
      } else if (payload.keyDown === false) {
        stopRecording();
      }
    } else {
      // 开关模式：每次按下切换状态
      if (payload.keyDown !== false) {
        toggleRecording();
      }
    }
  }
};
```

### Electron 主进程

**热键管理** (`frontend/electron/hotkey-manager.ts`)
- 使用 `uiohook-napi` 实现高精度、非阻塞的全局 `keydown` 和 `keyup` 监听。
- **不劫持系统按键**：即使注册了 `CapsLock` 或修饰键，它们在系统中的原有功能依然保留（如 RCtrl 依然能作为组合键使用）。
- **智能分流**：对于单键，完全使用 `uiohook`；对于某些特殊的组合键，回退到 Electron 的 `globalShortcut` 以获得更好的兼容性。

**核心逻辑改进**：
- 完美支持 **Push-to-Talk**，响应速度极快且无重复触发。
- 自动过滤零长度音频数据，防止后端 ONNX 推理引擎因非法输入而崩溃。

## 设置界面

用户可以在 **设置** 页面看到两个独立的卡片：

### 快捷键卡片
```
┌─────────────────────────────────────┐
│ 快捷键                               │
├─────────────────────────────────────┤
│ 当前快捷键: RCtrl                    │
│ [配置快捷键]                         │
└─────────────────────────────────────┘
```

### 录音模式卡片（独立）
```
┌─────────────────────────────────────┐
│ 录音模式                             │
├─────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐          │
│ │对讲机模式│ │ 开关模式 │          │
│ └──────────┘ └──────────┘          │
│                                     │
│ 按住快捷键录音，松开停止             │
│ （像对讲机一样）                     │
└─────────────────────────────────────┘
```

**快捷键配置**：
- 默认：单键（RCtrl 或 RCmd）
- 支持：组合键（如 Ctrl+Shift+Space）
- 推荐：右侧修饰键或特殊功能键，避免与系统快捷键冲突

## 国际化支持

### 中文
- 对讲机模式：按住键录音，松开停止（像对讲机一样）
- 开关模式：按一次开始，再按一次停止

### English
- Push-to-Talk: Hold key to record, release to stop (like a walkie-talkie)
- Toggle: Press once to start, press again to stop

## 默认配置

根据设计文档 `design/README.md` 的要求：
- **默认模式**：对讲机模式（Push-to-Talk）
- **默认快捷键**：单键
  - Windows/Linux: `RCtrl`（右 Ctrl 键）
  - macOS: `RCmd`（右 Command 键）
- **支持组合键**：用户可以在设置中配置组合键（如 `Ctrl+Shift+Space`）
- **推荐单键**：
  - 右侧修饰键：RCtrl、RCmd、RAlt、RWin
  - 特殊功能键：F13、F14、F15
  - 锁定键：Scroll Lock、Caps Lock（较少冲突）

## 未来改进

1. **真正的按键监听**
   - 使用 `uiohook-napi` 或类似库
   - 实现真正的 keydown/keyup 事件检测
   - 支持更精确的对讲机模式

2. **自定义延迟**
   - 允许用户调整松开延迟时间
   - 适应不同的使用习惯

3. **视觉反馈**
   - 录音时显示波形动画
   - 按键状态实时显示

4. **快捷键配置**
   - 支持单键和组合键
   - 默认使用单键（RCtrl/RCmd）
   - 更灵活的快捷键配置

## 相关文件

- `frontend/src/store/appStore.ts` - 状态管理
- `frontend/src/App.tsx` - 录音逻辑
- `frontend/src/components/SettingsPage.tsx` - 设置界面
- `frontend/electron/main.ts` - Electron 主进程
- `frontend/electron/hotkey-manager.ts` - 热键管理
- `frontend/src/i18n/locales/zh.json` - 中文翻译
- `frontend/src/i18n/locales/en.json` - 英文翻译

## 测试建议

1. **对讲机模式测试**
   - 按住快捷键，说话，松开
   - 验证录音立即停止
   - 测试短句输入

2. **开关模式测试**
   - 按一次快捷键，说话
   - 再按一次快捷键
   - 验证录音正确停止
   - 测试长句输入

3. **模式切换测试**
   - 在设置中切换模式
   - 验证新模式立即生效
   - 测试状态持久化

4. **边界情况**
   - 快速连续按键
   - 录音中切换模式
   - 应用重启后模式保持

---

**最后更新**: 2026-01-30
**状态**: ✅ 已实现
