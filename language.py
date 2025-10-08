import gettext
import locale
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional


class POParser:
    def __init__(self, pofile: Path):
        self.translations: Dict[str, str] = {}
        self._parse(pofile)

    def _parse(self, pofile: Path):
        with pofile.open("r", encoding="utf-8") as f:
            lines = f.readlines()

        msgid = ""
        msgstr = ""
        in_msgid = False
        in_msgstr = False

        for line in lines:
            line = line.strip()
            if line.startswith("msgid "):
                if msgid and msgstr:
                    self.translations[self._unescape(msgid)] = self._unescape(msgstr)
                msgid = line[6:].strip()
                in_msgid = True
                in_msgstr = False
            elif line.startswith("msgstr "):
                msgstr = line[7:].strip()
                in_msgstr = True
                in_msgid = False
            elif line.startswith('"'):
                if in_msgid:
                    msgid += line
                elif in_msgstr:
                    msgstr += line
            else:
                if msgid and msgstr:
                    self.translations[self._unescape(msgid)] = self._unescape(msgstr)
                msgid = ""
                msgstr = ""
                in_msgid = False
                in_msgstr = False
        if msgid and msgstr:
            self.translations[self._unescape(msgid)] = self._unescape(msgstr)
    
    def _unescape(self, s: str) -> str:
        s = s.strip('"')
        # Using str.replace is simpler and safer than re.sub for this task
        s = s.replace('\\n', '\n')
        s = s.replace('\\"', '"')
        s = s.replace('\\\\', '\\')
        return s

    def gettext(self, message: str) -> str:
        return self.translations.get(message, message)


class POTranslations(gettext.NullTranslations):
    def __init__(self, fp=None, parser: Optional[POParser] = None):
        super().__init__(fp)
        self.parser = parser

    def _parse(self, fp):
        # This is not used when a parser is provided
        pass

    def gettext(self, message):
        if self.parser:
            return self.parser.gettext(message)
        return super().gettext(message)


# The top-level directory of the application
APP_DIR = Path(__file__).resolve().parent
LOCALE_DIR = APP_DIR / "locales"

SUPPORTED_LANGUAGES = {
    "en": "English",
    "zh": "简体中文",
}


def get_system_language() -> str:
    """
    Detects the system's default language.
    Returns a two-letter language code (e.g., 'en', 'zh').
    """
    try:
        lang_code, _ = locale.getdefaultlocale()
        if lang_code:
            return lang_code.split("_")[0]
    except Exception:
        pass
    return "en"


def init_translation(config: Dict[str, Any]) -> None:
    """
    Initializes the translation system based on the user's configuration.
    It finds the appropriate .mo file and installs the translation.
    """
    lang_code = config.get("language", "auto")
    if lang_code == "auto":
        lang_code = get_system_language()

    # Fallback to English if the detected language is not supported
    if lang_code not in SUPPORTED_LANGUAGES:
        lang_code = "en"

    translation: gettext.NullTranslations = gettext.NullTranslations()
    
    # gettext requires the language directory to exist.
    lang_dir = LOCALE_DIR / lang_code
    if lang_dir.exists():
        try:
            # Prefer the compiled .mo file
            translation = gettext.translation(
                "messages", localedir=LOCALE_DIR, languages=[lang_code]
            )
        except FileNotFoundError:
            # Fallback to parsing the .po file directly
            po_file = lang_dir / "LC_MESSAGES" / "messages.po"
            if po_file.exists():
                try:
                    parser = POParser(po_file)
                    translation = POTranslations(parser=parser)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error("Failed to parse .po file: %s", e, exc_info=True)
                    # In case of parsing error, use NullTranslations
                    pass
    
    translation.install()

