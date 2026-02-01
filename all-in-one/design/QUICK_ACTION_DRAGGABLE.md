# Quick Action 窗口拖动功能

## 概述

Quick Action 窗口现在支持拖动功能，用户可以通过拖动窗口标题栏来移动窗口位置。

## 实现方案

### 方案 1：Electron 原生拖动（已实现）

使用 Electron 的 `-webkit-app-region` CSS 属性实现窗口拖动。这是最简单和性能最好的方案。

#### 关键实现点：

1. **窗口配置**（`frontend/electron/quick-action-window.ts`）
   - `frame: false` - 无边框窗口
   - `movable: true` - 允许窗口移动

2. **CSS 配置**（`frontend/src/styles.css`）
   - 标题栏区域：`-webkit-app-region: drag` - 可拖动
   - 关闭按钮：`-webkit-app-region: no-drag` - 不可拖动
   - 文本输入区：`-webkit-app-region: no-drag` - 不可拖动
   - 图标按钮区：`-webkit-app-region: no-drag` - 不可拖动

3. **视觉提示**
   - 标题栏显示 `⋮⋮` 拖动手柄图标
   - 标题栏 `cursor: move` 鼠标样式

## 测试步骤

1. **启动应用**
   ```bash
   cd frontend
   npm run dev
   ```

2. **触发 Quick Action 窗口**
   - 使用全局快捷键（默认：Ctrl+Shift+Space）
   - 或在主窗口中录制语音后触发

3. **测试拖动功能**
   - 将鼠标移到窗口标题栏（显示 "Quick Action" 的区域）
   - 鼠标应显示为移动光标
   - 按住鼠标左键并拖动
   - 窗口应跟随鼠标移动

4. **测试交互区域**
   - 点击关闭按钮（×）- 应关闭窗口，不应拖动
   - 点击文本输入框 - 应可以编辑文本，不应拖动
   - 点击集成图标按钮 - 应执行操作，不应拖动

## 技术细节

### `-webkit-app-region` 属性

这是 Electron 提供的特殊 CSS 属性：

- `drag` - 该区域可以拖动窗口
- `no-drag` - 该区域不可拖动窗口（用于按钮等交互元素）

### 优点

- 性能好，使用原生实现
- 代码简单，易于维护
- 跨平台兼容（Windows、macOS、Linux）
- 自动处理多显示器场景

### 注意事项

1. **拖动区域层级**
   - 父元素设置 `drag`，子元素可以设置 `no-drag` 覆盖
   - 确保所有交互元素都设置了 `no-drag`

2. **窗口边界**
   - Electron 会自动防止窗口被拖出屏幕
   - 多显示器环境下可以在显示器之间拖动

3. **性能考虑**
   - 原生拖动不会触发 JavaScript 事件
   - 不会影响窗口内容的渲染性能

## 备选方案：自定义 JavaScript 拖动

如果原生方案在某些平台上有问题，可以实现自定义拖动：

```typescript
// 在 QuickActionWindow.tsx 中添加
const [isDragging, setIsDragging] = useState(false);
const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

const handleMouseDown = (e: React.MouseEvent) => {
  setIsDragging(true);
  setDragOffset({
    x: e.clientX,
    y: e.clientY
  });
};

const handleMouseMove = (e: MouseEvent) => {
  if (isDragging) {
    const deltaX = e.screenX - dragOffset.x;
    const deltaY = e.screenY - dragOffset.y;
    window.echotype?.moveQuickActionWindow?.(deltaX, deltaY);
  }
};

const handleMouseUp = () => {
  setIsDragging(false);
};
```

但目前不需要实现这个方案，因为原生方案已经足够好。

## 相关文件

- `frontend/electron/quick-action-window.ts` - 窗口创建和配置
- `frontend/src/components/QuickActionWindow.tsx` - React 组件
- `frontend/src/styles.css` - 样式定义（1832-2013 行）

## 更新日期

2026-01-31
