import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppSession from "@/components/app/AppSession";
import { CatalogProvider } from "@/components/app/catalog-context";
import { georama, lilitaOne, satoshi } from "@/components/site/fonts";
import { buildLobbyCatalog } from "./catalog";
import "@/components/app/app.css";

export const metadata: Metadata = {
  title: "Chog Royale",
  description: "Chog Royale: your commander, your deck and the closed alpha battle.",
};

// Built once on the server from the live card and commander rulesets, then
// handed to the client lobby as plain data.
const catalog = buildLobbyCatalog();

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`app-root ${satoshi.variable} ${georama.variable} ${lilitaOne.variable} font-site`}>
      <AppSession>
        <CatalogProvider catalog={catalog}>{children}</CatalogProvider>
      </AppSession>
    </div>
  );
}
