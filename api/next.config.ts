import type { NextConfig } from "next"

/**
 * This Next app is the single deploy origin: the CRA bundle built by
 * `scripts/vercel-build.sh` lands in `public/`, and `/api/*` is served by the
 * route handlers under `app/api/`. Same origin means the app's `sameSite:
 * 'lax'` session/guest cookies stay first-party — a second Vercel project for
 * the UI would make them cross-site (vercel.app is on the public suffix list)
 * and break sign-in.
 *
 * SPA fallback: `frontend/src/App.js` only has two real routes, `/` and
 * `/settings`; everything else the app handles client-side with a `<Navigate
 * to="/">`. Next checks the filesystem first, so `/api/*` route handlers are
 * never shadowed by these rewrites — only paths that match no handler and no
 * file reach them.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // matching all API routes
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "http://localhost:3002" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ]
      }
    ]
  },
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      { source: "/settings", destination: "/index.html" },
    ]
  },
}

export default nextConfig
