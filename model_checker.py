"""本地模型检测工具"""
from pathlib import Path


def check_local_models() -> bool:
    """检测本地模型是否存在
    
    Returns:
        bool: 如果所有必需的模型目录都存在则返回 True
    """
    base_dir = Path(__file__).resolve().parent
    model_dir = base_dir / 'server' / 'models'
    
    required_models = [
        model_dir / 'paraformer-offline-zh',
        model_dir / 'punc_ct-transformer_cn-en',
    ]
    
    return all(path.exists() and path.is_dir() for path in required_models)


def get_model_download_url() -> str:
    """获取模型下载地址"""
    return 'https://github.com/ljyou001/echotype/releases/download/v1.0-model/models.zip'
