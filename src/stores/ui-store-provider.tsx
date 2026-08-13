"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { createUiStore, type UiState, type UiStore, type UiStoreApi } from "./ui-store";

const UiStoreContext = createContext<UiStoreApi | null>(null);

export function UiStoreProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<UiState>;
}) {
  // Lazy initialiser rather than a module-level store: on the server a
  // singleton would be shared between requests.
  const [store] = useState(() => createUiStore(initialState));

  return <UiStoreContext value={store}>{children}</UiStoreContext>;
}

export function useUiStore<T>(selector: (store: UiStore) => T): T {
  const store = useContext(UiStoreContext);

  if (store === null) {
    throw new Error("useUiStore must be used inside <UiStoreProvider>");
  }

  return useStore(store, selector);
}
