#!/usr/bin/env python3
"""独立测试 Paraformer 识别"""

import sys
import os
import wave
import numpy as np
from pathlib import Path

# 设置工作目录
os.chdir(Path(__file__).parent.parent)
sys.path.insert(0, 'backend')

def test_paraformer():
    # 导入模块
    from common.config import BackendConfig
    from sherpa_onnx.adapter import SherpaOnnxAdapter
    from common.types import RecognitionTask
    
    # 读取测试音频
    wav_path = Path('test/20260131_130657_b383e941.wav')
    
    print('=' * 60)
    print(f'测试音频: {wav_path.name}')
    print('=' * 60)
    
    with wave.open(str(wav_path), 'rb') as w:
        rate = w.getframerate()
        frames = w.getnframes()
        data = np.frombuffer(w.readframes(frames), dtype=np.int16)
    
    print(f'采样率: {rate} Hz')
    print(f'时长: {frames / rate:.2f}s')
    print(f'样本数: {len(data)}')
    print()
    
    # 转换为 float32
    samples = data.astype(np.float32) / 32768.0
    audio_bytes = samples.tobytes()
    
    # 创建配置
    config = BackendConfig(
        backend='sherpa_onnx',
        model_id='paraformer-offline-zh',
        models_dir=Path.home() / '.echotype' / 'models',
        enable_punctuation=True,
        format_numbers=True,
        format_spacing=True,
    )
    
    # 创建 adapter
    print('加载 Paraformer 模型...')
    adapter = SherpaOnnxAdapter(config)
    adapter.load()
    print('模型加载完成')
    print()
    
    # 创建识别任务
    task = RecognitionTask(
        task_id='test-task',
        client_id='test-client',
        data=audio_bytes,
        offset=0.0,
        overlap=0.0,
        is_final=True,
        time_start=0.0,
        time_submit=0.0,
        source='test',
        samplerate=rate,
        lang=None,
    )
    
    # 处理
    print('开始识别...')
    result = adapter.process_task(task)
    
    print('=' * 60)
    print('识别结果:')
    print(result.text)
    print('=' * 60)
    print(f'识别时长: {result.duration:.2f}s')
    print(f'Token数: {len(result.tokens)}')
    print()
    
    print('原始内容:')
    print('我不是让你把这个东西的前后端设置全都改成，只要不相近就是错的')
    print('=' * 60)

if __name__ == '__main__':
    test_paraformer()
