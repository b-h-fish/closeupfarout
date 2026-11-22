// Vercel serverless function — Instrument 01
// Returns 4 voice objects: 2 Wikipedia + 2 Project Gutenberg
//
// Wikipedia note: MediaWiki caps full-article extracts at exlimit=1 per request,
// regardless of how many titles you pass. We run two parallel single-article
// requests instead, each retrying until a non-stub article is found.
//
// Gutenberg note: books are drawn from a ~61k-title manifest (api/books.json,
// built by scripts/build-gutenberg-manifest.py) covering all English prose in
// the catalog. We fetch the full text and pull a contiguous passage from
// anywhere in the book — not just the opening pages. Exact search (?search=) and
// direct load (?book=) run against this manifest; no external service needed.

module.exports.config = { maxDuration: 30 };

const BOOKS = require('./books.json');
const BOOKS_BY_ID = new Map(BOOKS.map(b => [b.id, b]));

const VOICE_COLORS = ['#c07a2b', '#8b3d6b', '#2b6e8b', '#4a7a46'];

const WIKI_UA = 'closeupfarout.com/instrument-01 (hello@closeupfarout.com)';

// How many contiguous paragraphs one voice contributes. Wikipedia's window is
// small so its random start engages on most articles (which are short), letting
// a voice begin deep in the article rather than always at the lead section.
const GUT_WINDOW  = 0;  // 0 = return all cleaned paragraphs (client handles windowing)
const WIKI_WINDOW = 8;

// ── Wikipedia ──────────────────────────────────────────────────────────────

function cleanWiki(text) {
  if (!text) return [];
  return text
    .replace(/\r\n/g, '\n')
    .replace(/={1,6}[^\n]+=+\n?/g, '')
    .replace(/\[\d+\]/g, '')
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p =>
      p.length >= 120 &&
      !/^\d+$/.test(p) &&
      !/^See also\b/i.test(p) &&
      !/^https?:\/\//i.test(p) &&
      !/^References\b/i.test(p) &&
      !/^External links\b/i.test(p) &&
      !/^Further reading\b/i.test(p) &&
      // Skip paragraphs that are mostly URLs / Archived-from patterns
      (p.match(/https?:\/\//g) || []).length < 2
    );
}

// Contiguous window from anywhere in the list.
function randomWindow(arr, size) {
  if (!size || arr.length <= size) return arr;
  const start = Math.floor(Math.random() * (arr.length - size));
  return arr.slice(start, start + size);
}

// Returns a single Wikipedia voice (no color — the caller assigns it by corner).
async function fetchWikiVoice(attempt) {
  attempt = attempt || 0;
  if (attempt > 8) throw new Error('Wikipedia: could not find a non-stub article after 9 attempts');

  const params = new URLSearchParams({
    action: 'query', generator: 'random',
    grnnamespace: '0', grnlimit: '1',
    prop: 'extracts', explaintext: 'true',
    exsectionformat: 'plain',
    format: 'json', origin: '*',
  });

  const res = await fetch('https://en.wikipedia.org/w/api.php?' + params, {
    headers: { 'User-Agent': WIKI_UA },
  });
  if (!res.ok) throw new Error('Wikipedia API ' + res.status);

  const data = await res.json();
  const page = Object.values(data.query && data.query.pages || {})[0];

  // Retry stubs
  if (!page || !page.extract || page.extract.length < 1500) {
    return fetchWikiVoice(attempt + 1);
  }

  const paragraphs = cleanWiki(page.extract);
  if (paragraphs.length < 3) return fetchWikiVoice(attempt + 1);

  return {
    title: page.title, author: null, source: 'Wikipedia',
    paragraphs: randomWindow(paragraphs, WIKI_WINDOW),
  };
}

// ── Project Gutenberg ──────────────────────────────────────────────────────


// Books come from our own R2 corpus rather than gutenberg.org. Each object is
// the cleaned paragraph array for one book, stored gzipped with a matching
// Content-Encoding so fetch() inflates it for us — the cleaning that used to
// run on every request now happens once, at build time, in scripts/.
//
// Nothing here falls back to gutenberg.org. That dependency is what took Cento
// down when the archive went offline, and the corpus is a frozen snapshot, so
// a miss means the object is genuinely absent rather than temporarily
// unreachable. See scripts/build-corpus.js to rebuild.
//
// This is the r2.dev development URL — rate-limited, and with no Cloudflare
// cache, WAF or Access in front of it. Moving the zone to Cloudflare would
// allow a custom domain and caching; CORPUS_BASE is the only thing to change.
const CORPUS_BASE = (process.env.CORPUS_BASE ||
  'https://pub-d1324c09cd0143a29e18b22877716331.r2.dev')
  .replace(/\/+$/, '');

async function fetchCorpusParagraphs(id) {
  try {
    const res = await fetch(CORPUS_BASE + '/books/' + id + '.json.gz');
    if (!res.ok) return null;
    const paragraphs = await res.json();
    return Array.isArray(paragraphs) && paragraphs.length ? paragraphs : null;
  } catch (_) {
    return null;
  }
}

// Reference works are lists, not prose — one drawn into a corner fills the
// weave with headwords and entry fragments. Skipped on random draws only: Find
// and direct id loads still reach them, so Bierce's Devil's Dictionary or
// Johnson's Preface are there for anyone who asks for them by name.
const REFERENCE_TITLE = /\b(dictionar(y|ies)|encyclopa?edias?|catalogues?|catalogs?)\b/i;

function isReferenceWork(book) {
  return REFERENCE_TITLE.test(book.title || '');
}

function pickRandomBook(usedIds) {
  let book;
  do {
    book = BOOKS[Math.floor(Math.random() * BOOKS.length)];
  } while (usedIds.has(book.id) || isReferenceWork(book));
  return book;
}

// Draws a random book, fetches its full text, and returns a contiguous passage
// from anywhere within it (no color — the caller assigns it by corner). Retries
// with a different book if a draw fails (404, too short, or unclean) — expected
// occasionally across a 20k-title pool.
async function fetchGutenbergVoice(usedIds, attempt) {
  attempt = attempt || 0;
  if (attempt > 6) throw new Error('Gutenberg: no usable book after ' + attempt + ' attempts');

  const book = pickRandomBook(usedIds);
  usedIds.add(book.id); // reserve immediately so retries/other voice skip it

  // Already cleaned and already past the paragraph floor at build time, so a
  // null here means the object is missing, not that the book was unusable.
  const all = await fetchCorpusParagraphs(book.id);
  if (!all) return fetchGutenbergVoice(usedIds, attempt + 1);

  return {
    id: book.id, title: book.title, author: book.author, source: 'Project Gutenberg',
    paragraphs: randomWindow(all, GUT_WINDOW),
  };
}

// Loads one specific book by id — used by exact search and by "new passage from
// the same work." No random retry — if the chosen book can't be fetched/cleaned,
// the caller surfaces an error.
async function fetchGutenbergVoiceById(id) {
  const book = BOOKS_BY_ID.get(id) || { id, title: null, author: null };
  const all = await fetchCorpusParagraphs(id);
  if (!all) throw new Error('Gutenberg ' + id + ': not in the corpus');

  return {
    id: book.id, title: book.title, author: book.author, source: 'Project Gutenberg',
    paragraphs: randomWindow(all, GUT_WINDOW),
  };
}

// ── Exact search over the manifest ──────────────────────────────────────────

// Lowercased title/author index, built once per instance for fast substring search.
const SEARCH_INDEX = BOOKS.map(b => ({
  b, t: b.title.toLowerCase(), a: (b.author || '').toLowerCase(),
}));

function searchBooks(query, limit) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const e of SEARCH_INDEX) {
    let score = 0;
    if (e.t === q) score = 100;
    else if (e.t.startsWith(q)) score = 80;
    else if (e.t.includes(' ' + q)) score = 60;
    else if (e.t.includes(q)) score = 40;
    else if (e.a.includes(q)) score = 20;
    if (score) scored.push({ e, score });
  }
  // Higher score first; ties broken by lower id (older ~ more canonical).
  scored.sort((x, y) => y.score - x.score || x.e.b.id - y.e.b.id);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const key = s.e.t + '||' + s.e.a;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: s.e.b.id, title: s.e.b.title, author: s.e.b.author });
    if (out.length >= (limit || 20)) break;
  }
  return out;
}

