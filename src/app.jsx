import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import css from './styles.css';
import { loadContent, loadNews, resolveSource, searchAll, fmtDate, timeAgo, lsGet, lsSet } from './data.js';

// ---- constants -------------------------------------------------------------
const LAUNCH = new Date(2026, 10, 19, 0, 0, 0); // Nov 19, 2026, local midnight
const PRELOAD = new Date(2026, 10, 12, 0, 0, 0); // Nov 12, 2026
const SITE_NAME = 'Leonida Files';
const STATUS_LABEL = { official: 'Official', reported: 'Reported', rumor: 'Rumor / Leak' };

// inject styles once (bundled as text so app.js is the only versioned file)
if (!document.getElementById('app-css')) {
  const s = document.createElement('style');
  s.id = 'app-css';
  s.textContent = css;
  document.head.appendChild(s);
}

// ---- tiny hash router ------------------------------------------------------
function parseHash() {
  const h = (location.hash || '#/').replace(/^#/, '');
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { parts, query, path: pathPart };
}
function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
const href = (p) => `#${p}`;

// ---- persisted state ---------------------------------------------------------
function usePersisted(key, initial) {
  const [v, setV] = useState(() => lsGet(key, initial));
  const set = useCallback(
    (next) => {
      setV((prev) => {
        const val = typeof next === 'function' ? next(prev) : next;
        lsSet(key, val);
        return val;
      });
    },
    [key]
  );
  return [v, set];
}

// ---- shared components ---------------------------------------------------------
function Badge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

function Icon({ name }) {
  const paths = {
    home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    browse: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v7H4zM13 14h7v7h-7z',
    news: 'M4 5h16v14H4zM7 9h6M7 12h10M7 15h10',
    search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8',
    saved: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z',
    gear: 'M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4'
  };
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="bm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a0f5e" /><stop offset="1" stopColor="#7a1f6b" /></linearGradient>
        <linearGradient id="bm-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd166" /><stop offset="1" stopColor="#ff3fa4" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#bm-sky)" />
      <circle cx="32" cy="34" r="17" fill="url(#bm-sun)" />
      <rect x="10" y="36" width="44" height="2.5" fill="#2a0f5e" />
      <rect x="10" y="42" width="44" height="3" fill="#2a0f5e" />
      <rect x="10" y="49" width="44" height="3.5" fill="#2a0f5e" />
      <rect x="0" y="52" width="64" height="12" fill="#12082a" />
    </svg>
  );
}

