import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

/** Resolve "system" | "en" | "zh" to "en" | "zh". Default/system unknown -> English. */
export function resolveAppLanguage(choice: "system" | "en" | "zh" | undefined): "en" | "zh" {
  if (choice === "zh" || choice === "en") return choice;
  if (typeof navigator !== "undefined" && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("zh")) return "zh";
  }
  return "en";
}

const initialLng = resolveAppLanguage("system");

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: initialLng,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
