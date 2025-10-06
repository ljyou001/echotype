from __future__ import annotations

import sys

from tray_app import TrayApp


def main() -> int:
    app = TrayApp()
    return app.run()


if __name__ == '__main__':
    sys.exit(main())
