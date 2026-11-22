#!/usr/bin/env node
//
// Gate the corpus before it goes to R2.
//
// A corpus built with the wrong cleaner looks entirely healthy by structural
// checks — right book count, valid JSON, sane paragraph counts — and only shows
// up as boilerplate in the opening line. That is the check that actually
// matters, so it is the one that fails the build.
//
//   node scripts/verify-corpus.js <corpusdir>
//
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: node scripts/verify-corpus.js <corpusdir>');
  process.exit(1);
}

// Matches what the tightened isFrontMatter is supposed to be removing.
const BOILERPLATE = /project\s+gutenberg|\be-?texts?\b|^credits?\b|^transcriber|^produced by|^e-text prepared/i;

// Measured ceiling: the tightened cleaner leaves ~0.5% of books opening on a
// stray credit line, against ~5.6% for the untightened one. Anything above this
// means the wrong cleaner ran.
const MAX_BOILERPLATE_PCT = 1.5;

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'books.json')));
let checked = 0, dirty = 0, broken = 0, short = 0;
const samples = [];

for (const b of manifest) {
  const f = path.join(DIR, 'books', b.id + '.json.gz');
  let paras;
  try {
    paras = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));
  } catch (e) {
    broken++;
    continue;
  }
  if (!Array.isArray(paras) || paras.some(p => typeof p !== 'string')) { broken++; continue; }
  if (paras.length < 12) short++;
  checked++;
  if (BOILERPLATE.test(paras[0])) {
    dirty++;
    if (samples.length < 5) samples.push([b.id, paras[0].slice(0, 70)]);
  }
}

const pct = dirty / checked * 100;
console.log('=== corpus verification ===');
console.log('  manifest entries      ' + manifest.length);
console.log('  objects read          ' + checked);
console.log('  unreadable/malformed  ' + broken);
console.log('  under 12 paragraphs   ' + short);
console.log('  opening on boilerplate ' + dirty + '  (' + pct.toFixed(2) + '%)');
if (samples.length) {
  console.log('\n  samples:');
  for (const [id, p] of samples) console.log('    #' + String(id).padEnd(7) + '"' + p + '…"');
}

const fail = [];
if (broken) fail.push(broken + ' objects unreadable');
if (short) fail.push(short + ' books under the paragraph floor');
if (checked !== manifest.length) fail.push('manifest and objects disagree');
if (pct > MAX_BOILERPLATE_PCT) {
  fail.push('boilerplate ' + pct.toFixed(2) + '% exceeds ' + MAX_BOILERPLATE_PCT +
            '% — this is what a stale cleaner looks like');
}

console.log();
if (fail.length) {
  console.log('FAILED: ' + fail.join('; '));
  process.exit(1);
}
console.log('PASSED — safe to upload');
