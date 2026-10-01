#!/bin/sh
# Vercel build for the `api/` project (Vercel Root Directory = `api`).
#
# Two deploy paths, one script:
#
#  1. Git-push deploy — Vercel clones the repo. `api/public/` is gitignored, so
#     the CRA bundle has to be built here. That needs the project setting
#     "Include source files outside of the Root Directory in the Build Step"
#     enabled, otherwise ../frontend isn't on disk.
#  2. CLI deploy (`cd api && vercel deploy`) — only `api/` is uploaded, so
#     ../frontend is never present. The bundle must already sit in `public/`
#     (see root `pnpm build`, which copies frontend/build there).
#
# In both cases the CRA output lands in `public/`, which Next.js serves
# statically — same origin as the API, so cookies stay first-party.
set -e

if [ -d ../frontend ]; then
  echo "[vercel-build] ../frontend found -> building CRA bundle with yarn"
  # Vercel exports NODE_ENV=production, and yarn classic then skips
  # devDependencies — which is where `@craco/craco` lives (the build script
  # invokes craco directly). Force a full install, or the build dies with
  # "Cannot find module @craco/craco/dist/scripts/build.js".
  ( cd ../frontend && NODE_ENV=development yarn install --frozen-lockfile --non-interactive && yarn build )
  echo "[vercel-build] copying frontend/build -> api/public"
  rm -rf public.tmp && cp -R ../frontend/build public.tmp
  rm -rf public && mv public.tmp public && touch public/.gitkeep
else
  echo "[vercel-build] ../frontend not present -> reusing the pre-built public/"
  if [ ! -f public/index.html ]; then
    echo "[vercel-build] ERROR: public/index.html is missing." >&2
    echo "[vercel-build] Either enable 'Include source files outside of the Root" >&2
    echo "[vercel-build] Directory in the Build Step' (git deploys), or run the" >&2
    echo "[vercel-build] root 'pnpm build' before deploying from the CLI." >&2
    exit 1
  fi
fi

echo "[vercel-build] next build"
next build
