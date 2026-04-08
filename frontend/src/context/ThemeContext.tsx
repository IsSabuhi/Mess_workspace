import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const STORAGE_KEY = "mess-workspace-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(theme: Theme) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && getSystemDark());
  root.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const s = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return s === "light" || s === "dark" || s === "system" ? s : "system";
  });

  const resolved: "light" | "dark" =
    theme === "dark" || (theme === "system" && getSystemDark()) ? "dark" : "light";

  useLayoutEffect(() => {
    applyClass(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyClass("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState(resolved === "dark" ? "light" : "dark");
  }, [resolved]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
