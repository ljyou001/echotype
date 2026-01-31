# 测试目录

本目录包含测试相关的文件和资源。

## 目录结构

```
test/
├── assets/          # 测试音频文件（个人使用记录）
├── docs/            # 测试记录文档（个人使用记录）
├── results/         # 模型测试结果
└── run_model_tests.py  # 模型测试脚本
```

## 说明

### assets/
包含大量音频测试文件，这些是使用EchoType进行语音输入时的录音记录。

**用途**: 
- 个人使用记录
- 音频质量测试
- 识别准确率验证

**注意**: 这些文件是个人使用记录，不是项目测试用例。

### docs/
包含音频转录文本记录，对应assets/目录中的音频文件。

**格式**: 每个文档包含时间戳和对应的转录文本。

**注意**: 这些是个人使用记录，不是正式的测试文档。

### results/
包含模型性能测试结果的JSON文件。

**文件**:
- `qwen3_cpu_results.json` - Qwen3模型CPU测试结果
- `qwen3_gpu_results.json` - Qwen3模型GPU测试结果
- `sherpa_onnx_results.json` - Sherpa-ONNX模型测试结果

### run_model_tests.py
模型性能测试脚本。

**用途**: 测试不同模型的识别准确率和性能。

**运行**:
```bash
python test/run_model_tests.py
```

## 正式测试文档

正式的测试流程和方法请参考：
- [design/TESTING_PROCEDURES.md](../design/TESTING_PROCEDURES.md) - 测试流程
- [scripts/README.md](../scripts/README.md) - 测试脚本

## 清理建议

如果需要清理个人使用记录：

```powershell
# 清理音频文件（保留目录结构）
Remove-Item test\assets\*.mp3

# 清理转录记录（保留目录结构）
Remove-Item test\docs\*.md -Exclude README.md
```

**注意**: 清理前请确认不需要这些记录。
