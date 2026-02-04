import base64
import os

def create_resources_cs(exe_path, dll_path, output_path):
    with open(exe_path, "rb") as f:
        exe_b64 = base64.b64encode(f.read()).decode('utf-8')
    with open(dll_path, "rb") as f:
        dll_b64 = base64.b64encode(f.read()).decode('utf-8')
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("namespace EchoTypeInstaller {\n")
        f.write("    public static class Resources {\n")
        f.write("        public const string SevenZipExe = @\"")
        f.write(exe_b64)
        f.write("\";\n")
        f.write("        public const string SevenZipDll = @\"")
        f.write(dll_b64)
        f.write("\";\n")
        f.write("    }\n")
        f.write("}\n")

if __name__ == "__main__":
    create_resources_cs(r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files\7-Zip\7z.dll", r"c:\My\Dev\echotype\scripts\windows\Resources.cs")
