"""Local model detection tool"""
from pathlib import Path


def check_local_models() -> bool:
    """Check if local models exist
    
    Returns:
        bool: True if all required model directories exist
    """
    base_dir = Path(__file__).resolve().parent
    model_dir = base_dir / 'server' / 'models'
    
    required_models = [
        model_dir / 'paraformer-offline-zh',
        model_dir / 'punc_ct-transformer_cn-en',
    ]
    
    return all(path.exists() and path.is_dir() for path in required_models)


def get_model_download_url() -> str:
    """Get model download URL"""
    return 'https://github.com/ljyou001/echotype/releases/download/v1.0-model/models.zip'
