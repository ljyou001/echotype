import argparse
import os
import sys
import traceback
from pathlib import Path


def log(msg):
    """Log to both stdout and stderr for maximum visibility"""
    print(msg, flush=True)
    try:
        sys.stderr.write(f"{msg}\n")
        sys.stderr.flush()
    except Exception:
        pass

def _env_truthy(name: str) -> bool:
    value = os.environ.get(name, "")
    return value.strip().lower() in {"1", "true", "yes", "on"}

def _detect_backend(argv):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", type=str)
    parser.add_argument("--backend", type=str)
    parser.add_argument("--disable-punctuation", action="store_true")
    args, _ = parser.parse_known_args(argv[1:])
    try:
        from backend.common.config import load_config
        config = load_config(Path(args.config) if args.config else None)
        backend = (args.backend or config.backend or "").strip().lower()
        enable_punctuation = bool(getattr(config, "enable_punctuation", True)) and not args.disable_punctuation
        return backend, enable_punctuation
    except Exception as exc:
        log(f"Warning: Failed to detect backend config: {exc}")
        return "", False

def _verify_dependencies(argv):
    if not _env_truthy("ECHOTYPE_VERIFY_DEPS"):
        log("Dependency verification skipped (set ECHOTYPE_VERIFY_DEPS=1 to enable).")
        return

    log("Verifying dependencies...")

    try:
        import websockets
        log("websockets imported")
    except Exception as exc:
        log(f"Warning: Failed to import websockets: {exc}")

    backend, enable_punctuation = _detect_backend(argv)
    if backend in {"qwen3", "qwen-asr", "qwen_asr"}:
        try:
            import torch
            log(f"torch version: {torch.__version__}")
        except Exception as exc:
            log(f"Warning: Failed to import torch: {exc}")

        try:
            import transformers
            log(f"transformers version: {transformers.__version__}")
        except Exception as exc:
            log(f"Warning: Failed to import transformers: {exc}")

        try:
            import qwen_asr
            log(f"qwen_asr imported from: {qwen_asr.__file__}")
        except Exception as exc:
            log(f"Warning: Failed to import qwen_asr: {exc}")
    elif backend in {"sherpa_onnx", "sherpa-onnx", "paraformer"}:
        try:
            import sherpa_onnx
            log(f"sherpa_onnx imported from: {sherpa_onnx.__file__}")
        except Exception as exc:
            log(f"Warning: Failed to import sherpa_onnx: {exc}")

        if enable_punctuation:
            try:
                import funasr_onnx
                log(f"funasr_onnx imported from: {funasr_onnx.__file__}")
            except Exception as exc:
                log(f"Warning: Failed to import funasr_onnx: {exc}")
    elif backend:
        log(f"Unknown backend '{backend}' for dependency verification; skipping model-specific checks.")

log("="*40)
log("EchoType Launcher Starting")
log(f"sys.executable: {sys.executable}")
log(f"sys.argv: {sys.argv}")

try:
    # Determine base path
    if getattr(sys, 'frozen', False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))

    log(f"Base path: {base_path}")

    # Add base path to sys.path
    if base_path not in sys.path:
        sys.path.insert(0, base_path)

    # In onedir mode, dependencies are in _internal
    internal_path = os.path.join(base_path, "_internal")
    if os.path.exists(internal_path):
        log(f"Adding _internal to sys.path: {internal_path}")
        if internal_path not in sys.path:
            sys.path.insert(0, internal_path)

        # Critical fix for nagisa's internal unqualified imports (like 'import prepro')
        nagisa_path = os.path.join(internal_path, "nagisa")
        if os.path.exists(nagisa_path):
            log(f"Adding nagisa folder to sys.path: {nagisa_path}")
            if nagisa_path not in sys.path:
                sys.path.insert(0, nagisa_path)
    else:
        log("No _internal folder found, assuming dev mode or onefile")
        try:
            import nagisa
            # Add the folder containing nagisa package to sys.path (parent of nagisa dir)
            # but we also need the nagisa dir itself for its internal 'import prepro'
            nagisa_dir = os.path.dirname(nagisa.__file__)
            log(f"Dev mode: Adding nagisa dir to sys.path: {nagisa_dir}")
            if nagisa_dir not in sys.path:
                sys.path.insert(0, nagisa_dir)
        except ImportError:
            log("nagisa not found in environment")

    log(f"Final sys.path: {sys.path}")

    _verify_dependencies(sys.argv)

    # Start the main app
    log("Starting backend.app.main")
    from backend.app import main
    log("=" * 40)
    sys.exit(main())

except Exception as e:
    log("!" * 40)
    log(f"CRITICAL ERROR in Launcher: {e}")
    log(traceback.format_exc())
    log("!" * 40)
    sys.exit(1)
