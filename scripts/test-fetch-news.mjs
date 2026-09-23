// Offline test for fetch-news.mjs: stubs global fetch with fixtures shaped like the real feeds,
// runs the script in a temp copy, and checks news.json. Run: node scripts/test-fetch-news.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.resolve(new URL('.', import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'news-test-'));
fs.mkdirSync(path.join(tmp, 'scripts'));
fs.mkdirSync(path.join(tmp, '.github'));
fs.copyFileSync(path.join(here, 'fetch-news.mjs'), path.join(tmp, 'scripts', 'fetch-news.mjs'));

const gql = {
  data: {
    posts: {
      results: [
        { id: 111, title: 'Announcing Grand Theft Auto VI: The Album, Coming November 19', url: '/newswire/article/7599a881942544/announcing-grand-theft-auto-vi-the-album-coming-november-19', created: '2026-09-17T14:00:00Z', primary_tags: [{ name: 'Grand Theft Auto VI' }], preview_images_parsed: { newswire_block: { d16x9: 'https://media-rockstargames-com.akamaized.net/x.jpg' } }, description: 'Thirty-four original songs.' },
        { id: 112, title: 'GTA+ Members Enjoy One Week of Early Access to the New Pegassi Horus', url: '/newswire/article/75935kk3574223/gta-members', created: '2026-09-18T14:00:00Z', primary_tags: [{ name: 'GTA Online' }] },
        { id: 113, title: 'Grand Theft Auto VI: An Extended Look — Now Playing', url: '/newswire/article/4k138k8okkk483/grand-theft-auto-vi-an-extended-look-now-playing', created: '2026-08-28T01:00:00Z', primary_tags: [{ name: 'Grand Theft Auto VI' }] }
      ]
    }
  }
};
const yt = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<title>Rockstar Games</title>
<entry><id>yt:video:tJbzMqJGH4k</id><yt:videoId>tJbzMqJGH4k</yt:videoId><title>Grand Theft Auto VI: An Extended Look</title><link rel="alternate" href="https://www.youtube.com/watch?v=tJbzMqJGH4k"/><published>2026-08-28T01:00:00+00:00</published><media:group><media:description>Watch now.
Second line</media:description><media:thumbnail url="https://i4.ytimg.com/vi/tJbzMqJGH4k/hqdefault.jpg" width="480" height="360"/></media:group></entry>
<entry><id>yt:video:abc123</id><yt:videoId>abc123</yt:videoId><title>GTA Online: Something &amp; Other</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/><published>2026-09-01T01:00:00+00:00</published><media:group><media:description>x</media:description></media:group></entry>
</feed>`;
const gn = `<?xml version="1.0"?><rss version="2.0"><channel><title>"GTA 6" - Google News</title>
<item><title>GTA 6 trailer 3 expected soon - TweakTown</title><link>https://news.google.com/rss/articles/CBMi1</link><guid isPermaLink="false">CBMi1</guid><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><description>&lt;a href="x"&gt;GTA 6 trailer 3 expected soon&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;TweakTown&lt;/font&gt;</description><source url="https://www.tweaktown.com">TweakTown</source></item>
<item><title>Rockstar shares GTA 6 update - IGN</title><link>https://news.google.com/rss/articles/CBMi2</link><guid isPermaLink="false">CBMi2</guid><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate><description>x</description><source url="https://www.ign.com">IGN</source></item>
</channel></rss>`;

const makeStub = (fx, gqlFail = false) => `
const fx = ${JSON.stringify(fx)};
const gqlFail = ${gqlFail};
globalThis.__calls = [];
globalThis.fetch = async (url, opts={}) => {
  url = String(url); globalThis.__calls.push(url);
  const T = (status, text) => ({ status, ok: status < 400, text: async () => text, json: async () => JSON.parse(text) });
  if (url.includes('graph.rockstargames.com')) {
    if (gqlFail) return T(403, 'nope');
    const v = JSON.parse(new URL(url).searchParams.get('variables'));
    return T(200, JSON.stringify(v.page > 1 ? { data: { posts: { results: [] } } } : fx.gql));
  }
  if (url.includes('youtube.com/feeds')) return T(200, fx.yt);
  if (url.includes('news.google.com')) return T(200, fx.gn);
  if (url.includes('reddit.com')) return T(403, 'blocked');
  if (url.includes('ntfy.sh')) { globalThis.__ntfy = (globalThis.__ntfy||[]).concat([[opts.headers.Title, opts.body]]); return T(200, '{}'); }
  return T(404, 'nope');
};
`;
fs.writeFileSync(path.join(tmp, 'stub.mjs'), makeStub({ gql, yt, gn }));
fs.writeFileSync(path.join(tmp, '.github', 'news-state.json'), JSON.stringify({ newswireQueryUrl: 'https://graph.rockstargames.com/?operationName=NewswireList&variables=%7B%22page%22%3A1%7D' }));

const run = (env = {}) => execFileSync(process.execPath, ['--import', path.join(tmp, 'stub.mjs'), path.join(tmp, 'scripts', 'fetch-news.mjs')], { cwd: tmp, env: { ...process.env, ...env }, encoding: 'utf8' });

// Run 1: first run, no news.json
let out = run({ NTFY_TOPIC: 'test-topic' });
let news = JSON.parse(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8'));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m, '\n', out); process.exit(1); } };
assert(news.official.length === 3, 'expected 3 official items (2 newswire + 1 video), got ' + news.official.length);
assert(news.official[0].id === 'nw-7599a881942544', 'newest official should be the album post');
assert(news.official.find((i) => i.type === 'video')?.videoId === 'tJbzMqJGH4k', 'video id parsed');
assert(!news.official.find((i) => /Pegassi/.test(i.title)), 'GTA Online post filtered out');
assert(news.press.length === 2 && news.press[0].title === 'GTA 6 trailer 3 expected soon' && news.press[0].source === 'TweakTown', 'google news parsed + title suffix stripped');
assert(news.sources.reddit.ok === false && news.community.length === 0, 'reddit dropped');
assert(!/ntfy 200/.test(out), 'no ntfy on first run');
assert(news.official[0].image?.includes('akamaized'), 'image captured');

// Run 2: nothing new → no rewrite, no ntfy
const before = fs.readFileSync(path.join(tmp, 'news.json'), 'utf8');
out = run({ NTFY_TOPIC: 'test-topic' });
assert(/No changes/.test(out), 'second run should not rewrite');
assert(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8') === before, 'news.json unchanged');

// Run 3: new video appears → rewrite + ntfy
const yt2 = yt.replace('<entry><id>yt:video:abc123</id>', '<entry><id>yt:video:NEW11111111</id><yt:videoId>NEW11111111</yt:videoId><title>Grand Theft Auto VI Trailer 3</title><link rel="alternate" href="https://www.youtube.com/watch?v=NEW11111111"/><published>2026-10-01T01:00:00+00:00</published><media:group><media:description>t3</media:description></media:group></entry><entry><id>yt:video:abc123</id>');
fs.writeFileSync(path.join(tmp, 'stub.mjs'), makeStub({ gql, yt: yt2, gn }));
out = run({ NTFY_TOPIC: 'test-topic' });
news = JSON.parse(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8'));
assert(news.official[0].videoId === 'NEW11111111', 'new trailer is first');
assert(/ntfy 200: Grand Theft Auto VI Trailer 3/.test(out), 'ntfy sent for new trailer');

// Run 4: GraphQL fast path breaks (403) and browser can't run here → newswire keeps last good, others still update
fs.writeFileSync(path.join(tmp, 'stub.mjs'), makeStub({ gql, yt: yt2, gn }, true));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","type":"commonjs"}'); // no playwright here → import fails
out = run({});
news = JSON.parse(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8'));
assert(news.sources.newswire.ok === false, 'newswire marked failed');
assert(news.official.filter((i) => i.type === 'newswire').length === 2, 'previous newswire posts kept');
assert(news.sources.youtube.ok === true, 'youtube still ok');

// Run 5: a Short that was saved earlier is purged once the feed marks it as a Short; same-title re-uploads collapse
const prevNews = JSON.parse(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8'));
prevNews.official.push({ id: 'yt-SHORT000001', type: 'video', videoId: 'SHORT000001', title: 'Grand Theft Auto VI: An Extended Look — Now Playing', url: 'x', date: '2026-08-28T01:01:30.000Z' });
fs.writeFileSync(path.join(tmp, 'news.json'), JSON.stringify(prevNews));
const yt3 = yt2.replace('</feed>', '<entry><id>yt:video:SHORT000001</id><yt:videoId>SHORT000001</yt:videoId><title>Grand Theft Auto VI: An Extended Look — Now Playing</title><link rel="alternate" href="https://www.youtube.com/shorts/SHORT000001"/><published>2026-08-28T01:01:30+00:00</published><media:group><media:description>#GTAVI</media:description></media:group></entry><entry><id>yt:video:DUPE0000001</id><yt:videoId>DUPE0000001</yt:videoId><title>Grand Theft Auto VI: An Extended Look</title><link rel="alternate" href="https://www.youtube.com/watch?v=DUPE0000001"/><published>2026-08-29T01:00:00+00:00</published><media:group><media:description>again</media:description></media:group></entry></feed>');
fs.writeFileSync(path.join(tmp, 'stub.mjs'), makeStub({ gql, yt: yt3, gn }));
out = run({ NTFY_TOPIC: 'test-topic' });
news = JSON.parse(fs.readFileSync(path.join(tmp, 'news.json'), 'utf8'));
assert(!news.official.some((i) => i.id === 'yt-SHORT000001'), 'short purged');
assert(!news.official.some((i) => i.id === 'yt-DUPE0000001'), 'later same-title re-upload collapsed');
assert(news.official.some((i) => i.id === 'yt-tJbzMqJGH4k'), 'original upload kept');
assert(!/ntfy 200: Grand Theft Auto VI: An Extended Look/.test(out), 'no push for short or duplicate');

console.log('fetch-news tests passed');
fs.rmSync(tmp, { recursive: true, force: true });
