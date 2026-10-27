/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Production Docker image (Phase 8A) ──────────────────────────────────────
  // 'standalone' copies only the files Next.js actually uses into
  // .next/standalone/, including a self-contained server.js.
  // This makes the Docker image significantly smaller (~200 MB instead of ~1 GB)
  // because it excludes the full node_modules from the final image layer.
  //
  // At runtime, start with:  node .next/standalone/server.js
  // Static assets (CSS, JS chunks, images) are served from .next/static/
  // which must be copied alongside standalone (see dashboard Dockerfile COPY step).
  output: 'standalone',
};

module.exports = nextConfig;
