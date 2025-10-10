import sys
from pathlib import Path


from config import ModelPaths
from util.server_cosmic import console


def check_model():
    for key, path in ModelPaths.__dict__.items() :
        if key.startswith('_'): continue
        if path.exists(): continue
        console.print(f'''

            Not found: {path}

            This server requires the paraformer-offline-zh model and the punc_ct-transformer_cn-en model.
            Please download the models and extract them to: {ModelPaths.model_dir}

            Direct download link: https://github.com/ljyou001/echotype/releases/download/v1.0-model/models.zip

            ''', style='bright_red')
        input('Press Enter to exit')
        sys.exit()
