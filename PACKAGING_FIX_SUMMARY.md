# EchoType macOS 打包问题修复总结

## 问题分析

### 主要问题
你的打包应用**无法触发语音输入和整合工具**，debug显示按键按下和松开，但没有实际响应。

### 根本原因
**Native模块未正确打包** - `app.asar.unpacked` 目录不存在，导致：
- `uiohook-napi` 无法加载 → 按键事件无法监听
- `@hurdlegroup/robotjs` 无法加载 → 文本输入功能失效

### 诊断结果
```
✅ Backend正确打包（arm64）
✅ 所有Python依赖已包含（qwen_asr, torch, transformers等）
✅ 模型文件已复制（Paraformer, Qwen3-ASR）
✅ models_catalog.json已包含
❌ Native模块未解包（CRITICAL）
```

## 解决方案

### 已修复的文件

#### 1. `frontend/package.json`
添加了 `asarUnpack` 配置：
```json
"asarUnpack": [
  "node_modules/uiohook-napi/**/*",
  "node_modules/@hurdlegroup/robotjs/**/*"
]
```

#### 2. `scripts/build_backend_mac_arm64.sh`
增强PyInstaller配置，添加Qwen3完整依赖：
```bash
--collect-submodules tokenizers \
--collect-submodules safetensors \
--collect-submodules huggingface_hub \
--hidden-import transformers.models.qwen2 \
--hidden-import transformers.models.qwen2_audio \
--hidden-import qwen_asr.model \
--hidden-import qwen_asr.utils
```

### 新增工具脚本

1. **`scripts/build_and_package_mac.sh`** - 一键构建和打包
2. **`scripts/diagnose_package.sh`** - 诊断打包问题
3. **`scripts/quick_fix_native_modules.sh`** - 快速修复现有应用

## 立即修复当前应用

### 方法1：快速修复（无需重新构建）
```bash
cd /Users/fionacui/echotype
bash scripts/quick_fix_native_modules.sh
```

✅ **已执行并验证成功！**

### 方法2：完整重新构建
```bash
cd /Users/fionacui/echotype
bash scripts/build_and_package_mac.sh
```

## 测试验证

### 1. 启动应用
```bash
open /Applications/EchoType.app
```

### 2. 查看日志
```bash
# 前端日志（包括hotkey事件）
tail -f ~/.echotype/logs/frontend_*.log

# 后端日志（包括模型加载）
tail -f ~/.echotype/logs/backend_*.log
```

### 3. 测试按键
按下录音快捷键（默认RAlt），日志应显示：
```
[Hotkey][INFO] uiohook module loaded successfully
[Hotkey][INFO] uiohook started
[Hotkey] Key DOWN (uiohook): RAlt (code: xxx) -> toggle_recording
```

### 4. 测试录音
- 按住RAlt说话 → 应该看到实时转写
- 松开RAlt → 停止录音，显示最终结果
- 录音文件保存在 `~/.echotype/rec/`

### 5. 测试快速操作
- 轻按RAlt（<150ms）→ 应弹出快速操作窗口
- 日志显示：`[Hotkey] Light tap detected`

## Qwen3模型打包说明

### 已包含的依赖
```
✅ qwen_asr (核心库)
✅ torch (2.10.0, arm64优化)
✅ transformers (模型加载)
✅ tokenizers (分词器)
✅ safetensors (模型格式)
✅ huggingface_hub (模型管理)
```

### 模型文件位置
```
/Applications/EchoType.app/Contents/Resources/models/Qwen3-ASR-0.6B/
├── config.json
├── model.safetensors
├── preprocessor_config.json
├── tokenizer.json
└── ...
```

### 使用Qwen3
1. 打开设置 → 模型设置
2. 选择 "Qwen3-ASR-0.6B"
3. 设备选择：CPU（MPS支持待优化）
4. 语言：自动检测或手动选择

### 性能特点
- **首次加载**：~10秒（CPU模式）
- **流式识别**：0.2-2秒更新间隔
- **长录音限制**：>10秒会变慢，建议用Paraformer
- **多语言**：支持30+语言，22种中文方言

## Windows打包参考

main分支的Windows打包实现类似，关键点：
1. 使用 `electron-builder` 的 `asarUnpack`
2. PyInstaller打包backend时包含所有依赖
3. Native模块必须解包（.node文件）

## 常见问题

### Q: 按键仍然没反应？
A: 
1. 检查辅助功能权限：系统设置 → 隐私与安全 → 辅助功能
2. 查看日志是否有 `uiohook module loaded successfully`
3. 重启应用

### Q: Qwen3加载失败？
A:
1. 检查模型文件完整性
2. 查看backend日志中的错误信息
3. 确认torch版本兼容（应为2.10.0 arm64）

### Q: 录音没有保存？
A: 检查 `~/.echotype/rec/` 目录权限

## 下一步优化建议

1. **GPU加速**：添加MPS支持（Mac GPU）
2. **模型优化**：Qwen3量化版本（减小体积）
3. **流式优化**：改进Qwen3流式识别性能
4. **UI改进**：快速操作窗口动画和样式
5. **错误处理**：更友好的错误提示

## 文档位置

- 构建修复指南：`MACOS_BUILD_FIX.md`
- 项目README：`README.md`
- 设计文档：`design/` 目录

---

**修复状态**：✅ 已完成
**测试状态**：⏳ 待用户验证
**下次构建**：使用 `scripts/build_and_package_mac.sh`
