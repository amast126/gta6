// Data loading and indexing for the encyclopedia.
// Content lives in /content/*.json; the news job writes /news.json.

const BASE = new URL('.', document.baseURI).href; // works at /gta6/ and at a local server root

async function getJSON(rel) {
  const res = await fetch(new URL(rel, BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  return res.json();
}

export async function loadContent() {
  const [sections, sources] = await Promise.all([getJSON('content/sections.json'), getJSON('content/sources.json')]);
  const files = await Promise.all(sections.map((s) => getJSON(`content/${s.file}`)));
  const entries = [];
  const timeline = [];
  const bySection = {};
  sections.forEach((s, i) => {
    const items = files[i];
    if (s.kind === 'timeline') {
      timeline.push(...items.map((t, n) => ({ ...t, id: t.id || `tl-${t.date}-${n}`, section: s.id })));
      bySection[s.id] = items;
    } else {
      const list = items.map((e) => ({ ...e, section: s.id }));
      bySection[s.id] = list;
      entries.push(...list);
    }
  });
  timeline.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  const backlinks = {};
  for (const e of entries) for (const l of e.links || []) (backlinks[l] ||= []).push(e.id);
  for (const t of timeline) for (const l of t.links || []) (backlinks[l] ||= []).push(t.id);
  return { sections, sources, entries, byId, bySection, timeline, backlinks };
}

export async function loadNews() {
  try {
    return await getJSON('news.json');
  } catch (e) {
    return { generated: null, sources: {}, official: [], press: [], community: [], error: String(e.message || e) };
  }
}

export function resolveSource(fact, sources) {
  if (fact.source) return fact.source;
  if (fact.src && sources[fact.src]) return sources[fact.src];
  return { label: 'Unsourced', url: null };
}

// ---- search --------------------------------------------------------------
function norm(s) {
  return (s || '').toLowerCase();
}

export function searchAll(q, content, news) {
  const query = norm(q).trim();
  if (!query || !content) return [];
  const terms = query.split(/\s+/).filter(Boolean);
  const hits = [];
  const score = (fields) => {
    let s = 0;
    for (const t of terms) {
      let found = false;
      fields.forEach(([txt, w]) => {
        const n = norm(txt);
        if (n.includes(t)) {
          found = true;
          s += w + (n.startsWith(t) ? 2 : 0);
        }
      });
      if (!found) return 0;
    }
    return s;
  };
  for (const e of content.entries) {
    const s = score([
      [e.name, 10],
      [e.subtitle, 5],
      [(e.tags || []).join(' '), 4],
      [e.summary, 2],
      [(e.facts || []).map((f) => f.text).join(' '), 1]
    ]);
    if (s) hits.push({ kind: 'entry', score: s, id: e.id, title: e.name, sub: e.subtitle, section: e.section, spoiler: e.spoiler });
  }
  for (const t of content.timeline) {
    const s = score([[t.title, 8], [t.text, 2], [t.date, 3]]);
    if (s) hits.push({ kind: 'timeline', score: s, id: t.id, title: t.title, sub: t.date, section: 'timeline' });
  }
  if (news) {
    for (const group of ['official', 'press', 'community']) {
      for (const n of news[group] || []) {
        const s = score([[n.title, 6], [n.summary, 1], [n.source, 2]]);
        if (s) hits.push({ kind: 'news', score: s, id: n.id, title: n.title, sub: `${group === 'official' ? 'Official' : group === 'press' ? 'Press' : 'Community'} · ${fmtDate(n.date)}`, url: n.url, group });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 60);
}

// ---- formatting ----------------------------------------------------------
export function fmtDate(iso, opts) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ---- localStorage helpers -------------------------------------------------
export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}
