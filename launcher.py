import sys
import os
import traceback

def log(msg):
    """Log to both stdout and stderr for maximum visibility"""
    print(msg, flush=True)
    try:
        sys.stderr.write(f"{msg}\n")
        sys.stderr.flush()
    except:
        pass

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

    # Explicit imports to verify dependencies
    log("Verifying dependencies...")
    import torch
    log(f"torch version: {torch.__version__}")
    
    import transformers
    log(f"transformers version: {transformers.__version__}")
    
    import websockets
    log("websockets imported")

    try:
        import qwen_asr
        log(f"qwen_asr imported from: {qwen_asr.__file__}")
    except ImportError as e:
        log(f"Warning: Failed to import qwen_asr: {e}")

    # Start the main app
    log("Starting backend.app.main")
    from backend.app import main
    log("="*40)
    sys.exit(main())

except Exception as e:
    log("!"*40)
    log(f"CRITICAL ERROR in Launcher: {e}")
    log(traceback.format_exc())
    log("!"*40)
    sys.exit(1)
