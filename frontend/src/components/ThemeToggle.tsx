import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const STORAGE_KEY = "talentflow-theme";

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}
function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  return applied === "dark" || applied === "light" ? applied : storedTheme() ?? systemTheme();
}

/** Light/dark switch. Follows the system until the user chooses; the choice is remembered when storage is available. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const follow = (event: MediaQueryListEvent) => {
      if (!storedTheme()) setTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener?.("change", follow);
    return () => query.removeEventListener?.("change", follow);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* Storage can be unavailable (private mode); the theme still applies for this session. */
        }
      }}
    >
      {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