function YouTube({ id, title, autoplayOnTap = true }) {
  const [play, setPlay] = useState(false);
  if (!id) return null;
  return (
    <div className="video">
      {play ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
          title={title || 'YouTube video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <button className="video-facade" onClick={() => setPlay(true)} aria-label={`Play ${title || 'video'}`}>
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="video-play">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
    </div>
  );
}

function Countdown({ target, compact }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (compact) return diff === 0 ? 'Out now' : `${d}d ${h}h`;
  if (diff === 0) return <div className="hero-foot">It's out. Go play.</div>;
  const Cell = ({ n, l }) => (
    <div className="cd-cell">
      <div className="cd-num">{String(n).padStart(2, '0')}</div>
      <div className="cd-lbl">{l}</div>
    </div>
  );
  return (
    <div className="countdown">
      <Cell n={d} l="days" /><Cell n={h} l="hours" /><Cell n={m} l="min" /><Cell n={s} l="sec" />
    </div>
  );
}

// ---- pages ---------------------------------------------------------------------
function Home({ content, news, read, markRead }) {
  const officialVideos = (news.official || []).filter((n) => n.type === 'video' && n.videoId);
  const newestVideo = officialVideos[0] || null;
  const fallbackVideo = useMemo(() => {
    const vids = (content.bySection.media || []).filter((e) => e.video);
    vids.sort((a, b) => (a.date < b.date ? 1 : -1));
    return vids[0] ? { videoId: vids[0].video, title: vids[0].name, date: vids[0].date, url: `#/e/${vids[0].id}` } : null;
  }, [content]);
  const video = newestVideo || fallbackVideo;
  const official = (news.official || []).slice(0, 5);
  const press = (news.press || []).slice(0, 4);
  const preloadSoon = Date.now() < PRELOAD;

  return (
    <div>
      <div className="hero">
        <div className="hero-kicker">Countdown to launch</div>
        <div className="hero-title">Grand Theft Auto VI</div>
        <div className="hero-date">Thursday, November 19, 2026 · PS5 and Xbox Series X|S</div>
        <Countdown target={LAUNCH} />
        <div className="hero-foot">
          {preloadSoon ? <>Pre-load and physical copies from Nov 12 · </> : null}
          <a href={href('/e/platforms-and-date')} style={{ color: '#fff', textDecoration: 'underline' }}>Release details</a>
        </div>
      </div>

      {video ? (
        <>
          <div className="section-h"><h2>Newest video</h2><a href={href('/s/media')}>All trailers →</a></div>
          <YouTube id={video.videoId} title={video.title} />
          <div className="video-cap">{video.title}{video.date ? ` · ${fmtDate(video.date)}` : ''}</div>
        </>
      ) : null}

      <div className="section-h"><h2>Latest from Rockstar</h2><a href={href('/news')}>Feed →</a></div>
      {official.length ? official.map((n) => <NewsItem key={n.id} item={n} read={read} markRead={markRead} />) : <FeedEmpty news={news} />}

      {press.length ? (
        <>
          <div className="section-h"><h2>Press</h2><a href={href('/news?tab=press')}>More →</a></div>
          {press.map((n) => <NewsItem key={n.id} item={n} read={read} markRead={markRead} compact />)}
        </>
      ) : null}

      <div className="section-h"><h2>Encyclopedia</h2><a href={href('/browse')}>Browse →</a></div>
      <SectionGrid content={content} />
    </div>
  );
}

function FeedEmpty({ news }) {
  return (
    <div className="empty">
      {news.error ? <>news.json hasn't been generated yet. Once the GitHub Action runs, Rockstar posts and videos appear here.</> : <>Nothing yet.</>}
    </div>
  );
}

function NewsItem({ item, read, markRead, compact }) {
  const isRead = read.includes(item.id);
  const isVideo = item.type === 'video';
  return (
    <a className={`news-item ${isRead ? 'read' : ''}`} href={item.url} target="_blank" rel="noopener" onClick={() => markRead(item.id)}>
      <div className="row">
        {!compact && item.image ? <img className="news-thumb" src={item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            {!isRead ? <span className="dot-new" /> : null}
            <div className="news-title">{item.title}</div>
          </div>
          <div className="news-meta">
            <span className={`badge ${item.group === 'press' || item.group === 'community' ? 'badge-outline' : 'badge-official'}`}>
              {isVideo ? 'YouTube' : item.group === 'press' ? item.source || 'Press' : item.group === 'community' ? 'r/GTA6' : 'Newswire'}
            </span>
            <span>{fmtDate(item.date)}</span>
            {item.tag ? <span>· {item.tag}</span> : null}
          </div>
          {!compact && item.summary ? <div className="news-sum">{item.summary}</div> : null}
        </div>
      </div>
    </a>
  );
}

function SectionGrid({ content }) {
  return (
    <div className="grid-sections">
      {content.sections.map((s) => (
        <a key={s.id} className="sec-card" href={href(`/s/${s.id}`)}>
          <div className="sec-icon">{s.icon}</div>
          <div className="sec-title">{s.title}</div>
          <div className="sec-blurb">{s.blurb}</div>
          <div className="sec-count">{content.bySection[s.id]?.length || 0} entries</div>
        </a>
      ))}
    </div>
  );
}

function Browse({ content }) {
  return (
    <div>
      <h1 className="page-title">Encyclopedia</h1>
      <p className="page-blurb">{content.entries.length} entries, every fact tagged with its source.</p>
      <SectionGrid content={content} />
      <div className="legend">
        <Badge status="official" /> from Rockstar or Take-Two
        <Badge status="reported" /> from press
        <Badge status="rumor" /> unconfirmed
      </div>
    </div>
  );
}

function SectionPage({ content, sectionId, spoilers }) {
  const section = content.sections.find((s) => s.id === sectionId);
  const [tag, setTag] = useState('');
  if (!section) return <NotFound />;
  if (section.kind === 'timeline') return <Timeline content={content} section={section} />;
  const items = content.bySection[sectionId] || [];
  const tags = [...new Set(items.flatMap((e) => e.tags || []))];
  const shown = tag ? items.filter((e) => (e.tags || []).includes(tag)) : items;
  return (
    <div>
      <div className="crumbs"><a href={href('/browse')}>Encyclopedia</a> › {section.title}</div>
      <h1 className="page-title">{section.icon} {section.title}</h1>
      <p className="page-blurb">{section.blurb}</p>
      {tags.length > 1 ? (
        <div className="tabs">
          <button className={`tab ${!tag ? 'active' : ''}`} onClick={() => setTag('')}>All</button>
          {tags.map((t) => <button key={t} className={`tab ${tag === t ? 'active' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
        </div>
      ) : null}
      {shown.map((e) => <EntryCard key={e.id} entry={e} spoilers={spoilers} />)}
      {!shown.length ? <div className="empty">No entries yet.</div> : null}
    </div>
  );
}

function EntryCard({ entry, spoilers, sectionLabel }) {
  const hide = entry.spoiler && !spoilers;
  const statuses = new Set((entry.facts || []).map((f) => f.status));
  return (
    <a className="card card-link" href={href(`/e/${entry.id}`)}>
      <div className="row">
        <div className="grow">
          <div className="card-title">{entry.name}</div>
          {entry.subtitle ? <div className="card-sub">{sectionLabel ? `${sectionLabel} · ` : ''}{entry.subtitle}</div> : null}
        </div>
        {entry.spoiler ? <span className="badge badge-rumor" style={{ background: 'var(--surface-2)', color: 'var(--rumor)' }}>Spoiler</span> : null}
      </div>
      <div className="card-text">{hide ? 'Spoiler-tagged entry. Tap to open, then reveal.' : entry.summary}</div>
      <div className="card-meta">
        {['official', 'reported', 'rumor'].filter((s) => statuses.has(s)).map((s) => <Badge key={s} status={s} />)}
        <span>{(entry.facts || []).length} facts</span>
      </div>
    </a>
  );
}

function Fact({ fact, sources, spoilers }) {
  const [revealed, setRevealed] = useState(false);
  const src = resolveSource(fact, sources);
  const blurred = fact.spoiler && !spoilers && !revealed;
  return (
    <li className="fact">
      <div className={`fact-text ${fact.spoiler ? 'spoiler-fact' : ''} ${blurred ? '' : 'revealed'}`} onClick={() => blurred && setRevealed(true)} title={blurred ? 'Tap to reveal spoiler' : undefined}>
        {fact.text}
      </div>
      <div className="fact-src">
        <Badge status={fact.status} />
        {src.url ? <a href={src.url} target="_blank" rel="noopener">{src.label}</a> : <span>{src.label}</span>}
        {src.date ? <span>· {fmtDate(src.date)}</span> : null}
      </div>
    </li>
  );
}

function EntryPage({ content, id, spoilers, favs, toggleFav }) {
  const entry = content.byId[id];
  const [open, setOpen] = useState(false);
  if (!entry) return <NotFound />;
  const section = content.sections.find((s) => s.id === entry.section);
  const gate = entry.spoiler && !spoilers && !open;
  const links = (entry.links || []).map((l) => content.byId[l]).filter(Boolean);
  const back = (content.backlinks[entry.id] || []).filter((b) => !(entry.links || []).includes(b));
  const backEntries = back.map((b) => content.byId[b] || content.timeline.find((t) => t.id === b)).filter(Boolean);
  const isFav = favs.includes(entry.id);
  return (
    <div>
      <div className="crumbs"><a href={href('/browse')}>Encyclopedia</a> › <a href={href(`/s/${section.id}`)}>{section.title}</a></div>
      <div className="entry-head">
        <div className="grow">
          <h1 className="entry-title">{entry.name}</h1>
          {entry.subtitle ? <div className="entry-sub">{entry.subtitle}</div> : null}
        </div>
        <button className={`btn btn-icon ${isFav ? 'on' : ''}`} onClick={() => toggleFav(entry.id)} aria-label={isFav ? 'Remove from saved' : 'Save'} title="Save">
          <Icon name="saved" />
        </button>
      </div>
      {gate ? (
        <div className="spoiler-gate">
          <p>This entry is spoiler-tagged.</p>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>Show spoiler</button>
        </div>
      ) : (
        <>
          {entry.video ? <YouTube id={entry.video} title={entry.name} /> : null}
          <p className="entry-summary">{entry.summary}</p>
          {entry.tags?.length ? <div className="chips" style={{ marginBottom: 10 }}>{entry.tags.map((t) => <span key={t} className="pill">{t}</span>)}</div> : null}
          <ul className="facts">
            {(entry.facts || []).map((f, i) => <Fact key={i} fact={f} sources={content.sources} spoilers={spoilers || open} />)}
          </ul>
        </>
      )}
      {links.length ? (
        <>
          <div className="section-h"><h2>Related</h2></div>
          <div className="chips">
            {links.map((l) => {
              const s = content.sections.find((x) => x.id === l.section);
              return <a key={l.id} className="chip" href={href(`/e/${l.id}`)}><span className="chip-icon">{s?.icon}</span>{l.name}</a>;
            })}
          </div>
        </>
      ) : null}
      {backEntries.length ? (
        <>
          <div className="section-h"><h2>Linked from</h2></div>
          <div className="chips">
            {backEntries.map((l) =>
              l.section === 'timeline' ? (
                <a key={l.id} className="chip" href={href('/s/timeline')}><span className="chip-icon">🗓️</span>{l.title}</a>
              ) : (
                <a key={l.id} className="chip" href={href(`/e/${l.id}`)}><span className="chip-icon">{content.sections.find((x) => x.id === l.section)?.icon}</span>{l.name}</a>
              )
            )}
          </div>
        </>
      ) : null}
      {entry.updated ? <div className="footer-note">Entry updated {fmtDate(entry.updated)}</div> : null}
    </div>
  );
}

function Timeline({ content, section }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="crumbs"><a href={href('/browse')}>Encyclopedia</a> › {section.title}</div>
      <h1 className="page-title">{section.icon} {section.title}</h1>
      <p className="page-blurb">{section.blurb} — newest first.</p>
      <ul className="tl">
        {content.timeline.map((t) => {
          const src = resolveSource(t, content.sources);
          return (
            <li key={t.id} className={`tl-item ${t.date > today ? 'future' : ''}`}>
              <div className="tl-date">{fmtDate(t.date, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div className="tl-title">{t.title}</div>
              <div className="tl-text">{t.text}</div>
              <div className="fact-src">
                <Badge status={t.status} />
                {src.url ? <a href={src.url} target="_blank" rel="noopener">{src.label}</a> : null}
              </div>
              {t.links?.length ? (
                <div className="chips" style={{ marginTop: 8 }}>
                  {t.links.map((l) => content.byId[l]).filter(Boolean).map((l) => <a key={l.id} className="chip" href={href(`/e/${l.id}`)}>{l.name}</a>)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Feed({ news, tab, read, markRead }) {
  const tabs = [['official', 'Official'], ['press', 'Press']];
  if (news.community?.length) tabs.push(['community', 'Community']);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'official';
  const items = news[cur] || [];
  const st = news.sources || {};
  const line = (k, label) => {
    const s = st[k];
    if (!s) return null;
    return (
      <div>
        <b>{label}:</b> {s.ok ? `ok · ${s.count} item${s.count === 1 ? '' : 's'}` : `unavailable${s.error ? ` (${s.error})` : ''}`}
        {s.checked ? ` · checked ${timeAgo(s.checked)}` : ''}
      </div>
    );
  };
  return (
    <div>
      <h1 className="page-title">News feed</h1>
      <p className="page-blurb">Official posts and videos from Rockstar, press coverage separately. Refreshes about every 30 minutes.</p>
      <div className="tabs">
        {tabs.map(([k, l]) => <a key={k} className={`tab ${cur === k ? 'active' : ''}`} href={href(`/news?tab=${k}`)}>{l}</a>)}
      </div>
      {items.length ? items.map((n) => <NewsItem key={n.id} item={n} read={read} markRead={markRead} />) : <FeedEmpty news={news} />}
      <div className="feed-status">
        {news.note ? <div>{news.note}</div> : null}
        {news.generated ? <div><b>Feed generated:</b> {fmtDate(news.generated, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ({timeAgo(news.generated)})</div> : null}
        {line('newswire', 'Rockstar Newswire')}
        {line('youtube', 'Rockstar YouTube')}
        {line('googlenews', 'Google News')}
        {line('reddit', 'r/GTA6')}
      </div>
    </div>
  );
}

function Search({ content, news, initial }) {
  const [q, setQ] = useState(initial || '');
  const results = useMemo(() => searchAll(q, content, news), [q, content, news]);
  useEffect(() => {
    const el = document.getElementById('search-input');
    if (el && !initial) el.focus();
  }, []);
  const secIcon = (id) => content.sections.find((s) => s.id === id)?.icon || '';
  return (
    <div>
      <h1 className="page-title">Search</h1>
      <div className="search-box">
        <input id="search-input" className="search-input" type="search" placeholder="Characters, places, features, news…" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="off" autoCorrect="off" />
      </div>
      {q && !results.length ? <div className="empty">No matches for “{q}”.</div> : null}
      {results.map((r) =>
        r.kind === 'news' ? (
          <a key={r.id} className="result" href={r.url} target="_blank" rel="noopener">
            <div className="result-title">📰 {r.title}</div>
            <div className="result-sub">{r.sub}</div>
          </a>
        ) : (
          <a key={r.id} className="result" href={href(r.kind === 'timeline' ? '/s/timeline' : `/e/${r.id}`)}>
            <div className="result-title">{secIcon(r.section)} {r.title}{r.spoiler ? ' · spoiler' : ''}</div>
            <div className="result-sub">{r.sub}</div>
          </a>
        )
      )}
      {!q ? (
        <div className="empty">Search every entry, fact, timeline event and news item.</div>
      ) : null}
    </div>
  );
}

function Saved({ content, favs, spoilers }) {
  const items = favs.map((id) => content.byId[id]).filter(Boolean);
  return (
    <div>
      <h1 className="page-title">Saved</h1>
      <p className="page-blurb">Entries you starred. Stored on this device only.</p>
      {items.length ? items.map((e) => <EntryCard key={e.id} entry={e} spoilers={spoilers} sectionLabel={content.sections.find((s) => s.id === e.section)?.title} />) : <div className="empty">Nothing saved yet. Tap the star on any entry.</div>}
    </div>
  );
}

function Settings({ spoilers, setSpoilers, read, clearRead, content, news }) {
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="switch">
        <div>Show spoilers everywhere<small>Story and mission entries open without the gate.</small></div>
        <button className={`toggle ${spoilers ? 'on' : ''}`} onClick={() => setSpoilers(!spoilers)} aria-pressed={spoilers} aria-label="Show spoilers" />
      </div>
      <div className="switch">
        <div>Mark all news as unread<small>{read.length} items marked read on this device.</small></div>
        <button className="btn btn-sm" onClick={clearRead}>Reset</button>
      </div>
      <div className="section-h"><h2>About</h2></div>
      <p style={{ fontSize: 14, color: 'var(--muted)' }}>
        {SITE_NAME} is a personal, unofficial fan encyclopedia for Grand Theft Auto VI. It is not affiliated with Rockstar Games or Take-Two. Facts are summarised in our own words and linked to their sources; official media is shown through YouTube embeds and links, never re-hosted.
      </p>
      <p style={{ fontSize: 13, color: 'var(--dim)' }}>
        {content.entries.length} entries · {content.timeline.length} timeline events · feed {news.generated ? `updated ${timeAgo(news.generated)}` : 'not generated yet'} · build {window.__BUILD || 'dev'}
      </p>
    </div>
  );
}

function NotFound() {
  return <div className="empty">Nothing here. <a href={href('/')}>Back home</a></div>;
}

// ---- app shell ----------------------------------------------------------------------
function App() {
  const route = useRoute();
  const [content, setContent] = useState(null);
  const [news, setNews] = useState({ official: [], press: [], community: [], sources: {} });
  const [err, setErr] = useState(null);
  const [spoilers, setSpoilers] = usePersisted('gta6.spoilers', false);
  const [favs, setFavs] = usePersisted('gta6.favs', []);
  const [read, setRead] = usePersisted('gta6.read', []);

  useEffect(() => {
    loadContent().then(setContent).catch((e) => setErr(String(e.message || e)));
    loadNews().then((n) => setNews(tagGroups(n)));
  }, []);
  // refresh the feed when the app comes back to the foreground
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && loadNews().then((n) => setNews(tagGroups(n)));
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const toggleFav = (id) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
  const markRead = (id) => setRead((r) => (r.includes(id) ? r : [id, ...r].slice(0, 500)));
  const unread = (news.official || []).filter((n) => !read.includes(n.id)).length;

  const [p0, p1] = route.parts;
  let page = null;
  if (err) page = <div className="error">Couldn't load content: {err}</div>;
  else if (!content) page = <div className="loading">Loading…</div>;
  else if (!p0) page = <Home content={content} news={news} read={read} markRead={markRead} />;
  else if (p0 === 'browse') page = <Browse content={content} />;
  else if (p0 === 's' && p1) page = <SectionPage content={content} sectionId={p1} spoilers={spoilers} />;
  else if (p0 === 'e' && p1) page = <EntryPage content={content} id={p1} spoilers={spoilers} favs={favs} toggleFav={toggleFav} />;
  else if (p0 === 'news') page = <Feed news={news} tab={route.query.tab} read={read} markRead={markRead} />;
  else if (p0 === 'search') page = <Search content={content} news={news} initial={route.query.q} />;
  else if (p0 === 'saved') page = <Saved content={content} favs={favs} spoilers={spoilers} />;
  else if (p0 === 'settings') page = <Settings spoilers={spoilers} setSpoilers={setSpoilers} read={read} clearRead={() => setRead([])} content={content} news={news} />;
  else page = <NotFound />;

  const navItem = (path, icon, label, active) => (
    <a className={`nav-item ${active ? 'active' : ''}`} href={href(path)}>
      <Icon name={icon} />
      <span>{label}{icon === 'news' && unread ? ` (${unread})` : ''}</span>
    </a>
  );

  return (
    <div className="app">
      <header className="header">
        <a className="brand" href={href('/')}>
          <BrandMark />
          <span>{SITE_NAME}<span className="brand-sub">GTA VI encyclopedia</span></span>
        </a>
        <div className="header-spacer" />
        <a className="chip-countdown" href={href('/')} title="Days until launch"><Countdown target={LAUNCH} compact /></a>
        <a className="btn btn-icon settings-btn" href={href('/settings')} aria-label="Settings"><Icon name="gear" /></a>
      </header>
      <nav className="nav">
        {navItem('/', 'home', 'Home', !p0)}
        {navItem('/browse', 'browse', 'Browse', p0 === 'browse' || p0 === 's' || p0 === 'e')}
        {navItem('/news', 'news', 'News', p0 === 'news')}
        {navItem('/search', 'search', 'Search', p0 === 'search')}
        {navItem('/saved', 'saved', 'Saved', p0 === 'saved')}
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}

function tagGroups(n) {
  const out = { ...n };
  for (const g of ['official', 'press', 'community']) out[g] = (n[g] || []).map((x) => ({ ...x, group: g }));
  return out;
}

createRoot(document.getElementById('root')).render(<App />);
