// Vercel serverless function — Instrument 01
// Returns 4 voice objects: 2 Wikipedia + 2 Project Gutenberg
//
// Wikipedia note: MediaWiki caps full-article extracts at exlimit=1 per request,
// regardless of how many titles you pass. We run two parallel single-article
// requests instead, each retrying until a non-stub article is found.

module.exports.config = { maxDuration: 30 };

const VOICE_COLORS = ['#c07a2b', '#8b3d6b', '#2b6e8b', '#4a7a46'];

const BOOKS = [
  { id: 11,    title: "Alice's Adventures in Wonderland",           author: 'Lewis Carroll' },
  { id: 23,    title: 'Narrative of the Life of Frederick Douglass', author: 'Frederick Douglass' },
  { id: 26,    title: 'Paradise Lost',                               author: 'John Milton' },
  { id: 35,    title: 'The Time Machine',                            author: 'H.G. Wells' },
  { id: 36,    title: 'The War of the Worlds',                       author: 'H.G. Wells' },
  { id: 43,    title: 'The Strange Case of Dr Jekyll and Mr Hyde',   author: 'Robert Louis Stevenson' },
  { id: 76,    title: 'Adventures of Huckleberry Finn',              author: 'Mark Twain' },
  { id: 84,    title: 'Frankenstein',                                author: 'Mary Shelley' },
  { id: 98,    title: 'A Tale of Two Cities',                        author: 'Charles Dickens' },
  { id: 103,   title: 'Around the World in Eighty Days',             author: 'Jules Verne' },
  { id: 120,   title: 'Treasure Island',                             author: 'Robert Louis Stevenson' },
  { id: 135,   title: 'Les Misérables',                              author: 'Victor Hugo' },
  { id: 145,   title: 'Middlemarch',                                 author: 'George Eliot' },
  { id: 158,   title: 'Emma',                                        author: 'Jane Austen' },
  { id: 161,   title: 'Sense and Sensibility',                       author: 'Jane Austen' },
  { id: 174,   title: 'The Picture of Dorian Gray',                  author: 'Oscar Wilde' },
  { id: 205,   title: 'Walden',                                      author: 'Henry David Thoreau' },
  { id: 219,   title: 'Heart of Darkness',                           author: 'Joseph Conrad' },
  { id: 345,   title: 'Dracula',                                     author: 'Bram Stoker' },
  { id: 768,   title: 'Wuthering Heights',                           author: 'Emily Brontë' },
  { id: 844,   title: 'The Importance of Being Earnest',             author: 'Oscar Wilde' },
  { id: 969,   title: 'The Tenant of Wildfell Hall',                 author: 'Anne Brontë' },
  { id: 996,   title: 'Don Quixote',                                 author: 'Miguel de Cervantes' },
  { id: 1228,  title: 'On the Origin of Species',                    author: 'Charles Darwin' },
  { id: 1260,  title: 'Jane Eyre',                                   author: 'Charlotte Brontë' },
  { id: 1322,  title: 'Leaves of Grass',                             author: 'Walt Whitman' },
  { id: 1342,  title: 'Pride and Prejudice',                         author: 'Jane Austen' },
  { id: 1399,  title: 'Anna Karenina',                               author: 'Leo Tolstoy' },
  { id: 1400,  title: 'Great Expectations',                          author: 'Charles Dickens' },
  { id: 1497,  title: 'The Republic',                                author: 'Plato' },
  { id: 1524,  title: 'Hamlet',                                      author: 'William Shakespeare' },
  { id: 1532,  title: 'King Lear',                                   author: 'William Shakespeare' },
  { id: 1533,  title: 'Macbeth',                                     author: 'William Shakespeare' },
  { id: 1600,  title: 'Symposium',                                   author: 'Plato' },
  { id: 1727,  title: 'The Odyssey',                                 author: 'Homer' },
  { id: 1998,  title: 'Thus Spoke Zarathustra',                      author: 'Friedrich Nietzsche' },
  { id: 2554,  title: 'Crime and Punishment',                        author: 'Fyodor Dostoevsky' },
  { id: 2641,  title: 'A Room with a View',                          author: 'E.M. Forster' },
  { id: 2680,  title: 'Meditations',                                 author: 'Marcus Aurelius' },
  { id: 2701,  title: 'Moby-Dick',                                   author: 'Herman Melville' },
  { id: 4517,  title: 'Ethan Frome',                                 author: 'Edith Wharton' },
  { id: 5200,  title: 'The Metamorphosis',                           author: 'Franz Kafka' },
  { id: 6130,  title: 'The Iliad',                                   author: 'Homer' },
  { id: 8800,  title: 'The Divine Comedy',                           author: 'Dante Alighieri' },
  { id: 16643, title: 'Essays',                                      author: 'Ralph Waldo Emerson' },
  { id: 25344, title: 'The Scarlet Letter',                          author: 'Nathaniel Hawthorne' },
  { id: 28054, title: 'The Brothers Karamazov',                      author: 'Fyodor Dostoevsky' },
];

const WIKI_UA = 'closeupfarout.com/instrument-01 (hello@closeupfarout.com)';

function pickN(n, arr) {
  return arr.slice().sort(() => Math.random() - 0.5).slice(0, n);
}

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

  const paragraphs = cleanWiki(page.extract).slice(0, 60);
  if (paragraphs.length < 3) return getOneWikiVoice(color, attempt + 1);

  return { title: page.title, author: null, source: 'Wikipedia', color, paragraphs };
}

async function getWikiVoices() {
  const results = await Promise.all([
    getOneWikiVoice(VOICE_COLORS[0]),
    getOneWikiVoice(VOICE_COLORS[1]),
  ]);
  return results;
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

async function getGutenbergVoice(book, color) {
  const url = 'https://www.gutenberg.org/cache/epub/' + book.id + '/pg' + book.id + '.txt';
  const res = await fetch(url, { headers: { 'User-Agent': 'closeupfarout.com/instrument-01' } });
  if (!res.ok) throw new Error('Gutenberg ' + book.id + ': ' + res.status);

  const raw = (await res.text()).slice(0, 220000);
  const all = cleanGutenberg(raw);

  if (all.length < 5) throw new Error('Gutenberg ' + book.id + ': only ' + all.length + ' paras after cleaning');

  // Skip the first ~5% of cleaned paragraphs (lingering front matter), then take a random window
  const body = all.slice(Math.max(4, Math.floor(all.length * 0.05)));
  const start = body.length > 40 ? Math.floor(Math.random() * Math.max(1, body.length - 40)) : 0;

  return { title: book.title, author: book.author, source: 'Project Gutenberg', color, paragraphs: body.slice(start, start + 50) };
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [bookA, bookB] = pickN(2, BOOKS);

    const [wikiResult, gut1, gut2] = await Promise.allSettled([
      getWikiVoices(),
      getGutenbergVoice(bookA, VOICE_COLORS[2]),
      getGutenbergVoice(bookB, VOICE_COLORS[3]),
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
