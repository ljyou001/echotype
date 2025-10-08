import sys
from pathlib import Path

# Add project root to path to allow importing 'language' module
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

if __name__ == '__main__':
    from language import init_translation
    # For the server UI, we'll always auto-detect the language
    init_translation({'language': 'auto'})

    from server.server_manager_ui import main
    main()