/**
 * Builds news.json for the site. Runs in GitHub Actions every ~30 minutes (see .github/workflows/news.yml)
 * and can be run locally: node scripts/fetch-news.mjs
 *
 * Sources
 *  - Rockstar Newswire: no public feed any more. The page loads posts from graph.rockstargames.com with a
 *    "persisted query" hash. We reuse the last known-good query URL (fast path, plain fetch) and, when that
 *    fails, open the Newswire in headless Chromium (Playwright), capture the GraphQL responses and learn the
 *    new URL. Only GTA VI posts are kept.
 *  - Rockstar Games YouTube channel RSS (GTA VI videos only).
 *  - Google News RSS search for press coverage.
 *  - r/GTA6 RSS (optional; Reddit often blocks GitHub's IPs — dropped on failure).
 *
 * Failure policy: each source keeps its previous items if its fetch fails. news.json is only rewritten when
 * the item lists change (or every 12 h), so the repo isn't committed to every half hour.
 * ntfy: when NTFY_TOPIC is set, new official items (Newswire posts / videos) push to https://ntfy.sh/<topic>.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'news.json');
const STATE = path.join(ROOT, '.github', 'news-state.json');

const NEWSWIRE_URL = 'https://www.rockstargames.com/newswire';
const YT_CHANNEL_ID = 'UC6VcWc1rAoWdBCM0JxrRQ3A'; // Rockstar Games
const YT_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`;
const GNEWS_FEED = 'https://news.google.com/rss/search?q=%22GTA+6%22+OR+%22Grand+Theft+Auto+VI%22+OR+%22GTA+VI%22&hl=en-US&gl=US&ceid=US:en';
const REDDIT_FEED = 'https://www.reddit.com/r/GTA6/.rss';
const UA = 'Mozilla/5.0 (compatible; leonida-files-news/1.0; +https://amast126.github.io/gta6/)';

const GTA6_RE = /grand\s*theft\s*auto\s*vi\b|\bgta\s*vi\b|\bgta\s*6\b|\bgtavi\b|\bgta6\b|leonida|vice\s*city/i;
const MAX_KEEP = { official: 120, press: 60, community: 40 };
const NTFY_LIMIT = 5;

const nowISO = () => new Date().toISOString();
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- helpers
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function fetchText(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: ctl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(t);
  }
}
const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ');
const strip = (html = '') => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
};
const isoDate = (s) => {
  const d = new Date(s);
  return isNaN(d) ? nowISO() : d.toISOString();
};
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
function merge(prev = [], fresh = [], cap) {
  const map = new Map();
  for (const p of prev) map.set(p.id, p);
  for (const f of fresh) map.set(f.id, { ...(map.get(f.id) || {}), ...f });
  return [...map.values()].sort(byDateDesc).slice(0, cap);
}

// ---------------------------------------------------------------- Rockstar Newswire
function deepFindArticles(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return null;
  if (Array.isArray(obj) && obj.length >= 2) {
    const s = obj.find((x) => x && typeof x === 'object');
    if (s && typeof s.title === 'string' && (s.url || s.link || s.slug || s.uri)) return obj;
  }
  const keys = Object.keys(obj);
  const first = keys.filter((k) => /newswire|article|post|item|feed|result|node|content|data|list/i.test(k));
  const rest = keys.filter((k) => !first.includes(k));
  for (const k of [...first, ...rest]) {
    const f = deepFindArticles(obj[k], depth + 1);
    if (f) return f;
  }
  return null;
}
function normalizePost(a) {
  const raw = a.url || a.link || a.uri || a.slug || '';
  const url = raw.startsWith('http') ? raw : `https://www.rockstargames.com${raw.startsWith('/') ? '' : '/'}${raw}`;
  const image =
    a.preview_images_parsed?.newswire_block?.d16x9 || a.preview_images_parsed?.newswire_block?.square ||
    a.image?.social?.url || a.image?.default?.url || a.preview_image?.url || a.thumbnail?.url || a.heroImage?.url || null;
  const tags = []
    .concat(a.primary_tags || [], a.tags || [], a.categories || [])
    .map((t) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
    .filter(Boolean);
  // id comes from the article's URL segment (…/newswire/article/<id>/<slug>) so it stays stable across runs
  const m = url.match(/\/newswire\/article\/([^/]+)/);
  return {
    id: 'nw-' + (m ? m[1] : hash(url)),
    type: 'newswire',
    title: strip(a.title || a.headline || ''),
    url,
    date: isoDate(a.created || a.publishTime || a.publishedAt || a.published_at || a.date || a.updated),
    image,
    summary: strip(a.description || a.excerpt || a.short_description || a.summary || ''),
    tag: tags[0] || null,
    tags
  };
}
const isGta6Post = (p) => GTA6_RE.test(p.title) || GTA6_RE.test(p.url) || p.tags.some((t) => GTA6_RE.test(t));

function withPage(url, page) {
  try {
    const u = new URL(url);
    const v = JSON.parse(u.searchParams.get('variables') || '{}');
    v.page = page;
    u.searchParams.set('variables', JSON.stringify(v));
    return u.toString();
  } catch {
    return null;
  }
}
async function fetchNewswireFast(queryUrl, pages) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const u = p === 1 ? queryUrl : withPage(queryUrl, p);
    if (!u) break;
    const r = await fetchText(u, { headers: { Accept: 'application/json', Origin: 'https://www.rockstargames.com', Referer: NEWSWIRE_URL } });
    if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`);
    const data = JSON.parse(r.text);
    const raw = deepFindArticles(data);
    if (!raw) throw new Error('no article array in GraphQL response');
    all.push(...raw.map(normalizePost));
    if (raw.length < 10) break;
  }
  return all;
}
async function discoverNewswireWithBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const captured = []; // {url, data}
  try {
    const page = await browser.newPage({ userAgent: UA.replace('compatible; ', '') });
    page.on('response', async (res) => {
      const url = res.url();
      if (!url.includes('graph.rockstargames.com')) return;
      try {
        const data = await res.json();
        captured.push({ url, data });
      } catch {
        /* not JSON */
      }
    });
    await page.goto(NEWSWIRE_URL, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(6000);
    // nudge lazy loading
    await page.mouse.wheel(0, 2000).catch(() => {});
    await page.waitForTimeout(3000);
  } finally {
    await browser.close();
  }
  if (!captured.length) throw new Error('no graph.rockstargames.com responses captured');
  const ranked = [...captured.filter((c) => /newswire|article|post/i.test(c.url)), ...captured.filter((c) => !/newswire|article|post/i.test(c.url))];
  for (const c of ranked) {
    const raw = deepFindArticles(c.data);
    if (raw && raw.length) return { queryUrl: c.url, posts: raw.map(normalizePost) };
  }
  throw new Error(`captured ${captured.length} GraphQL responses but none looked like a post list`);
}
async function getNewswire(state, firstRun) {
  const pages = firstRun ? 5 : 2;
  let posts = null;
  let queryUrl = state.newswireQueryUrl || null;
  if (queryUrl) {
    try {
      posts = await fetchNewswireFast(queryUrl, pages);
      log(`Newswire fast path: ${posts.length} posts`);
    } catch (e) {
      log(`Newswire fast path failed: ${e.message}`);
      posts = null;
    }
  }
  if (!posts) {
    const found = await discoverNewswireWithBrowser();
    queryUrl = found.queryUrl;
    posts = found.posts;
    log(`Newswire browser discovery: ${posts.length} posts from ${queryUrl.slice(0, 80)}…`);
    try {
      const more = await fetchNewswireFast(queryUrl, pages);
      if (more.length > posts.length) posts = more;
    } catch {
      /* keep what the browser saw */
    }
  }
  const gta = posts.filter(isGta6Post).filter((p) => p.title && p.url);
  return { queryUrl, posts: gta, total: posts.length };
}

