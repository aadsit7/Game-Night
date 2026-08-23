import type { Metadata, Viewport } from "next";

import { PlacesProvider } from "@/lib/store/PlacesProvider";
import { TILE_ORIGIN } from "@/lib/maps/tileHost";

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
      <head>
        {/*
          Open the connection to the tile host while the app is still parsing.

          Nothing can be drawn until the style arrives, and the style cannot be
          asked for until a DNS lookup, a TCP handshake and a TLS handshake
          have all completed — three round trips that, on a phone's radio, are
          most of the wait before the first pixel of Earth. Starting them here
          overlaps all three with work the browser is doing anyway, so by the
          time the map asks, the connection is already open.

          `crossOrigin` matters: the tiles are fetched by CORS, and a warmed
          connection opened without it is a different connection pool.
        */}
        <link rel="preconnect" href={TILE_ORIGIN} crossOrigin="anonymous" />
        {/* For browsers that do not preconnect, at least resolve the name. */}
        <link rel="dns-prefetch" href={TILE_ORIGIN} />
      </head>
      <body className="antialiased">
        <PlacesProvider>{children}</PlacesProvider>
      </body>
    </html>
  );
}
