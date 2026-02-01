# 文档索引

本文档提供EchoType项目所有文档的快速索引。

## 根目录文档

### 入门文档
- **[README.md](README.md)** - 项目介绍和快速开始
- **[QUICKSTART.md](QUICKSTART.md)** - 详细的安装和启动指南
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - 生产环境部署指南

### 文档管理
- **[DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)** - 本文档，完整文档索引
- **[DOCUMENTATION_CLEANUP_SUMMARY.md](DOCUMENTATION_CLEANUP_SUMMARY.md)** - 文档整理总结

## design/ 目录文档

### 核心架构（必读）
- **[BACKEND_SPEC.md](design/BACKEND_SPEC.md)** - 后端架构规范
- **[FRONTEND_ELECTRON_SPEC_V2.md](design/FRONTEND_ELECTRON_SPEC_V2.md)** - 前端Electron架构（最新版）
- **[MODEL_SETTINGS_ARCHITECTURE.md](design/MODEL_SETTINGS_ARCHITECTURE.md)** - 模型设置架构

### 功能实现
- **[RECORDING_MODE.md](design/RECORDING_MODE.md)** - 录音模式（对讲机/开关）实现
- **[HOTKEY_IMPLEMENTATION.md](design/HOTKEY_IMPLEMENTATION.md)** - 全局热键系统实现
- **[MODEL_SWITCHING_GUIDE.md](design/MODEL_SWITCHING_GUIDE.md)** - 模型切换实现指南
- **[I18N_GUIDE.md](design/I18N_GUIDE.md)** - 国际化实现指南

### 问题修复与排查
- **[BUGFIXES.md](design/BUGFIXES.md)** - 已修复的问题汇总
- **[TROUBLESHOOTING.md](design/TROUBLESHOOTING.md)** - 故障排查指南

### 系统功能
- **[LOGGING_SYSTEM.md](design/LOGGING_SYSTEM.md)** - 统一日志系统说明
- **[TESTING_PROCEDURES.md](design/TESTING_PROCEDURES.md)** - 测试流程和方法

### 更新记录
- **[FINAL_UPDATES.md](design/FINAL_UPDATES.md)** - 完整更新历史
- **[FRONTEND_REFACTOR_SUMMARY.md](design/FRONTEND_REFACTOR_SUMMARY.md)** - 前端重构总结
- **[UPDATES_SUMMARY.md](design/UPDATES_SUMMARY.md)** - 更新摘要
- **[IMPLEMENTATION_PLAN.md](design/IMPLEMENTATION_PLAN.md)** - 实现计划

## scripts/ 目录

### 脚本工具
- **[README.md](scripts/README.md)** - 脚本使用指南和说明

**主要脚本**:
- `sync_configs.ps1` - 同步模型配置
- `quick_verify.ps1` - 快速验证修复
- `diagnose_connection.ps1` - 诊断连接问题
- `view_latest_logs.ps1` - 查看最新日志
- `test_config_loading.py` - 测试配置加载
- `test_backend_catalog.py` - 测试后端目录

## test/ 目录

### 测试资源
- **[README.md](test/README.md)** - 测试目录说明

**内容**:
- `assets/` - 测试音频文件（个人使用记录）
- `docs/` - 测试记录文档（个人使用记录）
- `results/` - 模型测试结果
- `run_model_tests.py` - 模型测试脚本

## 文档使用指南

### 新手入门路径
1. [README.md](README.md) - 了解项目概况
2. [QUICKSTART.md](QUICKSTART.md) - 快速启动应用
3. [design/FRONTEND_ELECTRON_SPEC_V2.md](design/FRONTEND_ELECTRON_SPEC_V2.md) - 了解前端架构
4. [design/BACKEND_SPEC.md](design/BACKEND_SPEC.md) - 了解后端架构

### 功能开发路径
1. [design/RECORDING_MODE.md](design/RECORDING_MODE.md) - 录音功能
2. [design/HOTKEY_IMPLEMENTATION.md](design/HOTKEY_IMPLEMENTATION.md) - 热键系统
3. [design/MODEL_SETTINGS_ARCHITECTURE.md](design/MODEL_SETTINGS_ARCHITECTURE.md) - 模型配置
4. [design/I18N_GUIDE.md](design/I18N_GUIDE.md) - 国际化

### 问题排查路径
1. [design/TROUBLESHOOTING.md](design/TROUBLESHOOTING.md) - 常见问题
2. [design/BUGFIXES.md](design/BUGFIXES.md) - 已知问题修复
3. [design/LOGGING_SYSTEM.md](design/LOGGING_SYSTEM.md) - 日志系统
4. [scripts/README.md](scripts/README.md) - 诊断脚本

### 测试与部署路径
1. [design/TESTING_PROCEDURES.md](design/TESTING_PROCEDURES.md) - 测试流程
2. [scripts/README.md](scripts/README.md) - 测试脚本
3. [DEPLOYMENT.md](DEPLOYMENT.md) - 部署指南

## 文档整理说明

### 整理原则
1. **按主题分类** - 相关内容整合到同一文档
2. **避免重复** - 删除重复和过时的内容
3. **清晰导航** - 提供明确的文档索引和导航路径
4. **保留历史** - 重要的更新记录保留在design/目录

### 整理历史
详细的整理过程和统计请查看：
- [DOCUMENTATION_CLEANUP_SUMMARY.md](DOCUMENTATION_CLEANUP_SUMMARY.md)

### 文档减少统计
- **根目录**: 从35个文件减少到5个文档（86%减少）
- **整体**: 文档更集中、更易维护、更易发现

## 维护建议

### 添加新文档时
1. 确定文档类型（架构/功能/问题/测试）
2. 放置在合适的目录（根目录或design/）
3. 更新本索引文档
4. 更新相关的README.md

### 更新现有文档时
1. 保持文档结构一致
2. 添加更新日期
3. 如有重大变更，在UPDATES_SUMMARY.md中记录

### 删除文档时
1. 确保内容已整合到其他文档
2. 更新本索引文档
3. 检查是否有其他文档引用

---

**最后更新**: 2026-01-31  
**整理人**: Kiro AI Assistant