// ---------------------------------------------------------------- YouTube
async function getYouTube() {
  const r = await fetchText(YT_FEED);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const entries = r.text.split('<entry>').slice(1);
  const videos = entries.map((e) => {
    const videoId = tag(e, 'yt:videoId');
    return {
      id: 'yt-' + videoId,
      type: 'video',
      videoId,
      title: tag(e, 'title'),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      date: isoDate(tag(e, 'published')),
      image: attr(e, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      summary: tag(e, 'media:description').split('\n')[0].slice(0, 240)
    };
  });
  return { videos: videos.filter((v) => v.videoId && GTA6_RE.test(v.title)), total: videos.length };
}

// ---------------------------------------------------------------- Google News
async function getGoogleNews() {
  const r = await fetchText(GNEWS_FEED);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const items = r.text.split('<item>').slice(1).map((x) => {
    const source = tag(x, 'source');
    let title = tag(x, 'title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = tag(x, 'link') || tag(x, 'guid');
    const guid = tag(x, 'guid') || link;
    return {
      id: 'gn-' + hash(guid),
      title,
      url: link,
      date: isoDate(tag(x, 'pubDate')),
      source: source || 'Press',
      summary: strip(tag(x, 'description')).replace(/\s*View Full Coverage.*$/i, '').slice(0, 240)
    };
  });
  return items.filter((i) => i.title && i.url);
}

// ---------------------------------------------------------------- Reddit (optional)
async function getReddit() {
  const r = await fetchText(REDDIT_FEED, { headers: { Accept: 'application/atom+xml' } }, 15000);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const entries = r.text.split('<entry>').slice(1);
  return entries
    .map((e) => ({
      id: 'rd-' + hash(tag(e, 'id') || attr(e, 'link', 'href')),
      title: tag(e, 'title'),
      url: attr(e, 'link', 'href'),
      date: isoDate(tag(e, 'published') || tag(e, 'updated')),
      source: 'r/GTA6',
      summary: strip(tag(e, 'content')).slice(0, 200)
    }))
    .filter((i) => i.title && i.url);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

// ---------------------------------------------------------------- ntfy push
async function notify(items) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !items.length) return;
  for (const it of items.slice(0, NTFY_LIMIT)) {
    const isVideo = it.type === 'video';
    try {
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          Title: isVideo ? 'New Rockstar video' : 'New Rockstar Newswire post',
          Click: it.url,
          Tags: isVideo ? 'clapper' : 'newspaper',
          Priority: isVideo ? '4' : '3'
        },
        body: it.title
      });
      log(`ntfy ${res.status}: ${it.title}`);
    } catch (e) {
      log(`ntfy failed: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------- main
async function main() {
  const prev = readJSON(OUT, null);
  const firstRun = !prev;
  const state = readJSON(STATE, {});
  const out = {
    generated: prev?.generated || nowISO(),
    sources: { ...(prev?.sources || {}) },
    official: prev?.official || [],
    press: prev?.press || [],
    community: prev?.community || []
  };
  const checked = nowISO();
  let officialFresh = [];

  // Newswire
  try {
    const { queryUrl, posts, total } = await getNewswire(state, firstRun);
    state.newswireQueryUrl = queryUrl;
    officialFresh.push(...posts);
    out.sources.newswire = { ok: true, count: posts.length, scanned: total, checked };
  } catch (e) {
    log(`Newswire FAILED: ${e.message}`);
    out.sources.newswire = { ...(prev?.sources?.newswire || {}), ok: false, error: e.message.slice(0, 120), checked };
  }

  // YouTube
  try {
    const { videos, total } = await getYouTube();
    officialFresh.push(...videos);
    out.sources.youtube = { ok: true, count: videos.length, scanned: total, checked };
    log(`YouTube: ${videos.length} GTA VI videos of ${total}`);
  } catch (e) {
    log(`YouTube FAILED: ${e.message}`);
    out.sources.youtube = { ...(prev?.sources?.youtube || {}), ok: false, error: e.message.slice(0, 120), checked };
  }

  // Google News
  try {
    const items = await getGoogleNews();
    out.press = merge(out.press, items, MAX_KEEP.press);
    out.sources.googlenews = { ok: true, count: items.length, checked };
    log(`Google News: ${items.length} items`);
  } catch (e) {
    log(`Google News FAILED: ${e.message}`);
    out.sources.googlenews = { ...(prev?.sources?.googlenews || {}), ok: false, error: e.message.slice(0, 120), checked };
  }

  // Reddit (optional)
  try {
    const items = await getReddit();
    out.community = merge(out.community, items, MAX_KEEP.community);
    out.sources.reddit = { ok: true, count: items.length, checked };
    log(`Reddit: ${items.length} items`);
  } catch (e) {
    log(`Reddit unavailable: ${e.message}`);
    out.sources.reddit = { ok: false, error: e.message.slice(0, 120), checked };
    if (!prev?.sources?.reddit?.ok) out.community = [];
  }

  // Official merge + push
  const prevIds = new Set((prev?.official || []).map((i) => i.id));
  const newOfficial = officialFresh.filter((i) => !prevIds.has(i.id));
  out.official = merge(out.official, officialFresh, MAX_KEEP.official);
  if (!firstRun && newOfficial.length) {
    log(`New official items: ${newOfficial.map((i) => i.title).join(' | ')}`);
    await notify(newOfficial.sort(byDateDesc));
  }

  // Decide whether to write
  const itemsChanged = JSON.stringify([out.official, out.press, out.community]) !== JSON.stringify([prev?.official || [], prev?.press || [], prev?.community || []]);
  const stale = !prev?.generated || Date.now() - new Date(prev.generated).getTime() > 12 * 3600 * 1000;
  const okChanged = JSON.stringify(Object.fromEntries(Object.entries(out.sources).map(([k, v]) => [k, v.ok]))) !== JSON.stringify(Object.fromEntries(Object.entries(prev?.sources || {}).map(([k, v]) => [k, v.ok])));
  if (firstRun || itemsChanged || stale || okChanged) {
    out.generated = checked;
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    log(`Wrote news.json (${out.official.length} official, ${out.press.length} press, ${out.community.length} community)`);
  } else {
    log('No changes — news.json left untouched');
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
}

main().catch((e) => {
  console.error('fetch-news failed:', e);
  process.exitCode = 1; // last good news.json stays in place
});
