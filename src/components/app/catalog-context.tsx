"use client";

// The lobby catalog (real card and commander definitions) is built on the
// server, because the ruleset tables are server modules. It travels to the
// client through this provider instead of a second copy of the data.

import { createContext, useContext, type ReactNode } from "react";
import type { LobbyCatalog } from "./lobby-types";

const CatalogContext = createContext<LobbyCatalog | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: LobbyCatalog; children: ReactNode }) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useLobbyCatalog(): LobbyCatalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error("The lobby catalog is missing from the app shell.");
  return catalog;
}
