import { createStore } from "zustand/vanilla";

import { THEME_COOKIE, type ThemeMode } from "@/lib/theme";

export type UiState = {
  themeMode: ThemeMode;
  sidebarCollapsed: boolean;
};

export type UiActions = {
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

export type UiStore = UiState & UiActions;

const DEFAULT_STATE: UiState = {
  themeMode: "light",
  sidebarCollapsed: false,
};

/**
 * The theme is mirrored into a cookie so the server renders the same theme the
 * user last chose. Without it the first paint would always be light and then
 * flip after hydration.
 */
function rememberThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${oneYear}; samesite=lax`;
}

/**
 * A store factory rather than a module-level singleton: on the server a
 * singleton would be shared across requests and leak one user's state into
 * another's render.
 */
export function createUiStore(initialState: Partial<UiState> = {}) {
  return createStore<UiStore>()((set, get) => ({
    ...DEFAULT_STATE,
    ...initialState,

    setThemeMode: (themeMode) => {
      set({ themeMode });
      rememberThemeMode(themeMode);
    },

    toggleTheme: () => {
      get().setThemeMode(get().themeMode === "light" ? "dark" : "light");
    },

    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  }));
}

export type UiStoreApi = ReturnType<typeof createUiStore>;
