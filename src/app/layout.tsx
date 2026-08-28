import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";

import { AppProviders } from "@/components/providers/app-providers";
import { parseThemeMode, THEME_COOKIE } from "@/lib/theme";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Brand first — "Halum · Reports" — so the name survives however narrow
  // the browser tab gets. Pages contribute only their own name.
  title: {
    template: "Halum · %s",
    default: "Halum",
  },
  description: "VAT and invoicing reports for multi-channel e-commerce sellers",
  icons: {
    // Two flattened PNGs rather than the file-convention icon.png: a
    // favicon can't pick up a CSS filter the way the sidebar mark does, so
    // the contrast has to be baked into the pixels themselves. `media`
    // maps straight to a <link media="..."> the browser evaluates against
    // the OS scheme, same as it would a stylesheet. The unconditional
    // entry is the fallback for a browser that ignores `media` on icons.
    icon: [
      { url: "/icon-light.png", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark.png", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: "/icon-light.png", type: "image/png" },
    ],
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const themeMode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppProviders initialThemeMode={themeMode}>{children}</AppProviders>
      </body>
    </html>
  );
}
