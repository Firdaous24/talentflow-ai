import { useSyncExternalStore } from "react";

/**
 * Light/dark theme shared by the header toggle and Settings.
 * "system" follows prefers-color-scheme; an explicit choice is remembered only
 * after the user makes it, and only when storage is available.
 */
export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
const STORAGE_KEY = "talentflow-theme";
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}
function system(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function apply() {
  document.documentElement.dataset.theme = stored() ?? system();
  listeners.forEach((listener) => listener());
}
function snapshot(): string {
  return `${stored() ?? "system"}:${document.documentElement.dataset.theme ?? system()}`;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  const follow = () => {
    if (!stored()) apply();
  };
  query?.addEventListener?.("change", follow);
  return () => {
    listeners.delete(listener);
    query?.removeEventListener?.("change", follow);
  };
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* Storage can be unavailable (private mode); the theme still applies now. */
    document.documentElement.dataset.theme = preference === "system" ? system() : preference;
    listeners.forEach((listener) => listener());
    return;
  }
  apply();
}

export function useTheme(): { theme: Theme; preference: ThemePreference } {
  const [preference, theme] = useSyncExternalStore(subscribe, snapshot, () => "system:light").split(":") as [ThemePreference, Theme];
  return { theme, preference };
}
