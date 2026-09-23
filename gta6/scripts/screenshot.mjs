// Loads the built site in headless Chromium at phone width, walks the main pages, reports console errors,
// and saves screenshots to the folder given as argv[2]. Run: ./build.sh && node scripts/screenshot.mjs out/
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.resolve(process.argv[2] || 'shots');
fs.mkdirSync(OUT, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/gta6' || p === '/gta6/') p = '/gta6/index.html';
  const file = path.join(ROOT, p.replace(/^\/gta6\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/gta6/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/youtube|ytimg/.test(m.location()?.url || '')) errors.push(m.text() + ' @ ' + (m.location()?.url || '')); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => { if (!/youtube|ytimg/.test(r.url())) errors.push('request failed: ' + r.url()); });

const routes = [
  ['home', '#/'],
  ['browse', '#/browse'],
  ['characters', '#/s/characters'],
  ['entry-jason', '#/e/jason-duval'],
  ['entry-story-spoiler', '#/e/prison-prologue'],
  ['timeline', '#/s/timeline'],
  ['news', '#/news'],
  ['search', '#/search?q=vice'],
  ['release', '#/e/platforms-and-date'],
  ['settings', '#/settings']
];
for (const [name, hash] of routes) {
  await page.goto(base + hash, { waitUntil: 'networkidle' });
  await page.waitForSelector('.main .page-title, .main .hero, .main .entry-title', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: name === 'home' || name === 'entry-jason' });
  console.log(`✓ ${name}`);
}
// interactions: spoiler gate, favorite, search typing
await page.goto(base + '#/e/prison-prologue', { waitUntil: 'networkidle' });
await page.click('text=Show spoiler');
await page.waitForSelector('.facts .fact');
await page.click('button[aria-label="Save"]');
await page.goto(base + '#/saved', { waitUntil: 'networkidle' });
const savedCount = await page.locator('.card').count();
console.log(`saved entries: ${savedCount}`);
await page.goto(base + '#/search', { waitUntil: 'networkidle' });
await page.fill('#search-input', 'boobie');
await page.waitForTimeout(200);
const results = await page.locator('.result').count();
console.log(`search results for "boobie": ${results}`);
const linkText = await page.locator('.result-title').first().innerText();
console.log(`first result: ${linkText}`);

// desktop width once
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(base + '#/', { waitUntil: 'networkidle' });
await desk.waitForSelector('.hero');
await desk.screenshot({ path: path.join(OUT, 'desktop-home.png') });
console.log('✓ desktop-home');

await browser.close();
server.close();
if (errors.length) {
  console.error('Console/page errors:\n - ' + errors.join('\n - '));
  process.exit(1);
}
console.log('No console errors.');
