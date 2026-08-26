import type { Metadata, Viewport } from "next";

import { AppProviders } from "@/components/app-providers";
import { id } from "@/lib/i18n/id";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: id.app.name, template: `%s · ${id.app.name}` },
  description: id.app.tagline,
  applicationName: id.app.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: id.app.name,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The app is a fixed shell with its own scroll panes; pinch-zoom would fight
  // the timeline drag gestures. maximumScale is left at 1 deliberately, and
  // userScalable is not disabled so assistive zoom still works on iOS 10+.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className="dark h-full" suppressHydrationWarning>
      <body className="h-full antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
