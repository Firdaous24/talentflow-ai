import { Moon, Sun } from "lucide-react";
import { setThemePreference, useTheme } from "../theme/theme";

/** Header light/dark switch. Follows the system until the user chooses. Labels can be translated. */
export function ThemeToggle({ labels }: { labels?: { dark: string; light: string } }) {
  const { theme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = labels ? labels[next] : `Switch to ${next} theme`;
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setThemePreference(next)}
    >
      {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
