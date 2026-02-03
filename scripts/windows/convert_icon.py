from PIL import Image
import sys
import os

def convert_png_to_ico(png_path, ico_path):
    img = Image.open(png_path)
    # 7z SFX icons usually look better if they include multiple sizes
    icon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico_path, format='ICO', sizes=icon_sizes)
    print(f"Converted {png_path} to {ico_path}")

if __name__ == "__main__":
    src = r"c:\My\Dev\echotype\frontend\assets\icon-white.png"
    dst = r"c:\My\Dev\echotype\scripts\windows\icon-white.ico"
    convert_png_to_ico(src, dst)
