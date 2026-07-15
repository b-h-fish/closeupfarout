// Vercel serverless function — Instrument 01
// Returns 4 voice objects: 2 Wikipedia + 2 Project Gutenberg
//
// Wikipedia note: MediaWiki caps full-article extracts at exlimit=1 per request,
// regardless of how many titles you pass. We run two parallel single-article
// requests instead, each retrying until a non-stub article is found.
//
// Gutenberg note: books are drawn from a ~20k-title manifest (api/books.json,
// built by scripts/build-gutenberg-manifest.py). We fetch the full text and pull
// a contiguous passage from anywhere in the book — not just the opening pages.

module.exports.config = { maxDuration: 30 };

const BOOKS = require('./books.json');

const VOICE_COLORS = ['#c07a2b', '#8b3d6b', '#2b6e8b', '#4a7a46'];

const WIKI_UA = 'closeupfarout.com/instrument-01 (hello@closeupfarout.com)';
const GUT_UA  = 'closeupfarout.com/instrument-01 (hello@closeupfarout.com)';

// Cap absurdly large files (dictionaries, complete-works compilations) so a
// single draw can't blow the function's time/memory budget. Normal novels are
// 0.5–2 MB, so this preserves full-text access for essentially every real book.
const MAX_BYTES = 4000000;

// How many contiguous paragraphs one voice contributes.
const GUT_WINDOW  = 50;
const WIKI_WINDOW = 30;

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
  if (arr.length <= size) return arr;
  const start = Math.floor(Math.random() * (arr.length - size));
  return arr.slice(start, start + size);
}

async function getOneWikiVoice(color, attempt) {
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
    return getOneWikiVoice(color, attempt + 1);
  }

  const paragraphs = cleanWiki(page.extract);
  if (paragraphs.length < 3) return getOneWikiVoice(color, attempt + 1);

  return {
    title: page.title, author: null, source: 'Wikipedia', color,
    paragraphs: randomWindow(paragraphs, WIKI_WINDOW),
  };
}

async function getWikiVoices() {
  return Promise.all([
    getOneWikiVoice(VOICE_COLORS[0]),
    getOneWikiVoice(VOICE_COLORS[1]),
  ]);
}

// ── Project Gutenberg ──────────────────────────────────────────────────────

function isToc(p) {
  const hits = (p.match(/\b(chapter|letter|act|scene|book|part|canto)\s+([ivxlcdmIVXLCDM]+|\d+)/gi) || []).length;
  return hits >= 3;
}

function isFrontMatter(p) {
  if (/^(chapter|book|part|volume|section|act|scene|contents?|preface|introduction|appendix|prologue|epilogue|notes?|translator|illustrations?)\b/i.test(p)) return true;
  if (/^[MDCLXVI]+\.?\s*$/.test(p)) return true;
  if (/^\[/.test(p)) return true;
  if (/^[_*]{3,}/.test(p)) return true;
  if (/^(produced by|transcribed by|scanned by|prepared by|updated editions)/i.test(p)) return true;
  const caps = (p.match(/[A-Z]/g) || []).length;
  if (caps / p.length > 0.35) return true;
  if (isToc(p)) return true;
  return false;
}

function cleanGutenberg(raw) {
  // Normalize Windows CRLF — Gutenberg files always use CRLF; without this
  // the paragraph splitter (/\n{2,}/) never fires.
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const startIdx = text.search(/\*{3}\s*START OF (THE |THIS )?PROJECT/i);
  if (startIdx !== -1) text = text.slice(text.indexOf('\n', startIdx) + 1);

  const endIdx = text.search(/\*{3}\s*END OF (THE |THIS )?PROJECT/i);
  if (endIdx !== -1) text = text.slice(0, endIdx);

  // Strip repeated header block (Title:/Author: metadata after START marker in some files)
  const headerBlock = text.search(/^Title:/im);
  if (headerBlock !== -1 && headerBlock < 4000) {
    const gap = text.indexOf('\n\n', headerBlock);
    if (gap !== -1) text = text.slice(gap);
  }

  return text
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 120 && !isFrontMatter(p));
}

// Gutenberg serves text at a few different URL shapes depending on the book's
// age. Try the modern cache path first, then the older /files/ variants.
function gutenbergUrls(id) {
  return [
    'https://www.gutenberg.org/cache/epub/' + id + '/pg' + id + '.txt',
    'https://www.gutenberg.org/files/' + id + '/' + id + '-0.txt',
    'https://www.gutenberg.org/files/' + id + '/' + id + '.txt',
  ];
}

async function fetchGutenbergText(id) {
  for (const url of gutenbergUrls(id)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': GUT_UA } });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 2000) return text.slice(0, MAX_BYTES);
    } catch (_) { /* try next URL shape */ }
  }
  return null;
}

function pickRandomBook(usedIds) {
  let book;
  do {
    book = BOOKS[Math.floor(Math.random() * BOOKS.length)];
  } while (usedIds.has(book.id));
  return book;
}

// Draws a random book, fetches its full text, and returns a contiguous passage
// from anywhere within it. Retries with a different book if a draw fails (404,
// too short, or unclean) — expected occasionally across a 20k-title pool.
async function getGutenbergVoice(color, usedIds, attempt) {
  attempt = attempt || 0;
  if (attempt > 6) throw new Error('Gutenberg: no usable book after ' + attempt + ' attempts');

  const book = pickRandomBook(usedIds);
  usedIds.add(book.id); // reserve immediately so retries/other voice skip it

  const raw = await fetchGutenbergText(book.id);
  if (!raw) return getGutenbergVoice(color, usedIds, attempt + 1);

  const all = cleanGutenberg(raw);
  if (all.length < 12) return getGutenbergVoice(color, usedIds, attempt + 1);

  return {
    title: book.title, author: book.author, source: 'Project Gutenberg', color,
    paragraphs: randomWindow(all, GUT_WINDOW),
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const usedIds = new Set();

    const [wikiResult, gut1, gut2] = await Promise.allSettled([
      getWikiVoices(),
      getGutenbergVoice(VOICE_COLORS[2], usedIds),
      getGutenbergVoice(VOICE_COLORS[3], usedIds),
    ]);

    const fallback = function(i) {
      return { title: 'Voice unavailable', author: null, source: 'error', color: VOICE_COLORS[i], paragraphs: [] };
    };

    const voices = wikiResult.status === 'fulfilled'
      ? wikiResult.value
      : [fallback(0), fallback(1)];

    voices.push(gut1.status === 'fulfilled' ? gut1.value : fallback(2));
    voices.push(gut2.status === 'fulfilled' ? gut2.value : fallback(3));

    res.status(200).json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
