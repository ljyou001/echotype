# shell/
> L2 | 父级: frontend/electron/CLAUDE.md

Electron 外壳：本层唯一 import electron 与原生模块的地方。只把 Core 的状态显示出来、把用户与系统事件转给 Core，不做业务决策。

## 成员清单
ipc.ts: EchotypeBridge（ipcVersion 2）的主进程实现，每个 IPC channel 恰好一个处理器（含 models:update-settings、models:storage、packs:*、system:licenses），只转调 Core 与窗口；拒绝非本应用 webContents 的调用；错误统一编码为 "[CODE] message"
main-window.ts: 主窗口 980×680，底色随主题明暗，经 additionalArguments 把发行渠道交给 preload，关闭即隐藏，退出时才真正关闭；loadRenderer（开发态 Vite URL / 打包态 dist/index.html）与 hardenWebContents（拒绝新窗口，外链交给浏览器）供两个窗口复用
quick-action-window.ts: Quick Action 浮窗（底色随主题明暗），几何与交互移植自 v2：贴近鼠标、按插件数估高、1 s 失焦宽限、拖动夹在屏幕内、回复变长时上移；resize 视为"已有回复"并关闭失焦自动关闭（替代 v2 的 quick-action-has-reply 消息）
theme.ts: ThemeSync，settings.ui.theme.mode 到 nativeTheme.themeSource 的唯一出口；原生标题栏、滚动条与渲染进程的 prefers-color-scheme 随之切换；主窗口与 Quick Action 窗口的底色跟随明暗（system 模式下系统切换由 nativeTheme updated 同步），色值等于渲染层的 --bg（tokens.css / themes.css）。强调色只属于渲染层
tray.ts: 托盘。状态由 AppSnapshot 推导（加载黄、出错红、录音白、就绪无点），jimp 绘制并按状态缓存；菜单文案随听写状态切换
system.ts: 权限查询与设置页跳转、外链白名单、开机启动（--hidden）、PowerPolicy（听写或加载时防休眠并提高引擎进程优先级）、GPU 厂商探测（app.getGPUInfo）、发行渠道解析、Wayland 下热键受限的识别（HOTKEY_WAYLAND_LIMITED，目前只记日志）
platform-adapters.ts: Electron 45 异步剪贴板（按条目与 MIME 类型保存/还原全部格式）、异步 safeStorage（isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync）、robotjs 0.9.1 粘贴、uiohook 键源到 Core 端口的适配；nullKeySource 供 smoke 使用

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
