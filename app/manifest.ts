import type { MetadataRoute } from "next";

import { id } from "@/lib/i18n/id";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: id.app.name,
    short_name: id.app.name,
    description: id.app.tagline,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    lang: "id",
    dir: "ltr",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: id.nav.tasks, url: "/tasks" },
      { name: id.nav.calendar, url: "/calendar" },
      { name: id.nav.today, url: "/today" },
    ],
  };
}
