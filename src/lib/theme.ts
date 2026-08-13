export type ThemeMode = "light" | "dark";

/** Read on the server so the first paint already uses the right theme. */
export const THEME_COOKIE = "ea-theme";

export function parseThemeMode(value: string | undefined): ThemeMode {
  return value === "dark" ? "dark" : "light";
}
