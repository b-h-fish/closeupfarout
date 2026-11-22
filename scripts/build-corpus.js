#!/usr/bin/env node
//
// Build the Cento corpus for R2.
//
// Streams the common-pile Project Gutenberg dump, cleans each book with the
// same rules the API used to run per request, joins it to the existing manifest
// by Gutenberg id so authors survive, and writes one gzipped paragraph array
// per book plus a matching books.json.
//
// Source is a frozen snapshot — its records carry added:2024-05-14 — rather
// than a live mirror of gutenberg.org, so a rebuild reproduces the same corpus
// and nothing upstream can change it underneath us.
//
//   node scripts/build-corpus.js <outdir> [shards]
//
// Then upload with Content-Encoding set, so the API can fetch().json() the
// objects without decompressing them itself:
//
//   rclone copy <outdir>/books cento-r2:cento-corpus/books \
//     --header-upload "Content-Encoding: gzip" \
//     --header-upload "Content-Type: application/json" \
//     --transfers 48 --checkers 32
//
const fs = require('fs'), zlib = require('zlib'), readline = require('readline');
const path = require('path'), https = require('https');
const { cleanGutenberg } = require('./clean-gutenberg.js');

const OUT = process.argv[2];
const SHARDS = Number(process.argv[3] || 30);
if (!OUT) {
  console.error('usage: node scripts/build-corpus.js <outdir> [shards]');
  process.exit(1);
}

// Below this a "book" is a fragment — a nursery rhyme, an alphabet card — with
// too little prose to weave. The API used to retry past these at request time.
const MIN_PARAS = 12;
const BASE = 'https://huggingface.co/datasets/common-pile/project_gutenberg/' +
             'resolve/main/v0/documents/';

const raw = require('../api/books.json');
const books = Array.isArray(raw) ? raw : (raw.books || Object.values(raw)[0]);
const byId = new Map(books.map(b => [String(b.id), b]));

fs.mkdirSync(path.join(OUT, 'books'), { recursive: true });

const manifest = [];
let seen = 0, written = 0, noMatch = 0, tooShort = 0, bytes = 0;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'closeupfarout-corpus-build' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function doShard(i) {
  const name = String(i).padStart(5, '0') + '_pg.jsonl.gz';
  const res = await get(BASE + name);
  const rl = readline.createInterface({
    input: res.pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    seen++;

    // common-pile carries no author and reaches past English; the manifest is
    // the authority on both. No entry means we don't want the book.
    const meta = byId.get(String(r.id));
    if (!meta) { noMatch++; continue; }

    const paras = cleanGutenberg(r.text);
    if (paras.length < MIN_PARAS) { tooShort++; continue; }

    const buf = zlib.gzipSync(JSON.stringify(paras), { level: 9 });
    fs.writeFileSync(path.join(OUT, 'books', r.id + '.json.gz'), buf);
    bytes += buf.length;
    written++;
    manifest.push({ id: Number(r.id), title: meta.title, author: meta.author || null });
  }

  console.log('  shard ' + String(i).padStart(2) +
              '  seen ' + String(seen).padStart(6) +
              '  written ' + String(written).padStart(6) +
              '  ' + (bytes / 1073741824).toFixed(2) + ' GB');
}

(async () => {
  const t0 = Date.now();
  for (let i = 0; i < SHARDS; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await doShard(i); break; }
      catch (e) {
        console.log('  shard ' + i + ' attempt ' + (attempt + 1) + ' failed: ' + e.message);
        if (attempt === 2) throw e;
      }
    }
  }

  // The manifest is built from what actually landed, so every entry Find can
  // reach has an object behind it — the two can't drift apart.
  manifest.sort((a, b) => a.id - b.id);
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(manifest));

  console.log('\n=== corpus built in ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min ===');
  console.log('  texts seen           ' + seen);
  console.log('  written              ' + written);
  console.log('  not in manifest      ' + noMatch);
  console.log('  under ' + MIN_PARAS + ' paragraphs   ' + tooShort);
  console.log('  total size           ' + (bytes / 1073741824).toFixed(2) + ' GB');
  console.log('  manifest entries     ' + manifest.length);
  console.log('  with author          ' + manifest.filter(m => m.author).length);
})();