// ── Handler ────────────────────────────────────────────────────────────────

const DEFAULT_SOURCES = ['gutenberg', 'gutenberg', 'gutenberg', 'gutenberg'];

function normSource(s) {
  return String(s || '').toLowerCase() === 'gutenberg' ? 'gutenberg' : 'wikipedia';
}

function fallbackVoice(color) {
  return { title: 'Voice unavailable', author: null, source: 'error', color, paragraphs: [] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};

  try {
    // ── Exact search: return matching books for a corner's Find box ───────
    if (typeof q.search === 'string') {
      return res.status(200).json({ results: searchBooks(q.search, 20) });
    }

    // ── Load a specific book by id into a corner ─────────────────────────
    if (q.book) {
      const id = parseInt(q.book, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad book id' });
      const voice = await fetchGutenbergVoiceById(id);
      return res.status(200).json({ voice });
    }

    // ── Single-voice mode: refresh or toggle one corner ──────────────────
    if (q.single) {
      const src = normSource(q.single);
      const voice = src === 'gutenberg'
        ? await fetchGutenbergVoice(new Set())
        : await fetchWikiVoice();
      // No color — the frontend keeps the corner's existing color.
      return res.status(200).json({ voice });
    }

    // ── Full pairing: one voice per corner, source list from ?sources= ───
    let sources = DEFAULT_SOURCES;
    if (typeof q.sources === 'string' && q.sources.trim()) {
      const parsed = q.sources.split(',').map(normSource);
      if (parsed.length === 4) sources = parsed;
    }

    const usedIds = new Set(); // shared so two Gutenberg corners never collide

    const settled = await Promise.allSettled(
      sources.map(src =>
        src === 'gutenberg' ? fetchGutenbergVoice(usedIds) : fetchWikiVoice()
      )
    );

    const voices = settled.map((s, i) => {
      const color = VOICE_COLORS[i];
      return s.status === 'fulfilled' ? { ...s.value, color } : fallbackVoice(color);
    });

    // ?window=N trims each voice to a contiguous run of N paragraphs. Cento
    // itself wants the whole book (Passage and Dialogue read across all of it),
    // but the landing-page weave needs only a few dozen sentences and would
    // otherwise pull about a megabyte of JSON to show them.
    const win = parseInt(q.window, 10);
    if (Number.isFinite(win) && win > 0) {
      voices.forEach(v => { v.paragraphs = randomWindow(v.paragraphs, win); });
    }

    res.status(200).json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
