/**
 * Generates the PWA icon set from a single inline SVG source.
 * Run with `npm run icons`. Output is committed so builds need no image toolchain.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "icons");

const BG = "#0b0d10";
const ACCENT = "#7c9cff";

/** The mark: a focus ring with a single filled pomodoro dot at the top. */
function mark({ size, padding }) {
  const c = size / 2;
  const r = (size - padding * 2) / 2;
  const stroke = size * 0.075;
  const dot = size * 0.085;
  return `
    <circle cx="${c}" cy="${c}" r="${r}" fill="none"
            stroke="${ACCENT}" stroke-opacity="0.28" stroke-width="${stroke}" />
    <path d="M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c + r * Math.sin(Math.PI * 0.7)} ${c - r * Math.cos(Math.PI * 0.7)}"
          fill="none" stroke="${ACCENT}" stroke-width="${stroke}" stroke-linecap="round" />
    <circle cx="${c}" cy="${c - r}" r="${dot}" fill="${ACCENT}" />
    <rect x="${c - size * 0.015}" y="${c - r * 0.42}" width="${size * 0.03}" height="${r * 0.46}" rx="${size * 0.015}" fill="${ACCENT}" />
    <rect x="${c - size * 0.015}" y="${c - size * 0.015}" width="${r * 0.34}" height="${size * 0.03}" rx="${size * 0.015}" fill="${ACCENT}" fill-opacity="0.75" />
  `;
}

function svg({ size, maskable }) {
  // Maskable icons must keep the mark inside the 80% safe zone.
  const padding = maskable ? size * 0.235 : size * 0.16;
  const radius = maskable ? 0 : size * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}" />
    ${mark({ size, padding })}
  </svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-192.png", size: 192, maskable: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

await mkdir(OUT, { recursive: true });

for (const t of targets) {
  const buf = Buffer.from(svg(t));
  await sharp(buf).png({ compressionLevel: 9 }).toFile(path.join(OUT, t.file));
  console.log("wrote", t.file);
}

await writeFile(path.join(OUT, "icon.svg"), svg({ size: 512, maskable: false }));
console.log("wrote icon.svg");
