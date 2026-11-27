import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { fr } from "./fr";

/**
 * Public pages and account spaces are translated (FR default, EN). The local
 * demo workbench keeps its English labels, which the end-to-end tests read.
 * The choice is stored only when the person clicks a language (like the theme).
 */
export type Language = "fr" | "en";
export const LANGUAGES: Language[] = ["fr", "en"];
const STORAGE_KEY = "talentflow-language";

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "fr" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: storedLanguage() ?? "fr",
  fallbackLng: "fr",
  supportedLngs: LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* Storage can be unavailable (private mode); the language still applies now. */
  }
  void i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return i18n.language === "en" ? "en" : "fr";
}

export { i18n };
