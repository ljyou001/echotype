import sys
from pathlib import Path


from config import ModelPaths
from util.server_cosmic import console


def check_model():
    for key, path in ModelPaths.__dict__.items() :
        if key.startswith('_'): continue
        if path.exists(): continue
        console.print(f'''
    未能找到模型文件 

    未找到：{path}

    本服务端需要 paraformer-offline-zh 模型和 punc_ct-transformer_cn-en 模型，
    请下载模型并解压到： {ModelPaths.model_dir} 
    
    直接下载链接： https://github.com/ljyou001/echotype/releases/download/v1.0-model/models.zip 

        ''', style='bright_red')
        input('按回车退出')
        sys.exit()
