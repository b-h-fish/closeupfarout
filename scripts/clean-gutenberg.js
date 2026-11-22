// Cleaning rules for the Gutenberg corpus. These ran per-request against
// gutenberg.org before the move to R2; now they run once, here, at build time.
// Keeping them versioned beside the builder is what makes the corpus
// rebuildable — change a rule and the corpus has to be rebuilt to match.
// ── Project Gutenberg ──────────────────────────────────────────────────────

function isToc(p) {
  const hits = (p.match(/\b(chapter|letter|act|scene|book|part|canto)\s+([ivxlcdmIVXLCDM]+|\d+)/gi) || []).length;
  return hits >= 3;
}

// Project Gutenberg's own apparatus — retranscription notes, cross-references
// to other ebooks, copyright headers. Measured across 1.64M cleaned paragraphs,
// the phrase "Project Gutenberg" and the word "etext" appear in 0.011% of them,
// and sampled deep inside books they are boilerplate every time: this corpus is
// public-domain prose that predates both terms.
const PG_APPARATUS = /\bproject\s+gutenberg\b|\be-?texts?\b/i;

// Digitiser credits that don't name Gutenberg outright. Anchored at the start
// so a passing mention mid-paragraph can't strip real prose.
const CREDIT_OPENING = new RegExp(
  '^(?:produced|transcribed|scanned|prepared|proofread|digiti[sz]ed)\\s+by\\b' +
  '|^(?:transcriber|editorial|translator)(?:\'s|s\')?\\s+note\\b' +
  '|^credits?\\b' +
  '|^we\\s+are\\s+releasing\\b' +
  '|^many\\s+thanks\\s+to\\b' +
  '|^updated\\s+editions\\b' +
  '|^distributed\\s+proofread',
  'i'
);

function isFrontMatter(p) {
  if (/^(chapter|book|part|volume|section|act|scene|contents?|preface|introduction|appendix|prologue|epilogue|notes?|translator|illustrations?)\b/i.test(p)) return true;
  if (/^[MDCLXVI]+\.?\s*$/.test(p)) return true;
  if (/^\[/.test(p)) return true;
  if (/^[_*]{3,}/.test(p)) return true;
  if (PG_APPARATUS.test(p)) return true;
  if (CREDIT_OPENING.test(p)) return true;
  const caps = (p.match(/[A-Z]/g) || []).length;
  if (caps / p.length > 0.35) return true;
  if (isToc(p)) return true;
  return false;
}

// Hard citation signals used to identify (and trim) an attribution/reference
// tail. Deliberately conservative — bare years and "No." are excluded as too
// ambiguous, so we only trim when a page/volume/edition/op.cit./ibid. marker
// is present.
const CITE_SIGNAL = /\bpp?\.\s*\d|\bvols?\.|\bop\.\s*cit|\bibid\b|\bedition\b/i;

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
    .filter(p => p.length >= 120 && !isFrontMatter(p))
    .map(p => {
      // Gutenberg plain-text conventions: _underscores_ mark italics, =equals=
      // mark bold, and runs of two-or-more hyphens are an ASCII em dash
      // (night--and day). Strip the emphasis markers, convert the dashes, and
      // remove footnote/reference markers [1] and editorial [sic] (bracketed
      // words like [Slavery] are kept as texture). Single hyphens (well-known)
      // are left alone.
      p = p
        .replace(/[_=]/g, '')
        .replace(/-{2,}/g, '—')
        .replace(/\[\d+\]/g, '')
        .replace(/\[sic\.?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      // Conservative attribution trim: drop a trailing em-dash citation tail,
      // but only when the em dash follows a terminator/closing-quote AND the
      // tail carries a hard citation signal — so narrative asides survive.
      p = p.replace(/([.!?…"”'’])\s*—\s*[^—]*$/, (m, punct) =>
        CITE_SIGNAL.test(m) ? punct : m
      );
      return p.trim();
    });
}

// Gutenberg serves text at a few different URL shapes depending on the book's

module.exports = { cleanGutenberg, isFrontMatter, isToc };
