#!/usr/bin/env node
/**
 * Sync `api/.env` → Vercel environment variables (production + preview).
 *
 * Why this exists: Vercel CLI has no `env push`, and the values that must go
 * up are not the raw local ones — local `.env` carries localhost URLs and a
 * dev-login bypass that must never reach production.
 *
 * Rules encoded here:
 *   - `ALLOW_DEV_LOGIN` is never pushed (it is the dev auth bypass).
 *   - AUTH_URL / NEXT_PUBLIC_APP_URL are rewritten to the current production
 *     origin; local `.env` holds localhost + a retired alias.
 *   - Credentials are stored as Vercel Secrets (`--sensitive`) so they are
 *     encrypted and never re-displayable.
 *   - Values go over stdin, never argv (keeps them out of shell history/`ps`).
 *
 * Usage: node scripts/push-vercel-env.mjs [--dry-run]
 * Requires: `npx vercel whoami` to be authenticated against the project.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PROD_ORIGIN = "https://gurusutra.vercel.app"

/** Strip one layer of matching surrounding quotes (dotenv-style quoting). */
function stripQuotes(v) {
  if (v.length >= 2) {
    const q = v[0]
    if ((q === '"' || q === "'") && v.endsWith(q)) return v.slice(1, -1)
  }
  return v
}

/** Parse api/.env: last assignment wins, `#` comments and quotes stripped. */
function parseEnv(file) {
  const out = new Map()
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const i = line.indexOf("=")
    if (i < 1) continue
    let v = line.slice(i + 1)
    const comment = v.search(/\s+#/)
    if (comment >= 0) v = v.slice(0, comment)
    // api/.env quotes DSNs (`DATABASE_URL="postgresql://…"`). Vercel stores
    // the value verbatim, and pg-connection-string then fails to parse the
    // quoted form (new URL → hostname 'base' → ENOTFOUND base at runtime).
    out.set(line.slice(0, i), stripQuotes(v.trim()))
  }
  return out
}

/** Key → replacement value. Anything listed here wins over local `.env`. */
const OVERRIDES = {
  AUTH_URL: PROD_ORIGIN,
  NEXT_PUBLIC_APP_URL: PROD_ORIGIN,
  REACT_APP_BACKEND_URL: "", // relative `/api` — the app is single-origin
}

/** Never push the dev-auth bypass to a deployed environment. */
const EXCLUDED = new Set(["ALLOW_DEV_LOGIN"])

/** Stored encrypted so the value cannot be re-displayed later. */
const SENSITIVE = new Set([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "AUTH_SECRET",
  "EMERGENT_LLM_KEY",
  "TAVILY_API_KEY",
  "DEEPSEEK_API_KEY",
])

const TARGETS = ["production", "preview"]

const local = parseEnv(join(ROOT, "api", ".env"))
const keys = [...new Set([...local.keys(), ...Object.keys(OVERRIDES)])]
  .filter((k) => !EXCLUDED.has(k))
  .sort()

const dryRun = process.argv.includes("--dry-run")
let failures = 0

for (const target of TARGETS) {
  for (const key of keys) {
    const value = Object.prototype.hasOwnProperty.call(OVERRIDES, key)
      ? OVERRIDES[key]
      : local.get(key)

    if (value === undefined) {
      console.log(`${key.padEnd(26)} ${target.padEnd(11)} SKIP (absent from api/.env)`)
      continue
    }

    // The CLI rejects an empty value (it falls back to prompting). An absent
    // var is what the frontend expects anyway — `lib/api.js` does
    // `process.env.REACT_APP_BACKEND_URL || ""`, so absent == same-origin.
    if (value === "") {
      console.log(`${key.padEnd(26)} ${target.padEnd(11)} SKIP (empty by design)`)
      continue
    }

    if (dryRun) {
      const note = Object.prototype.hasOwnProperty.call(OVERRIDES, key) ? " (override)" : ""
      console.log(`${key.padEnd(26)} ${target.padEnd(11)} DRY-RUN len=${value.length}${note}`)
      continue
    }

    const args = ["vercel", "env", "add", key, target, "--force", "--non-interactive"]
    if (SENSITIVE.has(key)) args.push("--sensitive")

    const res = spawnSync("npx", args, { input: value, encoding: "utf8" })
    if (res.status === 0) {
      console.log(`${key.padEnd(26)} ${target.padEnd(11)} OK${SENSITIVE.has(key) ? " (secret)" : ""}`)
    } else {
      failures++
      const detail = `${res.stderr || ""}${res.stdout || ""}`
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("npm warn"))
        .slice(-2)
        .join(" | ")
      console.log(`${key.padEnd(26)} ${target.padEnd(11)} FAIL: ${detail}`)
    }
  }
}

if (!dryRun && failures) {
  console.error(`\n${failures} push(es) failed.`)
  process.exit(1)
}
console.log(dryRun ? "\nDry run — nothing sent." : "\nDone.")
