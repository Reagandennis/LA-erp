#!/usr/bin/env node
/**
 * Navigation performance budget for LA-ERP.
 *
 * Drives a headless Chromium through the sidebar like a user would and times
 * each navigation: "commit" (the URL changes, i.e. the route's shell is on
 * screen) and "content" (the loading skeleton has been replaced by the page).
 * Fails when a route's content time exceeds its budget, so a regression in a
 * list screen or the app shell is caught at commit time rather than by the team.
 *
 *   BASE_URL=http://127.0.0.1:3100 BENCH_EMAIL=... BENCH_PASSWORD=... \
 *     node scripts/perf-benchmark.mjs [--latency 170] [--runs 3] [--budget 1500]
 *
 * Needs `playwright` with Chromium (not a project dependency, to keep deploys
 * small): `npm i --no-save playwright@1.58.2 && npx playwright install chromium`.
 * Each route is navigated `--runs` times and the median is compared with the
 * budget; `--latency` adds a simulated round-trip (ms) so the numbers reflect a
 * Nairobi user talking to a European server rather than localhost.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const EMAIL = process.env.BENCH_EMAIL ?? process.env.BOOTSTRAP_ADMIN_EMAIL;
const PASSWORD = process.env.BENCH_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;
const LATENCY = Number(flag('latency', process.env.PERF_LATENCY_MS ?? 0));
const RUNS = Number(flag('runs', 3));
const DEFAULT_BUDGET = Number(flag('budget', process.env.PERF_BUDGET_MS ?? 1500));

/** Content-visible budgets in ms, measured with the latency above. */
const ROUTES = [
  { path: '/dashboard', budget: DEFAULT_BUDGET },
  { path: '/modules/trip-planning', budget: DEFAULT_BUDGET },
  { path: '/modules/quotes', budget: DEFAULT_BUDGET },
  { path: '/modules/travelers', budget: DEFAULT_BUDGET },
  { path: '/modules/personnel', budget: DEFAULT_BUDGET },
  { path: '/modules/vehicles', budget: DEFAULT_BUDGET },
  { path: '/modules/task-assignment', budget: DEFAULT_BUDGET },
  { path: '/modules/customers', budget: DEFAULT_BUDGET },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD (or BOOTSTRAP_ADMIN_*)');
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  const url = new URL(BASE_URL);
  return setCookie.map((line) => {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: url.hostname, path: '/' };
  });
}

async function main() {
  const { chromium } = require('playwright');
  const cookies = await login();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies(cookies);
  const page = await context.newPage();
  if (LATENCY > 0) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: LATENCY,
      downloadThroughput: 10e6 / 8,
      uploadThroughput: 5e6 / 8,
    });
  }

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'load' });
  await page.waitForSelector('a[href="/modules/trip-planning"]', { timeout: 60000 });

  const results = [];
  for (const route of ROUTES) {
    const commits = [];
    const contents = [];
    for (let run = 0; run < RUNS; run += 1) {
      // Leave and come back so every run is a real navigation, not a no-op.
      const away = route.path === '/dashboard' ? '/modules/clock' : '/dashboard';
      await page.locator(`a[href="${away}"]`).first().click();
      await page.waitForURL(`${BASE_URL}${away}`, { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('[data-route-loading]'), null, { timeout: 60000 });

      const started = Date.now();
      await page.locator(`a[href="${route.path}"]`).first().click();
      await page.waitForURL(`${BASE_URL}${route.path}`, { timeout: 120000 });
      commits.push(Date.now() - started);
      await page.waitForFunction(() => !document.querySelector('[data-route-loading]'), null, { timeout: 120000 });
      contents.push(Date.now() - started);
    }
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
    results.push({ ...route, commit: median(commits), content: median(contents), dom });
  }
  await browser.close();

  let failed = 0;
  console.log(`\nNavigation budget (latency +${LATENCY} ms, median of ${RUNS} runs)\n`);
  console.log('route'.padEnd(28), 'commit'.padStart(8), 'content'.padStart(8), 'budget'.padStart(8), 'dom'.padStart(7), '');
  for (const r of results) {
    const ok = r.content <= r.budget;
    if (!ok) failed += 1;
    console.log(
      r.path.padEnd(28),
      `${r.commit}ms`.padStart(8),
      `${r.content}ms`.padStart(8),
      `${r.budget}ms`.padStart(8),
      String(r.dom).padStart(7),
      ok ? ' ok' : ' OVER BUDGET',
    );
  }
  if (failed > 0) {
    console.error(`\n${failed} route(s) over budget.`);
    process.exit(1);
  }
  console.log('\nAll routes within budget.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
