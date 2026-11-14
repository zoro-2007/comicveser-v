import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Automatically remove any leftover App Router icon files in src/app/ that conflict with public/ icons
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.join(__dirname, "src", "app");
  for (const f of ["favicon.ico", "icon.svg", "icon.png", "apple-icon.png"]) {
    const p = path.join(appDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
} catch {}

function normalizeApiTarget(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const u = new URL(trimmed);
    if (u.pathname === "" || u.pathname === "/") {
      u.pathname = "/api";
    }
    return u.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy-Report-Only",
    value: "default-src 'self'; img-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: http://localhost:4000 https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com; frame-src https://accounts.google.com https://www.google.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  trailingSlash: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    const rawTarget =
      process.env.API_INTERNAL_URL ||
      process.env.BACKEND_URL ||
      process.env.API_URL ||
      (/^https?:\/\//i.test(process.env.NEXT_PUBLIC_API_URL || "") ? process.env.NEXT_PUBLIC_API_URL : "");
    const target = normalizeApiTarget(rawTarget);
    return target ? [{ source: "/api/:path*", destination: `${target}/:path*` }] : [];
  },
};

export default nextConfig;
