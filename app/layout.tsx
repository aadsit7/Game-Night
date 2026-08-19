import type { Metadata, Viewport } from "next";

import { PlacesProvider } from "@/lib/store/PlacesProvider";

import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Globe",
  description:
    "A personal, visual history of everywhere you’ve been — pinned to an interactive Earth.",
  applicationName: "Travel Globe",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Travel Globe",
    // Lets the globe run under the status bar, which is the whole point of a
    // full-bleed Earth on the Home Screen.
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, address: false, date: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays available for accessibility; inputs are 16px so iOS never
  // zooms on focus by itself.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PlacesProvider>{children}</PlacesProvider>
      </body>
    </html>
  );
}
