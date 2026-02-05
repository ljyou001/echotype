import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import zhHK from "./locales/zh-HK.json";
import zhTW from "./locales/zh-TW.json";
import es from "./locales/es.json";
import ar from "./locales/ar.json";
import pt from "./locales/pt.json";
import id from "./locales/id.json";
import it from "./locales/it.json";
import ru from "./locales/ru.json";
import th from "./locales/th.json";
import vi from "./locales/vi.json";
import tr from "./locales/tr.json";
import hi from "./locales/hi.json";
import ms from "./locales/ms.json";
import nl from "./locales/nl.json";
import sv from "./locales/sv.json";
import da from "./locales/da.json";
import fi from "./locales/fi.json";
import pl from "./locales/pl.json";
import cs from "./locales/cs.json";
import fil from "./locales/fil.json";
import fa from "./locales/fa.json";
import el from "./locales/el.json";
import hu from "./locales/hu.json";
import mk from "./locales/mk.json";
import ro from "./locales/ro.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "zh", name: "中文 (简体)" },
  { code: "zh-TW", name: "中文 (繁體 - 台灣)" },
  { code: "zh-HK", name: "中文 (繁體 - 廣東話)" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "ar", name: "العربية" },
  { code: "pt", name: "Português" },
  { code: "it", name: "Italiano" },
  { code: "ru", name: "Русский" },
  { code: "hi", name: "हिन्दी" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "th", name: "ไทย" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "tr", name: "Türkçe" },
  { code: "nl", name: "Nederlands" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "fi", name: "Suomi" },
  { code: "pl", name: "Polski" },
  { code: "cs", name: "Čeština" },
  { code: "fil", name: "Filipino" },
  { code: "fa", name: "فارسی" },
  { code: "el", name: "Ελληνικά" },
  { code: "hu", name: "Magyar" },
  { code: "mk", name: "Македонски" },
  { code: "ro", name: "Română" }
];

/** Resolve "system" | language_code to a supported code. Default/system unknown -> English. */
export function resolveAppLanguage(choice: string | undefined): string {
  if (!choice || choice === "system") {
    if (typeof navigator !== "undefined" && navigator.language) {
      const browserLang = navigator.language.toLowerCase();
      const match = SUPPORTED_LANGUAGES.find(l => browserLang.startsWith(l.code));
      if (match) return match.code;
    }
    return "en";
  }
  return SUPPORTED_LANGUAGES.some(l => l.code === choice) ? choice : "en";
}

const initialLng = resolveAppLanguage("system");

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    "zh-TW": { translation: zhTW },
    "zh-HK": { translation: zhHK },
    ja: { translation: ja },
    ko: { translation: ko },
    fr: { translation: fr },
    de: { translation: de },
    es: { translation: es },
    ar: { translation: ar },
    pt: { translation: pt },
    id: { translation: id },
    it: { translation: it },
    ru: { translation: ru },
    th: { translation: th },
    vi: { translation: vi },
    tr: { translation: tr },
    hi: { translation: hi },
    ms: { translation: ms },
    nl: { translation: nl },
    sv: { translation: sv },
    da: { translation: da },
    fi: { translation: fi },
    pl: { translation: pl },
    cs: { translation: cs },
    fil: { translation: fil },
    fa: { translation: fa },
    el: { translation: el },
    hu: { translation: hu },
    mk: { translation: mk },
    ro: { translation: ro }
  },
  lng: initialLng,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
