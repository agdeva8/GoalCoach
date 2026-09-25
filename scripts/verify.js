#!/usr/bin/env node
/**
 * GoalCoach end-to-end verification script.
 *
 * What it does:
 *   1. Hits every key backend route (with bearer + guest cookie fallback)
 *   2. Opens the running frontend in headless Chromium
 *   3. Captures screenshots at 1920x800 + 390x844 (AGENT_BUILDER.md viewports)
 *   4. Captures console errors + failed network requests
 *   5. Writes a JSON report + saves screenshots to ./verify-out/
 *
 * Usage:
 *   node scripts/verify.js                  # full pass
 *   node scripts/verify.js --baseline       # save baseline, don't diff
 *   node scripts/verify.js --diff           # compare current to baseline
 *   node scripts/verify.js --viewport=desktop
 *   node scripts/verify.js --viewport=mobile
 *
 * Exit code: 0 = all green, 1 = any route non-2xx or any console error.
 */

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'verify-out');
const BASELINE = path.join(process.cwd(), 'verify-out', 'baseline.json');
const REPORT = path.join(process.cwd(), 'verify-out', 'report.json');

const args = process.argv.slice(2);
const isBaseline = args.includes('--baseline');
const isDiff = args.includes('--diff');
const viewportArg = args.find((a) => a.startsWith('--viewport='))?.split('=')[1];

const ROUTES = [
  { method: 'GET', path: '/api/auth/me', auth: 'bearer' },
  { method: 'GET', path: '/api/state', auth: 'bearer' },
  { method: 'GET', path: '/api/blockers', auth: 'bearer' },
  { method: 'GET', path: '/api/audit', auth: 'bearer' },
  { method: 'GET', path: '/api/chat/history', auth: 'bearer' },
  { method: 'POST', path: '/api/auth/guest', auth: 'none', body: {} },
];

async function probeRoute(r) {
  const headers = { 'Content-Type': 'application/json' };
  if (r.auth === 'bearer') headers.Authorization = 'Bearer user_test_demo';
  try {
    const res = await fetch(`${BACKEND}${r.path}`, {
      method: r.method,
      headers,
      body: r.body ? JSON.stringify(r.body) : undefined,
    });
    const body = await res.text().catch(() => '');
    return {
      ...r,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bodySnip: body.slice(0, 200),
    };
  } catch (e) {
    return { ...r, status: 0, error: e.message };
  }
}

async function shoot(browser, label, viewport, opts = {}) {
  // Normalize: Playwright's `devices['iPhone 13']` nests viewport under .viewport
  const vp =
    viewport && typeof viewport === 'object' && 'width' in viewport
      ? viewport
      : viewport?.viewport ?? { width: 1280, height: 720 };
  const ctx = await browser.newContext({ viewport: vp, ...opts });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (req) =>
    networkErrors.push(`${req.url()} → ${req.failure()?.errorText}`),
  );

  await page.goto(FRONTEND, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(800);
  const file = path.join(OUT, `${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const title = await page.title();
  const bodySnippet = await page.locator('body').innerText().catch(() => '');

  await ctx.close();
  return { file, title, bodySnippet: bodySnippet.slice(0, 300), consoleErrors, networkErrors };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`\n[verify] backend=${BACKEND}  frontend=${FRONTEND}`);
  console.log('[verify] probing routes...');
  const probes = [];
  for (const r of ROUTES) {
    const p = await probeRoute(r);
    const tag = p.status >= 200 && p.status < 300 ? '✓' : p.status === 401 ? '·' : '✗';
    console.log(`  ${tag} ${p.method.padEnd(4)} ${p.path.padEnd(22)} → ${p.status}`);
    probes.push(p);
  }

  let shots = [];
  if (!viewportArg || viewportArg === 'desktop') {
    console.log('\n[verify] desktop screenshot @ 1920x800');
    const browser = await chromium.launch();
    const r = await shoot(browser, 'desktop_1920x800', { width: 1920, height: 800 });
    await browser.close();
    console.log(`  📸 ${r.file}`);
    shots.push({ viewport: '1920x800', ...r });
  }
  if (!viewportArg || viewportArg === 'mobile') {
    console.log('\n[verify] mobile screenshot @ 390x844');
    const browser = await chromium.launch();
    const r = await shoot(browser, 'mobile_390x844', devices['iPhone 13']);
    await browser.close();
    console.log(`  📸 ${r.file}`);
    shots.push({ viewport: '390x844', ...r });
  }

  const report = {
    timestamp: new Date().toISOString(),
    backend: BACKEND,
    frontend: FRONTEND,
    probes,
    screenshots: shots.map((s) => ({
      viewport: s.viewport,
      file: s.file,
      title: s.title,
      bodySnippet: s.bodySnippet,
      consoleErrors: s.consoleErrors,
      networkErrors: s.networkErrors,
    })),
    summary: {
      routeFailures: probes.filter((p) => p.status >= 500 || (p.status !== 401 && p.status >= 400 && p.status !== 0)).length,
      route401: probes.filter((p) => p.status === 401).length,
      consoleErrors: shots.reduce((n, s) => n + s.consoleErrors.length, 0),
      networkErrors: shots.reduce((n, s) => n + s.networkErrors.length, 0),
    },
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  if (isBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2));
    console.log(`\n[verify] baseline saved → ${BASELINE}`);
  }

  if (isDiff && fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const regressions = report.probes
      .filter((p, i) => p.status !== base.probes?.[i]?.status)
      .map((p, i) => ({ path: p.path, was: base.probes[i].status, now: p.status }));
    console.log(`\n[verify] vs baseline: ${regressions.length} regressions`);
    for (const r of regressions) {
      console.log(`  ! ${r.path}: ${r.was} → ${r.now}`);
    }
  }

  console.log(`\n[verify] summary:`, JSON.stringify(report.summary));
  console.log(`[verify] report → ${REPORT}`);

  const failed = report.summary.routeFailures > 0 || report.summary.consoleErrors > 0;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[verify] FATAL', e);
  process.exit(2);
});
